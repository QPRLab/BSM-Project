// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./tokens/LPToken.sol";

/// @title AMM Liquidity Pool
/// @notice 管理储备和 LPToken，用户通过它 add/remove liquidity，内部调用 LPToken 的 mint/burn
/// @dev This contract manages liquidity for a pair of tokens in an AMM setup.
contract AMMLiquidity is Ownable, ReentrancyGuard {

    
    //相關token合約及地址
    LPToken public immutable lpToken;//LP Token
    IERC20 public immutable stableToken;  //Stable Token
    IERC20 public immutable usdcToken;    //USDC Token
    uint8 public immutable stableDecimals; //1e18
    uint8 public immutable usdcDecimals;   //1e6
    address public swapContract; //AMMSwap合约地址
    address public feeCollector;

    //流动性储备及纍計的管理费
    uint256 public reserveStable; //stableDecimals(18)位精度
    uint256 public reserveUsdc;   //usdcDecimals(6)位精度
    uint256 public adminStableBalance; // 管理费：StableToken (18位精度)
    uint256 public adminUsdcBalance;    // 管理费：USDC (6位精度)

    // 精度常量
    uint256 public constant PRECISION = 10 ** 18;
    
    event SwapContractSet(address indexed swapContract);
    event FeeCollectorSet(address indexed feeCollector);
    event FeeWithdrawn(address indexed feeCollector, uint256 stableAmount, uint256 usdcAmount);
    event ReservesSynced(uint256 reserveStable, uint256 reserveUsdc);
    event SwapExecuted(address indexed user, uint256 inAmount, uint256 outAmount, address indexed inToken, address indexed outToken);
    event LiquidityAdded(address indexed provider, uint256 stableAmount, uint256 usdcAmount, uint256 lpTokensMinted);
    event LiquidityRemoved(address indexed provider, uint256 stableAmount, uint256 usdcAmount, uint256 lpTokensBurned);

    modifier onlySwap() {
        require(msg.sender == swapContract, "Not swap contract");
        _;
    }
    /**
     * @dev 構造函數，初始化 AMM 流動性池
     * @param _stable StableToken 合約地址
     * @param _usdc USDC 合約地址
     * @param _lpName LP Token 名稱
     * @param _lpSymbol LP Token 符號
     */
    constructor(
        address _stable,
        address _usdc,
        string memory _lpName,
        string memory _lpSymbol
    ) Ownable(msg.sender) {

        require(_stable != address(0) && _usdc != address(0), "Invalid token address");
        stableToken = IERC20(_stable);
        usdcToken = IERC20(_usdc);
        stableDecimals = IERC20Metadata(_stable).decimals();
        usdcDecimals = IERC20Metadata(_usdc).decimals();

        // 创建 LP Token 合约
        lpToken = new LPToken(_lpName, _lpSymbol);
    }

    /**
     * @dev 初始化 AMM，設置交換合約和費用收集器地址
     * @param _swapContract AMMSwap 合約地址
     * @param _feeCollector 費用收集器地址
     */
    function initialize(
        address _swapContract,
        address _feeCollector
    ) external onlyOwner {
        require(_swapContract != address(0), "Invalid swap contract");
        require(_feeCollector != address(0), "Invalid fee collector address");
        swapContract = _swapContract;
        feeCollector = _feeCollector;
        emit SwapContractSet(_swapContract);
        emit FeeCollectorSet(_feeCollector);
    }

    /**
     * @dev 添加管理費（僅供 AMMSwap 調用）
     * @param stableFee StableToken 管理費金額（18位精度）
     * @param usdcFee USDC 管理費金額（6位精度）
     */
    function addAdminFee(uint256 stableFee, uint256 usdcFee) external onlySwap {
        adminStableBalance += stableFee;
        adminUsdcBalance += usdcFee;
    }

    /**
     * @notice 将 USDC 转移给 AMMSwap 合约（用于 swapUsdcToLeverage 流程）
     * @dev 此函数用于支持杠杆代币购买流程：
     *      1. AMMSwap 计算需要从池中取出多少 USDC
     *      2. 调用此函数将 USDC 转给 AMMSwap
     *      3. AMMSwap 使用这些 USDC 在 DEX 购买 underlying
     *      4. 铸币后的 S tokens 会存回 AMMLiquidity
     *      5. 最终池子的变化满足 StableSwap 曲线
     * 
     * ⚠️ 注意：此时池子的 USDC 储备减少，但 S token 储备尚未增加
     *          必须在铸币后立即更新储备，确保曲线平衡
     * 
     * @param usdcAmount 要转移的 USDC 数量（6位精度）
     * 
     * Requirements:
     * - 只能由 AMMSwap 合约调用
     * - 池子必须有足够的 USDC 储备
     */
    function transferUsdcToSwap(uint256 usdcAmount) external onlySwap {
        require(usdcAmount > 0, "Amount must be positive");
        require(reserveUsdc >= usdcAmount, "Insufficient USDC reserve");
        
        // 转移 USDC 给 AMMSwap 合约
        require(usdcToken.transfer(msg.sender, usdcAmount), "USDC transfer failed");
        
        // 更新储备（减少 USDC）
        // 注意：S token 储备稍后会通过 syncReserves 更新
        reserveUsdc -= usdcAmount;
    }

        /**
     * @dev 预览：用户输入 stableAmount，返回需要的 usdcAmount 和可获得的 LP Token 数量
     */
function addLiquidityStablePreview(
    uint256 stableAmount) 
    public view 
    returns (
        uint256 requiredUsdcAmount, 
        uint256 expectedLpTokens) 
{
    require(stableAmount > 0, "Stable amount must be positive");
    uint256 totalSupply = lpToken.totalSupply();
    uint256 currentStableBalance = reserveStable; //18位精度
    uint256 currentUsdcBalance = reserveUsdc * (10**(stableDecimals - usdcDecimals)); // 转换为18位精度
    uint256 MINIMUM_LIQUIDITY = 1000;
    // 新增判断：池子极低储备时，按初始流动性逻辑处理
    if (totalSupply <= MINIMUM_LIQUIDITY || currentStableBalance < MINIMUM_LIQUIDITY * (10**stableDecimals) || currentUsdcBalance < MINIMUM_LIQUIDITY * (10**stableDecimals)) {
        requiredUsdcAmount = stableAmount / (10**(stableDecimals - usdcDecimals)); // 转换为6位精度
        expectedLpTokens = stableAmount + stableAmount;
    } else {
        // 按池子比例
        requiredUsdcAmount = (stableAmount * currentUsdcBalance / currentStableBalance) / (10**(stableDecimals - usdcDecimals)); // 转换为6位精度
        uint256 effectiveRatio = stableAmount * PRECISION / currentStableBalance;
        expectedLpTokens = totalSupply * effectiveRatio / PRECISION;
    }
}

    /**
     * @dev 预览：用户输入 usdcAmount，返回需要的 stableAmount 和可获得的 LP Token 数量
     */
function addLiquidityUSDCPreview(
    uint256 usdcAmount) 
    public view 
    returns (
        uint256 requiredStableAmount,
        uint256 expectedLpTokens) 
{
    require(usdcAmount > 0, "USDC amount must be positive");
    uint256 totalSupply = lpToken.totalSupply();
    uint256 currentStableBalance = reserveStable;//18位精度
    uint256 currentUsdcBalance = reserveUsdc * (10**(stableDecimals - usdcDecimals)); // 转换为18位精度
    uint256 MINIMUM_LIQUIDITY = 1000;
    // 新增判断：池子极低储备时，按初始流动性逻辑处理
    if (totalSupply <= MINIMUM_LIQUIDITY || currentStableBalance < MINIMUM_LIQUIDITY * (10**stableDecimals) || currentUsdcBalance < MINIMUM_LIQUIDITY * (10**stableDecimals)) {
        requiredStableAmount = usdcAmount * (10**(stableDecimals - usdcDecimals));
        expectedLpTokens = requiredStableAmount + requiredStableAmount;
    } else {
        // 按池子比例
        uint256 usdcAmountNormalized = usdcAmount * (10**(stableDecimals - usdcDecimals)); // 转换为18位精度
        requiredStableAmount = usdcAmountNormalized * currentStableBalance / currentUsdcBalance;
        uint256 effectiveRatio = requiredStableAmount * PRECISION / currentStableBalance;
        expectedLpTokens = totalSupply * effectiveRatio / PRECISION;
    }
}

    /**
     * @dev 用戶添加流動性（僅輸入 StableToken）
     * @param stableAmount 用戶輸入的 StableToken 數量（18位精度）
     * @return lpTokens 鑄造的 LP Token 數量
     * @return actualStableAmount 實際使用的 StableToken 數量
     * @return actualUsdcAmount 實際使用的 USDC 數量
     */
    function addLiquidityStable(
        uint256 stableAmount) 
        external nonReentrant 
        returns (
            uint256 lpTokens, 
            uint256 actualStableAmount, 
            uint256 actualUsdcAmount) 
    {
        require(stableAmount > 0, "Stable amount must be positive");
        (uint256 requiredUsdcAmount, uint256 expectedLpTokens) = addLiquidityStablePreview(stableAmount);
        // 校验用户余额和授权
        require(stableToken.balanceOf(msg.sender) >= stableAmount, "Insufficient StableToken balance");
        require(usdcToken.balanceOf(msg.sender) >= requiredUsdcAmount, "Insufficient USDC balance");
        require(stableToken.allowance(msg.sender, address(this)) >= stableAmount, "Insufficient StableToken allowance");
        require(usdcToken.allowance(msg.sender, address(this)) >= requiredUsdcAmount, "Insufficient USDC allowance");
        // 执行代币转移
        stableToken.transferFrom(msg.sender, address(this), stableAmount);
        usdcToken.transferFrom(msg.sender, address(this), requiredUsdcAmount);
        // 更新池余额
        reserveStable += stableAmount;
        reserveUsdc += requiredUsdcAmount;
        // 铸造 LP 代币给用户
        uint256 totalSupply = lpToken.totalSupply();
        if (totalSupply == 0) {
            // 初始流动性，锁定最小流动性
            uint256 MINIMUM_LIQUIDITY = 1000;
            lpToken.mint(address(0xdead), MINIMUM_LIQUIDITY); // 锁定到死地址
            expectedLpTokens -= MINIMUM_LIQUIDITY;
        }
        lpToken.mint(msg.sender, expectedLpTokens);
        emit LiquidityAdded(msg.sender, stableAmount, requiredUsdcAmount, expectedLpTokens);
        return (expectedLpTokens, stableAmount, requiredUsdcAmount);
    }

    /**
     * @dev 用戶添加流動性（僅輸入 USDC）
     * @param usdcAmount 用戶輸入的 USDC 數量（6位精度）
     * @return lpTokens 鑄造的 LP Token 數量
     * @return actualStableAmount 實際使用的 StableToken 數量
     * @return actualUsdcAmount 實際使用的 USDC 數量
     */
    function addLiquidityUSDC(
        uint256 usdcAmount) 
        external nonReentrant 
        returns (
            uint256 lpTokens, 
            uint256 actualStableAmount, 
            uint256 actualUsdcAmount) 
    {
        require(usdcAmount > 0, "USDC amount must be positive");
        (uint256 requiredStableAmount, uint256 expectedLpTokens) = addLiquidityUSDCPreview(usdcAmount);
        // 校验用户余额和授权
        require(stableToken.balanceOf(msg.sender) >= requiredStableAmount, "Insufficient StableToken balance");
        require(usdcToken.balanceOf(msg.sender) >= usdcAmount, "Insufficient USDC balance");
        require(stableToken.allowance(msg.sender, address(this)) >= requiredStableAmount, "Insufficient StableToken allowance");
        require(usdcToken.allowance(msg.sender, address(this)) >= usdcAmount, "Insufficient USDC allowance");
        // 执行代币转移
        stableToken.transferFrom(msg.sender, address(this), requiredStableAmount);
        usdcToken.transferFrom(msg.sender, address(this), usdcAmount);
        // 更新池余额
        reserveStable += requiredStableAmount;
        reserveUsdc += usdcAmount;
        // 铸造 LP 代币给用户
        uint256 totalSupply = lpToken.totalSupply();
        if (totalSupply == 0) {
            // 初始流动性，锁定最小流动性
            uint256 MINIMUM_LIQUIDITY = 1000;
            lpToken.mint(address(0xdead), MINIMUM_LIQUIDITY); // 锁定到死地址
            expectedLpTokens -= MINIMUM_LIQUIDITY;
        }
        lpToken.mint(msg.sender, expectedLpTokens);
        emit LiquidityAdded(msg.sender, requiredStableAmount, usdcAmount, expectedLpTokens);
        return (expectedLpTokens, requiredStableAmount, usdcAmount);
    }

    

    /**
     * @dev 用戶移除流動性
     * @param lpTokens 用戶要燃燒的 LP Token 數量
     * @return amountStable 返回的 StableToken 數量（18位精度）
     * @return amountUsdc 返回的 USDC 數量（6位精度）
     */
    function removeLiquidity(
        uint256 lpTokens) 
        external nonReentrant 
        returns (uint256 amountStable, uint256 amountUsdc) 
    {
        require(lpTokens > 0, "LP tokens must be positive");
        require(lpToken.balanceOf(msg.sender) >= lpTokens, "Insufficient LP balance");

        uint256 totalSupply = lpToken.totalSupply();
        require(totalSupply > 0, "No liquidity available");
        amountStable = (lpTokens * reserveStable) / totalSupply;
        amountUsdc = (lpTokens * reserveUsdc) / totalSupply;

        require(amountStable > 0 && amountUsdc > 0, "Amounts must be positive");

        lpToken.burn(msg.sender, lpTokens);
        reserveStable -= amountStable;
        reserveUsdc -= amountUsdc;

        require(stableToken.transfer(msg.sender, amountStable), "Stable transfer failed");
        require(usdcToken.transfer(msg.sender, amountUsdc), "USDC transfer failed");

        emit LiquidityRemoved(msg.sender, amountStable, amountUsdc, lpTokens);
    }

    /**
     * @dev 预览：用户输入 LP Token 数量，返回可获得的 stableAmount 和 usdcAmount
     */
    function removeLiquidityPreview(uint256 lpTokens) external view returns (uint256 amountStable, uint256 amountUsdc) {
        require(lpTokens > 0, "LP tokens must be positive");
        uint256 totalSupply = lpToken.totalSupply();
        amountStable = (lpTokens * reserveStable) / totalSupply;
        amountUsdc = (lpTokens * reserveUsdc) / totalSupply;
    }


    //=======================与AMMSwap交互的函数=======================
    /**
     * @dev 同步儲備（僅供 AMMSwap 調用）
     * @param newReserveStable 新的 StableToken 儲備（18位精度）
     * @param newReserveUsdc 新的 USDC 儲備（6位精度）
     */
    function syncReserves(uint256 newReserveStable, uint256 newReserveUsdc) external onlySwap {
        reserveStable = newReserveStable; //18位精度
        reserveUsdc = newReserveUsdc;     //6位精度
        emit ReservesSynced(newReserveStable, newReserveUsdc);
    }

    /**
     * @dev 獲取當前儲備（僅讀）
     * @return reserveStable StableToken 儲備（18位精度）
     * @return reserveUsdc USDC 儲備（6位精度）
     */
    function getReserves() external view returns (uint256, uint256) {
        return (reserveStable, reserveUsdc);
    }

    /**
     * @dev 執行 StableToken 到 USDC 的交換（僅供 AMMSwap 調用）
     * @param user 用戶地址
     * @param stableAmountIn 輸入的 StableToken 數量（18位精度）
     * @param usdcAmountOut 輸出的 USDC 數量（6位精度）
     */
    function swapStableToUsdc(
        address user, 
        uint256 stableAmountIn,
        uint256 usdcAmountOut) 
        external onlySwap
        {

        require(stableAmountIn > 0 && usdcAmountOut > 0, "Both amounts must be positive");
        require(reserveUsdc >= usdcAmountOut, "Insufficient USDC reserve");

        // 资产转移
        require(stableToken.transferFrom(user, address(this), stableAmountIn), "Stable transfer failed");
        require(usdcToken.transfer(user, usdcAmountOut), "USDC transfer failed");

        // 更新储备
        reserveStable += stableAmountIn;
        reserveUsdc -= usdcAmountOut;

        emit SwapExecuted(user, stableAmountIn, usdcAmountOut, address(stableToken), address(usdcToken));
    }

    /**
     * @dev 執行 USDC 到 StableToken 的交換（僅供 AMMSwap 調用）
     * @param user 用戶地址
     * @param usdcAmountIn 輸入的 USDC 數量（6位精度）
     * @param stableAmountOut 輸出的 StableToken 數量（18位精度）
     */
    function swapUsdcToStable(
        address user, 
        uint256 usdcAmountIn,
        uint256 stableAmountOut) 
        external onlySwap
        {
        require(usdcAmountIn > 0 && stableAmountOut > 0, "Both amounts must be positive");
        require(reserveStable >= stableAmountOut, "Insufficient Stable reserve");

        // 资产转移
        require(usdcToken.transferFrom(user, address(this), usdcAmountIn), "USDC transfer failed");
        require(stableToken.transfer(user, stableAmountOut), "Stable transfer failed");

        // 更新储备
        reserveStable -= stableAmountOut;
        reserveUsdc += usdcAmountIn;

        emit SwapExecuted(user, usdcAmountIn, stableAmountOut, address(usdcToken), address(stableToken));
    }

    /**
     * @dev 提取管理費（僅供 AMMSwap 調用）
     * @return stableAmount 提取的 StableToken 數量（18位精度）
     * @return usdcAmount 提取的 USDC 數量（6位精度）
     */
    function withdrawFee() external onlySwap returns (uint256 stableAmount, uint256 usdcAmount) {
        stableAmount = adminStableBalance;
        usdcAmount = adminUsdcBalance;
        
        if (stableAmount > 0) {
            adminStableBalance = 0;
            require(stableToken.transfer(feeCollector, stableAmount), "Stable transfer failed");
        }
        
        if (usdcAmount > 0) {
            adminUsdcBalance = 0;
            require(usdcToken.transfer(feeCollector, usdcAmount), "USDC transfer failed");
        }
        
        emit FeeWithdrawn(feeCollector, stableAmount, usdcAmount);
    }


}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";


import "./Types.sol";
import "./tokens/StableToken.sol";
import "./tokens/MultiLeverageToken.sol";
import "./CustodianFixed.sol";
import "./AMMLiquidity.sol";


/*
 * @title AMMSwap
    AMMSwap 的职责是：

    负责交易逻辑、价格计算、滑点控制、手续费分配等“业务规则”。
    校验用户交易参数，防止恶意或异常操作。
    作为协议升级、扩展的入口（如支持多种交易模式、路由、聚合等）。
    用户不能直接和 AMMLiquidity 进行 swap 的原因：

    AMMLiquidity 只负责资产托管和结算，逻辑简单、安全性高，不易被攻击或误用。
    交易相关的复杂逻辑（如价格公式、手续费、滑点保护）应由 AMMSwap 统一管理，便于维护和升级。
    分层设计有助于权限隔离、代码复用和协议扩展（如支持多种交易类型、聚合路由等）。

/**
 * @title StableUSDCAMM
 * @dev 专用的 StableToken-USDC 交易池，使用 StableSwap 算法
 */

// ======================Interface由Uniswap V3团队在其官方合约中定义的(仅在当前合约中使用)================
// ✅ UniversalRouter 接口 (Sepolia: 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b)
// UniversalRouter 使用命令模式，通过 execute 函数执行各种操作
interface IUniversalRouter {
    /// @notice Executes encoded commands along with provided inputs
    /// @param commands A set of concatenated commands, each 1 byte in length
    /// @param inputs An array of byte strings containing abi encoded inputs for each command
    /// @param deadline The deadline by which the transaction must be executed
    function execute(
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) external payable;
}

// UniversalRouter 命令常量 (来自 Uniswap Commands.sol)
// V3_SWAP_EXACT_IN: 精确输入交换 (指定输入数量，获得至少 amountOutMin 的输出)
bytes1 constant V3_SWAP_EXACT_IN = 0x00;
// V3_SWAP_EXACT_OUT: 精确输出交换 (指定输出数量，最多花费 amountInMax 的输入)
bytes1 constant V3_SWAP_EXACT_OUT = 0x01;

// ✅ QuoterV2 接口 (Sepolia: 0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3)
interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    struct QuoteExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountOut;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Returns the amount out received for a given exact input swap without executing the swap
    /// @return amountOut The amount of the output token
    /// @return sqrtPriceX96After The sqrt price of the pool after the swap
    /// @return initializedTicksCrossed The number of initialized ticks that the swap crossed
    /// @return gasEstimate The estimate of the gas that the swap consumes
    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        );

    /// @notice Returns the amount in required for a given exact output swap without executing the swap
    /// @return amountIn The amount of the input token
    /// @return sqrtPriceX96After The sqrt price of the pool after the swap
    /// @return initializedTicksCrossed The number of initialized ticks that the swap crossed
    /// @return gasEstimate The estimate of the gas that the swap consumes
    function quoteExactOutputSingle(QuoteExactOutputSingleParams memory params)
        external
        returns (
            uint256 amountIn,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        );
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
    function liquidity() external view returns (uint128);
}

/**
 * @title AMMSwap 交换合约
 * @notice 管理 StableToken、USDC 和杠杆代币之间的交换逻辑
 * @dev 使用 StableSwap 算法进行 Stable-USDC 交换，集成 Uniswap V3 进行杠杆代币交易
 *
 * 主要功能：
 * 1. StableToken ↔ USDC 交换（基于 StableSwap AMM）
 * 2. USDC → 杠杆代币（购买）：通过 DEX 购买 underlying，铸造 S+L tokens
 * 3. 杠杆代币 → USDC（卖出）：合并注销 S+L tokens，通过 DEX 卖出 underlying
 *
 * 安全特性：
 * - 重入防护（ReentrancyGuard）
 * - 滑点保护
 * - 价格影响限制
 * - 费用自动分配
 *
 * 已知问题：
 * ⚠️ swapUsdcToLeverage 存在设计缺陷：
 *    - 只调用 previewSwapStableToUsdc 计算，未执行实际交换
 *    - 导致合约缺少购买 underlying 所需的 USDC
 *    - 需要外部预先给合约转入 USDC（见测试文件 workaround）
 *    - 建议重新设计流程或确保 USDC 余额充足
 */
contract AMMSwap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============= A 值调整机制 =============
    uint256 public initialA;
    uint256 public futureA; 
    uint256 public initialATime;
    uint256 public futureATime;
    uint256 public constant MIN_RAMP_TIME = 86400; // 1天
    uint256 public constant MIN_A = 1;
    uint256 public constant MAX_A = 10000;
    //以上參數是爲了支持A值的動態調整；
    uint256 public constant A_PRECISION = 100;
    uint256 public A;   // 放大系数
    
    // ============= 状态变量 =============
    CustodianFixed public custodian;
    AMMLiquidity public ammliquidity;
    
    // ============ 代币合约 ==============
    StableToken public immutable stableToken;    // StableToken (18 decimals)
    MultiLeverageToken public immutable leverageToken;      // 杠杆代币
    IERC20 public immutable underlyingToken;    // 标的资产 (如 ETH, BTC等)    
    IERC20 public immutable usdcToken;           // USDC (6 decimals)
    // uint256 public stableBalance;  // StableToken 余额
    // uint256 public usdcBalance;    // USDC 余额（已转换为 18 位精度）
    uint8 public stableDecimals; //1e18
    uint8 public usdcDecimals;   //1e6

    // ======== 費用管理相關變量及事件 =============
    uint256 public constant AUTO_WITHDRAW_THRESHOLD = 1000 * 1e18;  // 自动提取阈值
    uint256 public fee = 4;           // 0.04% 交易费
    uint256 public constant BASISPOINT = 10000;      // 100% 的基点表示
    uint256 public adminFee = 500;   // 50% 管理费，即0.02%交易費給管理員，剩餘0.02%給了lptoken持有者
    uint256 public constant PRECISION = 10 ** 18;//用於以下幾處：1. 賣出L獲得USDC后,拆分比例給用戶和池子
    uint256 public constant MAX_FEE = 5 * 10 ** 9;  // 最大费率 50%

    // ============= DEX交易相关变量 (修改为V3) ===============
    address public dexRouter;                       // Uniswap V3 Router地址
    address public quoter;                          // V3 Quoter地址
    address public usdcUnderlyingPool;              // USDC-Underlying池地址 (V3)
    uint24 public poolFee;                          // V3池费率 (500, 3000, 10000)
    uint256 public leverageSlippageTolerance = 300; // 3% 滑点容忍度
    uint256 public constant MAX_SLIPPAGE = 1000;    // 最大10%滑点
    uint160 public constant MIN_SQRT_RATIO = 4295128739;
    uint160 public constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    // ==============事件定義=======================
    event DebugAllowance(uint256 allowance);
    event DebugBalance(uint256 balance);

    // swap相關事件
    event SwapStableToUsdc(address indexed user, uint256 stableAmountIn, uint256 usdcAmountOut);
    event SwapUsdcToStable(address indexed user, uint256 usdcAmountIn, uint256 stableAmountOut);
    event SwapLeverageToUsdc(address indexed user, uint256 leverageTokenId, uint256 lAmountPercentage, uint256 usdcAmountOut);
    event SwapUsdcToLeverage(address indexed user, uint256 usdcAmountIn, uint256 leverageTokenId, uint256 lAmountOut);
    // fee相關事件
    event AutoFeeWithdraw(uint256 stableAmount, uint256 usdcAmount);
    event FeeUpdated(uint256 newFee, uint256 newAdminFee);
    event FeeDistribution(uint256 lpFee, uint256 adminFee);
    // A值調整相關事件
    event RampA(uint256 initialA, uint256 futureA, uint256 initialTime, uint256 futureTime);
    event AUpdated(uint256 newA);
    // DEX交易事件
    event DEXTradeExecuted(bool isBuy, uint256 amountIn, uint256 amountOut, uint256 slippage);
    // Debug事件
    event DebugBuyUnderlying(uint256 expectedUsdcIn, uint256 maxUsdcIn, uint256 contractBalance, uint256 routerBalanceAfter);






    // ============= 构造函数 =============
    constructor(
        address _underlyingToken,    // DEX中的配對資產之一：标的资产(WLTC) 
        address _usdc,               // DEX/AMM中的配對資產之一：USDC
        address _stableToken,        // AMM池中的配對資產之一：穩定幣 S token
        address _leverageToken,      // AMM池中的可以交易的產品：杠杆代币 L token   
        address _dexRouter,          // UniversalRouter地址，用于执行实际的代币交换操作 Sepolia测试网地址：0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
        address _quoter,             // V3 Quoter地址，用于查询交换价格，不执行实际交易 Sepolia测试网官方地址：0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3 (QuoterV2)
        address _usdcUnderlyingPool, // V3 池地址，你在Uniswap上创建的具体交易池合约地址 你的池地址：0xc2823E89bEB6D0331B918a0303e2e7Da7aF13Cb7
        uint24 _poolFee             // V3 费率层级，只能為 500, 3000, 10000 等           
    ) Ownable(msg.sender) {
      
        require(_underlyingToken != address(0), "Invalid underlying token");
        require(_usdc != address(0), "Invalid USDC address");
        require(_stableToken != address(0) && _usdc != address(0), "Invalid token addresses");
        require(_leverageToken != address(0) && _underlyingToken != address(0), "Invalid leverage tokens");

        // Allow zero addresses for testing
        // require(_dexRouter != address(0), "Invalid DEX router");
        // require(_quoter != address(0), "Invalid quoter");
        // require(_usdcUnderlyingPool != address(0), "Invalid trading pool");
        require(_poolFee == 500 || _poolFee == 3000 || _poolFee == 10000, "Invalid pool fee");

        underlyingToken = IERC20(_underlyingToken);
        usdcToken = IERC20(_usdc);
        stableToken = StableToken(_stableToken);
        leverageToken = MultiLeverageToken(_leverageToken);
        dexRouter = _dexRouter;
        quoter = _quoter;
        usdcUnderlyingPool = _usdcUnderlyingPool;
        poolFee = _poolFee;        
        
        stableDecimals = stableToken.decimals(); //通常是18位
        usdcDecimals = IERC20Metadata(_usdc).decimals(); //通常是6位

        // ✅ A值設定，从保守值开始
        uint256 initialAValue = 200;
        A = initialAValue * A_PRECISION;
        initialA = A;
        futureA = A;
        initialATime = block.timestamp;
        futureATime = block.timestamp;
    }

    function initialize(
        address _custodian,          // 托管合约地址
        address _AMMLiquidity        // AMMLiquidity合约地址
    ) external onlyOwner { 

        require(_custodian != address(0), "Invalid custodian address");
        require(_AMMLiquidity != address(0), "Invalid AMM liquidity address");
        custodian = CustodianFixed(_custodian);
        ammliquidity = AMMLiquidity(_AMMLiquidity);
    }
    

    
    // ======================================= 核心交易函數 ================================================
    // 1. swapStableToUsdc: StableToken -> USDC
    // 2. swapUsdcToStable: USDC -> StableToken
    // 3. swapLeverageToUsdc: 杠杆代币 -> USDC
    // 4. swapUsdcToLeverage: USDC -> 杠杆代币
    // ======================================= 核心交易函數 ================================================
    
    /**
     * @dev StableToken -> USDC 交换函数
     * 用户输入 StableToken 数量，自动计算输出 USDC 数量（考虑手续费）
     * @param stableAmountIn 输入的 StableToken 数量（18位精度）
     * @return usdcAmountOut 用户实际收到的 USDC 数量（6位精度）
     *
     * 执行流程：
     * 1. 验证输入参数
     * 2. 调用预览函数计算交易参数（输出金额、手续费等）
     * 3. 检查用户余额和授权
     * 4. 检查 AMMLiquidity 合约的 USDC 余额是否足够
     * 5. 执行代币交换（通过 AMMLiquidity）
     * 6. 处理管理费用
     * 7. 触发自动费用提取检查
     * 8. 发出事件
     *
     * 安全考虑：
     * - 使用 nonReentrant 防止重入攻击
     * - 所有外部调用都在检查后进行
     * - 费用自动累积和管理
     */
    function swapStableToUsdc(
        uint256 stableAmountIn // 单位：18位精度
    ) external nonReentrant returns (
        uint256 usdcAmountOut // 单位：6位精度
    ) {
        // 1. 输入验证
        require(stableAmountIn > 0, "Stable amount must be positive");
        
        // 2. 获取交易预览参数
        (
            uint256 previewUsdcOut,     // 预期输出 USDC（6位精度）
            ,
            uint256 adminFeeUsdcAmount, // 管理费（6位精度）
            uint256 lpFeeUsdcAmount,    // LP费（6位精度）
            ,                           // priceImpact（不需要）
            bool isValid
        ) = this.previewSwapStableToUsdc(stableAmountIn);
        
        require(isValid, "Invalid swap parameters");
        
        // 3. 检查用户余额和授权
        require(stableToken.balanceOf(msg.sender) >= stableAmountIn, "Insufficient Stable balance");
        require(stableToken.allowance(msg.sender, address(ammliquidity)) >= stableAmountIn, "Insufficient Stable allowance");
        
        // 4. 检查 AMMLiquidity 的 USDC 余额是否足够
        // 注意：adminUsdcBalance 是累积的管理费，但代币仍在合约中，不应从总余额中扣除
        uint256 requiredUsdc = previewUsdcOut + adminFeeUsdcAmount + lpFeeUsdcAmount;
        require(usdcToken.balanceOf(address(ammliquidity)) >= requiredUsdc, "Insufficient USDC balance in AMM");
        
        // 5. 执行代币交换
        ammliquidity.swapStableToUsdc(msg.sender, stableAmountIn, previewUsdcOut);
        
        // 6. 处理管理费用（累积到 AMMLiquidity）
        ammliquidity.addAdminFee(0, adminFeeUsdcAmount);
        
        // 7. 设置返回值
        usdcAmountOut = previewUsdcOut;
        
        // 8. 检查是否需要自动提取费用
        _checkAutoWithdraw();
        
        // 9. 发出事件
        emit SwapStableToUsdc(msg.sender, stableAmountIn, usdcAmountOut);
        emit FeeDistribution(lpFeeUsdcAmount, adminFeeUsdcAmount);
    }
    
    /**
     * @dev 预览 StableToken -> USDC 交换结果（view 函数，不改变状态）
     * @param stableAmountIn 输入的 StableToken 数量（18位精度）
     * @return usdcAmountOut 用户实际收到的 USDC 数量（6位精度）
     * @return tradingFee 总交易手续费（6位精度）
     * @return adminFeeUsdcAmount 管理费部分（6位精度）
     * @return lpFeeUsdcAmount LP提供者费部分（6位精度）
     * @return priceImpact 价格影响（基点，100 = 1%）
     * @return isValid 交易是否有效
     *
     * 计算流程：
     * 1. 获取当前池储备并标准化到18位精度
     * 2. 计算交易前的 D 值（StableSwap 不变量）
     * 3. 模拟添加 StableToken 后的新余额
     * 4. 使用 StableSwap 算法计算对应的 USDC 输出
     * 5. 计算手续费和分配
     * 6. 计算价格影响
     * 7. 验证结果合理性
     *
     * 精度说明：
     * - 内部计算使用18位精度
     * - 输出结果转换为相应代币的精度（USDC: 6位）
     *
     * 安全考虑：
     * - 纯 view 函数，不修改状态
     * - 包含多重验证防止无效交易
     */
    function previewSwapStableToUsdc(uint256 stableAmountIn)
        external view
        returns (
            uint256 usdcAmountOut,     // 6位精度
            uint256 tradingFee,        // 6位精度
            uint256 adminFeeUsdcAmount, // 6位精度
            uint256 lpFeeUsdcAmount,   // 6位精度
            uint256 priceImpact,       // 基点
            bool isValid
        )
    {
        // 1. 基本输入验证
        if (stableAmountIn == 0) {
            return (0, 0, 0, 0, 0, false);
        }

        // 2. 获取 AMMLiquidity 的当前储备
        (uint256 reserveStable, uint256 reserveUsdc) = ammliquidity.getReserves();

        // 标准化到18位精度进行内部计算
        uint256 stableBalanceBefore = reserveStable; // 已为18位精度
        uint256 usdcBalanceBefore = reserveUsdc * (10**(stableDecimals - usdcDecimals)); // 从6位转换为18位

        // 检查池子是否有足够的 USDC
        if (usdcBalanceBefore == 0) {
            return (0, 0, 0, 0, 0, false);
        }

        // 3. 计算交易前的 D 值（StableSwap 不变量）
        uint256 DBefore = getD(stableBalanceBefore, usdcBalanceBefore);
        if (DBefore == 0) {
            return (0, 0, 0, 0, 0, false);
        }

        // 4. 模拟添加 StableToken 后的状态
        uint256 stableBalanceAfter = stableBalanceBefore + stableAmountIn;

        // 使用 StableSwap 算法计算新的 USDC 余额
        uint256 usdcBalanceAfter = getY(stableBalanceAfter, DBefore);

        // 5. 验证计算结果
        if (usdcBalanceAfter == 0 || usdcBalanceAfter >= usdcBalanceBefore) {
            return (0, 0, 0, 0, 0, false); // USDC 余额不应增加或为0
        }

        // 6. 计算输出量（18位精度）
        uint256 usdcOutputBeforeFee18 = usdcBalanceBefore - usdcBalanceAfter;

        // 转换为6位精度用于费用计算
        uint256 usdcOutputBeforeFee6 = usdcOutputBeforeFee18 / (10**(stableDecimals - usdcDecimals)) ;

        // 7. 计算费用（6位精度）
        tradingFee = usdcOutputBeforeFee6 * fee / BASISPOINT;
        adminFeeUsdcAmount = tradingFee * adminFee / BASISPOINT;
        lpFeeUsdcAmount = tradingFee - adminFeeUsdcAmount;

        // 8. 计算最终用户输出（6位精度）
        uint256 usdcOutputAfterFee6 = usdcOutputBeforeFee6 - tradingFee;

        // 9. 计算价格影响（使用18位精度）
        priceImpact = _calculateSwapPriceImpact(
            stableAmountIn,                   // 18位
            usdcOutputBeforeFee18 ,            // 18位
            stableBalanceBefore ,              // 18位
            usdcBalanceBefore                  // 18位
        );

        // 10. 最终验证和返回值设置
        usdcAmountOut = usdcOutputAfterFee6;
        isValid = (usdcAmountOut > 0); // 移除价格影响检查，仅检查输出大于0
    }

    /**
     * @dev 執行 USDC 到 StableToken 的交換交易
     * 使用 StableSwap 算法計算交換比例，收取交易費用並分配給管理者和 LP 提供者
     *
     * 執行流程：
     * 1. 驗證輸入參數
     * 2. 使用預覽函數獲取交易參數和驗證有效性
     * 3. 檢查用戶的 USDC 餘額和 allowance
     * 4. 檢查 AMMLiquidity 合約的可用 StableToken 餘額
     * 5. 調用 AMMLiquidity 的 swapUsdcToStable 執行實際轉賬
     * 6. 處理管理費用（暫存到 AMMLiquidity）
     * 7. 檢查是否需要自動提取管理費
     * 8. 發射交換和費用分配事件
     *
     * 安全考慮：
     * - 使用 nonReentrant 防止重入攻擊
     * - 多重餘額和 allowance 檢查確保交易安全
     * - 依賴預覽函數的驗證確保參數有效
     *
     * @param usdcAmountIn 用戶輸入的 USDC 數量（6位精度）
     * @return stableAmountOut 用戶收到的 StableToken 數量（18位精度）
     */
    function swapUsdcToStable(
        uint256 usdcAmountIn //單位 6位
    ) external nonReentrant returns (
        uint256 stableAmountOut) 
    {
        require(usdcAmountIn > 0, "Amount must be positive");
        
        // ✅ 使用预览函数获取交易参数
        (
            uint256 previewStableOut,
            ,
            uint256 adminFeeStableAmount,
            uint256 lpFeeStableAmount,
            ,  // priceImpact - 不需要在实际交易中使用
            bool isValid
        ) = this.previewSwapUsdcToStable(usdcAmountIn);
        require(isValid, "Invalid swap parameters");

        //检查用户的allowance和余额是否足夠
        require(usdcToken.balanceOf(msg.sender) >= usdcAmountIn, "Insufficient USDC balance");
        require(usdcToken.allowance(msg.sender, address(ammliquidity)) >= usdcAmountIn, "Insufficient USDC allowance");


        //检查ammliquidity的Stable余额是否足夠
        require(stableToken.balanceOf(address(ammliquidity)) - ammliquidity.adminStableBalance() >= previewStableOut + adminFeeStableAmount + lpFeeStableAmount, "Insufficient Stable balance");

       
       //调用AMMLiquidity的swapUsdcToStable函数进行实际的转账
        ammliquidity.swapUsdcToStable(msg.sender, usdcAmountIn, previewStableOut);

        
        // 管理费用处理
        ammliquidity.addAdminFee(adminFeeStableAmount, 0);  // 暂存管理费用到AMMLiquidity

        // ✅ 设置返回值
        stableAmountOut = previewStableOut;
        
        // ✅ 可选：超过阈值时自动提取管理费
        _checkAutoWithdraw();
        
        emit SwapUsdcToStable(msg.sender, usdcAmountIn, stableAmountOut);
        emit FeeDistribution(lpFeeStableAmount, adminFeeStableAmount);
    }

    /**
     * @dev 預覽 USDC -> StableToken 交換結果（view 函數，不改變狀態）
     * @param usdcAmountIn 輸入的 USDC 數量（6位精度）
     * @return stableAmountOut 用戶實際收到的 StableToken 數量（18位精度）
     * @return tradingFee 總交易手續費（18位精度）
     * @return adminFeeAmount 管理費部分（18位精度）
     * @return lpFeeAmount LP 提供者費部分（18位精度）
     * @return priceImpact 價格影響（基點，100 = 1%）
     * @return isValid 交易是否有效
     *
     * 計算流程：
     * 1. 驗證輸入參數
     * 2. 獲取池儲備並標準化到18位精度
     * 3. 計算交易前的 D 值（StableSwap 不變量）
     * 4. 將 USDC 輸入標準化並模擬添加後的新餘額
     * 5. 使用 StableSwap 算法計算對應的 StableToken 輸出
     * 6. 計算手續費和分配
     * 7. 計算價格影響
     * 8. 驗證結果合理性
     *
     * 精度說明：
     * - 內部計算使用18位精度
     * - 輸出結果為相應代幣的精度（StableToken: 18位）
     *
     * 安全考慮：
     * - 純 view 函數，不修改狀態
     * - 包含多重驗證防止無效交易
     */
    function previewSwapUsdcToStable(uint256 usdcAmountIn)
        external view
        returns (
            uint256 stableAmountOut,     // 18位精度
            uint256 tradingFee,          // 18位精度
            uint256 adminFeeAmount,      // 18位精度
            uint256 lpFeeAmount,         // 18位精度
            uint256 priceImpact,         // 基點
            bool isValid
        )
    {
        // 1. 基本輸入驗證
        if (usdcAmountIn == 0) {
            return (0, 0, 0, 0, 0, false);
        }

        // 2. 獲取 AMMLiquidity 的當前儲備
        (uint256 reserveStable, uint256 reserveUsdc) = ammliquidity.getReserves();

        // 標準化到18位精度進行內部計算
        uint256 stableBalanceBefore = reserveStable; // 已為18位精度
        uint256 usdcBalanceBefore = reserveUsdc * (10**(stableDecimals - usdcDecimals)); // 從6位轉換為18位

        // 檢查池子是否有足夠的 StableToken
        if (stableBalanceBefore == 0) {
            return (0, 0, 0, 0, 0, false);
        }

        // 3. 計算交易前的 D 值（StableSwap 不變量）
        uint256 DBefore = getD(stableBalanceBefore, usdcBalanceBefore);
        if (DBefore == 0) {
            return (0, 0, 0, 0, 0, false);
        }

        // 4. 將 USDC 輸入標準化為18位精度
        uint256 usdcAmountInNormalized = usdcAmountIn * (10**(stableDecimals - usdcDecimals));

        // 5. 模擬添加 USDC 後的狀態
        uint256 usdcBalanceAfter = usdcBalanceBefore + usdcAmountInNormalized;

        // 使用 StableSwap 算法計算新的 StableToken 餘額
        uint256 stableBalanceAfter = getY(usdcBalanceAfter, DBefore);

        // 6. 驗證計算結果
        if (stableBalanceAfter == 0 || stableBalanceAfter >= stableBalanceBefore) {
            return (0, 0, 0, 0, 0, false); // StableToken 餘額不應增加或為0
        }

        // 7. 計算輸出量（18位精度）
        uint256 stableOutputBeforeFee = stableBalanceBefore - stableBalanceAfter;

        // 8. 計算費用（18位精度）
        tradingFee = stableOutputBeforeFee * fee / BASISPOINT;
        adminFeeAmount = tradingFee * adminFee / BASISPOINT;
        lpFeeAmount = tradingFee - adminFeeAmount;

        // 9. 計算最終用戶輸出（18位精度）
        stableAmountOut = stableOutputBeforeFee - tradingFee;

        // 10. 計算價格影響（使用18位精度）
        priceImpact = _calculateSwapPriceImpact(
            usdcAmountInNormalized,      // 18位
            stableOutputBeforeFee,       // 18位
            usdcBalanceBefore,           // 18位
            stableBalanceBefore          // 18位
        );

        // 11. 最終驗證和返回值設置
        isValid = (stableAmountOut > 0 && priceImpact <= 5000); // 最大50%價格影響
    }

    /**
     * @dev 計算交易的價格影響（內部輔助函數）
     * 價格影響表示交易價格相對於現貨價格的差異，通常由於滑點造成
     *
     * 計算公式：
     * - 現貨價格 = balanceOut / balanceIn
     * - 交易價格 = amountOutBeforeFee / amountIn
     * - 價格影響 = (現貨價格 - 交易價格) / 現貨價格 * 10000（基點）
     *
     * 在 StableSwap 中，交易價格通常低於現貨價格（因為有滑點），所以價格影響為正數
     * 如果交易價格高於現貨價格（罕見情況），價格影響設為0
     *
     * @param amountIn 輸入數量（18位精度）
     * @param amountOutBeforeFee 費用前的輸出數量（18位精度）
     * @param balanceIn 輸入代幣的池餘額（18位精度）
     * @param balanceOut 輸出代幣的池餘額（18位精度）
     * @return priceImpact 價格影響（基點，10000 = 100%）
     */
    function _calculateSwapPriceImpact(
        uint256 amountIn,
        uint256 amountOutBeforeFee,
        uint256 balanceIn,
        uint256 balanceOut
    ) internal pure returns (uint256 priceImpact) {
        // 邊界檢查：避免除零錯誤
        if (balanceIn == 0 || balanceOut == 0 || amountIn == 0) {
            return 0;
        }

        // 計算現貨價格（使用 PRECISION 進行高精度計算）
        uint256 currentSpotPrice = balanceOut * PRECISION / balanceIn;

        // 計算實際交易價格
        uint256 actualTradePrice = amountOutBeforeFee * PRECISION / amountIn;

        // 計算價格影響（滑點）
        if (currentSpotPrice > actualTradePrice) {
            // 正常情況：交易價格低於現貨價格，計算滑點百分比
            priceImpact = (currentSpotPrice - actualTradePrice) * 10000 / currentSpotPrice;
        } else {
            // 罕見情況：交易價格高於現貨價格，設為0（避免負數）
            priceImpact = 0;
        }

        // 限制最大價格影響為10000基點（100%）
        if (priceImpact > 10000) {
            priceImpact = 10000;
        }
    }


    /**
     * @dev 槓桿代幣到 USDC 的交換
     * 原理：用戶的槓桿代幣 + 池中的穩定代幣 -> 合併成基礎抵押物 -> DEX 賣出 -> 給用戶等值 USDC
     * 本質上是通過調用 merge 函數來註銷 S & L token 實現的
     *
     * 執行流程：
     * 1. 計算需要多少 S token 來合併（通過預覽燃燒）
     * 2. 計算需要支付給 AMM 池的 USDC 數量（基於 StableSwap 算法）
     * 3. 合併註銷 S & L token，獲取基礎抵押物
     * 4. DEX 賣出抵押物，獲取 USDC 並執行分配
     * 5. 更新 AMM 池中的資產儲備
     * 6. 處理管理費和自動提取
     *
     * 安全考慮：
     * - 使用 nonReentrant 防止重入攻擊
     * - 多重驗證確保交易參數有效
     * - DEX 賣出後驗證 USDC 數量
     *
     * @param leverageTokenId 槓桿代幣 ID
     * @param lAmountPercentage 賣出 L 幣的百分比（大於1%，1表示1%）
     * @return usdcAmountToUser 用戶收到的 USDC 數量（6位精度）
     */
    function swapLeverageToUsdc(
        uint256 leverageTokenId,
        uint256 lAmountPercentage // 賣出L幣的百分比, 需要大於1%, 否则无法賣出； 這裏的1表示1%
    ) external nonReentrant returns (
        uint256 usdcAmountToUser)
    {
        
        // 輸入驗證
        require(lAmountPercentage >= 1, "Percentage must be at least 1%"); 

        // 获取最新价格用于利息计算
        (uint256 currentPriceInWei, , bool priceValid) = custodian.getLatestPriceView();
        require(priceValid && currentPriceInWei > 0, "Invalid price");

        //------------------第一步： 計算需要多少S token來合并------------------------
        BurnPreview memory preview = custodian.previewBurn(msg.sender, leverageTokenId, lAmountPercentage, currentPriceInWei);
        require(preview.sAmountNeededInWei > 0, "No S token needed");

        //------------------第二步： 計算需要支付給AMM池的USDC數量---------------------
        // 獲取 AMMLiquidity 的當前儲備
        (uint256 reserveStable, uint256 reserveUsdc) = ammliquidity.getReserves();
        
        uint256 stableBalanceBefore = reserveStable; // 18位精度
        uint256 usdcBalanceBefore = reserveUsdc * (10**(stableDecimals - usdcDecimals)); // 標準化為18位

        // 檢查池子餘額充足
        require(stableBalanceBefore >= preview.sAmountNeededInWei, "Insufficient stable balance in pool");

        uint256 DBefore = getD(stableBalanceBefore, usdcBalanceBefore);
        require(DBefore > 0, "Invalid D value");

        // 計算理論輸出（基於當前 D 值）
        uint256 stableBalanceAfter = stableBalanceBefore - preview.sAmountNeededInWei;
        uint256 usdcBalanceAfter = getY(stableBalanceAfter, DBefore);

        // 驗證計算結果
        require(usdcBalanceAfter > usdcBalanceBefore, "Invalid balance calculation");

        // 計算存入的 USDC（6位精度）
        uint256 usdcInput = (usdcBalanceAfter - usdcBalanceBefore) / (10**(stableDecimals - usdcDecimals));
        uint256 tradingFee = usdcInput * fee / BASISPOINT;
        uint256 adminFeeUsdcAmount = tradingFee * adminFee / BASISPOINT;
        uint256 lpFeeUsdcAmount = tradingFee - adminFeeUsdcAmount;

        //========================================================================
        //通過以上代碼計算下列變量(基於賣出特定數量的L token):
        //  1. AMM池需要拿出的S token(模型決定)
        //  2. 合并后的underlying數量(模型決定)
        //  3. 用戶需要支付給AMM池的USDC數量(AMM池Curve決定)
        //下面的代碼是執行真正的交易操作
        //  4. 調用custodian.burnFromAMM來合并注銷S & L token
        //  5. 調用_sellUnderlyingOnDEX賣出抵押物
        //========================================================================

        //------------------第三步： 合并注銷，並獲取抵押物------------------------
        uint256 underlyingAmountRedeemedInWei;
        uint256 stableTokenBurnedInWei;
        // 捕获 custodian 可能的 revert 原因，便于诊断
        try custodian.burnFromAMM(address(ammliquidity), msg.sender, leverageTokenId, lAmountPercentage) returns (
            uint256 _underlyingAmountRedeemedInWei,
            uint256 _stableTokenBurnedInWei,
            uint256 /* _leverageTokenBurnedInWei */
        ) {
            underlyingAmountRedeemedInWei = _underlyingAmountRedeemedInWei;
            stableTokenBurnedInWei = _stableTokenBurnedInWei;
        } catch Error(string memory reason) {
            revert(string(abi.encodePacked("custodian.burnFromAMM reverted: ", reason)));
        } catch {
            revert("custodian.burnFromAMM failed: Unknown error");
        }

        require(underlyingAmountRedeemedInWei > 0, "No underlying to redeem");
        // 如果 burn 出来的 S token 与 preview 不一致，直接报错以避免后续 underflow
        require(stableTokenBurnedInWei == preview.sAmountNeededInWei, "Burn amount mismatch");

        //------------------第四步： DEX賣出抵押物，獲取USDC, 並執行分配------------------------
        uint256 usdcAmountToAMM = usdcInput + tradingFee; // 進入AMM的USDC = 算法決定量+ 手續費;

        usdcAmountToUser = _sellUnderlyingOnDEX(
            underlyingAmountRedeemedInWei,
            address(ammliquidity),
            usdcAmountToAMM,
            msg.sender
        );

        //------------------第五步： 更新AMM池中的資產儲備------------------------
        // 防御性检查：确保不会发生 underflow
        require(reserveStable >= stableTokenBurnedInWei, "Reserve stable less than burned amount");
        ammliquidity.syncReserves(reserveStable - stableTokenBurnedInWei, reserveUsdc + usdcAmountToAMM);
        ammliquidity.addAdminFee(0, adminFeeUsdcAmount);

        // 可選：超過閾值時自動提取
        _checkAutoWithdraw();

        emit SwapLeverageToUsdc(msg.sender, leverageTokenId, lAmountPercentage, usdcAmountToUser);
        emit FeeDistribution(lpFeeUsdcAmount, adminFeeUsdcAmount);
    }    

    //========================費用管理相關函數========================

    /**
     * @dev 主動提取所有管理费到指定地址
     */
    function withdrawAdminFees() external onlyOwner returns (uint256 stableAmount, uint256 usdcAmount) {
        (stableAmount, usdcAmount) = ammliquidity.withdrawFee();
    }

      /**
     * @dev 检查是否需要自动提取费用
     */
    function _checkAutoWithdraw() internal {
        uint256 totalFeesNormalized = ammliquidity.adminStableBalance() + ammliquidity.adminUsdcBalance() * (10**(stableDecimals - usdcDecimals));
        
        if (totalFeesNormalized >= AUTO_WITHDRAW_THRESHOLD) {
            _autoWithdrawFees();
        }
    }
    
    /**
     * @dev 自动提取费用（内部函数）
     */
    function _autoWithdrawFees() internal {
        (uint256 stableAmount, uint256 usdcAmount) = ammliquidity.withdrawFee();

        emit AutoFeeWithdraw(stableAmount, usdcAmount);
    }

   
    // ============= 查询函数 =============
    // ============= 管理员函数 =============
    
    /**
     * @dev 设置费率
     */
    function setFee(uint256 newFee, uint256 newAdminFee) external onlyOwner {
        require(newFee <= MAX_FEE, "Fee too high");
        
        fee = newFee;
        adminFee = newAdminFee;
        
        emit FeeUpdated(newFee, newAdminFee);
    }
    
    /**
     * @dev 设置放大系数
     */
    function setA(uint256 newA) external onlyOwner {
        require(newA > 0 && newA <= 10000, "Invalid A value");
        
        A = newA * A_PRECISION;
        
        emit AUpdated(newA);
    }
    
    
/**
 * @notice 在 Uniswap V3 DEX 上购买 underlying token (使用 UniversalRouter)
 * @dev 使用精确输出模式 (V3_SWAP_EXACT_OUT)，指定想要的 underlying 数量
 * 
 * ⚠️ 重要前提：合约必须有足够的 USDC 余额
 * 当前实现存在问题：swapUsdcToLeverage 只预览 S→USDC 交换但未执行，
 * 导致合约缺少 USDC。测试中需要手动转入 USDC 才能通过。
 * 
 * 执行流程：
 * 1. 使用 QuoterV2 获取需要的 USDC 数量
 * 2. 计算最大输入量（考虑滑点保护）
 * 3. 检查合约 USDC 余额是否足够 ⚠️ 
 * 4. 授权 UniversalRouter 使用 USDC
 * 5. 编码交换路径和参数
 * 6. 执行 UniversalRouter 交易
 * 7. 验证实际交易结果
 * 8. 重置授权（安全措施）
 * 
 * @param underlyingAmount 需要购买的 underlying 数量 (18位精度)
 * @param maxUsdcAmount 愿意支付的最大 USDC 数量 (6位精度)
 * @return actualUsdcAmount 实际支付的 USDC 数量 (6位精度)
 * 
 * Requirements:
 * - underlyingAmount > 0
 * - maxUsdcAmount > 0  
 * - dexRouter != address(0)
 * - 合约 USDC 余额 >= expectedUsdcIn ⚠️
 * 
 * Emits:
 * - DEXTradeExecuted(true, actualUsdcAmount, underlyingAmount, actualSlippage)
 */
function buyUnderlyingOnDEX(
    uint256 underlyingAmount, 
    uint256 maxUsdcAmount,
    uint256 slippageTolerance
) internal returns (uint256 actualUsdcAmount) {
    require(underlyingAmount > 0, "Invalid underlying amount");
    require(maxUsdcAmount > 0, "Invalid max USDC amount");
    require(dexRouter != address(0), "DEX router not set");
    
    // ✅ 1. 【关键修复】在执行交换前重新获取最新报价
    // 避免价格变化导致 V3TooLittleReceived
    uint256 latestQuote;
    try IQuoterV2(quoter).quoteExactOutputSingle(
        IQuoterV2.QuoteExactOutputSingleParams({
            tokenIn: address(usdcToken),
            tokenOut: address(underlyingToken),
            amountOut: underlyingAmount,
            fee: poolFee,
            sqrtPriceLimitX96: 0
        })
    ) returns (
        uint256 amountIn,
        uint160 /* sqrtPriceX96After */,
        uint32 /* initializedTicksCrossed */,
        uint256 /* gasEstimate */
    ) {
        latestQuote = amountIn;
    } catch {
        revert("Failed to get latest V3 quote");
    }
    
    require(latestQuote > 0, "Invalid latest V3 quote");
    
    // ✅ 2. 使用最新报价 + 滑点计算 amountInMax
    uint256 amountInMax = latestQuote * (10000 + slippageTolerance) / 10000;
    
    // ❌ 如果最新报价（含滑点）超过用户准备的最大金额，直接拒绝交易
    // 这避免了 V3TooLittleReceived 错误，同时给出清晰的错误信息
    require(
        amountInMax <= maxUsdcAmount,
        string(abi.encodePacked(
            "Price increased: need ",
            _toString(amountInMax / 1e6),
            " USDC, but max is ",
            _toString(maxUsdcAmount / 1e6),
            " USDC. Please retry with higher slippage."
        ))
    );
    
    // ✅ 3. 检查合约USDC余额是否足够
    uint256 contractUsdcBalance = usdcToken.balanceOf(address(this));
    require(contractUsdcBalance >= amountInMax, "Insufficient USDC balance in contract");
    
    // ✅ 4. 【方案1：使用 payerIsUser=true】授权 UniversalRouter 使用合约的 USDC
    // 好处：UniversalRouter 只会拉取实际需要的 USDC，多余的自动保留在合约中
    // 避免退款的复杂性和 gas 消耗
    usdcToken.approve(dexRouter, 0);
    usdcToken.approve(dexRouter, amountInMax);
    
    // 🔍 Debug: 记录关键参数
    // emit DebugBuyUnderlying(latestQuote, amountInMax, contractUsdcBalance, amountInMax);

    // ✅ 5. 记录交易前余额
    uint256 usdcBefore = usdcToken.balanceOf(address(this));
    uint256 underlyingBefore = underlyingToken.balanceOf(address(this));
    
    // ✅ 6. 编码 UniversalRouter 交换路径
    // V3_SWAP_EXACT_OUTPUT: 我们知道要买多少 WLTC (underlyingAmount)
    // 对于 EXACT_OUTPUT，Uniswap V3 路径是反向的：tokenOut → fee → tokenIn
    bytes memory path = abi.encodePacked(
        address(underlyingToken), // tokenOut (WLTC) - 我们想要的
        uint24(poolFee),                  // fee (uint24)
        address(usdcToken)        // tokenIn (USDC) - 我们支付的
    );
    
    // ✅ 7. 编码 V3_SWAP_EXACT_OUT 参数
    // ⚠️ 关键：UniversalRouter 的 V3_SWAP_EXACT_OUT 参数顺序
    // (address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser)
    bytes memory swapInput = abi.encode(
        address(this),           // recipient: 合约地址（接收WLTC）
        underlyingAmount,        // amountOut: 精确要购买的WLTC数量
        amountInMax,            // amountInMax: 最多愿意支付的USDC（包含滑点）
        path,                    // path: 交换路径（反向）
        true                     // payerIsUser: true - UniversalRouter 从 msg.sender (本合约) 拉取代币
    );
    
    bytes[] memory inputs = new bytes[](1);
    inputs[0] = swapInput;
    
    // ✅ 8. 执行UniversalRouter交易 (V3_SWAP_EXACT_OUT = 0x01)
    bytes memory commands = abi.encodePacked(V3_SWAP_EXACT_OUT);
    

    if (usdcToken.allowance(address(this), dexRouter) < amountInMax) {
        revert("Insufficient allowance");
    }

    if (usdcToken.balanceOf(address(this)) < amountInMax) {
        revert("Insufficient balance");
    }

    try IUniversalRouter(dexRouter).execute(
        commands,
        inputs,
        block.timestamp + 600  // 10分钟过期
    ) {
        // 交易成功
    } catch Error(string memory reason) {
        revert(string(abi.encodePacked("UniversalRouter swap failed: ", reason)));
    } catch (bytes memory lowLevelData) {
        // 捕获所有其他错误（Panic、低级错误等）
        if (lowLevelData.length > 0) {
            // 如果是 4 字节错误选择器（自定义错误）
            if (lowLevelData.length == 4) {
                bytes4 errorSelector;
                assembly {
                    errorSelector := mload(add(lowLevelData, 32))
                }
                revert(string(abi.encodePacked(
                    "UniversalRouter swap failed: Custom error 0x",
                    _toHexString(uint32(errorSelector))
                )));
            }
            // 尝试解码为 Panic 错误
            if (lowLevelData.length == 36) {
                uint256 panicCode;
                assembly {
                    panicCode := mload(add(lowLevelData, 36))
                }
                revert(string(abi.encodePacked(
                    "UniversalRouter swap failed: Panic code 0x",
                    _toHexString(panicCode)
                )));
            }
            revert(string(abi.encodePacked(
                "UniversalRouter swap failed: Unknown error (data length: ",
                _toString(lowLevelData.length),
                ")"
            )));
        }
        revert("UniversalRouter swap failed: Unknown error (no data)");
    }
    
    // ✅ 6. 重置授权（安全措施）
    usdcToken.approve(dexRouter, 0);
    
    // ✅ 7. 验证实际交易结果
    uint256 usdcAfter = usdcToken.balanceOf(address(this));
    uint256 underlyingAfter = underlyingToken.balanceOf(address(this));
    
    // 使用 payerIsUser=true，Router 会从合约拉取实际需要的 USDC
    actualUsdcAmount = usdcBefore - usdcAfter;
    uint256 actualUnderlyingReceived = underlyingAfter - underlyingBefore;
    
    require(actualUsdcAmount > 0, "No USDC spent");
    require(actualUnderlyingReceived == underlyingAmount, "Underlying amount mismatch");
    require(actualUsdcAmount <= maxUsdcAmount, "Exceeded maximum USDC amount");
    
    // ✅ 7. 记录交易执行
    emit DEXTradeExecuted(true, actualUsdcAmount, underlyingAmount, 0);
    
    return actualUsdcAmount;
}

/**
 * @dev 预览 swapUsdcToLeverage 需要的最大 USDC 授权额度
 * @param LAmountInWei 想要购买的 L token 数量 (18位精度)
 * @param mintPrice 铸造价格 (18位精度)
 * @param leverage 杠杆类型
 * @param slippageTolerance 滑点容忍度 (基点，如100表示1%)
 * @return maxUsdcRequired 需要授权的最大 USDC 数量（包含滑点）
 * @return underlyingAmount 需要购买的 underlying 数量
 * @return dexQuote DEX 报价（不含滑点）
 */
function previewSwapUsdcToLeverage(
    uint256 LAmountInWei,
    uint256 mintPrice,
    LeverageType leverage,
    uint256 slippageTolerance
) external returns (
    uint256 maxUsdcRequired,
    uint256 underlyingAmount,
    uint256 dexQuote
) {
    require(LAmountInWei > 0, "L token amount must be positive");
    require(mintPrice > 0, "Mint price must be positive");
    require(slippageTolerance <= MAX_SLIPPAGE, "Slippage tolerance too high");
    require(leverage <= LeverageType.AGGRESSIVE, "Invalid leverage type");

    // 计算所需的 S token 和 underlying 数量
    uint256 stableAmountRequired;
    if (leverage == LeverageType.CONSERVATIVE) {
        stableAmountRequired = LAmountInWei / 8;
        underlyingAmount = (9 * stableAmountRequired * 1e18 + mintPrice - 1) / mintPrice;
    } else if (leverage == LeverageType.MODERATE) {
        stableAmountRequired = LAmountInWei / 4;
        underlyingAmount = (5 * stableAmountRequired * 1e18 + mintPrice - 1) / mintPrice;
    } else if (leverage == LeverageType.AGGRESSIVE) {
        stableAmountRequired = LAmountInWei;
        underlyingAmount = (2 * stableAmountRequired * 1e18 + mintPrice - 1) / mintPrice;
    } else {
        revert("Invalid leverage level");
    }

    require(stableAmountRequired > 0, "Invalid stable amount calculated");
    require(underlyingAmount > 0, "Invalid underlying amount calculated");

    // 获取 DEX 报价
    (uint256 requiredUsdcForUnderlying, uint256 dexPriceImpact) =
        this.getUsdcRequiredForUnderlying(underlyingAmount);
    require(requiredUsdcForUnderlying > 0, "Failed to get DEX quote");
    require(dexPriceImpact <= 1000, "DEX price impact too high");

    // 计算包含滑点的最大 USDC 金额
    dexQuote = requiredUsdcForUnderlying;
    maxUsdcRequired = requiredUsdcForUnderlying * (10000 + slippageTolerance) / 10000;
}

/**
* @dev 获取购买指定数量underlying需要的USDC数量 (只查询，不执行交易)
* @param underlyingAmount 需要购买的underlying数量 (18位精度)
* @return usdcRequired 需要的USDC数量 (6位精度)
* @return priceImpact 价格影响 (基点)
*/
function getUsdcRequiredForUnderlying(uint256 underlyingAmount) 
    external 
    returns (uint256 usdcRequired, uint256 priceImpact) 
{
    require(quoter != address(0), "Quoter not set");
    
    if (underlyingAmount == 0) return (0, 0);
    
    try IQuoterV2(quoter).quoteExactOutputSingle(
        IQuoterV2.QuoteExactOutputSingleParams({
            tokenIn: address(usdcToken),
            tokenOut: address(underlyingToken),
            amountOut: underlyingAmount,
            fee: poolFee,
            sqrtPriceLimitX96: 0
        })
    ) returns (
        uint256 amountIn,
        uint160 /* sqrtPriceX96After */,
        uint32 /* initializedTicksCrossed */,
        uint256 /* gasEstimate */
    ) {
        usdcRequired = amountIn;
        
        // 计算价格影响
        priceImpact = _calculateV3PriceImpactExactOutput(usdcRequired, underlyingAmount);
    } catch {
        return (0, 0);
    }
}

/**
* @dev 计算精确输出交易的价格影响
*/
function _calculateV3PriceImpactExactOutput(
    uint256 usdcIn,       //6位精度
    uint256 underlyingOut //18位精度
) internal view returns (uint256 priceImpact) {
    if (usdcUnderlyingPool == address(0)) return 0;
    
    try IUniswapV3Pool(usdcUnderlyingPool).slot0() returns (
        uint160 sqrtPriceX96,
        int24,
        uint16,
        uint16,
        uint16,
        uint8,
        bool
    ) {
        // 从sqrtPriceX96计算当前现货价格
        uint256 spotPrice = _sqrtPriceX96ToPrice(sqrtPriceX96, true); // USDC -> Underlying， 1 USDC = ？ underlying， ？单位是18位
        
        // 计算理想USDC成本（按现货价格）
        uint256 idealUsdcCost = underlyingOut * (10 ** 6) / spotPrice; // 转换为6位精度
        
        // 计算价格影响
        if (usdcIn > idealUsdcCost) {
            priceImpact = (usdcIn - idealUsdcCost) * 10000 / idealUsdcCost;
        }
    } catch {
        return 0;
    }
}

    /**
     * @notice 在 Uniswap V3 DEX 上卖出 underlying token (使用 UniversalRouter)
     * @dev 使用精确输入模式 (V3_SWAP_EXACT_IN)，卖出指定数量的 underlying
     * 
     * 功能说明：
     * 此函数用于 swapLeverageToUsdc 流程，将从 custodian 赎回的 underlying
     * 在 DEX 上卖出换成 USDC，然后分配给 AMM 池和用户
     * 
     * 执行流程：
     * 1. 使用 QuoterV2 获取预期 USDC 输出量
     * 2. 计算最小输出量（考虑滑点保护）
     * 3. 授权 UniversalRouter 使用 underlying token
     * 4. 编码交换路径和参数
     * 5. 执行 UniversalRouter 交易 (V3_SWAP_EXACT_IN)
     * 6. 验证实际收到的 USDC 数量
     * 7. 分配 USDC：一部分给 AMM 池，剩余给用户
     * 8. 重置授权
     * 
     * USDC 分配逻辑：
     * - usdcAmountToAMM: 给 AMM 池（基于 StableSwap 算法计算 + 手续费）
     * - usdcAmountToUser: 给用户（剩余部分）
     * 
     * @param underlyingAmount 要卖出的 underlying 数量 (18位精度)
     * @param ammLiquidityAddr AMMLiquidity 合约地址（接收部分 USDC）
     * @param usdcAmountToAMM 应给 AMM 池的 USDC 数量 (6位精度)
     * @param userAddr 用户地址（接收剩余 USDC）
     * @return usdcAmountToUser 用户实际收到的 USDC 数量 (6位精度)
     * 
     * Requirements:
     * - underlyingAmount > 0
     * - dexRouter != address(0)
     * - 合约有足够的 underlying token 余额
     * - actualReceived >= minAmountOut (滑点保护)
     * - actualReceived >= usdcAmountToAMM (确保能支付给 AMM)
     * 
     * Emits:
     * - DEXTradeExecuted(false, underlyingAmount, usdcAmount, actualSlippage)
     */
    function _sellUnderlyingOnDEX(
        uint256 underlyingAmount,
        address ammLiquidityAddr, 
        uint256 usdcAmountToAMM, 
        address userAddr
        ) internal returns (uint256 usdcAmountToUser)
    {
        require(underlyingAmount > 0, "Invalid underlying amount");
        require(dexRouter != address(0), "DEX router not set");
        
        // ✅ 1. 使用QuoterV2获取预期输出量
        uint256 expectedOut;
        try IQuoterV2(quoter).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: address(underlyingToken),  // Underlying (WLTC)
                tokenOut: address(usdcToken),       // USDC
                amountIn: underlyingAmount,         // 卖出的underlying数量
                fee: poolFee,                       // fee tier (3000)
                sqrtPriceLimitX96: 0                // 无价格限制
            })
        ) returns (
            uint256 amountOut,
            uint160 /* sqrtPriceX96After */,
            uint32 /* initializedTicksCrossed */,
            uint256 /* gasEstimate */
        ) {
            expectedOut = amountOut;
        } catch {
            revert("Failed to get V3 quote");
        }
        
        require(expectedOut > 0, "Invalid V3 quote");
        
        // ✅ 2. 计算最小输出量（考虑滑点）
        uint256 minAmountOut = expectedOut * (10000 - leverageSlippageTolerance) / 10000;
        
        // ✅ 3. 将代币转给 UniversalRouter（因为使用 payerIsUser=false）
        // 注意：当 payerIsUser=false 时，UniversalRouter 期望代币已经在其账户中
        underlyingToken.transfer(dexRouter, underlyingAmount);
        
        // 确认 Router 收到 WLTC
        uint256 routerBalance = underlyingToken.balanceOf(dexRouter);
        require(routerBalance >= underlyingAmount, "Router did not receive expected WLTC");
        
        // ✅ 4. 记录交易前余额
        uint256 usdcBefore = usdcToken.balanceOf(address(this));
        
        // ✅ 5. 编码 UniversalRouter 交换路径 (WLTC -> USDC)
        bytes memory path = abi.encodePacked(
            address(underlyingToken), // tokenIn
            poolFee,                  // fee (uint24)
            address(usdcToken)        // tokenOut
        );
        
        // ✅ 6. 编码 V3_SWAP_EXACT_IN 参数
        // 参数: (address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)
        bytes memory swapInput = abi.encode(
            address(this),      // recipient: 合约地址（接收USDC）
            underlyingAmount,   // amountIn: 卖出的underlying数量
            minAmountOut,       // amountOutMin: 最小USDC输出
            path,               // path: 交换路径
            false               // payerIsUser: false - 使用UniversalRouter自己的余额进行交易
        );
        
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = swapInput;
        
        // ✅ 7. 执行UniversalRouter交易 (V3_SWAP_EXACT_IN = 0x00)
        bytes memory commands = abi.encodePacked(V3_SWAP_EXACT_IN);
        
        try IUniversalRouter(dexRouter).execute(
            commands,
            inputs,
            block.timestamp + 600  // 10分钟过期
        ) {
            // 交易成功
        } catch Error(string memory reason) {
            revert(string(abi.encodePacked("UniversalRouter swap failed: ", reason)));
        } catch (bytes memory lowLevelData) {
            // 捕获所有其他错误（Panic、低级错误等）
            if (lowLevelData.length > 0) {
                // 尝试解码为 Panic 错误
                if (lowLevelData.length == 36) {
                    uint256 panicCode;
                    assembly {
                        panicCode := mload(add(lowLevelData, 36))
                    }
                    revert(string(abi.encodePacked(
                        "UniversalRouter swap failed: Panic code 0x",
                        _toHexString(panicCode)
                    )));
                }
                revert(string(abi.encodePacked(
                    "UniversalRouter swap failed: Unknown error (data length: ",
                    _toString(lowLevelData.length),
                    ")"
                )));
            }
            revert("UniversalRouter swap failed: Unknown error (no data)");
        }
        
        // ✅ 8. 验证实际收到的数量
        uint256 usdcAfter = usdcToken.balanceOf(address(this));
        uint256 actualReceived = usdcAfter - usdcBefore;
        require(actualReceived >= minAmountOut, "Insufficient tokens received");
        
        uint256 usdcAmount = actualReceived;
        
        // ✅ 9. 计算实际滑点
        uint256 actualSlippage = expectedOut > actualReceived ? 
            (expectedOut - actualReceived) * 10000 / expectedOut : 0;

        // ✅ 10. USDC分配
        usdcAmountToUser = usdcAmount - usdcAmountToAMM;
        usdcToken.transfer(ammLiquidityAddr, usdcAmountToAMM);//將USDC轉給AMM池
        usdcToken.transfer(userAddr, usdcAmountToUser);//將USDC转给用户

        emit DEXTradeExecuted(false, underlyingAmount, usdcAmount, actualSlippage);
    }



    /**
    * @dev 计算V3的价格影响
    */
    function _calculateV3PriceImpact(
        uint256 amountIn, 
        uint256 amountOut, 
        bool isUsdcToUnderlying
    ) internal view returns (uint256 priceImpact) {
        if (usdcUnderlyingPool == address(0)) return 0;
        
        try IUniswapV3Pool(usdcUnderlyingPool).slot0() returns (
            uint160 sqrtPriceX96,
            int24,
            uint16,
            uint16,
            uint16,
            uint8,
            bool
        ) {
            // 从sqrtPriceX96计算当前价格；
            // isUsdcToUnderlying=true表示1USDC = ? underlying, 单位18位
            // isUsdcToUnderlying=false表示1underlying = ? USDC, 单位6位
            uint256 price = _sqrtPriceX96ToPrice(sqrtPriceX96, isUsdcToUnderlying);
            
            // 计算理想输出量（按当前价格）
            uint256 idealAmountOut = amountIn * price / (10 ** 18);
            
            if (idealAmountOut > amountOut) {
                priceImpact = (idealAmountOut - amountOut) * 10000 / idealAmountOut;
            }
        } catch {
            return 0;
        }
    }

    /**
    * @dev 将sqrtPriceX96转换为价格
    * @notice 参考 correct_price_formula_confirmed.ts 的正确实现
    * 
    * Uniswap V3 价格公式：
    * sqrtPriceX96 = sqrt(token1/token0) × 2^96
    * 因此: price = (sqrtPriceX96 / 2^96)^2 = token1/token0 (wei级别)
    * 
    * 调整为人类可读单位：
    * price' = price × 10^decimals0 / 10^decimals1
    * 
    * 对于 USDC(6位) 和 WLTC(18位):
    * price' = price × 10^(6-18) = price / 10^12
    * 
    * 实现策略：使用 FullMath 风格的 mulDiv，保留最大精度
    */
    function _sqrtPriceX96ToPrice(uint160 sqrtPriceX96, bool isUsdcToUnderlying) 
        internal view returns (uint256 price) 
    {
        require(sqrtPriceX96 > 0, "Invalid sqrtPriceX96");
        
        // 获取代币顺序
        IUniswapV3Pool pool = IUniswapV3Pool(usdcUnderlyingPool);
        address token0 = pool.token0();
        
        // Q96 = 2^96
        uint256 Q96 = 0x1000000000000000000000000; // 2^96 = 79228162514264337593543950336
        
        // 计算 price = (sqrtPriceX96)^2 / 2^192
        // 为保留精度，使用 mulDiv 方式：
        // price = (sqrtPriceX96 * sqrtPriceX96 * 10^18) / (Q96 * Q96)
        // 这样 price 保留 18 位小数精度
        
        uint256 sqrtPriceX96_squared = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        
        // 使用 mulDiv 计算: numerator / denominator，保留18位精度
        // price_18decimals = (sqrtPriceX96^2 * 1e18) / (2^96 * 2^96)
        uint256 price_18decimals = _mulDiv(sqrtPriceX96_squared, 1e18, Q96 * Q96);

        uint256 token0Decimals;
        uint256 token1Decimals;
        if(token0 == address(underlyingToken))
        {
            //wltc/usdc
            uint256 token0Decimals = 18;
            uint256 token1Decimals = 6;

        }
        else
        {
            //usdc/wltc
            uint256 token0Decimals = 6;
            uint256 token1Decimals = 18;
        }
        uint256 price_modified = price_18decimals * (10 ** (token0Decimals - token1Decimals));//表示的是1token0 = ?token1, 单位为wei, 经单位调整

        if(isUsdcToUnderlying)
        {
            // 需要: 1 USDC = ? underlying, ?值的单位是1e18
            if(token0 == address(underlyingToken)) price = _mulDiv(1e36, 1, price_modified);
            else price = price_modified;
        }
        else
        {
            // 需要: 1 underlying = ? USDC, ?值的单位是1e6
            if(token0 == address(underlyingToken)) price = price_modified / 1e12;
            else price = _mulDiv(1e24, 1, price_modified);
        }

    }
    
    /**
     * @dev 计算 (a × b) / c，避免溢出
     * @notice 简化版 FullMath.mulDiv
     */
    function _mulDiv(uint256 a, uint256 b, uint256 c) private pure returns (uint256) {
        require(c > 0, "Division by zero");
        
        // 计算 a * b
        uint256 prod0; // 低 256 位
        uint256 prod1; // 高 256 位
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }
        
        // 如果没有溢出（prod1 == 0），直接除法
        if (prod1 == 0) {
            return prod0 / c;
        }
        
        // 确保结果小于 2^256
        require(prod1 < c, "MulDiv overflow");
        
        // 512-bit division
        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, c)
        }
        
        assembly {
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }
        
        uint256 twos = c & (~c + 1);
        assembly {
            c := div(c, twos)
            prod0 := div(prod0, twos)
            twos := add(div(sub(0, twos), twos), 1)
        }
        
        prod0 |= prod1 * twos;
        
        uint256 inv = (3 * c) ^ 2;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        
        return prod0 * inv;
    }


        // ======================================= AMM池參數管理函數 ================================================
    // 1. getA: 获取当前有效的 A 值（支持平滑过渡）
    // 2. rampA: 逐步调整 A 值到新的值
    // 3. getD: 计算 D 值
    // 4. getY: 已知一種資產x的數量，计算另一種資產 Y 的數量
    // ======================================= AMM池參數管理函數 ================================================

    /**
     * @dev 获取当前有效的 A 值（支持平滑过渡）
     */
    function getA() public view returns (uint256) {
        uint256 t1 = futureATime;
        uint256 A1 = futureA;

        if (block.timestamp < t1) {
            uint256 A0 = initialA;
            uint256 t0 = initialATime;
            
            if (A1 > A0) {
                return A0 + (A1 - A0) * (block.timestamp - t0) / (t1 - t0);
            } else {
                return A0 - (A0 - A1) * (block.timestamp - t0) / (t1 - t0);
            }
        } else {
            return A1;
        }
    }
    
    /**
     * @dev 逐步调整 A 值到新的值
     */
    function rampA(uint256 futureAValue, uint256 futureTime) external onlyOwner {
        require(block.timestamp >= initialATime + MIN_RAMP_TIME, "Too frequent");
        require(futureTime >= block.timestamp + MIN_RAMP_TIME, "Insufficient time");
        require(futureAValue >= MIN_A && futureAValue <= MAX_A, "A out of range");
        
        uint256 initialAValue = getA();
        futureAValue *= A_PRECISION;
        
        // 限制 A 值变化幅度（不超过2倍）
        if (futureAValue < initialAValue) {
            require(futureAValue * 2 >= initialAValue, "A decrease too large");
        } else {
            require(futureAValue <= initialAValue * 2, "A increase too large");
        }
        
        initialA = initialAValue;
        futureA = futureAValue;
        initialATime = block.timestamp;
        futureATime = futureTime;
        
        emit RampA(initialAValue, futureAValue, block.timestamp, futureTime);
    }

    /**
     * @dev 计算不变量 D
     */
    function getD(uint256 stableBalance, uint256 usdcBalance) public view returns (uint256) {

        uint256 currentA = getA(); // 使用动态 A 值
        uint256 s = stableBalance + usdcBalance; //注意: 需要在调用getD函数前进行更新
        if (s == 0) return 0;

        uint256 prevD = 0;
        uint256 d = s;
        uint256 ann = currentA * 4; // A * n^n, where n=2

        for (uint256 i = 0; i < 255; i++) {
             // 计算 D_P = D^3 / (4 * x * y)
            uint256 dp = d * d * d / (4 * stableBalance * usdcBalance);
            prevD = d;
            // d = (ann * s + 2 * dp) * d / ((ann - 1) * d + 3 * dp)
            d = (ann * s + 2 * dp) * d / ((ann - 1) * d + 3 * dp);
            
            if (d > prevD) {
                if (d - prevD <= 1) break;// 收敛，退出循环
            } else {
                if (prevD - d <= 1) break; // 收敛，退出循环
            }
        }
        
        return d;
    }

    /**
    * @dev 计算 StableSwap 中的 y 值（纯数学版本）
    * @param x 已知的代币余额
    * @param d 不变量D
    * @return y 另一个代币的余额
    */
    function getY(uint256 x, uint256 d) internal view returns (uint256) {
        require(x > 0 && d > 0, "Invalid parameters");
        
        uint256 currentA = getA();
        uint256 ann = currentA * 4; // A * n^n, where n=2
        
        // 使用牛顿迭代法求解
        uint256 c = d * d * d / (4 * ann * x);
        uint256 b = x + d / ann;
        
        uint256 prevY = 0;
        uint256 y = d; // 初始猜测值
        
        for (uint256 i = 0; i < 255; i++) {
            prevY = y;
            // 牛顿迭代公式：y_new = (y^2 + c) / (2*y + b - d)
            y = (y * y + c) / (2 * y + b - d);
            
            // 收敛判断
            if (y > prevY) {
                if (y - prevY <= 1) break;
            } else {
                if (prevY - y <= 1) break;
            }
        }
        
        return y;
    }

    /**
     * @dev 获取 usdcUnderlyingPool 上的 USDC 和 WLTC 储备数量
     * @return underlyingReserve WLTC 储备数量（18位精度）
     * @return usdcReserve USDC 储备数量（6位精度）
     */
    function getPoolReserves() external view returns (uint256 underlyingReserve, uint256 usdcReserve) {
        if (usdcUnderlyingPool == address(0)) {
            return (0, 0);
        }

        IUniswapV3Pool pool = IUniswapV3Pool(usdcUnderlyingPool);
        
        // 获取池子信息
        address token0 = pool.token0();
        address token1 = pool.token1();
        uint128 liquidity = pool.liquidity();
        
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        
        if (liquidity == 0 || sqrtPriceX96 == 0) {
            return (0, 0);
        }

        // 计算储备数量
        // amount0 = liquidity * sqrtPriceX96 / 2^96
        // amount1 = liquidity / sqrtPriceX96 * 2^96
        
        uint256 amount0 = (uint256(liquidity) * uint256(sqrtPriceX96)) / (2**96);
        uint256 amount1 = (uint256(liquidity) * (2**96)) / uint256(sqrtPriceX96);

        // 确定哪个是 underlying，哪个是 USDC
        if (token0 == address(underlyingToken) && token1 == address(usdcToken)) {
            // token0 = WLTC, token1 = USDC
            underlyingReserve = amount0;
            usdcReserve = amount1 / (10**(18 - usdcDecimals)); // 转换为 6 位精度
        } else if (token0 == address(usdcToken) && token1 == address(underlyingToken)) {
            // token0 = USDC, token1 = WLTC
            usdcReserve = amount0 / (10**(18 - usdcDecimals)); // 转换为 6 位精度
            underlyingReserve = amount1;
        } else {
            // 池子配置错误
            return (0, 0);
        }
    }

    /**
     * @dev 辅助函数：将 uint256 转换为字符串
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @dev 辅助函数：将 uint256 转换为十六进制字符串
     */
    function _toHexString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 length = 0;
        while (temp != 0) {
            length++;
            temp >>= 4;
        }
        bytes memory buffer = new bytes(length);
        for (uint256 i = length; i > 0; i--) {
            buffer[i - 1] = _toHexChar(uint8(value & 0xf));
            value >>= 4;
        }
        return string(buffer);
    }

    /**
     * @dev 辅助函数：将数字转换为十六进制字符
     */
    function _toHexChar(uint8 value) internal pure returns (bytes1) {
        if (value < 10) {
            return bytes1(uint8(48 + value)); // 0-9
        } else {
            return bytes1(uint8(87 + value)); // a-f
        }
    }

}

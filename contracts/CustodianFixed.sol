// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./tokens/StableToken.sol";
import "./tokens/MultiLeverageToken.sol";
import "./interfaces/IChainlinkV3.sol";
import "./InterestManager.sol";
import "./Types.sol";
import "./libraries/CustodianUtils.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./auctions/AuctionManager.sol";
import "./auctions/LiquidationManager.sol";

contract CustodianFixed is Ownable, ReentrancyGuard, AccessControl {

    // ✅ 核心资产合约 - 构造函数设置（immutable）
    IERC20 public immutable underlyingToken;              
    StableToken public immutable stableToken;             
    MultiLeverageToken public immutable leverageToken;    
    IChainlinkV3 public priceFeed;
    InterestManager public interestManager;
    uint8 public immutable underlyingTokenDecimals;
    uint8 public priceFeedDecimals;

    // 授权AMM池进行mint和burn操作
    mapping(address => bool) public authorizedAMM;
    event AuthorizedAMMUpdated(address indexed amm, bool authorized);
    modifier onlyAuthorizedAMM {
        require(authorizedAMM[msg.sender], "Unauthorized AMM"); 
        _;
    }
    function setAuthorizedAMM(address amm, bool authorized) external onlyOwner {
        authorizedAMM[amm] = authorized;
        emit AuthorizedAMMUpdated(amm, authorized);
    }


    // 當前合約狀態及是否初始化
    enum State {
        Inception,
        Trading,
        PreReset,
        Reset,
        Matured
    }
    State public state;
    modifier inState(State _state) {
        require(state == _state, "Invalid state: Current state does not match required state");
        _;
    }
    
    // 统计变量
    uint public totalSupplyS;
    uint public totalSupplyL;
    uint public CollateralInWei; // 所有用户抵押品总和

    //跟踪用戶持倉變量，如L token ids, 抵押品等
    mapping(address => uint256[]) public userTokenIds;//用戶擁有的所有L token ID列表
    mapping(address => mapping(uint256 => bool)) public userHasToken;
    mapping(address => uint256) public userCollateral; // 用戶抵押品

    // 价格保护参数
    uint256 public constant MAX_PRICE_AGE = 3600; // 1小时
    uint256 public constant PRICE_PRECISION = 1e18; // 18位小数
    bool private _systemInitialized = false;

    // 事件定义
    event StaticTokenMint(address indexed user, uint256 indexed tokenId, uint256 underlyingAmountInWei, uint256 leverageLevel, uint256 sAmount, uint256 lAmount);
    event DynamicTokenMint(address indexed user, uint256 indexed tokenId, uint256 underlyingAmountInWei, uint256 leverageLevel, uint256 sAmount, uint256 lAmount);
    event SystemInitialized(address indexed interestManager, address indexed priceFeed);
    event PriceFeedUpdated(address indexed oldPriceFeed, address indexed newPriceFeed, uint8 decimals);
    event AcceptPrice(uint256 indexed priceInWei, uint256 indexed timeInSecond);
    event Mint(address indexed user, uint256 underlyingAmountInWei, uint256 leverageLevel, uint256 mintPriceInWei, uint256 sAmountInWei, uint256 lAmountInWei);
    event Burn(address indexed user, uint256 tokenId, uint256 sAmountInWei, uint256 lAmountInWei, uint256 underlyingAmountInWei);

    // ================= 构造函数 =================
    
    constructor(
        address _underlyingTokenAddr,
        address _stableTokenAddr,
        address _leverageTokenAddr
    ) Ownable(msg.sender) {
        require(_underlyingTokenAddr != address(0), "Invalid underlying token");
        require(_stableTokenAddr != address(0), "Invalid stable token");
        require(_leverageTokenAddr != address(0), "Invalid leverage token");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); 
        _grantRole(ADMIN_ROLE, msg.sender);
        
        underlyingToken = IERC20(_underlyingTokenAddr);
        stableToken = StableToken(_stableTokenAddr);
        leverageToken = MultiLeverageToken(_leverageTokenAddr);
        underlyingTokenDecimals = IERC20Metadata(_underlyingTokenAddr).decimals();
        
        state = State.Inception;
    }

    // ================= 系统初始化 =================
    
    function initialize(
        address _interestManagerAddr,
        address _priceFeedAddr,
        address _auctionManagerAddr,
        address _liquidationManagerAddr
    ) external onlyOwner {
        require(!_systemInitialized, "System already initialized");
        require(state == State.Inception, "Can only initialize in Inception state");
        
        
        // 设置业务合约
        interestManager = InterestManager(_interestManagerAddr);
        priceFeed = IChainlinkV3(_priceFeedAddr);
        priceFeedDecimals = IChainlinkV3(_priceFeedAddr).decimals();   

        liquidationManager = LiquidationManager(_liquidationManagerAddr); 
        grantLiquidationRole(_liquidationManagerAddr);
        auctionManager = AuctionManager(_auctionManagerAddr); 
        grantAuctionRole(_auctionManagerAddr);     
      
        // 激活交易系统
        state = State.Trading;

        _systemInitialized = true;    
        emit SystemInitialized(_interestManagerAddr, _priceFeedAddr);
    }

    /**
     * @dev 更新价格预言机地址（仅限 Owner）
     * @param _newPriceFeedAddr 新的 Chainlink Price Feed 地址
     * 
     * 使用场景：
     * - 切换到新的价格源
     * - 修复预言机故障
     * - 升级到更好的价格聚合器
     * 
     * 安全考虑：
     * - 只能由 Owner 调用
     * - 验证新地址非零
     * - 验证新预言机返回有效价格
     * - 更新精度配置
     * - 发出更新事件
     */
    function updatePriceFeed(address _newPriceFeedAddr) external onlyOwner {
        require(_newPriceFeedAddr != address(0), "Invalid price feed address");
        require(_newPriceFeedAddr != address(priceFeed), "Same price feed address");
        
        // 测试新 price feed 是否可用
        IChainlinkV3 newPriceFeed = IChainlinkV3(_newPriceFeedAddr);
        
        // 保存旧地址用于事件
        address oldPriceFeed = address(priceFeed);
        
        // 更新 price feed
        priceFeed = newPriceFeed;
        priceFeedDecimals = newPriceFeed.decimals();
        
        // 发出事件
        emit PriceFeedUpdated(oldPriceFeed, _newPriceFeedAddr, priceFeedDecimals);
    }

    // ===============================從Pricefeed获取最新价格（18位小数）================================
   

    /**
    * @dev 获取当前价格和时间（view版本）
    * @return priceInWei 最新价格（18位小数）
    * @return timeInSecond 最新价格更新时间
    * @return isValid 数据是否有效
    */
    function getLatestPriceView() external view returns (
        uint256 priceInWei,
        uint256 timeInSecond,
        bool isValid
    ) {
        return CustodianUtils.getLatestPriceView(
            priceFeed,
            priceFeedDecimals,
            MAX_PRICE_AGE
        );
    }

    // ======================================= 核心函數 ================================================
    // 鑄幣相關函數：
    //     1. mint: 按指定价格和杠杆进行鑄幣（智能选择静态或动态token）
    //     3. _executeMintCore: 調用S token和L token合約中的mint函數执行鑄幣
    //     4. previewMint: view函數，計算按照“mint price”和“leverage”進行鑄幣，所需的S代币數量，所獲得的L代币數量，及應付給InterestManager的利息(不改變區塊鏈狀態)
    // 燃燒相關函數：
    //     1. burn: 燃燒一定比例的特定ID的L代币
    // ======================================= 核心函數 ================================================
    

     /**
     * @dev 按指定价格和杠杆进行Mint（智能选择静态或动态token）
     * @param underlyingAmountInWei 投入的标的资产数量
     * @param mintPriceInWei 目标价格（18位精度）
     * @param leverageLevel 杠杆等级
     * @return sAmountInWei 获得的稳定币数量
     * @return lAmountInWei 获得的杠杆代币数量
     */
    function mint(
        uint256 underlyingAmountInWei,
        uint256 mintPriceInWei, //P0
        LeverageType leverageLevel
    ) external 
        inState(State.Trading) 
        nonReentrant 
        returns (
            uint256 sAmountInWei,
            uint256 lAmountInWei,
            uint256 leverageTokenId
        ) 
    {
        require(mintPriceInWei > 0 && underlyingAmountInWei > 0, "Invalid price");
    
        // ✅ allowance 检查
        require(
            underlyingToken.allowance(msg.sender, address(this)) >= underlyingAmountInWei,
            "Insufficient allowance"
        );

        // ✅ 1. 资产转移（先转移，后处理）
        require(
            underlyingToken.transferFrom(msg.sender, address(this), underlyingAmountInWei), 
            "Underlying token transfer failed"
        );

        // ✅ 2. 查找是否存在匹配的静态token
        uint256 staticTokenId = leverageToken.findStaticTokenId(leverageLevel, mintPriceInWei);
        
        
        bool isStaticToken;
        
        if (staticTokenId != 0) {
            // ✅ 3a. 找到静态token，直接使用
            leverageTokenId = staticTokenId;
            isStaticToken = true;
            
        } else {
            // ✅ 3b. 未找到静态token，创建动态token； 僅僅是創建token ID
            leverageTokenId = leverageToken.createDynamicLeverageToken(
                leverageLevel,
                mintPriceInWei
            );
            isStaticToken = false;
        }

        // ✅ 4. 计算Mint数量
        (sAmountInWei, lAmountInWei) = CustodianUtils.calculateMintAmounts(
            underlyingAmountInWei,
            leverageLevel,
            mintPriceInWei
        );

        // ✅ 5. 执行核心Mint逻辑
        _executeMintCore(
            msg.sender,
            msg.sender,
            underlyingAmountInWei,
            leverageTokenId,
            sAmountInWei,
            lAmountInWei,
            isStaticToken
        );

        updateLiquidationStatus(msg.sender, leverageTokenId, 
            leverageToken.balanceOf(msg.sender, leverageTokenId), leverageLevel );

        // ✅ 6. 发出对应事件
        if (isStaticToken) {
            emit StaticTokenMint(
                msg.sender, 
                leverageTokenId, 
                underlyingAmountInWei, 
                uint256(leverageLevel),
                sAmountInWei,
                lAmountInWei
            );
        } else {
            emit DynamicTokenMint(
                msg.sender, 
                leverageTokenId, 
                underlyingAmountInWei, 
                uint256(leverageLevel),
                sAmountInWei,
                lAmountInWei
            );
        }

        emit Mint(
            msg.sender, 
            underlyingAmountInWei, 
            uint256(leverageLevel), 
            mintPriceInWei, 
            sAmountInWei, 
            lAmountInWei
        );

        return (sAmountInWei, lAmountInWei, leverageTokenId);
    }   

    function mintFromAMM(
        address StokenTo,  //S token持有者地址, S token给用户，之后由用户转入AMM获取USDC
        address LtokenTo,  //L token持有者地址, L token给用户
        uint256 underlyingAmountInWei,
        uint256 mintPriceInWei, //P0
        LeverageType leverageLevel 
    ) external 
        inState(State.Trading) onlyAuthorizedAMM nonReentrant
        returns (
            uint256 sAmountInWei,
            uint256 lAmountInWei,
            uint256 leverageTokenId
        ) 
    {
        require(mintPriceInWei > 0 && underlyingAmountInWei > 0, "Invalid price");
        
        // ✅ allowance 检查
        // 對於AMMSwap, 如何增加對CustodianFixed的allowance? 在AMMSwap中執行approve函數！
        require(
            underlyingToken.allowance(msg.sender, address(this)) >= underlyingAmountInWei,
            "Insufficient allowance"
        );

        // ✅ 1. 资产转移（先转移，后处理）
        require(
            underlyingToken.transferFrom(msg.sender, address(this), underlyingAmountInWei), 
            "Underlying token transfer failed"
        );

        // ✅ 2. 查找是否存在匹配的静态token
        uint256 staticTokenId = leverageToken.findStaticTokenId(leverageLevel, mintPriceInWei);
        
        
        bool isStaticToken;
        
        if (staticTokenId != 0) {
            // ✅ 3a. 找到静态token，直接使用
            leverageTokenId = staticTokenId;
            isStaticToken = true;
            
        } else {
            // ✅ 3b. 未找到静态token，创建动态token； 僅僅是創建token ID
            leverageTokenId = leverageToken.createDynamicLeverageToken(
                leverageLevel,
                mintPriceInWei
            );
            isStaticToken = false;
        }

        // ✅ 4. 计算Mint数量
        (sAmountInWei, lAmountInWei) = CustodianUtils.calculateMintAmounts(
            underlyingAmountInWei, 
            leverageLevel, 
            mintPriceInWei
        );

        // ✅ 5. 执行核心Mint逻辑
        _executeMintCore(
            StokenTo, //S token给用户，之后由用户转入AMM获取USDC
            LtokenTo, //L token给用户
            underlyingAmountInWei,
            leverageTokenId,
            sAmountInWei,
            lAmountInWei,
            isStaticToken
        );

        updateLiquidationStatus(LtokenTo, leverageTokenId, 
            leverageToken.balanceOf(LtokenTo, leverageTokenId), leverageLevel );

        // ✅ 6. 发出对应事件
        if (isStaticToken) {
            emit StaticTokenMint(
                StokenTo, 
                leverageTokenId, 
                underlyingAmountInWei, 
                uint256(leverageLevel),
                sAmountInWei,
                lAmountInWei
            );
        } else {
            emit DynamicTokenMint(
                StokenTo, 
                leverageTokenId, 
                underlyingAmountInWei, 
                uint256(leverageLevel),
                sAmountInWei,
                lAmountInWei
            );
        }

        emit Mint(
            StokenTo, 
            underlyingAmountInWei, 
            uint256(leverageLevel), 
            mintPriceInWei, 
            sAmountInWei, 
            lAmountInWei
        );

        return (sAmountInWei, lAmountInWei, leverageTokenId);
    }   

    /**
     * @dev 調用S token和L token合約中的mint函數执行鑄幣
     */
    function _executeMintCore(
        address StokenTo, //S token接收地址
        address LtokenTo, //L token接收地址; 抵押品保存在Custodian地址，記錄在Ltoken持有者名下
        uint256 underlyingAmountInWei,
        uint256 leverageTokenId,
        uint256 sAmountInWei,
        uint256 lAmountInWei,
        bool isStaticToken
    ) internal {
        // ✅ 1. 更新用户抵押品
        userCollateral[LtokenTo] += underlyingAmountInWei;
        CollateralInWei += underlyingAmountInWei;

        // ✅ 2. 铸造稳定币
        stableToken.mint(StokenTo, sAmountInWei);

        // ✅ 3. 铸造杠杆代币（根据类型选择方法）
        if (isStaticToken) {
            leverageToken.mintStaticToken(LtokenTo, leverageTokenId, lAmountInWei);
        } else {
            leverageToken.mintDynamicToken(LtokenTo, leverageTokenId, lAmountInWei);
        }

        // ✅ 4. 记录持仓信息, 用於計算利息
        interestManager.recordPosition(LtokenTo, leverageTokenId, lAmountInWei);

        // ✅ 5. 更新总供应量
        totalSupplyS += sAmountInWei;
        totalSupplyL += lAmountInWei;

        // ✅ 新增：记录用户tokenId
        if (!userHasToken[LtokenTo][leverageTokenId]) {
            userTokenIds[LtokenTo].push(leverageTokenId);
            userHasToken[LtokenTo][leverageTokenId] = true;
        }
    }
    
    /**
     * @dev 纯计算函数：计算按照“鑄幣價格”和“leverage”進行鑄幣，所獲得的S和L的數量
     */
    // ...existing code...

    /**
     * @dev burn 一定比例的特定ID的L代币；可以由用戶調用burn L token, 也可以由AMM調用賣出L token
     */
    function burnFromAMM(
        address StokenFrom,  //S token持有者地址
        address LtokenFrom,  //L token持有者地址
        uint256 leverageTokenId,   //注銷的杠桿幣ID
        uint256 lAmountPercentage  //注銷的杠桿幣百分比（1-100），前端限制：10%，20%，30%，40%，50%，60%，70%，80%, 90%，100%選項
    ) external 
        inState(State.Trading) onlyAuthorizedAMM nonReentrant returns (
        uint256 underlyingAmountRedeemedInWei, //贖回的标的资产数量，給用戶或給AMM
        uint256 stableTokenBurnedInWei,        //被注銷的S代币数量
        uint256 leverageTokenBurnedInWei       //被注銷的L代币数量
    ){


        require(lAmountPercentage >= 1 && lAmountPercentage <= 100, "Percentage must be between 1% and 100%");

        // //檢查用戶是否有足夠的相應leverage的杠桿幣
        // require(leverageToken.balanceOf(LtokenFrom, leverageTokenId)* lAmountPercentage / 100 > 0, "No enough L tokens to burn");

        // 获取最新价格（view版本）
        (uint underlyingPriceInWei, , bool isValid) = this.getLatestPriceView();
        require(isValid && underlyingPriceInWei > 0, "Invalid price");
        //計算需要的S幣數量，贖回的抵押品數量，及應付給InterestManager的利息(不改變區塊鏈狀態)
        BurnPreview memory preview  = previewBurn(LtokenFrom, leverageTokenId, lAmountPercentage, underlyingPriceInWei);

        //檢查用戶是否有足夠的S幣和抵押品
        require(stableToken.balanceOf(StokenFrom) >= preview.sAmountNeededInWei, "Insufficient S balance");//AMM需要提供S幣
        require(userCollateral[LtokenFrom] >= preview.underlyingAmountInWei, "Insufficient collateral");//抵押物始終在L token名下

        uint256 contractBalance = underlyingToken.balanceOf(address(this));
        require(
            contractBalance >= preview.underlyingAmountToUser + preview.underlyingAmountToInterestManager,
            "Insufficient contract balance"
        );

        // ================== 以下代碼部分進行注銷/轉移支付等操作，會改變區塊鏈狀態 ================
        // 注銷S幣和杠桿幣
        stableToken.burn(StokenFrom, preview.sAmountNeededInWei);//burn S token from AMM
        leverageToken.burn(LtokenFrom, leverageTokenId, preview.lAmountBurnedInWei);//burn L token from L token holder

        ( LeverageType leverage, , , ,
        ) = leverageToken.getTokenInfo(leverageTokenId);
        updateLiquidationStatus(LtokenFrom, leverageTokenId, leverageToken.balanceOf(LtokenFrom, leverageTokenId), leverage );


        userCollateral[LtokenFrom] -= preview.underlyingAmountInWei;
        CollateralInWei -= preview.underlyingAmountInWei;
        totalSupplyS -= preview.sAmountNeededInWei;
        totalSupplyL -= preview.lAmountBurnedInWei;

        //更新用戶在interestManager的應付利息及杠桿幣數量
        interestManager.updateUserPosition(LtokenFrom, leverageTokenId, preview.deductInterestInWei, preview.lAmountBurnedInWei);


        //對於AMM池賣出注銷：抵押物給AMMSwap池，由AMM池在DEX上賣出
        bool userTransferSuccess = underlyingToken.transfer(msg.sender, preview.underlyingAmountToUser);
        // 部分抵押物(作爲利息)給InterestManager
        bool feeTransferSuccess = underlyingToken.transfer(address(interestManager), preview.underlyingAmountToInterestManager);
        
        require(userTransferSuccess, "User transfer failed");
        require(feeTransferSuccess, "Fee transfer failed");

        stableTokenBurnedInWei = preview.sAmountNeededInWei;
        leverageTokenBurnedInWei = preview.lAmountBurnedInWei;
        underlyingAmountRedeemedInWei = preview.underlyingAmountToUser;
        emit Burn(LtokenFrom, leverageTokenId, stableTokenBurnedInWei, leverageTokenBurnedInWei, underlyingAmountRedeemedInWei);
    }

    function burnFromUser(
        uint256 leverageTokenId,   //注銷的杠桿幣ID
        uint256 lAmountPercentage  //注銷的杠桿幣百分比（1-100），前端限制：10%，20%，30%，40%，50%，60%，70%，80%, 90%，100%選項
    ) external 
        inState(State.Trading) nonReentrant returns (
        uint256 underlyingAmountRedeemedInWei, //贖回的标的资产数量，給用戶或給AMM
        uint256 stableTokenBurnedInWei,        //被注銷的S代币数量
        uint256 leverageTokenBurnedInWei       //被注銷的L代币数量
    ){


        // require(lAmountPercentage >= 1 && lAmountPercentage <= 100, "Percentage must be between 1% and 100%");

        //檢查用戶是否有足夠的相應leverage的杠桿幣
        // require(leverageToken.balanceOf(msg.sender, leverageTokenId)* lAmountPercentage / 100 > 0, "No enough L tokens to burn");

        // 获取最新价格（view版本）
        (uint underlyingPriceInWei, , bool isValid) = this.getLatestPriceView();
        require(isValid && underlyingPriceInWei > 0, "Invalid price");
        //計算需要的S幣數量，贖回的抵押品數量，及應付給InterestManager的利息(不改變區塊鏈狀態)
        BurnPreview memory preview  = previewBurn(msg.sender, leverageTokenId, lAmountPercentage, underlyingPriceInWei);

        //檢查用戶是否有足夠的S幣和抵押品
        require(stableToken.balanceOf(msg.sender) >= preview.sAmountNeededInWei, "Insufficient S balance");
        require(userCollateral[msg.sender] >= preview.underlyingAmountInWei, "Insufficient collateral");//抵押物始終在L token名下

        // uint256 contractBalance = underlyingToken.balanceOf(address(this));
        // require(
        //     contractBalance >= preview.underlyingAmountToUser + preview.underlyingAmountToInterestManager,
        //     "Insufficient contract balance"
        // );

        // ================== 以下代碼部分進行注銷/轉移支付等操作，會改變區塊鏈狀態 ================
        // 注銷S幣和杠桿幣
        stableToken.burn(msg.sender, preview.sAmountNeededInWei);
        leverageToken.burn(msg.sender, leverageTokenId, preview.lAmountBurnedInWei);

        ( LeverageType leverage, , , ,
        ) = leverageToken.getTokenInfo(leverageTokenId);
        updateLiquidationStatus(msg.sender, leverageTokenId, leverageToken.balanceOf(msg.sender, leverageTokenId), leverage );


        userCollateral[msg.sender] -= preview.underlyingAmountInWei;
        CollateralInWei -= preview.underlyingAmountInWei;
        totalSupplyS -= preview.sAmountNeededInWei;
        totalSupplyL -= preview.lAmountBurnedInWei;

        //更新用戶在interestManager的應付利息及杠桿幣數量
        interestManager.updateUserPosition(msg.sender, leverageTokenId, preview.deductInterestInWei, preview.lAmountBurnedInWei);

        // 部分抵押物給用戶
        //      對於用戶注銷：抵押物給用戶
        //      對於AMM池賣出注銷：抵押物給AMM池，由AMM池在DEX上賣出
        bool userTransferSuccess = underlyingToken.transfer(msg.sender, preview.underlyingAmountToUser);
        // 部分抵押物(作爲利息)給InterestManager
        bool feeTransferSuccess = underlyingToken.transfer(address(interestManager), preview.underlyingAmountToInterestManager);

        require(userTransferSuccess, "User transfer failed");
        require(feeTransferSuccess, "Fee transfer failed");

        stableTokenBurnedInWei = preview.sAmountNeededInWei;
        leverageTokenBurnedInWei = preview.lAmountBurnedInWei;
        underlyingAmountRedeemedInWei = preview.underlyingAmountToUser;
        emit Burn(msg.sender, leverageTokenId, stableTokenBurnedInWei, leverageTokenBurnedInWei, underlyingAmountRedeemedInWei);
    }

    /**
     * @dev 計算按照一定比例burn L代币，所需的S代币數量，贖回的抵押品數量，及應付給InterestManager的利息(不改變區塊鏈狀態)
     */    
    function previewBurn(
        address user,
        uint256 leverageTokenId,
        uint256 lAmountPercentage,
        uint256 currentPriceInWei
    ) public view returns (BurnPreview memory result) {
        require(lAmountPercentage >= 1 && lAmountPercentage <= 100, "Percentage must be between 1% and 100%");
        uint256 totalLAmountInWei = leverageToken.balanceOf(user, leverageTokenId);
        // require(totalLAmountInWei > 0, "No L tokens to burn");
        (LeverageType leverage, uint256 mintPrice, , , ) = leverageToken.getTokenInfo(leverageTokenId);
        uint256 totalInterestInWei = interestManager.previewAccruedInterest(user, leverageTokenId);
        result = CustodianUtils.previewBurn(
            underlyingTokenDecimals,
            totalLAmountInWei,
            leverage,
            mintPrice,
            lAmountPercentage,
            currentPriceInWei,
            totalInterestInWei
        );
    }


    // ======================================= 前端調用函數 ================================================
    // 1. getTokenDetails: 获取特定id的token信息
    // 2. getUserCollateral: 获取用户抵押品余额
    // 3. previewMint: Mint頁面調用，预览Mint结果
    // 4. previewBurn: Burn頁面調用，预览Burn结果
    // 5. getAllLeverageTokenInfo: 获取用戶所有leverage token的详细信息
    // 6. getSingleLeverageTokenInfo: 获取用戶单个leverage token的详细信息（供前端选择token后调用）
    // 7. getSingleLeverageTokenNav: 获取单个杠杆幣的净值（供前端选择token后调用）
    // 8. getProjectStats: 获取项目统计信息
    // ======================================= 前端調用函數 ================================================
    
    /**
     * @dev 获取token详细信息
     */
    function getTokenDetails(uint256 tokenId) external view returns (
        LeverageType leverage,
        uint256 mintPrice,
        uint256 creationTime,
        string memory tokenName,
        bool isStatic
    ) {
        return leverageToken.getTokenInfo(tokenId);
    }

    /**
     * @dev 获取用户抵押品余额
     */
    function getUserCollateral(address user) external view returns (uint256) {
        return userCollateral[user];
    }

    /**
     * @dev Mint頁面調用，预览Mint结果
     */
    function previewMint(
        uint256 underlyingAmountInWei,
        LeverageType leverage,
        uint256 mintPriceInWei,
        uint256 currentPriceInWei
    ) external pure returns (
        uint256 sAmountInWei,
        uint256 lAmountInWei,
        uint256 grossNavInWei
    ) {
        (sAmountInWei, lAmountInWei, grossNavInWei) = CustodianUtils.previewMint(
            underlyingAmountInWei,
            leverage,
            mintPriceInWei,
            currentPriceInWei
        );
    }

    /**
    * @dev 获取用戶所有leverage token的详细信息
    */
    function getAllLeverageTokenInfo(
        address user
    ) external view returns (
        uint256[] memory tokenIds, //用戶所有持有的杠杆幣IDs
        uint256[] memory balancesInWei, //用戶所有持有的杠杆幣數量
        LeverageType[] memory leverages, //杠杆类型,即CONSERVATIVE, MODERATE, AGGRESSIVE
        uint256[] memory mintPricesInWei, //鑄幣價格，有了leverage,mintPrice+(前端獲取的LTC currentPrice)就可以计算净值,如nav = (z*Pt - x*1)/4x = (z*Pt - z*P0/5)/4/(z*P0/5) = (5Pt - P0)/(4P0)
        uint256[] memory accuredInterestsInWei //用户已累积的未扣除利息,用於計算扣除利息后的净值
    ) {
        uint256[] memory userTokens = userTokenIds[user];
        uint256 activeCount = 0;
        
        // 先统计非零余额的数量
        for (uint256 i = 0; i < userTokens.length; i++) {
            if (leverageToken.balanceOf(user, userTokens[i]) > 0) {
                activeCount++;
            }
        }

        // 如果没有任何持仓，返回空数组
        if (activeCount == 0) {
            return (
                new uint256[](0),
                new uint256[](0), 
                new LeverageType[](0),
                new uint256[](0),
                new uint256[](0)
            );
        }

        // 填充结果数组
        tokenIds = new uint256[](activeCount);
        balancesInWei = new uint256[](activeCount);
        leverages = new LeverageType[](activeCount);
        mintPricesInWei = new uint256[](activeCount);
        accuredInterestsInWei = new uint256[](activeCount);
        
        uint256 index = 0;
        for (uint256 i = 0; i < userTokens.length; i++) {
            uint256 balance = leverageToken.balanceOf(user, userTokens[i]);
            if (balance > 0) {
                uint256 tokenId = userTokens[i];

                tokenIds[index] = tokenId;
                balancesInWei[index] = balance;//獲取用戶持有的杠杆幣數量
                (leverages[index], mintPricesInWei[index],,,) = leverageToken.getTokenInfo(tokenId);//獲取杠杆类型和鑄幣價格
                accuredInterestsInWei[index] = interestManager.previewAccruedInterest(user, tokenId);//獲取用戶已累積的未扣除利息
                
                index++;
            }
        }

        //有了上面的返回結果，在前端可以顯示：數量,净值，纍計利息, 除息净值
        /*
         * 计算净值的公式：
         *  CONSERVATIVE : (9Pt - P0)/(8P0)
         *  MODERATE : (5Pt - P0)/(4P0)
         *  AGGRESSIVE : (2Pt - P0)/(1P0)
         *  其中Pt是当前价格(從前端獲取)，P0是這裏的mintPrice
         *  
         *  除息净值 = (净值*数量 - 累计利息) / 数量
        */
    }

    /**
    * @dev 获取用戶单个leverage token的详细信息（供前端选择token后调用）
    */
    function getSingleLeverageTokenInfo(
        address user, 
        uint256 tokenId
    ) external view returns (
        uint256 balance,                     // 用户余额
        LeverageType leverage,              // 杠杆类型
        uint256 mintPrice,                  // 铸币价格
        string memory tokenName,            // token名称
        bool isStatic,                      // 是否为静态token
        uint256 accruedInterest,            // 累计利息
        uint256 creationTime                // 创建时间
    ) {
        // 检查用户是否持有该token
        balance = leverageToken.balanceOf(user, tokenId);
        require(balance > 0, "User does not hold this token");
        
        // 获取token完整信息
        (leverage, mintPrice, creationTime, tokenName, isStatic) = leverageToken.getTokenInfo(tokenId);
        
        // 获取累计利息
        accruedInterest = interestManager.previewAccruedInterest(user, tokenId);
    }

    /**
    * @dev 获取单个杠杆Token的净值信息 V2版本 - 使用内部预言机价格
    * @param user 用户地址
    * @param tokenId 杠杆Token ID
    * @return balance 用户余额
    * @return grossNavInWei 总净值（未扣利息）
    * @return netNavInWei 除息净值
    * @return totalValueInWei 总价值（余额 × 净值）
    * @return totalNetValueInWei 净价值（余额 × 除息净值）
    * @return accruedInterestInWei 累计利息
    * @return currentPriceInWei 当前LTC价格（预言机获取）
    * @return priceTimestamp 价格更新时间
    */
    function getSingleLeverageTokenNavV2(
        address user,
        uint256 tokenId
    ) external view returns (
        uint256 balance,                     // 用户余额
        uint256 grossNavInWei,              // 总净值（未扣利息）
        uint256 netNavInWei,                // 除息净值
        uint256 totalValueInWei,            // 总价值（余额 × 净值）
        uint256 totalNetValueInWei,         // 净价值（余额 × 除息净值）
        uint256 accruedInterestInWei,       // 累计利息
        uint256 currentPriceInWei,          // 当前LTC价格
        uint256 priceTimestamp              // 价格时间戳
    ) {
        // ✅ 1. 验证用户持有该Token
        balance = leverageToken.balanceOf(user, tokenId);
        require(balance > 0, "User does not hold this token");
        
        // ✅ 2. 从内部预言机获取最新价格
        bool priceValid;
        (currentPriceInWei, priceTimestamp, priceValid) = this.getLatestPriceView();
        require(priceValid, "Oracle price not available or too old");
        require(currentPriceInWei > 0, "Invalid current price from oracle");
        
        // ✅ 3. 获取Token信息
        (LeverageType leverage, uint256 mintPriceInWei,,,) = leverageToken.getTokenInfo(tokenId);
        
        // ✅ 4. 获取累计利息
        accruedInterestInWei = interestManager.previewAccruedInterest(user, tokenId);
        
        // ✅ 5. 计算总净值（根据杠杆公式）
        grossNavInWei = CustodianUtils.calculateNav(
            leverage,
            mintPriceInWei,
            currentPriceInWei
        );
        
        // ✅ 6. 计算总价值
        totalValueInWei = balance * grossNavInWei / PRICE_PRECISION;
        
        // ✅ 7. 计算除息净值和净价值
        if (totalValueInWei >= accruedInterestInWei) {
            netNavInWei = (totalValueInWei - accruedInterestInWei) * PRICE_PRECISION / balance;
            totalNetValueInWei = totalValueInWei - accruedInterestInWei;
        } else {
            // 如果累计利息超过总价值，净值为0
            netNavInWei = 0;
            totalNetValueInWei = 0;
        }
    }



    // ====================== 清算和拍卖管理器 =======================
    // 清算合约
    LiquidationManager public liquidationManager;
    AuctionManager public auctionManager;
    //Accounting variables
    uint256 public accumulatedRewardInStable = 0;
    uint256 public accumulatedPenaltyInStable = 0;
    uint256 public accumulatedUnderlyingSoldInAuction = 0;
    uint256 public accumulatedReceivedInAuction  = 0;
    // ====================== 权限管理 =======================
    bytes32 public constant LIQUIDATION_ROLE = keccak256("LIQUIDATION_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant AUCTION_ROLE = keccak256("AUCTION_ROLE");

    
    function grantAuctionRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(AUCTION_ROLE, account);
        emit AuctionAccessGranted(account);
    }
    function revokeAuctionRole(address account) onlyRole(ADMIN_ROLE) public  {
        revokeRole(AUCTION_ROLE, account);
        emit AuctionAccessRevoked(account);
    }
    function grantLiquidationRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(LIQUIDATION_ROLE, account);
        emit LiquidationAccessGranted(account);
    }
    function revokeLiquidationRole(address account) onlyRole(ADMIN_ROLE) public {
        revokeRole(LIQUIDATION_ROLE, account);
        emit LiquidationAccessRevoked(account);
    }
    function grantAdminRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(ADMIN_ROLE, account);
        emit AdminAccessGranted(account);
    }
    function revokeAdminRole(address account) onlyRole(ADMIN_ROLE) public {
        revokeRole(ADMIN_ROLE, account);
        emit AdminAccessRevoked(account);
    }
    // ================= 定义error ===============
    error InsufficientAllowance(uint256 allowance, uint256 required);
    error InsufficientBalance(uint256 balance, uint256 required);
    function checkAllowance(uint256 _inputValue1, uint256 _inputValue2) internal pure {
        if (_inputValue1 < _inputValue2) {
            // 触发自定义错误，并传入相关的变量值
            revert InsufficientAllowance(_inputValue1, _inputValue2);
        }
    }
    function checkBalance(uint256 _inputValue1, uint256 _inputValue2) internal pure {
        if (_inputValue1 < _inputValue2) {
            // 触发自定义错误，并传入相关的变量值
            revert InsufficientBalance(_inputValue1, _inputValue2);
        }
    }


    //================== 定义事件 =================
    event AdminAccessGranted(address indexed user);
    event LiquidationAccessGranted(address indexed user);   
    event AuctionAccessGranted(address indexed user); 
    event AdminAccessRevoked(address indexed user);
    event LiquidationAccessRevoked(address indexed user);
    event AuctionAccessRevoked(address indexed user); 
    event SellUnderlyingInAuction(address indexed kpr, uint256 amount);
    event ReceiveStableInAuction(address indexed kpr, uint256 amount);
    event RewardKpr(address indexed kpr, uint256 amount);
    event InterestPaidInAdjustment(uint256 interest);
    event ResetAccounting();
    event BurnLeverageTokenInLiquidation(address indexed user, uint256 tokenId, uint256 balance);
    event WithdrawAfterLiquidation(address indexed user, uint256 amountToUser, uint256 penalty);
    event BurnStableTokenInLiquidation(address indexed user,uint256 tokenID, uint256 stableAmount );

    // ================= Accounting =====================
    function getAccumulatedRewardInStable() external onlyRole(ADMIN_ROLE) view returns (uint256) {
        return accumulatedRewardInStable;
    }
    function getAccumulatedPenaltyInStable() external onlyRole(ADMIN_ROLE) view returns (uint256) {
        return accumulatedPenaltyInStable;
    }
    function resetAccounting() external onlyRole(ADMIN_ROLE) {
        accumulatedRewardInStable = 0;
        accumulatedPenaltyInStable = 0;
        accumulatedUnderlyingSoldInAuction = 0;
        accumulatedReceivedInAuction = 0;
        emit ResetAccounting();
    }
    
    // ================= 记录清算信息 =====================
    function updateLiquidationStatus(address user, uint256 tokenId,  uint256 balance, 
        LeverageType leverageType ) internal {
            require(address(liquidationManager)!=address(0), "liquidationManager not set" );
            require(liquidationManager.checkFreezeStatus(user, tokenId) == false, "Token is freezed" );
            liquidationManager._updateLiquidationStatus(user, tokenId,
             balance, leverageType);
    }

    // =================清算=====================
    /**
     * @dev 销毁被清算的Ltoken
     * @param user 用户地址
     * @param tokenId tokenID
     * @param balance 销毁数量
     */
    function burnToken (address user, uint256 tokenId, uint256 balance, uint256 underlyingAmountInWei ) external onlyRole(LIQUIDATION_ROLE) {

        leverageToken.burn(user, tokenId, balance);
        totalSupplyL -= balance;
        emit BurnLeverageTokenInLiquidation(user, tokenId, balance);

        // ================ 更新利息记录 =============
        //定义变量
        uint256 totalInterestInWei = interestManager.previewAccruedInterest(user, tokenId);
        uint256 underlyingAmountToInterestManager; 
        (uint256 currentPriceInWei, , bool isValid) = this.getLatestPriceView();
        // 计算利息对应的底层资产数量
        if(isValid && currentPriceInWei > 0) {
            uint256 deductUnderlyingAmountInWei = totalInterestInWei * PRICE_PRECISION / currentPriceInWei;
            require(deductUnderlyingAmountInWei <= underlyingAmountInWei, "The underlying to be in auction should be more than accured interest.");
            
            // 根据底层资产精度调整
            if (underlyingTokenDecimals == 18) {
                underlyingAmountToInterestManager = deductUnderlyingAmountInWei;
            } else if (underlyingTokenDecimals < 18) {
                underlyingAmountToInterestManager = deductUnderlyingAmountInWei / (10 ** (18 - underlyingTokenDecimals));
            } else {
                underlyingAmountToInterestManager = deductUnderlyingAmountInWei * (10 ** (underlyingTokenDecimals - 18));
            }
        } else {
            //價格爲0，無法計算利息
            underlyingAmountToInterestManager = 0;
        }


        // 将利息转移到interestManager中
        bool feeTransferSuccess = underlyingToken.transfer(address(interestManager), underlyingAmountToInterestManager);
        require(feeTransferSuccess, "Interest transfer failed");

        //利息从记录中扣除
        //被清算的代币数量从记录中扣除
        interestManager.updateUserPosition(user, tokenId, totalInterestInWei, balance);

    }
    


        /**
     * @dev 用户提取清算后拍卖后得到的稳定币
     * @param user 用户地址
     * @param tokenID 被清算的tokenID
     * @param amountToUser 最后返还给用户的稳定币
     * @param penalty 惩罚金
     * @param stableAmountToBeBurned 将被销毁的稳定币
     */
    function withdrawAfterLiquidation (address user, uint256 tokenID, uint256 amountToUser,  uint256 penalty,  uint256 stableAmountToBeBurned ) external onlyRole(LIQUIDATION_ROLE) {
        require(stableToken.balanceOf(address(this)) >= (stableAmountToBeBurned+amountToUser), 'withdrawAfterLiquidation failed.' );
        stableToken.burn(address(this), stableAmountToBeBurned);
        totalSupplyS -= stableAmountToBeBurned;
        require(stableToken.transfer(user, amountToUser), 'withdrawAfterLiquidation failed' );
        accumulatedPenaltyInStable += penalty;
        emit BurnStableTokenInLiquidation(user, tokenID, stableAmountToBeBurned);
        emit WithdrawAfterLiquidation(user, amountToUser, penalty); 
    } 



    //================== 拍卖 ====================
    function receiveFromKpr(address kpr,  uint256 stableAmount) external onlyRole(AUCTION_ROLE) {
        // require(stableToken.balanceOf(kpr) >= stableAmount, 'receiveFromKpr failed' );
        checkBalance(stableToken.balanceOf(kpr), stableAmount);
        checkAllowance(stableToken.allowance(kpr, address(this)), stableAmount);
        require(stableToken.transferFrom( kpr, address(this), stableAmount), 'receiveFromKpr failed' );
        accumulatedReceivedInAuction += stableAmount;
        emit ReceiveStableInAuction(kpr, stableAmount);
    }

    function transferToKpr( address kpr , uint256 underlyingAmount) external onlyRole(AUCTION_ROLE) {
        require(underlyingToken.balanceOf(address(this)) >= underlyingAmount, 'underlyingType amount not enough');
        require(underlyingToken.transfer(kpr, underlyingAmount), 'transferToKpr failed' );
        CollateralInWei -= underlyingAmount;
        accumulatedUnderlyingSoldInAuction += underlyingAmount;
        emit SellUnderlyingInAuction(kpr, underlyingAmount);
    }

    function rewardKpr(address kpr, uint256 rewardAmount) external onlyRole(AUCTION_ROLE) {
        checkBalance(stableToken.balanceOf(address(this)), rewardAmount);
        require(stableToken.transfer(kpr, rewardAmount), 'transferToKpr failed' );
        accumulatedRewardInStable += rewardAmount;
        emit RewardKpr(kpr, rewardAmount);
    }

}
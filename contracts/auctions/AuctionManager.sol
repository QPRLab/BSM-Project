// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../tokens/StableToken.sol";
import "./LiquidationManager.sol";
import "../interfaces/IAbacus.sol";

// 方便无本金拍卖
interface ClipperCallee {
    function clipperCall(address, uint256, uint256, bytes calldata) external;
}


contract AuctionManager is AccessControl, ReentrancyGuard{
    // --- 权限管理 ---
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    function grantCallerRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(CALLER_ROLE, account);
        emit CallerAccessGranted(account);
    }  
    function revokeCallerRole(address account) onlyRole(ADMIN_ROLE) public {
        revokeRole(CALLER_ROLE, account);
        emit CallerAccessRevoked(account);
    }
    function grantAdminRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(ADMIN_ROLE, account);
        emit AdminAccessGranted(account);
    }
    function revokeAdminRole(address account) onlyRole(ADMIN_ROLE) public {
        revokeRole(ADMIN_ROLE, account);
        emit AdminAccessRevoked(account);
    }



    // --- 数据 ---
    StableToken public immutable stableToken;                // 稳定币合约
    CustodianFixed public immutable custodian;        // 核心引擎
    
    LiquidationManager  public liquidationManager;  // 清算管理模块
    IAbacus  public priceCalculator;     // 当前价格计算器 (from Abacus)

    // 拍卖参数结构体 - 优化存储布局
    struct AuctionParams {
        uint256 priceMultiplier;     // 增加起始价格的乘数因子 
        uint256 resetTime;           // 拍卖重置前的时间 [seconds]
        uint256 priceDropThreshold;  // 拍卖重置前的价格下降百分比
        uint256 percentageReward;    // 激励keeper的百分比费用 
        uint256 fixedReward;         // 激励keeper的固定费用 
        uint256 minAuctionAmount;    // 最小购买数量 
    }
    AuctionParams public auctionParams;

    uint256   public totalAuctions = 0;     // 总拍卖数量
    
    // 循环优化 - 使用映射跟踪活跃拍卖
    mapping(uint256 => bool) public isActiveAuction;
    uint256 public activeAuctionCount;

    // ================ Accounting (auction-level) ==================
    uint256 public accumulatedReceivedInAuction = 0;
    uint256 public accumulatedUnderlyingSoldInAuction = 0;
    uint256 public accumulatedRewardInStable = 0;

    struct Auction {
        uint256 valueToBeBurned;  // 剩余抵押品数量 [1e18]
        int256 underlyingAmount; // 扣除reward后剩余的底层资产数量 [1e18] 有正负
        uint256 soldUnderlyingAmount; //卖掉的underlying数量[1e18]
        address originalOwner;     // 被清算的杠杆币所有者
        uint256 tokenId;           // tokenID
        uint96  startTime;         // 拍卖开始时间
        uint256 startingPrice;     // 起始价格 [1e18]
        uint256 currentPrice;      // 当前价格 [1e18]
        uint256 totalPayment;      // 累计支付金额  - 拍卖重置时不重置该值
    }
    mapping(uint256 => Auction) public auctions;

    // uint256 internal reentrancyLock;

    // 断路器级别
    // 0: 无限制
    // 1: 禁止新拍卖()
    // 2: 禁止新拍卖()或重置拍卖()
    // 3: 禁止新拍卖()、重置拍卖()或购买()
    uint256 public circuitBreaker = 0;



    // --- 事件 ---
    event AdminAccessGranted(address indexed user);
    event CallerAccessGranted(address indexed user);    
    event AdminAccessRevoked(address indexed user);
    event CallerAccessRevoked(address indexed user);


    event ParameterChanged(bytes32 indexed parameter, uint256 value);
    event AddressChanged(bytes32 indexed parameter, address addr);

    event AuctionStarted(
        uint256 indexed auctionId,
        uint256 valueToBeBurned,
        uint256 startingPrice,
        address originalOwner,
        uint256 indexed tokenId,
        address indexed triggerer,
        uint256 rewardValue
    );
    event PurchaseMade(
        uint256 indexed auctionId,
        uint256 currentPrice,
        uint256 purchaseSlice,
        uint256 remainingValueToBeBurned,
        address indexed kpr,
        address indexed originalOwner
    );
    event AuctionReset(
        uint256 indexed auctionId,
        uint256 valueToBeBurned,
        uint256 newStartingPrice,
        address originalOwner,
        uint256 indexed tokenId,
        address indexed triggerer,
        uint256 rewardValue
    );

    event AuctionRemoved(uint256 auctionId);

    event ResetAccounting();

    event AuctionCancelled(uint256 auctionId);

    // --- 初始化 ---
    constructor(
        address stableToken_, 
        address custodian_
    ) {      
        require(stableToken_ != address(0), "StableToken address cannot be 0");
        require(custodian_ != address(0), "Custodian address cannot be 0");
        stableToken = StableToken(stableToken_);  
        custodian = CustodianFixed(custodian_);
        
        // 设置角色 (权限管理)
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        emit AdminAccessGranted(msg.sender);
    }


    modifier checkCircuitBreaker(uint256 level) {
        require(circuitBreaker < level, 'CircuitBreaker error!');
        _;
    }


    // --- 管理功能 ---

    function initialize(
        address liquidationManager_, 
        address priceCalculator_,
        uint256 priceMultiplier_,
        uint256 resetTime_,
        uint256 priceDropThreshold_,
        uint256 percentageReward_,
        uint256 fixedReward_,
        uint256 minAuctionAmount_
    ) external onlyRole(ADMIN_ROLE) {

        liquidationManager = LiquidationManager(liquidationManager_);
        grantCallerRole(liquidationManager_);
        priceCalculator = IAbacus(priceCalculator_);

        auctionParams.priceMultiplier = priceMultiplier_;
        auctionParams.resetTime = resetTime_;
        auctionParams.priceDropThreshold = priceDropThreshold_;
        auctionParams.percentageReward = percentageReward_;
        auctionParams.fixedReward = fixedReward_;
        auctionParams.minAuctionAmount = minAuctionAmount_;
    }

    function setParameter(bytes32 parameter, uint256 value) external onlyRole(ADMIN_ROLE) nonReentrant {
        // require(hasRole(ADMIN_ROLE, msg.sender), "Auction/not-admin");

        if      (parameter == "priceMultiplier") auctionParams.priceMultiplier = value;
        else if (parameter == "resetTime")       auctionParams.resetTime = value;           // 拍卖重置前的时间
        else if (parameter == "minAuctionAmount") auctionParams.minAuctionAmount = value;           // 最小购买金额
        else if (parameter == "priceDropThreshold") auctionParams.priceDropThreshold = value; // 拍卖重置前的价格下降百分比
        else if (parameter == "percentageReward") auctionParams.percentageReward = value;   // 激励百分比
        else if (parameter == "fixedReward")     auctionParams.fixedReward = value;  // 固定激励费用
        else if (parameter == "circuitBreaker") circuitBreaker = value;        // 设置断路器级别
        else revert("Unrecognized parameter");
        emit ParameterChanged(parameter, value);
    }
    
    function setAddress(bytes32 parameter, address addr) external onlyRole(ADMIN_ROLE) nonReentrant {
        // require(hasRole(ADMIN_ROLE, msg.sender), "Auction/not-admin");
        if (parameter == "liquidationManager") { liquidationManager = LiquidationManager(addr); grantCallerRole(addr);}
        else if (parameter == "priceCalculator") priceCalculator = IAbacus(addr);
        else revert("Unrecognized parameter");
        emit AddressChanged(parameter, addr);
    }

    // --- 数学运算 ---
    // uint256 constant BILLION = 10 **  9;
    // uint256 constant WAD = 10 ** 18;
    // uint256 constant RAY = 10 ** 27;

    // 定义内部精度
    uint8 public constant PRECISION_DECIMALS = 18;
    uint256 public constant PRECISION_UNIT = 1e18;

    function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = x <= y ? x : y;
    }
    function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require((z = x + y) >= x);
    }
    function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require((z = x - y) <= x);
    }
    function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x);
    }
    function wmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = mul(x, y) / PRECISION_UNIT;
    }
    function wdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = mul(x, PRECISION_UNIT) / y;
    }


    // --- 拍卖功能 ---

    // 开始拍卖
    function startAuction(
        uint256 valueToBeBurned,  // 需被销毁的稳定币价值
        uint256 penalty,          // 惩罚金
        address originalOwner,    // 被清算用户地址
        uint256 tokenId,          // tokenID
        uint256 underlyingValueToUser, //返还给用户的残值
        address triggerer         // 将接收激励的地址
    ) external onlyRole(CALLER_ROLE) nonReentrant checkCircuitBreaker(1) returns (uint256 auctionId) {
        // 输入验证
        auctionId = ++totalAuctions;


        // 循环优化 - 更新映射和计数器
        isActiveAuction[auctionId] = true;
        activeAuctionCount++;


        // 从预言机获取最新底层资产价格并计算拍卖起始价格
        uint256 startingPrice;
        (uint256 currentPrice, , bool isValid) = custodian.getLatestPriceView();
        require(currentPrice>0 && isValid, 'Invalid oracle price!');
        startingPrice = wmul(currentPrice, auctionParams.priceMultiplier);

        // 计算应付给Keeper的reward
        uint256 currentFixedReward = auctionParams.fixedReward;
        uint256 currentPercentageReward = auctionParams.percentageReward;
        uint256 rewardValue;

        if (currentFixedReward > 0 || currentPercentageReward > 0) {
            uint256 currentMinAuctionAmount = auctionParams.minAuctionAmount;
            // 当拍卖数量大于等于最小拍卖数量时，支付固定奖励和比例奖励，否则只支付固定奖励
            if ( wdiv(valueToBeBurned, currentPrice) >= currentMinAuctionAmount) {
                rewardValue = add(currentFixedReward, wmul( valueToBeBurned- wmul(currentMinAuctionAmount, currentPrice ), currentPercentageReward));

            } else{
                rewardValue = currentFixedReward;
            }
        }

        // 记录拍卖信息
        auctions[auctionId].startingPrice = startingPrice;
        auctions[auctionId].valueToBeBurned = valueToBeBurned;
        auctions[auctionId].underlyingAmount =int256(wdiv( valueToBeBurned + penalty , currentPrice)) 
                                                - int256(wdiv( rewardValue, currentPrice))  ;
        auctions[auctionId].soldUnderlyingAmount = 0;
        auctions[auctionId].originalOwner = originalOwner;
        auctions[auctionId].tokenId = tokenId;
        auctions[auctionId].startTime = uint96(block.timestamp);
        
        // 返还给被清算用户残值
        custodian.backToUser(originalOwner,  wdiv(underlyingValueToUser, currentPrice));

        // 支付reward        
        custodian.rewardKpr(triggerer, wdiv(rewardValue, currentPrice));

        emit AuctionStarted(auctionId, valueToBeBurned, startingPrice,  originalOwner, tokenId, triggerer, rewardValue);
    }



        // 重置拍卖
    function resetAuction(
        uint256 auctionId,  // 要重置的拍卖ID
        address triggerer   // 将接收激励的地址
    ) external  nonReentrant checkCircuitBreaker(2) {
        // 读取拍卖数据
        address originalOwner = auctions[auctionId].originalOwner;
        uint96  startTime = auctions[auctionId].startTime;
        uint256 startingPrice = auctions[auctionId].startingPrice;

        require(originalOwner != address(0), "Invalid Original Owner!");

        // 检查拍卖是否需要重置并计算当前价格
        (bool needsReset,) = checkAuctionStatus(startTime, startingPrice);
        require(needsReset, "Auction is not ready to be reset!");

        uint256 valueToBeBurned = auctions[auctionId].valueToBeBurned;
        auctions[auctionId].startTime = uint96(block.timestamp);

        // 计算新的起始价格
        (uint256 currentPrice, , bool isValid) = custodian.getLatestPriceView();
        require(currentPrice>0 && isValid, 'Invalid oracle price!');
        startingPrice = wmul(currentPrice, auctionParams.priceMultiplier);
        auctions[auctionId].startingPrice = startingPrice;

        // 计算应付给Keeper的reward
        uint256 currentFixedReward = auctionParams.fixedReward;
        uint256 currentPercentageReward = auctionParams.percentageReward;
        uint256 rewardValue;

        if (currentFixedReward > 0 || currentPercentageReward > 0) {
            uint256 currentMinAuctionAmount = auctionParams.minAuctionAmount;
            // 当拍卖数量大于等于最小拍卖数量时，支付固定奖励和比例奖励，否则只支付固定奖励
            if ( wdiv(valueToBeBurned, currentPrice) >= currentMinAuctionAmount) {
                rewardValue = add(currentFixedReward, wmul( valueToBeBurned- wmul(currentMinAuctionAmount, currentPrice ), currentPercentageReward));

            } else{
                rewardValue = currentFixedReward;
            }
        }

        // 更新underlying数量
        auctions[auctionId].underlyingAmount= auctions[auctionId].underlyingAmount - int256(wdiv( rewardValue, currentPrice));
        
        // 激励触发拍卖        
        custodian.rewardKpr(triggerer, wdiv(rewardValue, currentPrice));

        emit AuctionReset(auctionId, valueToBeBurned, startingPrice, originalOwner, auctions[auctionId].tokenId , triggerer, rewardValue);
    }


    // 检查并确保授权额度
    function ensureApproval(uint256 amount) internal view {
        uint256 currentAllowance = stableToken.allowance(msg.sender, address(custodian));
        if (currentAllowance < amount) {
            // 前端需要提示用户授权
            revert("Insufficient approval. Please approve Custodian contract to spend your stable tokens");
        }
    }


    // 购买底层资产
    function purchaseUnderlying(
        uint256 auctionId,           // 拍卖ID
        uint256 maxPurchaseAmount,   // 购买underlying数量的上限 [Wei]
        uint256 maxAcceptablePrice,  // 最高可接受价格 [Wei]
        address receiver,            // underlying接收者和外部调用地址
        bytes calldata callData      // 传递给外部调用的数据
    ) external nonReentrant checkCircuitBreaker(3) {
        require(address(stableToken)!=address(0),'stableToken address is not set');
        ensureApproval(wmul(maxPurchaseAmount, maxAcceptablePrice));
        address originalOwner = auctions[auctionId].originalOwner;
        require(originalOwner != address(0), "Auction not ready");

        uint96  startTime = auctions[auctionId].startTime;
        uint256 currentPrice;
        {
            bool needsReset;
            (needsReset, currentPrice) = checkAuctionStatus(startTime, auctions[auctionId].startingPrice);

            // 检查拍卖是否需要重置
            require(!needsReset, "Auction needs to be reset");
        }

        // 确保价格对买家可接受
        require(maxAcceptablePrice >= currentPrice, "Current price is above acceptable price");

        // 确保买家最大购买量不小于系统最小购买量
        uint256 currentMinAuctionAmount = auctionParams.minAuctionAmount; //最小购买限制
        require(maxPurchaseAmount>=currentMinAuctionAmount, 'Puchase amount should be no less than the minimum purchase limit');

        uint256 valueToBeBurned = auctions[auctionId].valueToBeBurned;
        uint256 paymentAmount;


        
        // 购买尽可能多的抵押品，最多到maxPurchaseAmount
        uint256 purchaseSlice = maxPurchaseAmount;

        // 购买这部分underlying需要的S金额
        paymentAmount = wmul(purchaseSlice, currentPrice);

        // 如果支付的S超过销毁量，将其设为销毁量, 并计算相应底层资产数量; 
        // 如果支付的S不足以抵消销毁量，那么计算underlying尘数量是否小于系统最小购买限制
        if (paymentAmount>valueToBeBurned){
            paymentAmount = valueToBeBurned;
            purchaseSlice = wdiv(paymentAmount, currentPrice);
        } else {
            uint256 residualAmount = wdiv(sub(valueToBeBurned, paymentAmount), currentPrice);
            require(residualAmount > currentMinAuctionAmount, 'Residual value are too small, please increase the maximum purchase amount' );
        }

        // 更新剩余销毁数量
        auctions[auctionId].valueToBeBurned = sub(valueToBeBurned, paymentAmount);

        // 更新卖掉的underlying数量
        auctions[auctionId].soldUnderlyingAmount+=purchaseSlice;



        emit PurchaseMade(auctionId, currentPrice, purchaseSlice, auctions[auctionId].valueToBeBurned , receiver, originalOwner);

        if (auctions[auctionId].valueToBeBurned==0){
            // 更新清算状态
            liquidationManager._afterAuction(originalOwner, auctions[auctionId].tokenId,
             auctions[auctionId].soldUnderlyingAmount, auctions[auctionId].underlyingAmount);
            removeAuction(auctionId);
        }

        // 发送underlying给接收者
        custodian.transferToKpr(receiver, purchaseSlice);

        // 执行外部调用（如果定义了调用数据）
        LiquidationManager liquidationManager_ = liquidationManager;
        if (callData.length > 0 && receiver != address(custodian) && receiver != address(liquidationManager_)) {
            ClipperCallee(receiver).clipperCall(msg.sender, paymentAmount, purchaseSlice, callData);
        }
        
        // 从调用者获取S
        custodian.receiveFromKpr(msg.sender,  paymentAmount);
    
    }

    function removeAuction(uint256 auctionId) internal {
        //
        isActiveAuction[auctionId] = false;
        activeAuctionCount--;
        delete auctions[auctionId];
        emit AuctionRemoved(auctionId);
    }

    // 活跃拍卖数量
    function getActiveAuctionCount() external view returns (uint256) {
        return activeAuctionCount;
    }

    // 返回拍卖ID是否活跃
    function auctionIsActive(uint256 auctionId) external view returns (bool) {
        return isActiveAuction[auctionId];
    }

    // 外部查询拍卖状态
    function getAuctionStatus(uint256 auctionId) external view returns (bool needsReset, uint256 currentPrice, uint256 valueToBeBurned) {
        require(isActiveAuction[auctionId],'The acuction is not active');
        // 读取拍卖数据
        address originalOwner = auctions[auctionId].originalOwner;
        uint96  startTime = auctions[auctionId].startTime;

        bool done;
        (done, currentPrice) = checkAuctionStatus(startTime, auctions[auctionId].startingPrice);

        needsReset = originalOwner != address(0) && done;
        valueToBeBurned = auctions[auctionId].valueToBeBurned;
    }

    // 内部检查拍卖状态
    function checkAuctionStatus(uint96 startTime, uint256 startingPrice) internal view returns (bool needsReset, uint256 currentPrice) {
        currentPrice = priceCalculator.price(startingPrice, sub(block.timestamp, startTime));
        needsReset = (sub(block.timestamp, startTime) > auctionParams.resetTime || wdiv(currentPrice, startingPrice) < auctionParams.priceDropThreshold);
    }




    // 取消拍卖（紧急情况或治理操作）
    function cancelAuction(uint256 auctionId) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(auctions[auctionId].originalOwner != address(0), "Auction not started");
        removeAuction(auctionId);
        emit AuctionCancelled(auctionId);
    }

}
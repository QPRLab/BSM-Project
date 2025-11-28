// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../tokens/MultiLeverageToken.sol";
import "../CustodianFixed.sol";
import "./AuctionManager.sol";
import "../Types.sol";


contract LiquidationManager is AccessControl, ReentrancyGuard {

    MultiLeverageToken public immutable leverageToken;
    CustodianFixed public immutable custodian;  // 核心合约  
    AuctionManager public auction; //清算模块
    

    // --- 权限管理 ---
    bytes32 public constant AUCTION_ROLE = keccak256("AUCTION_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
  
    function grantAuctionRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(AUCTION_ROLE, account);
        emit AuctionAccessGranted(account);
    }
    function revokeAuctionRole(address account) onlyRole(ADMIN_ROLE) public  {
        revokeRole(AUCTION_ROLE, account);
        emit AuctionAccessRevoked(account);
    }
    function grantCustodianRole(address account) onlyRole(ADMIN_ROLE) public  {
        grantRole(CUSTODIAN_ROLE, account);
        emit CustodianAccessGranted(account);
    }
    function revokeCustodianRole(address account) onlyRole(ADMIN_ROLE) public  {
        revokeRole(CUSTODIAN_ROLE, account);
        emit CustodianAccessRevoked(account);
    }
    function grantAdminRole(address account) onlyRole(ADMIN_ROLE) public  {
        grantRole(ADMIN_ROLE, account);
        emit AdminAccessGranted(account);
    }
    function revokeAdminRole(address account) onlyRole(ADMIN_ROLE) external {
        revokeRole(ADMIN_ROLE, account);
        emit AdminAccessRevoked(account);
    }


    // ================= 全局清算配置 =================
    struct GlobalLiquidationConfig {
        uint256 adjustmentThreshold;     // 净值调整阈值 [1e18] 
        uint256 liquidationThreshold;    // 强制清算阈值 [1e18]
        uint256 penalty;                 // 清算惩罚金 [1e18]
        bool enabled;                    // 清算功能是否启用
    }
    GlobalLiquidationConfig public globalConfig;



    // ================= 用户清算状态 =================
    struct UserLiquidationStatus {
        uint256 balance;               // 余额
        uint256 auctionId;
        LeverageType leverageType;     // 杠杆比例
        uint8 riskLevel;               // 风险等级
        bool isFreezed;                // 是否被冻结 币在清算时被冻结，拍卖完成时解冻。冻结期间无法铸币和销毁
    }
    mapping(address => mapping(uint256 => UserLiquidationStatus)) public userLiquidationStatus; // userLiquidationStatus[user][tokenId];

    // ================= 修饰符 =================
    modifier liquidationEnabled() {
        require(globalConfig.enabled, "Liquidation not enabled");
        _;
    }

    // --- Math ---
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

    //================== 定义事件 =================
    event AdminAccessGranted(address indexed user);
    event AuctionAccessGranted(address indexed user); 
    event CustodianAccessGranted(address indexed user);
    event AdminAccessRevoked(address indexed user);
    event AuctionAccessRevoked(address indexed user);
    event CustodianAccessRevoked(address indexed user);
    event ParameterChanged(bytes32 indexed parameter, uint256 value);
    event AddressChanged(bytes32 indexed parameter, address addr);
    event LiquidateSwitch (bool liquidationSwitch);
    // ================= 新增事件 =================
    event RiskLevelUpdated(address indexed user, uint256 indexed tokenId, uint8 riskLevel);
    event NetValueAdjusted(address indexed user, uint256 indexed fromTokenId, uint256 indexed toTokenId, uint256 adjustAmountInWei, uint256 underlyingAmountInWei);
    event NoLeftAfterLiquidation(string message);
    event DEFICIT(uint256 value);


    // ================= 构造函数 =================
    constructor(
        address _leverageToken,
        address _custodian     
    ){
        require(_custodian != address(0), "Custodian cannot be zero address");
        require(_leverageToken != address(0), "LeverageToken cannot be zero address");

        // 添加权限管理
        custodian = CustodianFixed(_custodian);
        leverageToken = MultiLeverageToken(_leverageToken);

        // 设置角色 (权限管理)
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(CUSTODIAN_ROLE, _custodian);

        // 默认全局清算配置
        globalConfig = GlobalLiquidationConfig({
            adjustmentThreshold: PRECISION_UNIT / 2,   // 净值调整阈值 (0.5)
            liquidationThreshold: (3 * PRECISION_UNIT) / 10,  // 强制清算阈值 (0.3)
            penalty: (3 * PRECISION_UNIT) / 100,       // 清算惩罚金 (0.03)
            enabled: true
        });

        emit AdminAccessGranted(msg.sender);

    }

    function initialize(
        address _auction,
        uint256 _adjustmentThreshold,
        uint256 _liquidationThreshold,
        uint256 _penalty
    ) external onlyRole(ADMIN_ROLE) {

        
        // 初始化函数，可用于后续扩展
        auction = AuctionManager(_auction);
        grantAuctionRole(_auction);

        globalConfig.adjustmentThreshold = _adjustmentThreshold;
        globalConfig.liquidationThreshold = _liquidationThreshold;
        globalConfig.penalty = _penalty;


    }

        // --- 管理功能 ---
    function LiquidationSwitch(bool liquidationSwitch) external onlyRole(ADMIN_ROLE) nonReentrant{
        globalConfig.enabled = liquidationSwitch;
        emit LiquidateSwitch (liquidationSwitch);
    }
    
    function setParameter(bytes32 parameter, uint256 value) external onlyRole(ADMIN_ROLE) nonReentrant {
        // require(hasRole(ADMIN_ROLE, msg.sender), "Auction/not-admin");
        if      (parameter == "adjustmentThreshold") globalConfig.adjustmentThreshold = value;
        else if (parameter == "liquidationThreshold") globalConfig.liquidationThreshold = value;          
        else if (parameter == "penalty") globalConfig.penalty = value;          
        else revert("Unrecognized parameter");
        emit ParameterChanged(parameter, value);
    }
    
    function setAddress(bytes32 parameter, address addr) external onlyRole(ADMIN_ROLE) nonReentrant {
        // require(hasRole(ADMIN_ROLE, msg.sender), "Auction/not-admin");
        if (parameter == "auction") {auction = AuctionManager(addr); grantAuctionRole(addr);}
        else revert("Unrecognized parameter");
        emit AddressChanged(parameter, addr);
    }

    // ================= 更新用户清算信息 （铸币时和销毁时均需调用）================
    function _updateLiquidationStatus ( address user, uint256 tokenId,  uint256 balance, 
        LeverageType leverageType )        
         external onlyRole(CUSTODIAN_ROLE) nonReentrant{
            require(address(custodian)!=address(0),'Set custodian address first');
            userLiquidationStatus[user][tokenId].balance = balance;
            if (userLiquidationStatus[user][tokenId].leverageType != leverageType){
                userLiquidationStatus[user][tokenId].leverageType = leverageType;
            }
        }
    function checkFreezeStatus (address user, uint256 tokenId) public view returns (bool isFreezed){
        isFreezed = userLiquidationStatus[user][tokenId].isFreezed;
    } 



    // ================= 清算功能 =================
    
    /**
     * @dev 触发清算（类似MakerDAO的bark函数）
     * @param user 被清算用户
     * @param tokenId 杠杆币ID
     * @param kpr Keeper地址（接收激励）
     * @return auctionId 创建的拍卖ID
     */

    function bark(
        address user,
        uint256 tokenId,
        address kpr
    ) external liquidationEnabled nonReentrant returns (uint256 auctionId) {
        require(address(auction)!=address(0), 'Set auction address first!');
        require(address(custodian)!=address(0), 'Set custodian address first!');
        require(address(leverageToken)!=address(0), 'Set leverageToken address first!');
        require(user != address(0), "Invalid user address");
        require(kpr != address(0), "Invalid keeper address");
        require(leverageToken.tokenExists(tokenId), "Token does not exist");
        
        // 获取用户持仓
        uint256 balance = leverageToken.balanceOfInWei(user, tokenId);
        require(balance > 0, "No tokens to liquidate");
        require(userLiquidationStatus[user][tokenId].isFreezed == false, "The token is under liquidation");
        
        // 检查净值是否低于清算阈值
        uint256 nav = _calculateNetAssetValue(user, tokenId);
        require(nav < globalConfig.liquidationThreshold, "NAV above liquidation threshold");

        // 计算将要销毁的稳定币价值
        uint256 valueToBeBurned=_calculateValueToBeBurned(user, tokenId, balance);
        require(valueToBeBurned > 0, "Null auction");

        // 计算用户残值 
        uint256 underlyingValueToUser; 
        if (wmul(nav, balance) > globalConfig.penalty) {
            underlyingValueToUser = wmul(nav, balance) - globalConfig.penalty; 
        } else {
            underlyingValueToUser = 0;
        }
        
        // 销毁杠杆币，并处理利息
        custodian.burnToken(user, tokenId, balance);

        // 更新用户状态
        userLiquidationStatus[user][tokenId].riskLevel = 4; // 清算中
        userLiquidationStatus[user][tokenId].isFreezed = true;
        userLiquidationStatus[user][tokenId].balance =0 ;

        // 创建荷兰式拍卖
        auctionId = auction.startAuction(valueToBeBurned, globalConfig.penalty, user, tokenId, underlyingValueToUser, kpr);

        // 记录auctionID
        userLiquidationStatus[user][tokenId].auctionId =auctionId ;



        return auctionId;
    }


    /**
     * @dev 计算清算价值
     */
    function _calculateValueToBeBurned(
        address user,
        uint256 tokenId,
        uint256 balance
    ) internal view returns ( uint256 valueToBeBurned) {
        LeverageType leverage = userLiquidationStatus[user][tokenId].leverageType;
        uint8 leverageLevel;
        if (leverage==LeverageType.CONSERVATIVE){
            leverageLevel = 8;
        } else if (leverage==LeverageType.MODERATE){
            leverageLevel = 4;
        } else if (leverage==LeverageType.AGGRESSIVE ){
            leverageLevel = 1;
        }
        valueToBeBurned = wmul ( balance, 1*PRECISION_UNIT/leverageLevel );
    }

    /**
     * @dev 计算用户杠杆币的净值
     */
    function _calculateNetAssetValue(address user, uint256 tokenId) internal view returns (uint256 nav) {
        ( , , uint256 navInWei, , , , , ) = custodian.getSingleLeverageTokenNavV2(user, tokenId);
        require(navInWei>=0, 'Invalid Net Value!'); 
        nav = navInWei; // 返回除息净值
    }

    /**
     * @dev 当拍卖结束时，更新清算状态
     */
    function _afterAuction(address usr, uint256 tokenID, uint256 soldUnderlyingAmount, int256 underlyingAmount) external onlyRole(AUCTION_ROLE) {
        userLiquidationStatus[usr][tokenID].isFreezed = false; //解冻
        userLiquidationStatus[usr][tokenID].riskLevel = 0; //重置riskLevel
        userLiquidationStatus[usr][tokenID].auctionId = 0; //重置auctionId
        custodian.updateDeficit(soldUnderlyingAmount, underlyingAmount);
    }


    // ================= 下折功能 =================

    /**
     * @dev 风险预览 - 持币用户可以调用该函数查看并更新账户内所有token的净值风险等级
     * @param user 用户地址
     * @return tokenIds 用户持有的所有token ID数组
     * @return netValues 对应的净值数组
     * @return riskLevels 对应的风险等级数组
     */
    function updateAllTokensRiskLevel(address user) public returns (
        uint256[] memory tokenIds,
        uint256[] memory netValues,
        uint8[] memory riskLevels
    ) {
        require(user != address(0), "Invalid user address");
        require(address(custodian) != address(0), "Set custodian address first");
        
        // 获取用户所有token信息
        (tokenIds, , , , ) = custodian.getAllLeverageTokenInfo(user);
        
        uint256 tokenCount = tokenIds.length;
        netValues = new uint256[](tokenCount);
        riskLevels = new uint8[](tokenCount);
        
        for (uint256 i = 0; i < tokenCount; i++) {
            uint256 tokenId = tokenIds[i];
            uint256 balance = leverageToken.balanceOfInWei(user, tokenId);
            
            if (balance > 0) {
                // 获取净值
                ( , , uint256 netNavInWei, , , , , ) = custodian.getSingleLeverageTokenNavV2(user, tokenId);
                netValues[i] = netNavInWei;
                
                // 计算风险等级
                riskLevels[i] = _calculateRiskLevel(netNavInWei);
                
                // 更新用户状态
                userLiquidationStatus[user][tokenId].riskLevel = riskLevels[i];
            } else {
                netValues[i] = 0;
                riskLevels[i] = 0;
            }
        }
        
        return (tokenIds, netValues, riskLevels);
    }


    function updateSingleTokensRiskLevel(address user, uint256 tokenId) public returns (
        uint256 netValue,
        uint8 riskLevel
    ) {
        require(user != address(0), "Invalid user address");
        require(address(custodian) != address(0), "Set custodian address first");
        
        uint256 balance = leverageToken.balanceOfInWei(user, tokenId);
        require(balance > 0, "User does not hold this token");
        ( , , netValue, , , , , ) = custodian.getSingleLeverageTokenNavV2(user, tokenId);
        // 计算风险等级
        // riskLevel = 0;
        riskLevel = _calculateRiskLevel(netValue);
        
        // 更新用户状态
        userLiquidationStatus[user][tokenId].riskLevel = riskLevel;
    
    }


    /**
     * @dev 计算风险等级
     * @param netValue 净值（18位精度）
     * @return riskLevel 风险等级：0=安全，1=低风险，2=中风险，3=高风险，4=强制清算
     */
    function _calculateRiskLevel(uint256 netValue) internal view returns (uint8 riskLevel) {
        if (netValue <= globalConfig.liquidationThreshold) {
            // 净值低于强制清算阈值
            riskLevel = 4;
        } else if (netValue <= globalConfig.adjustmentThreshold) {
            // 净值在调整阈值和清算阈值之间，分为3档
            uint256 range = globalConfig.adjustmentThreshold - globalConfig.liquidationThreshold;
            uint256 position = netValue - globalConfig.liquidationThreshold;
            
            // 将区间分为3等分
            uint256 segment = range / 3;
            
            if (position <= segment) {
                riskLevel = 3; // 高风险（最接近清算阈值）
            } else if (position <= segment * 2) {
                riskLevel = 2; // 中风险
            } else {
                riskLevel = 1; // 低风险（最接近调整阈值）
            }
        } else {
            // 净值高于调整阈值，安全
            riskLevel = 0;
        }
        // riskLevel = 0;
    }



}
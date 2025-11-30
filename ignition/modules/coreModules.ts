import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/*
  1. 部署合約的兩種方式：
    a. 使用module
    b. 使用脚本
    優缺點比較：    
      部署方式	等待确认数	自动依赖管理	自动回滚	速度
      Ignition module	5	有	有	慢
      脚本部署	1 或 0	无	无	快
    
    本地开发建议用 Hardhat Network，出块快，Ignition 也会很快。
    测试网/主网建议耐心等待，保证部署安全。

  2. 爲什麽使用after屬性？
    保證每個合約按順序部署；
    Sepolia 测试网出块慢，多个合约并发部署时，交易容易被丢弃（dropped），尤其是同一个账户连续发多笔交易，nonce 管理容易出错。

  3. 執行部署代碼
    npx hardhat ignition deploy ignition/modules/toolModules.ts --network sepolia

  4. 查詢部署地址
    部署完成後，Ignition 會在專案根目錄下生成一個 `ignition-deployments` 資料夾，
    裏面有deployed_addresses.json檔案，可以查詢到各合約的部署地址。
*/

export default buildModule("coreModules", (m) => {

  // ================= 获取已部署合约地址 =================
  // 获取当前文件的目录 (ES module 替代 __dirname)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // 读取 Ignition 生成的 deployed_addresses.json
  const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../deployments/chain-11155111/deployed_addresses.json'), "utf-8"));

  // ================= 依赖的合约地址（来自 tokenModules）=================
  // 这些地址来自 tokenModules 部署，需要先部署 tokenModules
  const wltcAddress = deployedAddresses["tokenModules#WLTCMock"]; // WLTC (抵押物)
  const usdcAddress = deployedAddresses["tokenModules#USDCMock"]; // USDC (交易币)
  const stableTokenAddress = deployedAddresses["tokenModules#StableToken"]; // S Token (稳定币)
  const multiLeverageTokenAddress = deployedAddresses["tokenModules#MultiLeverageToken"]; // L Token (杠杆币)

  // ⚠️ 注意: 不使用 m.contractAt，避免在 deployed_addresses.json 中重复记录
  // 直接使用地址字符串作为参数传递给 m.contract 和 m.call
 


  // =====================================================
  // 部署: 管理器與價格預言機（InterestManager, LTCPriceOracle, CustodianFixed, LinearDecrease, AuctionManager, LiquidationManager）
  // 注意: 這裡把先前取得的 futures（例如 wltc、stableToken）直接作為構造函數參數。
  //      ignition 會確保在需要它們時先部署相依合約。
  // =====================================================
  // Deploy managers and oracle
  // 使用地址字符串直接作为构造参数
  const interestManager = m.contract("InterestManager", [wltcAddress, 300n]);
  // 初始價格 $120 === 120 * 10^18 for oracle
  const initialPrice = 120n * 10n ** 18n;
  // 使用 deploy_all.ts 中的 recipients 作为 price providers
  const priceProviders = [
    "0x4845d4db01b81A15559b8734D234e6202C556d32",
    "0x6bCf5fbb6569921c508eeA15fF16b92426F99218",
    "0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B",
    "0xA4b399a194e2DD9b84357E92474D0c32e3359A74",
  ];
  const ltcPriceOracle = m.contract("LTCPriceOracle", [initialPrice, priceProviders],{ after: [interestManager] });
  const custodianFixed = m.contract("CustodianFixed", [wltcAddress, stableTokenAddress, multiLeverageTokenAddress],
    { after: [ltcPriceOracle] }
  );

  // 时间相关参数（秒）
  const TIME_PARAMS = {
    ONE_HOUR: 3600,
    TWO_HOURS: 7200,
    TWENTY_FOUR_HOURS: 86400
  };
  // 价格计算器参数
  const PRICE_CALCULATOR_PARAMS = {
    TAU: TIME_PARAMS.ONE_HOUR          // 线性递减时间参数
  };
  
  const auctionManager = m.contract("AuctionManager", [stableTokenAddress,custodianFixed], { after: [custodianFixed]});
  const liquidationManager = m.contract("LiquidationManager", [multiLeverageTokenAddress, custodianFixed], {after: [auctionManager]});
  const linearDecrease = m.contract("LinearDecrease", [PRICE_CALCULATOR_PARAMS.TAU, auctionManager], {after: [liquidationManager]});


  // =====================================================
  // 初始化步驟（呼叫合約內的方法）
  // 注意: 需要使用 m.contractAt 来调用已部署合约的方法
  // =====================================================
  // 创建 contractAt futures 仅用于 m.call (不会重复记录到 deployed_addresses.json 中，因为没有被 return)
  const stableToken = m.contractAt("StableToken", stableTokenAddress);
  const multiLeverageToken = m.contractAt("MultiLeverageToken", multiLeverageTokenAddress);
  
  // 初始化 InterestManager（传入未来地址 futures）
  const initializeInterestManagerCall = m.call(interestManager, "initialize", [multiLeverageTokenAddress, custodianFixed],{ after: [linearDecrease] });
  // 设置 custodian
  const setStableCustodianCall = m.call(stableToken, "setCustodian", [custodianFixed],{ after: [initializeInterestManagerCall] });
  const setLeverageCustodianCall = m.call(multiLeverageToken, "setCustodian", [custodianFixed],{ after: [setStableCustodianCall] });
  // Ensure custodian is set on tokens before initializing the custodian system
  const CustodianInitializeCall = m.call(custodianFixed, "initialize", [interestManager, ltcPriceOracle, auctionManager, liquidationManager], {
    after: [setLeverageCustodianCall],
  });

  // 拍卖管理器参数
  const AUCTION_PARAMS = {
    PRICE_MULTIPLIER: "1.0",           // 起始价格乘数
    RESET_TIME: TIME_PARAMS.TWO_HOURS,  // 重置时间
    MIN_AUCTION_AMOUNT: "1",          // 最小拍卖金额
    PRICE_DROP_THRESHOLD: "0.8",        // 价格下降阈值
    PERCENTAGE_REWARD: "0.01",          // 百分比激励 (1%)
    FIXED_REWARD: "10"                  // 固定激励
  };

  const auctionManagerInitializeCall = m.call(auctionManager, "initialize", [
    liquidationManager,
    linearDecrease,
    ethers.parseEther(AUCTION_PARAMS.PRICE_MULTIPLIER),
    AUCTION_PARAMS.RESET_TIME, 
    ethers.parseEther(AUCTION_PARAMS.PRICE_DROP_THRESHOLD),
    ethers.parseEther(AUCTION_PARAMS.PERCENTAGE_REWARD),
    ethers.parseEther(AUCTION_PARAMS.FIXED_REWARD),
    ethers.parseEther(AUCTION_PARAMS.MIN_AUCTION_AMOUNT)
    ], { after: [CustodianInitializeCall] });

  // 清算管理器参数
  const LIQUIDATION_PARAMS = {
    ADJUSTMENT_THRESHOLD: "0.7",        // 调整阈值
    LIQUIDATION_THRESHOLD: "0.3",       // 清算阈值
    PENALTY: "0.03"                     // 惩罚金 (3%)
  };



  const liquidationManagerInitializeCall = m.call(liquidationManager, "initialize", [
    auctionManager,
    ethers.parseEther(LIQUIDATION_PARAMS.ADJUSTMENT_THRESHOLD),
    ethers.parseEther(LIQUIDATION_PARAMS.LIQUIDATION_THRESHOLD),
    ethers.parseEther(LIQUIDATION_PARAMS.PENALTY)
  ], { after: [auctionManagerInitializeCall] });



  // ================= 返回部署的合约 =================
  // 返回所有部署的合约 futures，供其他模块或测试使用
  return {
    interestManager,
    ltcPriceOracle,
    custodianFixed,
    linearDecrease,
    auctionManager,
    liquidationManager,
    initializeInterestManagerCall,
    setStableCustodianCall,
    setLeverageCustodianCall,
    CustodianInitializeCall,
    auctionManagerInitializeCall,
    liquidationManagerInitializeCall
  } as any;
});

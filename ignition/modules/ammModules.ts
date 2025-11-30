import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
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
    npx hardhat ignition deploy ignition/modules/ammModules.ts --network sepolia

  4. 查詢部署地址
    部署完成後，Ignition 會在專案根目錄下生成一個 `ignition-deployments` 資料夾，
    裏面有deployed_addresses.json檔案，可以查詢到各合約的部署地址。
*/

export default buildModule("ammModules", (m) => {

  // =====================================================
  // AMM 池部署相關常數與建構參數
  // Sepolia Testnet 真實 DEX 地址
  // =====================================================
  // ================= DEX 配置（Sepolia Testnet）=================
  const dexRouter = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b"; // ✅ UniversalRouter (Sepolia)
  const quoter = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3"; // ✅ QuoterV2 (Sepolia)
  const usdcUnderlyingPool = "0xCa250B562Beb3Be4fC75e79826390F9f14c622d0"; // ✅ WLTC/USDC Pool (您创建的池子)
  const poolFee = 3000; // 0.3% (uint24)
  
  // ================= AMM LP Token 配置 =================
  const lpName = "Stable-USDC LP";
  const lpSymbol = "SLP";

  // ================= 获取已部署合约地址 =================
  // 获取当前文件的目录 (ES module 替代 __dirname)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // 读取 Ignition 生成的 deployed_addresses.json
  const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../deployments/chain-11155111/deployed_addresses.json'), "utf-8"));

  // ================= 依赖的合约地址（来自 tokenModules）=================
  // 这些地址来自 tokenModules 部署，需要先部署 tokenModules
  const underlyingTokenAddress = deployedAddresses["tokenModules#WLTCMock"]; // WLTC (抵押物)
  const usdcTokenAddress = deployedAddresses["tokenModules#USDCMock"]; // USDC (交易币)
  const stableTokenAddress = deployedAddresses["tokenModules#StableToken"]; // S Token (稳定币)
  const multiLeverageTokenAddress = deployedAddresses["tokenModules#MultiLeverageToken"]; // L Token (杠杆币)
  const custodianFixedAddress = deployedAddresses["coreModules#CustodianFixed"]; // 托管合约

  // ⚠️ 注意: 不使用 m.contractAt 转换所有地址，避免在 deployed_addresses.json 中重复记录
  // 只在需要调用方法时才使用 m.contractAt

  // ================= 管理员地址 =================
  const feeCollector = "0x4845d4db01b81A15559b8734D234e6202C556d32"; // 费用收集地址
  
  // ================= 部署 AMM 合约 =================
  // 1. 部署 AMMLiquidity (流动性池管理)
  // 使用地址字符串作为构造参数
  const ammLiquidity = m.contract("AMMLiquidity", [
    stableTokenAddress,    // S Token 地址
    usdcTokenAddress,      // USDC 地址
    lpName,                // LP Token 名称
    lpSymbol,              // LP Token 符号
  ]);

  // 2. 部署 AMMSwap (交易执行合约)
  const ammSwap = m.contract("AMMSwap", [
    underlyingTokenAddress,     // WLTC 地址
    usdcTokenAddress,           // USDC 地址
    stableTokenAddress,         // S Token 地址
    multiLeverageTokenAddress,  // L Token 地址
    dexRouter,                  // UniversalRouter 地址 (Sepolia)
    quoter,                     // QuoterV2 地址 (Sepolia)
    usdcUnderlyingPool,         // USDC/WLTC Pool 地址
    poolFee                     // Pool 费率 (3000 = 0.3%)
  ], {
    after: [ammLiquidity],  // 等待 AMMLiquidity 部署完成
  });

  // ================= 初始化合约 =================
  // 创建 contractAt futures 仅用于 m.call (不会重复记录，因为没有被 return)
  const custodianFixedForCall = m.contractAt("CustodianFixed", custodianFixedAddress);
  
  // 3. 初始化 AMMLiquidity (设置 AMMSwap 地址和费用收集地址)
  const ammliquidityInitializeCall = m.call(ammLiquidity, "initialize", [
    ammSwap,      // AMMSwap 合约地址
    feeCollector  // 费用收集地址
  ], {
    after: [ammSwap]  // 等待 AMMSwap 部署完成
  });

  // 4. 初始化 AMMSwap (设置 Custodian 和 AMMLiquidity 地址)
  const ammSwapInitializeCall = m.call(ammSwap, "initialize", [
    custodianFixedAddress,  // CustodianFixed 合约地址 (使用地址字符串)
    ammLiquidity            // AMMLiquidity 合约地址
  ], {
    after: [ammliquidityInitializeCall]  // 等待 AMMLiquidity 初始化完成
  });

  // 5. 授权 AMMSwap 调用 Custodian 的 mintFromAMM 函数
  const setAuthorizedAMMCall = m.call(custodianFixedForCall, "setAuthorizedAMM", [
    ammSwap,  // AMMSwap 合约地址
    true      // 授权状态
  ], {
    after: [ammSwapInitializeCall]  // 等待 AMMSwap 初始化完成
  });


  // ================= 返回部署的合约 =================
  // 返回所有部署的合约 futures，供其他模块或测试使用
  return {
    ammLiquidity,
    ammSwap,
    ammliquidityInitializeCall,
    ammSwapInitializeCall,
    setAuthorizedAMMCall,
  } as any;
});

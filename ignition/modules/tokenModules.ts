import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { after } from "node:test";

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
    npx hardhat ignition deploy ignition/modules/tokenModules.ts --network sepolia

  4. 查詢部署地址
    部署完成後，Ignition 會在專案根目錄下生成一個 `ignition-deployments` 資料夾，
    裏面有deployed_addresses.json檔案，可以查詢到各合約的部署地址。
*/

export default buildModule("tokenModules", (m) => {
  // =====================================================
  // 部署: 代幣與測試用 mock 合約
  // 使用 m.contract 會回傳一個 deployment future（延遲部署的參考），
  // 可以直接把這些 futures 當作後續合約建構子參數或呼叫參數傳入。
  // ignition 會依賴圖（dependency graph）自動排序並部署。
  // =====================================================
  // Deploy tokens and mocks
  const wltc = m.contract("WLTCMock");
  const usdc = m.contract("USDCMock", [],{ after: [wltc] });
  const stableToken = m.contract("StableToken", [],{ after: [usdc] });
  const multiLeverageToken = m.contract("MultiLeverageToken", ["ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/"],{ after: [stableToken] });




  // 返回所有部署的合約 futures，供其他模組或測試使用。
  return {
    wltc,
    usdc,
    stableToken,
    multiLeverageToken,
  };
});

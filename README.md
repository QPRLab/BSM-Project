````markdown
# Sample Hardhat 3 Beta Project (`node:test` and `viem`)

This project showcases a Hardhat 3 Beta project using the native Node.js test runner (`node:test`) and the `viem` library for Ethereum interactions.

To learn more about the Hardhat 3 Beta, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join our [Hardhat 3 Beta](https://hardhat.org/hardhat3-beta-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in our GitHub issue tracker.

## Project Overview

This example project includes:

- A simple Hardhat configuration file.
- Foundry-compatible Solidity unit tests.
- TypeScript integration tests using [`node:test`](nodejs.org/api/test.html), the new Node.js native test runner, and [`viem`](https://viem.sh/).
- Examples demonstrating how to connect to different types of networks, including locally simulating OP mainnet.

## Usage

### Running Tests

To run all the tests in the project, execute the following command:

```shell
npx hardhat test
```

You can also selectively run the Solidity or `node:test` tests:

```shell
npx hardhat test solidity
npx hardhat test nodejs
```

### Make a deployment to Sepolia

This project includes an example Ignition module to deploy the contract. You can deploy this module to a locally simulated chain or to Sepolia.

To run the deployment to a local chain:

```shell
```markdown
1.  部署tokenModules模組：
	執行命令：npx hardhat ignition deploy ignition/modules/tokenModules.ts --network sepolia
	命令說明：部署以下合約 WLTCMock, USDCMock, StableToken, MultiLeverageToken 四個合約
2.  部署coreModules模組： 
	執行命令：npx hardhat ignition deploy ignition/modules/coreModules.ts --network sepolia
	命令說明：部署以下合約 InterestManager, LTCPriceOracle, CustodianFixed, LinearDecrease, AuctionManager, LiquidationManager
3.  鑄幣 USDC, WLTC 合約： 
	執行命令：npx tsx scripts/1_mint_USDCWLTCtokens_allusers_viem.ts 
	命令說明：測試環境，部署者給開發組四個人鑄幣 USDC(12000萬枚) WLTC(100萬枚)
			 僅有部署者可以鑄幣 WLTC, USDC
4.  鑄幣 S token & L token:
	執行命令：npx tsx scripts/2_mint_SLtokens_viem.ts 
	命令說明：部署者給自己帳戶鑄幣，三種槓桿(CONSERVATIVE,MODERATE,AGGRESSIVE)分別鑄幣24.5萬枚 WLTC, 24.5萬枚 WLTC, 1萬枚 WLTC；鑄幣價格 P0=120;
			 當前持倉：WLTC(50萬枚)，USDC(12000萬枚), stable(9746666枚)，leverage(id5=2612萬，id8=2352萬，id2=60萬)
			 所有用戶均可呼叫 CustodianFixed.mint 使用自己帳戶的 WLTC 給自己鑄幣，mint 前需要 approve 給 CustodianFixed 相應數量的 WLTC
5.  在 Uniswap 上創建 WLTC-USDC 的池子：
	池子參數：V3 position; token0:WLTC, token1:USDC(順序由 Uniswap 決定), fee:0.3%, full range;
	流動性參數：注入 WLTC(30萬枚) 和 USDC(3600萬枚), WLTC 初始價格為 P0=120；  帳戶剩餘 20萬 WLTC, 8400萬 USDC
	部署後地址：
		POOL:   0xCa250B562Beb3Be4fC75e79826390F9f14c622d0(每次重新部署會變化)
		Router: 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b(不變)
		Quoter: 0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3(不變)
6.  部署 ammModules 模組：
	執行命令：npx hardhat ignition deploy ignition/modules/ammModules.ts --network sepolia
	命令說明：部署以下合約 AMMLiquidaity, AMMSwap
7.  合約驗證：
	執行命令：npx tsx scripts/3_verify_allContracts_viem.ts
8.  合約交互：
	檢驗交易：
		執行命令：npx tsx scripts/4_interact_amm_viem.ts
		命令說明：
			若流動性不足，則添加流動性, 注入流動性：500萬 USDC, 500萬 stable; 需要向 AMMLiquidity 中 approve 相應數量的 USDC 和 stable
			若 Oracle 價格無效，使用更新為 Uniswap 中當前 WLTC 的價格;
			Stable token <--> USDC token   (基於 AMM)
			Leverage token <--> USDC token (基於 AMM + DEX)
	檢驗清算：
		執行命令：npx tsx scripts/5_auction_viem.ts
		命令說明：
			給 CustodianFixed 轉入 10 萬個 stable, 用於獎勵

```
安全上傳到 GitHub（建議流程）

1. 確認 `.gitignore` 包含：`.env*`, `node_modules/`, `artifacts/`, `ignition/deployments/`, `cache/` 等。
2. 若曾錯誤提交敏感檔案，請先用 `git rm --cached <file>` 刪除索引並重新 commit，或使用 `git filter-repo` 清理歷史（須小心）。
3. 倉庫包含輔助腳本 `create_and_push.ps1`（檢查追蹤的敏感檔並引導使用 `gh` 或遠端 URL 推送）。

示例（使用 GitHub CLI）

```powershell
# 需先安裝並登入 gh
.\create_and_push.ps1 -RepoName "BSM-Project"
```

或手動建立遠端並推送：

```powershell
git remote add origin <git@github.com:youruser/yourrepo.git>
git branch -M main
git push -u origin main
```

疑難排解（常見錯誤）
- 如果前端啟動時出現 `Cannot invoke an object which is possibly 'undefined'`，通常是未 guard contract.read 函數。使用 guard：

```ts
const fn = (contract as any)?.read?.someMethod
if (typeof fn === 'function') await fn([...args])
```

- 若出現 `Relative import paths need explicit file extensions`，請確保本地變更中相對匯入含 `.js` 副檔名。

還需要我做什麼？
- 我可以：
	- 在此環境執行 `npx hardhat test` 或 `cd frontend && npm run dev` 幫你排查 runtime 問題（回覆 “運行測試”）。
	- 幫你把倉庫安全推上 GitHub（需 `gh` 已安裝或你提供遠端 URL，回覆 “推送倉庫”）。

最後更新：2025-11-22


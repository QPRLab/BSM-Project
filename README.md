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
﻿# BSM Project — 本地開發說明

這份 README 已根據倉庫內實際內容撰寫。該專案是一個完整的智能合約 + 前端範例，包含 AMM/交換、拍賣與清算流程的合約與互動腳本。

主要目錄（與對應說明）
- `contracts/` — Solidity 合約（核心合約如 `AMMLiquidity.sol`, `AMMSwap.sol`, `CustodianFixed.sol`, `AuctionManager`, `LiquidationManager`, `Types.sol` 等）。
- `scripts/` — Node + viem 腳本：用於呼叫合約、模擬交易與測試（例如 `test_DEX_QUOTE.ts`, `4_interact_amm_viem.ts`, `5_auction_viem.ts`）。
- `ignition/` — Ignition 部署模組以及 `ignition/deployments/`（已加入 .gitignore，避免上傳部署私鑰/產物）。
- `frontend/` — Vue 3 + Vite 前端應用（放置 UI、ABI 加載與合約 helper）。
- `test/` — Hardhat 測試文件（TypeScript）：`AMM.test.ts`, `AMMSwap.test.ts`, `LiquidationAuction.test.ts`, `Oracle.test.ts` 等。

快速開始（開發機）

1) 安裝專案依賴（根目錄）

```powershell
npm ci
```

2) 安裝前端依賴並啟動開發伺服器

```powershell
cd frontend
npm ci
npm run dev
```

3) 本地測試（Hardhat）

```powershell
# 在專案根目錄
npx hardhat test
```

4) TypeScript 靜態檢查

```powershell
npx tsc --noEmit
```

重要腳本（說明）
- `scripts/test_DEX_QUOTE.ts` — 呼叫 Uniswap Quoter（path-based）取得 WLTC ↔ USDC 報價（預設 1 WLTC）。用於檢查 Quoter 路徑及 fee=3000 的單跳回傳。
- `scripts/4_interact_amm_viem.ts` — 範例互動流程：查詢報價、`ensureAllowance` 授權流程、使用 Universal Router 進行交換、監聽交易回執（示範 bigint 上溢計算與安全的 approve/allowance 流程）。
- `scripts/5_auction_viem.ts` — 拍賣互動腳本（出價、重置、提取等）。

前端重點說明
- `frontend/src/utils/contracts.ts`：集中 ABI 與合約實例化函式（`getReadonlyContract`, `getWalletContract`）。
- 重要視圖：`Mint.vue`, `AmmSwapLeverage.vue`, `AmmSwapStable.vue`, `Auction.vue`, `Liquidation.vue`, `Oracle.vue` 等，已做部分遷移以使用合約 helper。
- 注意 ESM 匯入：部分檔案要求相對路徑加 `.js` 副檔名（已在專案中修正若干匯入），在修改時保持 `.js` 副檔名以避免 Vite/TS 錯誤。

數值精度與授權建議
- 專案內使用 `bigint` 表示 token 數量（避免 Number 损失精度）。
- 計算上浮（如 slippage）時請使用整數向上取整，例如：

```ts
// ceil(amount * (100 + pct) / 100)
const pct = 5n
const x = (amount * (100n + pct) + 99n) / 100n
```

- 授權（allowance）最佳實踐：讀取現有 allowance；若不足，且 allowance > 0，先 approve(0) 等待回執，再 approve(需要值)。專案內腳本與前端已採用此模式。

如何使用常見功能（範例命令）

- 查詢 Uniswap 報價（Quoter）：

```powershell
npx tsx scripts/test_DEX_QUOTE.ts
```

- 執行 AMM+拍賣互動腳本（範例）：

```powershell
npx tsx scripts/4_interact_amm_viem.ts
```

- 執行單元測試：

```powershell
npx hardhat test test/AMMSwap.test.ts
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


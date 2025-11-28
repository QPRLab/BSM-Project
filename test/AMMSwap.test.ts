import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { formatUnits, parseUnits } from "viem";

/*
 * AMMSwap 测试 - swapUsdcToLeverage 和 swapLeverageToUsdc
 * 命令：npx hardhat test test/AMMSwap.test.ts
 * 
 * ⚠️ 重要说明：
 * swapUsdcToLeverage 和 swapLeverageToUsdc 这两个函数依赖 DEX (UniversalRouter/Quoter)
 * 来购买/卖出底层资产 (underlying token)。
 * 
 * 在 Hardhat 本地测试网络中，无法部署真实的 Uniswap 合约，因此这些函数无法完整测试。
 * 
 * 测试场景：
 * 1. 测试合约部署和初始化
 * 2. 测试基本的 Stable <-> USDC 交换（不需要 DEX）
 * 3. 说明 Leverage token 交换需要在 Sepolia 等测试网上进行
 * 
 * 完整的 Leverage token 测试需要：
 * - 部署到 Sepolia testnet
 * - 配置 UniversalRouter: 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
 * - 配置 QuoterV2: 0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3
 * - 配置 USDC/WLTC Pool: 0xAB67EBaef7cc4ff18f44E1B71d66ac942a24E29c
 */

describe("AMMSwap - Basic Tests (Without DEX)", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const walletClients = await viem.getWalletClients();
  const feeders = walletClients.slice(0, 4).map(client => client.account.address);
  const deployer = walletClients[0].account.address;
  const user = walletClients[1].account.address;
  const feeCollector = deployer;

  let wltc: any, usdc: any, stable: any, leverage: any;
  let interestManager: any, ltcOracle: any, custodian: any, auctionManager: any, liquidationManager: any;
  let ammliquidity: any, ammswap: any;
  let universalRouterMock: any, quoterV2Mock: any;

  // 记录用户铸造的 leverage token ID
  let leverageTokenId: bigint;
  let mintedTokenId: bigint;
  const initialPrice = 120n * 10n ** 18n; // LTC 初始价格 $120

  before(async function () {
    // console.log("\n=== 开始部署合约 ===");
    // console.log("Deployer address:", deployer);
    // console.log("User address:", user);

    // ========== 1. 部署 Token 合约 ==========
    // console.log("\n--- 部署 Token 合约 ---");
    wltc = await viem.deployContract("WLTCMock");
    // console.log("✅ WLTC deployed:", wltc.address);
    
    usdc = await viem.deployContract("USDCMock");
    // console.log("✅ USDC deployed:", usdc.address);
    
    stable = await viem.deployContract("StableToken");
    // console.log("✅ StableToken deployed:", stable.address);
    
    leverage = await viem.deployContract("MultiLeverageToken", [
      "ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/"
    ]);
    // console.log("✅ MultiLeverageToken deployed:", leverage.address);

    // ========== 2. 部署核心合约 ==========
    // console.log("\n--- 部署核心合约 ---");
    interestManager = await viem.deployContract("InterestManager", [wltc.address, 300n]);
    // console.log("✅ InterestManager deployed:", interestManager.address);
    
    ltcOracle = await viem.deployContract("LTCPriceOracle", [initialPrice, feeders]);
    // console.log("✅ LTCPriceOracle deployed:", ltcOracle.address);
    
    custodian = await viem.deployContract("CustodianFixed", [
      wltc.address,
      stable.address,
      leverage.address
    ]);
    // console.log("✅ CustodianFixed deployed:", custodian.address);

    auctionManager = await viem.deployContract("AuctionManager", [stable.address, custodian.address]);
    liquidationManager = await viem.deployContract("LiquidationManager", [leverage.address, custodian.address]);

    // ========== 3. 初始化核心合约 ==========
    // console.log("\n--- 初始化核心合约 ---");
    await publicClient.waitForTransactionReceipt({
      hash: await interestManager.write.initialize([leverage.address, custodian.address])
    });
    // console.log("✅ InterestManager initialized");
    await publicClient.waitForTransactionReceipt({
      hash: await stable.write.setCustodian([custodian.address])
    });
    // console.log("✅ StableToken custodian set");
    await publicClient.waitForTransactionReceipt({
      hash: await leverage.write.setCustodian([custodian.address])
    });
    // console.log("✅ MultiLeverageToken custodian set");
    await publicClient.waitForTransactionReceipt({
      hash: await custodian.write.initialize([interestManager.address, ltcOracle.address, auctionManager.address, liquidationManager.address])
    });
    // console.log("✅ CustodianFixed initialized");

    // ========== 5. 部署 AMM 合约（使用 DEX Mock）==========
    // console.log("\n--- 部署 AMM 合约 ---");
    ammliquidity = await viem.deployContract("AMMLiquidity", [
      stable.address,
      usdc.address,
      "LP Token",
      "LPT"
    ]);
    // console.log("✅ AMMLiquidity deployed:", ammliquidity.address);

    ammswap = await viem.deployContract("contracts/AMMSwap.sol:AMMSwap", [
      wltc.address,                    // underlyingToken
      usdc.address,                    // usdcToken
      stable.address,                  // stableToken
      leverage.address,                // multiLeverageToken
      "0x0000000000000000000000000000000000000000",          // set empty
      "0x0000000000000000000000000000000000000000",          // set empty
      "0x0000000000000000000000000000000000000000",          // set empty
      3000                             // poolFee
    ]);
    // console.log("✅ AMMSwap deployed:", ammswap.address);

    // ========== 6. 初始化 AMM 合约 ==========
    // console.log("\n--- 初始化 AMM 合约 ---");
    await publicClient.waitForTransactionReceipt({
      hash: await ammliquidity.write.initialize([ammswap.address, feeCollector])
    });
    // console.log("✅ AMMLiquidity initialized");

    await publicClient.waitForTransactionReceipt({
      hash: await ammswap.write.initialize([custodian.address, ammliquidity.address])
    });
    // console.log("✅ AMMSwap initialized");

    // 授权 AMMSwap 可以调用 custodian.mintFromAMM
    await publicClient.waitForTransactionReceipt({
      hash: await custodian.write.setAuthorizedAMM([ammswap.address, true])
    });
    // console.log("✅ AMMSwap authorized to call mintFromAMM");

    // ========== 7. 初始流动性设置 ==========
    // console.log("\n--- 初始流动性设置 ---");
    
    // Mint WLTC 和 USDC 给 deployer
    const wltcAmount = 10000n * 10n ** 18n; // 10,000 WLTC
    const usdcAmount = 1200000n * 10n ** 6n; // 1,200,000 USDC
    
    await publicClient.waitForTransactionReceipt({
      hash: await wltc.write.mint([deployer, wltcAmount])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.mint([deployer, usdcAmount])
    });
    // console.log(`✅ Minted ${formatUnits(wltcAmount, 18)} WLTC to deployer`);
    // console.log(`✅ Minted ${formatUnits(usdcAmount, 6)} USDC to deployer`);

    // Deployer 通过 custodian mint S+L tokens (2x leverage: 1S1L)
    const underlyingForMint = 1000n * 10n ** 18n; // 1,000 WLTC
    await publicClient.waitForTransactionReceipt({
      hash: await wltc.write.approve([custodian.address, underlyingForMint])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await custodian.write.mint([underlyingForMint, initialPrice, 2n]) // 2 = AGGRESSIVE (1:1)
    });
    const deployerStableBalance = await stable.read.balanceOf([deployer]);
    // console.log(`✅ Minted S+L tokens from ${formatUnits(underlyingForMint, 18)} WLTC`);
    // console.log(`   Deployer S token balance: ${formatUnits(deployerStableBalance, 18)}`);

    // 添加初始流动性到 AMM 池 (使用deployer实际拥有的数量)
    const initialStable = deployerStableBalance; // 使用全部 S tokens
    
    await publicClient.waitForTransactionReceipt({
      hash: await stable.write.approve([ammliquidity.address, initialStable])
    });
    // 需要预先计算所需的 USDC
    const requiredUsdc = await ammliquidity.read.addLiquidityStablePreview([initialStable]);
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.approve([ammliquidity.address, requiredUsdc[0]])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await ammliquidity.write.addLiquidityStable([initialStable])
    });
    // console.log(`✅ Added initial liquidity: ${formatUnits(initialStable, 18)} S + ${formatUnits(requiredUsdc[0], 6)} USDC`);

    // ========== 7. 给 user 账户 mint USDC ==========
    const userUsdcAmount = 100000n * 10n ** 6n; // 100,000 USDC
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.mint([user, userUsdcAmount])
    });
    // console.log(`✅ Minted ${formatUnits(userUsdcAmount, 6)} USDC to user`);

    console.log("\n=== 合约部署和初始化完成 ===\n");
  });

  /**
   * 测试 1: 合约部署和初始化
   */
  it("should deploy and initialize all contracts successfully", async function () {
    // console.log("\n========== Test 1: 合约部署和初始化 ==========");

    // 验证所有合约地址
    // console.log("\n--- 合约地址验证 ---");
    assert(wltc.address !== "0x0000000000000000000000000000000000000000", "WLTC 应该已部署");
    assert(usdc.address !== "0x0000000000000000000000000000000000000000", "USDC 应该已部署");
    assert(stable.address !== "0x0000000000000000000000000000000000000000", "StableToken 应该已部署");
    assert(leverage.address !== "0x0000000000000000000000000000000000000000", "MultiLeverageToken 应该已部署");
    assert(custodian.address !== "0x0000000000000000000000000000000000000000", "CustodianFixed 应该已部署");
    assert(ammliquidity.address !== "0x0000000000000000000000000000000000000000", "AMMLiquidity 应该已部署");
    assert(ammswap.address !== "0x0000000000000000000000000000000000000000", "AMMSwap 应该已部署");
    // console.log("✅ 所有合约地址有效");

    // 验证 AMM 池状态
    const reserves = await ammliquidity.read.getReserves();
    // console.log("\n--- AMM 池状态 ---");
    // console.log(`Stable Token 储备: ${formatUnits(reserves[0], 18)}`);
    // console.log(`USDC 储备: ${formatUnits(reserves[1], 6)}`);
    assert(reserves[0] > 0n, "Stable Token 储备应该大于 0");
    assert(reserves[1] > 0n, "USDC 储备应该大于 0");
    // console.log("✅ AMM 池已初始化");

    // 验证用户余额
    const userUsdcBalance = await usdc.read.balanceOf([user]);
    // console.log("\n--- 用户余额 ---");
    // console.log(`用户 USDC 余额: ${formatUnits(userUsdcBalance, 6)}`);
    assert(userUsdcBalance > 0n, "用户应该有 USDC");
    // console.log("✅ 用户账户已准备好");
    // console.log("\n✅ Test 1 通过: 合约部署和初始化成功");
  });

  /**
   * 测试 2: Stable -> USDC 交换 (不需要 DEX)
   */
  it("should swap Stable to USDC (swapStableToUsdc)", async function () {
    // console.log("\n========== Test 2: swapStableToUsdc ==========");

    const userWalletClient = walletClients[1];

    // 先给用户一些 Stable tokens
    // User需要 mint underlying 然后通过 custodian mint S+L
    const wltcForUser = 100n * 10n ** 18n; // 100 WLTC
    await publicClient.waitForTransactionReceipt({
      hash: await wltc.write.mint([user, wltcForUser])
    });

    // User approve and mint S+L
    await publicClient.waitForTransactionReceipt({
      hash: await wltc.write.approve([custodian.address, wltcForUser], {
        account: userWalletClient.account
      })
    });
    await publicClient.waitForTransactionReceipt({
      hash: await custodian.write.mint([wltcForUser, initialPrice, 2n], {
        account: userWalletClient.account
      })
    });

    const userStableBalance = await stable.read.balanceOf([user]);
    // console.log(`\n--- 用户获得 Stable Token ---`);
    // console.log(`Stable Token 余额: ${formatUnits(userStableBalance, 18)}`);
    assert(userStableBalance > 0n, "用户应该有 Stable tokens");

    // 记录交易前状态
    const userUsdcBefore = await usdc.read.balanceOf([user]);
    const swapAmount = userStableBalance / 2n; // 交换一半

    // console.log(`\n--- 执行 swapStableToUsdc ---`);
    // console.log(`交换数量: ${formatUnits(swapAmount, 18)} Stable`);

    // 授权 ammliquidity
    await publicClient.waitForTransactionReceipt({
      hash: await stable.write.approve([ammliquidity.address, swapAmount], {
        account: userWalletClient.account
      })
    });

    // 执行交换
    const txHash = await ammswap.write.swapStableToUsdc([swapAmount], {
      account: userWalletClient.account
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // 记录交易后状态
    const userUsdcAfter = await usdc.read.balanceOf([user]);
    const usdcGained = userUsdcAfter - userUsdcBefore;

    // console.log(`\n--- 交易结果 ---`);
    // console.log(`获得 USDC: ${formatUnits(usdcGained as unknown as bigint, 6)}`);

    assert(usdcGained > 0n, "应该获得了 USDC");
    // console.log("\n✅ Test 2 通过: swapStableToUsdc 成功执行");
  });

  /**
   * 测试 3: USDC -> Stable 交换 (不需要 DEX)
   */
  it("should swap USDC to Stable (swapUsdcToStable)", async function () {
    // console.log("\n========== Test 3: swapUsdcToStable ==========");

    const userWalletClient = walletClients[1];

    // 记录交易前状态
    const userStableBefore = await stable.read.balanceOf([user]);
    const userUsdcBefore = await usdc.read.balanceOf([user]);
    const swapAmount = 1000n * 10n ** 6n; // 1000 USDC

    // console.log(`\n--- 交易前状态 ---`);
    // console.log(`用户 Stable 余额: ${formatUnits(userStableBefore, 18)}`);
    // console.log(`用户 USDC 余额: ${formatUnits(userUsdcBefore, 6)}`);
    // console.log(`交换数量: ${formatUnits(swapAmount, 6)} USDC`);

    // 授权 ammliquidity
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.approve([ammliquidity.address, swapAmount], {
        account: userWalletClient.account
      })
    });

    // 执行交换
    const txHash = await ammswap.write.swapUsdcToStable([swapAmount], {
      account: userWalletClient.account
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // 记录交易后状态
    const userStableAfter = await stable.read.balanceOf([user]);
    const userUsdcAfter = await usdc.read.balanceOf([user]);
    const stableGained = userStableAfter - userStableBefore;
    const usdcSpent = userUsdcBefore - userUsdcAfter;

    // console.log(`\n--- 交易结果 ---`);
    // console.log(`花费 USDC: ${formatUnits(usdcSpent as unknown as bigint, 6)}`);
    // console.log(`获得 Stable: ${formatUnits(stableGained as unknown as bigint, 18)}`);

    assert(stableGained > 0n, "应该获得了 Stable tokens");
    assert((usdcSpent as unknown as bigint) === (swapAmount as unknown as bigint), "应该花费指定数量的 USDC");
    // console.log("\n✅ Test 3 通过: swapUsdcToStable 成功执行");
  });


});

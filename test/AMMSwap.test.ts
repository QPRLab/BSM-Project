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
  let interestManager: any, ltcOracle: any, custodian: any;
  let ammliquidity: any, ammswap: any;
  let universalRouterMock: any, quoterV2Mock: any;

  // 记录用户铸造的 leverage token ID
  let leverageTokenId: bigint;
  const initialPrice = 120n * 10n ** 18n; // LTC 初始价格 $120

  before(async function () {
    console.log("\n=== 开始部署合约 ===");
    console.log("Deployer address:", deployer);
    console.log("User address:", user);

    // ========== 1. 部署 Token 合约 ==========
    console.log("\n--- 部署 Token 合约 ---");
    wltc = await viem.deployContract("WLTCMock");
    console.log("✅ WLTC deployed:", wltc.address);
    
    usdc = await viem.deployContract("USDCMock");
    console.log("✅ USDC deployed:", usdc.address);
    
    stable = await viem.deployContract("StableToken");
    console.log("✅ StableToken deployed:", stable.address);
    
    leverage = await viem.deployContract("MultiLeverageToken", [
      "ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/"
    ]);
    console.log("✅ MultiLeverageToken deployed:", leverage.address);

    // ========== 2. 部署核心合约 ==========
    console.log("\n--- 部署核心合约 ---");
    interestManager = await viem.deployContract("InterestManager", [wltc.address, 300n]);
    console.log("✅ InterestManager deployed:", interestManager.address);
    
    ltcOracle = await viem.deployContract("LTCPriceOracle", [initialPrice, feeders]);
    console.log("✅ LTCPriceOracle deployed:", ltcOracle.address);
    
    custodian = await viem.deployContract("CustodianFixed", [
      wltc.address,
      stable.address,
      leverage.address
    ]);
    console.log("✅ CustodianFixed deployed:", custodian.address);

    // ========== 3. 初始化核心合约 ==========
    console.log("\n--- 初始化核心合约 ---");
    await publicClient.waitForTransactionReceipt({
      hash: await interestManager.write.initialize([leverage.address, custodian.address])
    });
    console.log("✅ InterestManager initialized");

    await publicClient.waitForTransactionReceipt({
      hash: await stable.write.setCustodian([custodian.address])
    });
    console.log("✅ StableToken custodian set");

    await publicClient.waitForTransactionReceipt({
      hash: await leverage.write.setCustodian([custodian.address])
    });
    console.log("✅ MultiLeverageToken custodian set");

    await publicClient.waitForTransactionReceipt({
      hash: await custodian.write.initialize([interestManager.address, ltcOracle.address])
    });
    console.log("✅ CustodianFixed initialized");

    // ========== 4. 部署 DEX Mock 合约 ==========
    console.log("\n--- 部署 DEX Mock 合约 ---");
    universalRouterMock = await viem.deployContract("UniversalRouterMock", [
      wltc.address,
      usdc.address
    ]);
    console.log("✅ UniversalRouterMock deployed:", universalRouterMock.address);

    quoterV2Mock = await viem.deployContract("QuoterV2Mock", [
      wltc.address,
      usdc.address
    ]);
    console.log("✅ QuoterV2Mock deployed:", quoterV2Mock.address);

    // 给 UniversalRouterMock 添加流动性
    const routerWltcLiquidity = 1000n * 10n ** 18n; // 1,000 WLTC
    const routerUsdcLiquidity = 120000n * 10n ** 6n; // 120,000 USDC
    
    await publicClient.waitForTransactionReceipt({
      hash: await wltc.write.mint([deployer, routerWltcLiquidity])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.mint([deployer, routerUsdcLiquidity])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await wltc.write.approve([universalRouterMock.address, routerWltcLiquidity])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.approve([universalRouterMock.address, routerUsdcLiquidity])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await universalRouterMock.write.addLiquidity([routerWltcLiquidity, routerUsdcLiquidity])
    });
    console.log(`✅ Added liquidity to UniversalRouterMock: ${formatUnits(routerWltcLiquidity, 18)} WLTC + ${formatUnits(routerUsdcLiquidity, 6)} USDC`);

    // ========== 5. 部署 AMM 合约（使用 DEX Mock）==========
    console.log("\n--- 部署 AMM 合约 ---");
    ammliquidity = await viem.deployContract("AMMLiquidity", [
      stable.address,
      usdc.address,
      "LP Token",
      "LPT"
    ]);
    console.log("✅ AMMLiquidity deployed:", ammliquidity.address);

    ammswap = await viem.deployContract("contracts/AMMSwap.sol:AMMSwap", [
      wltc.address,                    // underlyingToken
      usdc.address,                    // usdcToken
      stable.address,                  // stableToken
      leverage.address,                // multiLeverageToken
      universalRouterMock.address,     // dexRouter (使用 Mock)
      quoterV2Mock.address,            // quoter (使用 Mock)
      "0x0000000000000000000000000000000000000000", // usdcUnderlyingPool (不需要)
      3000                             // poolFee
    ]);
    console.log("✅ AMMSwap deployed:", ammswap.address);

    // ========== 6. 初始化 AMM 合约 ==========
    console.log("\n--- 初始化 AMM 合约 ---");
    await publicClient.waitForTransactionReceipt({
      hash: await ammliquidity.write.initialize([ammswap.address, feeCollector])
    });
    console.log("✅ AMMLiquidity initialized");

    await publicClient.waitForTransactionReceipt({
      hash: await ammswap.write.initialize([custodian.address, ammliquidity.address])
    });
    console.log("✅ AMMSwap initialized");

    // 授权 AMMSwap 可以调用 custodian.mintFromAMM
    await publicClient.waitForTransactionReceipt({
      hash: await custodian.write.setAuthorizedAMM([ammswap.address, true])
    });
    console.log("✅ AMMSwap authorized to call mintFromAMM");

    // ========== 7. 初始流动性设置 ==========
    console.log("\n--- 初始流动性设置 ---");
    
    // Mint WLTC 和 USDC 给 deployer
    const wltcAmount = 10000n * 10n ** 18n; // 10,000 WLTC
    const usdcAmount = 1200000n * 10n ** 6n; // 1,200,000 USDC
    
    await publicClient.waitForTransactionReceipt({
      hash: await wltc.write.mint([deployer, wltcAmount])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.mint([deployer, usdcAmount])
    });
    console.log(`✅ Minted ${formatUnits(wltcAmount, 18)} WLTC to deployer`);
    console.log(`✅ Minted ${formatUnits(usdcAmount, 6)} USDC to deployer`);

    // Deployer 通过 custodian mint S+L tokens (2x leverage: 1S1L)
    const underlyingForMint = 1000n * 10n ** 18n; // 1,000 WLTC
    await publicClient.waitForTransactionReceipt({
      hash: await wltc.write.approve([custodian.address, underlyingForMint])
    });
    await publicClient.waitForTransactionReceipt({
      hash: await custodian.write.mint([underlyingForMint, initialPrice, 2n]) // 2 = AGGRESSIVE (1:1)
    });
    const deployerStableBalance = await stable.read.balanceOf([deployer]);
    console.log(`✅ Minted S+L tokens from ${formatUnits(underlyingForMint, 18)} WLTC`);
    console.log(`   Deployer S token balance: ${formatUnits(deployerStableBalance, 18)}`);

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
    console.log(`✅ Added initial liquidity: ${formatUnits(initialStable, 18)} S + ${formatUnits(requiredUsdc[0], 6)} USDC`);

    // ========== 7. 给 user 账户 mint USDC ==========
    const userUsdcAmount = 100000n * 10n ** 6n; // 100,000 USDC
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.mint([user, userUsdcAmount])
    });
    console.log(`✅ Minted ${formatUnits(userUsdcAmount, 6)} USDC to user`);

    console.log("\n=== 合约部署和初始化完成 ===\n");
  });

  /**
   * 测试 1: 合约部署和初始化
   */
  it("should deploy and initialize all contracts successfully", async function () {
    console.log("\n========== Test 1: 合约部署和初始化 ==========");

    // 验证所有合约地址
    console.log("\n--- 合约地址验证 ---");
    assert(wltc.address !== "0x0000000000000000000000000000000000000000", "WLTC 应该已部署");
    assert(usdc.address !== "0x0000000000000000000000000000000000000000", "USDC 应该已部署");
    assert(stable.address !== "0x0000000000000000000000000000000000000000", "StableToken 应该已部署");
    assert(leverage.address !== "0x0000000000000000000000000000000000000000", "MultiLeverageToken 应该已部署");
    assert(custodian.address !== "0x0000000000000000000000000000000000000000", "CustodianFixed 应该已部署");
    assert(ammliquidity.address !== "0x0000000000000000000000000000000000000000", "AMMLiquidity 应该已部署");
    assert(ammswap.address !== "0x0000000000000000000000000000000000000000", "AMMSwap 应该已部署");
    console.log("✅ 所有合约地址有效");

    // 验证 AMM 池状态
    const reserves = await ammliquidity.read.getReserves();
    console.log("\n--- AMM 池状态 ---");
    console.log(`Stable Token 储备: ${formatUnits(reserves[0], 18)}`);
    console.log(`USDC 储备: ${formatUnits(reserves[1], 6)}`);
    assert(reserves[0] > 0n, "Stable Token 储备应该大于 0");
    assert(reserves[1] > 0n, "USDC 储备应该大于 0");
    console.log("✅ AMM 池已初始化");

    // 验证用户余额
    const userUsdcBalance = await usdc.read.balanceOf([user]);
    console.log("\n--- 用户余额 ---");
    console.log(`用户 USDC 余额: ${formatUnits(userUsdcBalance, 6)}`);
    assert(userUsdcBalance > 0n, "用户应该有 USDC");
    console.log("✅ 用户账户已准备好");

    console.log("\n✅ Test 1 通过: 合约部署和初始化成功");
  });

  /**
   * 测试 2: Stable -> USDC 交换 (不需要 DEX)
   */
  it("should swap Stable to USDC (swapStableToUsdc)", async function () {
    console.log("\n========== Test 2: swapStableToUsdc ==========");

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
    console.log(`\n--- 用户获得 Stable Token ---`);
    console.log(`Stable Token 余额: ${formatUnits(userStableBalance, 18)}`);
    assert(userStableBalance > 0n, "用户应该有 Stable tokens");

    // 记录交易前状态
    const userUsdcBefore = await usdc.read.balanceOf([user]);
    const swapAmount = userStableBalance / 2n; // 交换一半

    console.log(`\n--- 执行 swapStableToUsdc ---`);
    console.log(`交换数量: ${formatUnits(swapAmount, 18)} Stable`);

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

    console.log(`\n--- 交易结果 ---`);
    console.log(`获得 USDC: ${formatUnits(usdcGained as unknown as bigint, 6)}`);

    assert(usdcGained > 0n, "应该获得了 USDC");
    console.log("\n✅ Test 2 通过: swapStableToUsdc 成功执行");
  });

  /**
   * 测试 3: USDC -> Stable 交换 (不需要 DEX)
   */
  it("should swap USDC to Stable (swapUsdcToStable)", async function () {
    console.log("\n========== Test 3: swapUsdcToStable ==========");

    const userWalletClient = walletClients[1];

    // 记录交易前状态
    const userStableBefore = await stable.read.balanceOf([user]);
    const userUsdcBefore = await usdc.read.balanceOf([user]);
    const swapAmount = 1000n * 10n ** 6n; // 1000 USDC

    console.log(`\n--- 交易前状态 ---`);
    console.log(`用户 Stable 余额: ${formatUnits(userStableBefore, 18)}`);
    console.log(`用户 USDC 余额: ${formatUnits(userUsdcBefore, 6)}`);
    console.log(`交换数量: ${formatUnits(swapAmount, 6)} USDC`);

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

    console.log(`\n--- 交易结果 ---`);
    console.log(`花费 USDC: ${formatUnits(usdcSpent as unknown as bigint, 6)}`);
    console.log(`获得 Stable: ${formatUnits(stableGained as unknown as bigint, 18)}`);

    assert(stableGained > 0n, "应该获得了 Stable tokens");
    assert((usdcSpent as unknown as bigint) === (swapAmount as unknown as bigint), "应该花费指定数量的 USDC");
    console.log("\n✅ Test 3 通过: swapUsdcToStable 成功执行");
  });

  /**
   * 测试 4: swapUsdcToLeverage - 使用 DEX Mock
   */
  it("should swap USDC to Leverage token using DEX Mock (swapUsdcToLeverage)", async function () {
    console.log("\n========== Test 4: swapUsdcToLeverage with DEX Mock ==========");

    const userWalletClient = walletClients[1];

    // 测试参数
    const LAmountDesired = parseUnits("6", 18); // 购买 6 个 L tokens (clean division by 2 and 120)
    const mintPrice = initialPrice; // 使用初始价格 $120
    const leverageType = 2n; // AGGRESSIVE (1:1 ratio)
    const slippageTolerance = 300n; // 3% 滑点容忍度

    console.log(`\n--- 测试参数 ---`);
    console.log(`想要购买的 L token 数量: ${formatUnits(LAmountDesired, 18)}`);
    console.log(`铸币价格: $${formatUnits(mintPrice, 18)}`);
    console.log(`杠杆类型: AGGRESSIVE (2x)`);
    console.log(`滑点容忍度: ${Number(slippageTolerance) / 100}%`);

    // 记录交易前状态
    const userUsdcBefore = await usdc.read.balanceOf([user]);
    const poolStableBefore = await stable.read.balanceOf([ammliquidity.address]);
    
    console.log(`\n--- 交易前状态 ---`);
    console.log(`用户 USDC 余额: ${formatUnits(userUsdcBefore, 6)}`);
    console.log(`AMM 池 S token 余额: ${formatUnits(poolStableBefore, 18)}`);

    // ✅ 修复完成：现在 AMMSwap 会从 AMMLiquidity 提取 USDC
    // 移除了之前的 workaround（手动转 USDC）
    // AMMLiquidity.transferUsdcToSwap() 会将 USDC 转给 AMMSwap

    // 用户授权 USDC 给 ammswap
    const approveAmount = parseUnits("50000", 6); // 授权 50,000 USDC
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.approve([ammswap.address, approveAmount], {
        account: userWalletClient.account
      })
    });
    console.log(`\n✅ 用户授权 ${formatUnits(approveAmount, 6)} USDC 给 AMMSwap`);

    // 执行 swapUsdcToLeverage
    console.log(`\n--- 执行 swapUsdcToLeverage ---`);
    const txHash = await ammswap.write.swapUsdcToLeverage(
      [LAmountDesired, mintPrice, leverageType, slippageTolerance],
      { account: userWalletClient.account }
    );
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`✅ 交易成功，gas used: ${receipt.gasUsed.toString()}`);

    // 解析事件
    const logs = await publicClient.getLogs({
      address: ammswap.address,
      event: {
        type: 'event',
        name: 'SwapUsdcToLeverage',
        inputs: [
          { type: 'address', name: 'user', indexed: true },
          { type: 'uint256', name: 'usdcAmountIn' },
          { type: 'uint256', name: 'leverageTokenId' },
          { type: 'uint256', name: 'lAmountOut' }
        ]
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber
    });

    if (logs.length > 0) {
      const eventArgs = logs[0].args as any;
      leverageTokenId = eventArgs.leverageTokenId;
      console.log(`\n--- 交易事件 ---`);
      console.log(`实际支付 USDC: ${formatUnits(eventArgs.usdcAmountIn, 6)}`);
      console.log(`获得 L token ID: ${leverageTokenId.toString()}`);
      console.log(`获得 L token 数量: ${formatUnits(eventArgs.lAmountOut, 18)}`);
    }

    // 记录交易后状态
    const userUsdcAfter = await usdc.read.balanceOf([user]);
    const poolStableAfter = await stable.read.balanceOf([ammliquidity.address]);
    
    console.log(`\n--- 交易后状态 ---`);
    console.log(`用户 USDC 余额: ${formatUnits(userUsdcAfter, 6)}`);
    console.log(`AMM 池 S token 余额: ${formatUnits(poolStableAfter, 18)}`);

    // 验证结果
    const usdcSpent = userUsdcBefore - userUsdcAfter;
    
    console.log(`\n--- 验证结果 ---`);
    console.log(`USDC 花费: ${formatUnits(usdcSpent as unknown as bigint, 6)}`);
    console.log(`获得 L token ID: ${leverageTokenId.toString()}`);
    console.log(`AMM 池 S token 增加: ${formatUnits((poolStableAfter - poolStableBefore) as unknown as bigint, 18)}`);

    // 验证用户拥有的 L token 数量
    const userLTokenBalance = await leverage.read.balanceOf([user, leverageTokenId]);
    console.log(`用户拥有的 L token 数量: ${formatUnits(userLTokenBalance, 18)}`);

    // 断言
    assert(usdcSpent > 0n, "应该花费了 USDC");
    assert(leverageTokenId !== undefined, "应该获得了 L token ID");
    assert(userLTokenBalance > 0n, "应该拥有 L tokens");
    assert(poolStableAfter > poolStableBefore, "AMM 池 S token 应该增加");

    console.log("\n✅ Test 4 通过: swapUsdcToLeverage (with DEX Mock) 成功执行");
  });

  /**
   * 新增测试: 使用 QuoterV2Mock 对 exact output 5 WLTC 进行报价验证
   */
  it("should quote exact_out 5 WLTC (QuoterV2Mock)", async function () {
    console.log("\n========== Test X: Quoter exact_out 5 WLTC ==========");

    const amountOut = parseUnits("5", 18); // 5 WLTC
    // 使用 QuoterV2Mock 进行报价（USDC -> WLTC, exact output）
    try {
      const quote = await quoterV2Mock.read.quoteExactOutputSingle([{ tokenIn: usdc.address, tokenOut: wltc.address, amountOut: amountOut, fee: 3000n, sqrtPriceLimitX96: 0n }]);
      const amountIn = quote[0] as bigint;
      console.log(`Quoter returned amountIn: ${formatUnits(amountIn, 6)} USDC`);

      // 预期: 5 WLTC * 120 USDC/WLTC = 600 USDC
      const expected = parseUnits("600", 6);
      assert(amountIn === expected, `Expected ${formatUnits(expected,6)} USDC, got ${formatUnits(amountIn,6)} USDC`);
      console.log("✅ Quoter exact_out 5 WLTC returned expected amountIn");
    } catch (err: any) {
      console.log("⚠️ Quoter call failed:", err?.shortMessage || err?.message || err);
      throw err;
    }
  });

  /**
   * 测试 5: swapLeverageToUsdc - 使用 DEX Mock
   */
  it("should swap Leverage token to USDC using DEX Mock (swapLeverageToUsdc)", async function () {
    console.log("\n========== Test 5: swapLeverageToUsdc with DEX Mock ==========");

    const userWalletClient = walletClients[1];

    // 确保 leverageTokenId 已定义（从 Test 4 获得）
    assert(leverageTokenId !== undefined, "需要先运行 Test 4 获得 leverage token ID");
    
    // 检查用户是否拥有该 token
    const userLTokenBalance = await leverage.read.balanceOf([user, leverageTokenId]);
    assert(userLTokenBalance > 0n, "用户应该拥有 leverage tokens (先运行 Test 4)");
    
    // 测试参数
    const lAmountPercentage = 50n; // 卖出 50% 的 L tokens
    
    console.log(`\n--- 测试参数 ---`);
    console.log(`Leverage Token ID: ${leverageTokenId.toString()}`);
    console.log(`用户拥有的 L token 数量: ${formatUnits(userLTokenBalance, 18)}`);
    console.log(`卖出百分比: ${lAmountPercentage.toString()}%`);

    // 记录交易前状态
    const userUsdcBefore = await usdc.read.balanceOf([user]);
    const poolStableBefore = await stable.read.balanceOf([ammliquidity.address]);
    const poolUsdcBefore = await usdc.read.balanceOf([ammliquidity.address]);
    
    console.log(`\n--- 交易前状态 ---`);
    console.log(`用户 USDC 余额: ${formatUnits(userUsdcBefore, 6)}`);
    console.log(`AMM 池 S token 余额: ${formatUnits(poolStableBefore, 18)}`);
    console.log(`AMM 池 USDC 余额: ${formatUnits(poolUsdcBefore, 6)}`);

    // 用户授权 leverage token 给 AMMSwap (ERC1155 uses setApprovalForAll)
    await publicClient.waitForTransactionReceipt({
      hash: await leverage.write.setApprovalForAll([ammswap.address, true], {
        account: userWalletClient.account
      })
    });
    console.log(`\n✅ 用户授权所有 Leverage Token 给 AMMSwap`);

    // 执行 swapLeverageToUsdc
    console.log(`\n--- 执行 swapLeverageToUsdc ---`);
    const txHash = await ammswap.write.swapLeverageToUsdc(
      [leverageTokenId, lAmountPercentage],
      { account: userWalletClient.account }
    );
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`✅ 交易成功，gas used: ${receipt.gasUsed.toString()}`);

    // 解析事件
    const logs = await publicClient.getLogs({
      address: ammswap.address,
      event: {
        type: 'event',
        name: 'SwapLeverageToUsdc',
        inputs: [
          { type: 'address', name: 'user', indexed: true },
          { type: 'uint256', name: 'leverageTokenId' },
          { type: 'uint256', name: 'lAmountPercentage' },
          { type: 'uint256', name: 'usdcAmountOut' }
        ]
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber
    });

    if (logs.length > 0) {
      const eventArgs = logs[0].args as any;
      console.log(`\n--- 交易事件 ---`);
      console.log(`Token ID: ${eventArgs.leverageTokenId.toString()}`);
      console.log(`卖出百分比: ${eventArgs.lAmountPercentage.toString()}%`);
      console.log(`获得 USDC: ${formatUnits(eventArgs.usdcAmountOut, 6)}`);
    }

    // 记录交易后状态
    const userUsdcAfter = await usdc.read.balanceOf([user]);
    const poolStableAfter = await stable.read.balanceOf([ammliquidity.address]);
    const poolUsdcAfter = await usdc.read.balanceOf([ammliquidity.address]);
    
    console.log(`\n--- 交易后状态 ---`);
    console.log(`用户 USDC 余额: ${formatUnits(userUsdcAfter, 6)}`);
    console.log(`AMM 池 S token 余额: ${formatUnits(poolStableAfter, 18)}`);
    console.log(`AMM 池 USDC 余额: ${formatUnits(poolUsdcAfter, 6)}`);

    // 验证结果
    const usdcGained = userUsdcAfter - userUsdcBefore;
    const poolStableDecrease = poolStableBefore - poolStableAfter;
    const poolUsdcIncrease = poolUsdcAfter - poolUsdcBefore;
    
    console.log(`\n--- 验证结果 ---`);
    console.log(`USDC 获得: ${formatUnits(usdcGained as unknown as bigint, 6)}`);
    console.log(`AMM 池 S token 减少: ${formatUnits(poolStableDecrease as unknown as bigint, 18)}`);
    console.log(`AMM 池 USDC 增加: ${formatUnits(poolUsdcIncrease as unknown as bigint, 6)}`);

    // 断言
    assert(usdcGained > 0n, "应该获得了 USDC");
    assert(poolStableDecrease > 0n, "AMM 池 S token 应该减少");
    assert(poolUsdcIncrease > 0n, "AMM 池 USDC 应该增加");

    console.log("\n✅ Test 5 通过: swapLeverageToUsdc (with DEX Mock) 成功执行");
  });

  /**
   * 测试 6: Leverage Token 交换说明
   */
  it("should explain leverage token swap requirements", async function () {
    console.log("\n========== Test 6: Leverage Token 交换说明 ==========");

    console.log(`
✅ 本测试中已使用 DEX Mock 成功测试了 Leverage token 交换！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DEX Mock 实现：

1. UniversalRouterMock (contracts/mocks/UniversalRouterMock.sol)
   - 模拟 execute(bytes commands, bytes[] inputs, uint256 deadline)
   - 支持 V3_SWAP_EXACT_IN 和 V3_SWAP_EXACT_OUT
   - 固定价格: 1 WLTC = 120 USDC
   - 滑点: 0.5%

2. QuoterV2Mock (contracts/mocks/QuoterV2Mock.sol)
   - 模拟 quoteExactInputSingle() 和 quoteExactOutputSingle()
   - 返回正确的报价和模拟的 gas 估算
   - 与 AMMSwap 合约完全兼容

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

真实 DEX 地址 (Sepolia Testnet)：

在实际部署到 Sepolia 时，使用以下真实地址：

- UniversalRouter: 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
- QuoterV2: 0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3
- USDC/WLTC Pool: 0xAB67EBaef7cc4ff18f44E1B71d66ac942a24E29c
- Fee tier: 0.3% (3000)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

本地测试 vs Sepolia 测试：

本地测试（使用 Mock）：
✅ 快速验证合约逻辑
✅ 固定价格，易于预测结果
✅ 无需真实的流动性池
✅ 适合单元测试和集成测试

Sepolia 测试（使用真实 DEX）：
✅ 验证与真实 Uniswap 的兼容性
✅ 真实的价格和滑点
✅ 真实的 gas 消耗
✅ 适合最终部署前的验证
    `);

    console.log("\n✅ Test 6 通过: Leverage token 交换说明已更新");
  });

  /**
   * 测试 7: swapUsdcToLeverage（新流程）- 用户支付 USDC 获得 Leverage Token
   * 
   * 新流程：
   * 1. 用户使用 USDC 在 DEX 购买 WLTC
   * 2. 铸造 S token 到 AMMSwap 合约，L token 到用户
   * 3. AMMSwap 将 S token 卖给 AMM 池换 USDC
   * 4. 用户最终获得 L token，净支出部分 USDC
   */
  it("should swap USDC to Leverage token (new flow)", async function () {
    console.log("\n========== Test 7: swapUsdcToLeverage (新流程) ==========");

    // 准备测试数据
    const LAmountInWei = parseUnits("10", 18); // 10 L tokens
    const mintPrice = 120n * 10n ** 18n; // $120
    const leverageType = 2; // AGGRESSIVE (2x)
    const slippageTolerance = 1000; // 10%

    console.log(`\n--- 交易参数 ---`);
    console.log(`L Amount: ${formatUnits(LAmountInWei, 18)}`);
    console.log(`Mint Price: $${formatUnits(mintPrice, 18)}`);
    console.log(`Leverage: ${leverageType}x (AGGRESSIVE)`);
    console.log(`Slippage Tolerance: ${slippageTolerance / 100}%`);

    // 🔍 使用 previewSwapUsdcToLeverage 获取精确的授权金额
    console.log(`\n--- 预览交易 ---`);
    const swapPreview = await ammswap.read.previewSwapUsdcToLeverage([
      LAmountInWei,
      mintPrice,
      leverageType,
      slippageTolerance
    ]) as readonly [bigint, bigint, bigint];
    
    const maxUsdcRequired = swapPreview[0]; // 最大 USDC 需求（含滑点）
    const expectedUnderlying = swapPreview[1]; // 需要购买的 underlying
    const dexQuote = swapPreview[2]; // DEX 报价（不含滑点）
    
    console.log(`📊 预览结果:`);
    console.log(`  - 需要购买 WLTC: ${formatUnits(expectedUnderlying, 18)}`);
    console.log(`  - DEX 报价（不含滑点）: ${formatUnits(dexQuote, 6)} USDC`);
    console.log(`  - 最大 USDC 需求（含${slippageTolerance / 100}%滑点）: ${formatUnits(maxUsdcRequired, 6)} USDC`);

    // 给用户足够的 USDC（额外加一点余量）
    const userUsdcNeeded = maxUsdcRequired + parseUnits("10", 6); // 多给 10 USDC 作为余量
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.mint([user, userUsdcNeeded])
    });
    console.log(`\n--- 准备工作 ---`);
    console.log(`Mint ${formatUnits(userUsdcNeeded, 6)} USDC to user`);

    // 用户授权精确的 USDC 金额
    await publicClient.waitForTransactionReceipt({
      hash: await walletClients[1].writeContract({
        address: usdc.address,
        abi: usdc.abi,
        functionName: 'approve',
        args: [ammswap.address, maxUsdcRequired]
      })
    });
    console.log(`✅ User approved ${formatUnits(maxUsdcRequired, 6)} USDC to AMMSwap`);

    // 记录交易前状态
    const userUsdcBefore = await usdc.read.balanceOf([user]) as bigint;
    const poolStableBefore = await stable.read.balanceOf([ammliquidity.address]) as bigint;
    const poolUsdcBefore = await usdc.read.balanceOf([ammliquidity.address]) as bigint;
    const ammswapStableBefore = await stable.read.balanceOf([ammswap.address]) as bigint;

    console.log(`\n--- 交易前状态 ---`);
    console.log(`用户 USDC 余额: ${formatUnits(userUsdcBefore, 6)}`);
    console.log(`AMM 池 S token 余额: ${formatUnits(poolStableBefore, 18)}`);
    console.log(`AMM 池 USDC 余额: ${formatUnits(poolUsdcBefore, 6)}`);
    console.log(`AMMSwap 合约 S token 余额: ${formatUnits(ammswapStableBefore, 18)}`);

    // 执行交易
    console.log(`\n--- 执行 swapUsdcToLeverage ---`);
    const txHash = await walletClients[1].writeContract({
      address: ammswap.address,
      abi: ammswap.abi,
      functionName: 'swapUsdcToLeverage',
      args: [LAmountInWei, mintPrice, leverageType, slippageTolerance]
    });
    console.log(`交易哈希: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`✅ 交易已确认，区块: ${receipt.blockNumber}`);

    // 解析事件并获取铸造的 token ID
    const logs = await ammswap.getEvents.SwapUsdcToLeverage({
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber
    });

    console.log(`\n--- 事件调试 ---`);
    console.log(`找到 ${logs.length} 个事件`);

    let mintedTokenId: bigint | undefined;
    if (logs.length > 0) {
      const eventArgs = logs[0].args as any;
      mintedTokenId = eventArgs.leverageTokenId;
      
      console.log(`\n--- 交易事件 ---`);
      console.log(`用户: ${eventArgs.user}`);
      console.log(`净支出 USDC: ${formatUnits(eventArgs.netUsdcPaid, 6)}`);
      console.log(`Token ID: ${mintedTokenId !== undefined ? mintedTokenId.toString() : 'undefined'}`);
      console.log(`L Amount: ${formatUnits(eventArgs.actualLAmountInWei, 18)}`);
    } else {
      console.log(`⚠️ 未找到 SwapUsdcToLeverage 事件`);
    }

    // 记录交易后状态
    const userUsdcAfter = await usdc.read.balanceOf([user]) as bigint;
    const poolStableAfter = await stable.read.balanceOf([ammliquidity.address]) as bigint;
    const poolUsdcAfter = await usdc.read.balanceOf([ammliquidity.address]) as bigint;
    const ammswapStableAfter = await stable.read.balanceOf([ammswap.address]) as bigint;
    
    // 检查用户的 L token 余额（需要 token ID）
    let userLeverageBalance = 0n;
    if (mintedTokenId !== undefined) {
      userLeverageBalance = await leverage.read.balanceOf([user, mintedTokenId]) as bigint;
      console.log(`查询 token ID ${mintedTokenId} 的余额: ${formatUnits(userLeverageBalance, 18)}`);
    } else {
      // 如果没有从事件获取到 token ID，尝试使用静态 token ID 2 (AGGRESSIVE, $120)
      console.log(`⚠️ 未从事件获取到 token ID，尝试使用静态 token ID 2`);
      try {
        userLeverageBalance = await leverage.read.balanceOf([user, 2n]) as bigint;
        mintedTokenId = 2n;
        console.log(`Token ID 2 的余额: ${formatUnits(userLeverageBalance, 18)}`);
      } catch (e) {
        console.log(`查询 token ID 2 失败:`, e);
      }
    }
    
    console.log(`\n--- 交易后状态 ---`);
    console.log(`用户 USDC 余额: ${formatUnits(userUsdcAfter, 6)}`);
    if (mintedTokenId !== undefined) {
      console.log(`用户 Leverage Token (ID: ${mintedTokenId}) 余额: ${formatUnits(userLeverageBalance, 18)}`);
    }
    console.log(`AMM 池 S token 余额: ${formatUnits(poolStableAfter, 18)}`);
    console.log(`AMM 池 USDC 余额: ${formatUnits(poolUsdcAfter, 6)}`);
    console.log(`AMMSwap 合约 S token 余额: ${formatUnits(ammswapStableAfter, 18)}`);

    // 验证结果
    const usdcSpent = userUsdcBefore - userUsdcAfter;
    const poolStableIncrease = poolStableAfter - poolStableBefore;
    const poolUsdcDecrease = poolUsdcBefore - poolUsdcAfter;
    
    console.log(`\n--- 验证结果 ---`);
    console.log(`USDC 净支出: ${formatUnits(usdcSpent, 6)}`);
    console.log(`Leverage Token 余额: ${formatUnits(userLeverageBalance, 18)}`);
    console.log(`AMM 池 S token 增加: ${formatUnits(poolStableIncrease, 18)}`);
    console.log(`AMM 池 USDC 净减少: ${formatUnits(poolUsdcDecrease, 6)}`);
    console.log(`AMMSwap 合约 S token 余额（应为0）: ${formatUnits(ammswapStableAfter, 18)}`);

    // 断言
    assert(usdcSpent > 0n, "应该花费了 USDC");
    // 注意：由于前面的测试可能已经铸造过同一个 token ID，所以这里检查至少获得了期望数量
    assert(userLeverageBalance >= LAmountInWei, `应该获得了至少 ${formatUnits(LAmountInWei, 18)} 个 Leverage Token，实际: ${formatUnits(userLeverageBalance, 18)}`);
    assert(poolStableIncrease > 0n, "AMM 池 S token 应该增加（接收了铸造的 S token）");
    assert(poolUsdcDecrease > 0n, "AMM 池 USDC 应该净减少（卖 S token 换出的 USDC 返还给用户）");
    assert(ammswapStableAfter === 0n, "AMMSwap 合约不应持有 S token（已全部转给 AMM）");

    console.log("\n✅ Test 7 通过: swapUsdcToLeverage (新流程) 成功执行");
    console.log("\n流程验证：");
    console.log("1. ✅ 用户用 USDC 在 DEX 购买 WLTC");
    console.log("2. ✅ S token 铸造到 AMMSwap 合约，L token 铸造到用户");
    console.log("3. ✅ AMMSwap 将 S token 卖给 AMM 池换 USDC");
    console.log("4. ✅ 用户收到 USDC，净支出 = DEX 购买成本 - AMM 卖出收入");
  });
});

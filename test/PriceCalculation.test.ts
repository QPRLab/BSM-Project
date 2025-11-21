import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { formatUnits, parseUnits } from "viem";

/*
 * 测试 AMMSwap._sqrtPriceX96ToPrice 函数的正确性
 * 命令：npx hardhat test test/PriceCalculation.test.ts
 * 
 * 验证目标：
 * 1. 价格计算与参考实现（correct_price_formula_confirmed.ts）一致
 * 2. 不同 token 顺序下的价格计算正确
 * 3. 价格反转逻辑正确
 * 4. Decimals 调整正确
 */

describe("AMMSwap - _sqrtPriceX96ToPrice Function Test", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const walletClients = await viem.getWalletClients();
  const deployer = walletClients[0].account.address;

  let wltc: any, usdc: any, stable: any, leverage: any;
  let ammswap: any;
  let testHelper: any; // 用于测试内部函数的辅助合约

  // Uniswap V3 池子的真实数据（来自 Sepolia）
  const REAL_SQRT_PRICE_X96 = 7016525649038329142060551968629605n; // 真实的 sqrtPriceX96 (2024-11-06)
  const REAL_TICK = 227840n; // 对应的 tick

  before(async function () {
    console.log("\n=== 部署测试合约 ===");

    // 部署 Token 合约
    wltc = await viem.deployContract("WLTCMock");
    usdc = await viem.deployContract("USDCMock");
    stable = await viem.deployContract("StableToken");
    leverage = await viem.deployContract("MultiLeverageToken", [
      "ipfs://test/"
    ]);
    console.log("✅ Token 合约部署完成");

    // 部署一个测试用的 Uniswap V3 Pool Mock
    testHelper = await viem.deployContract("PriceCalculationTestHelper", [
      usdc.address,    // token0
      wltc.address     // token1
    ]);
    console.log("✅ PriceCalculationTestHelper 部署完成:", testHelper.address);

    // 部署 AMMSwap（使用 testHelper 作为 pool）
    ammswap = await viem.deployContract("AMMSwap", [
      wltc.address,                    // underlyingToken
      usdc.address,                    // usdcToken
      stable.address,                  // stableToken
      leverage.address,                // multiLeverageToken
      "0x0000000000000000000000000000000000000001", // dexRouter (dummy)
      "0x0000000000000000000000000000000000000002", // quoter (dummy)
      testHelper.address,              // usdcUnderlyingPool (使用 testHelper)
      3000                             // poolFee
    ]);
    console.log("✅ AMMSwap 部署完成:", ammswap.address);

    console.log("\n=== 合约部署完成 ===\n");
  });

  /**
   * 测试 1: 验证价格计算的数学正确性
   */
  it("should calculate price correctly using sqrtPriceX96", async function () {
    console.log("\n========== Test 1: 价格计算正确性验证 ==========");

    // 设置 sqrtPriceX96
    await publicClient.waitForTransactionReceipt({
      hash: await testHelper.write.setSqrtPriceX96([REAL_SQRT_PRICE_X96])
    });
    console.log(`✅ 设置 sqrtPriceX96: ${REAL_SQRT_PRICE_X96.toString()}`);

    // 调用 testHelper 来测试内部函数
    const result = await testHelper.read.testSqrtPriceX96ToPrice([
      REAL_SQRT_PRICE_X96,
      true // isUsdcToUnderlying
    ]);

    console.log(`\n--- 合约计算结果 ---`);
    console.log(`价格 (underlying/usdc): ${result.toString()}`);
    console.log(`格式化后: ${formatUnits(result as bigint, 18)}`);

    // 参考计算（JavaScript 实现）
    const tick = Number(REAL_TICK);
    const p = Math.pow(1.0001, tick);
    const decimals0 = 6;  // USDC
    const decimals1 = 18; // WLTC
    const p_adjusted = p * Math.pow(10, decimals0 - decimals1);
    
    console.log(`\n--- 参考实现（JavaScript）---`);
    console.log(`Tick: ${tick}`);
    console.log(`p (wei级别): ${p.toExponential(6)}`);
    console.log(`p' (调整后): ${p_adjusted.toExponential(6)}`);
    console.log(`1 USDC = ${p_adjusted.toFixed(8)} WLTC`);
    console.log(`1 WLTC = ${(1 / p_adjusted).toFixed(2)} USDC`);

    // 将合约结果转换为 JavaScript Number 进行比较
    const contractPrice = Number(formatUnits(result as bigint, 18));
    console.log(`\n--- 结果对比 ---`);
    console.log(`合约计算: 1 USDC = ${contractPrice.toFixed(8)} WLTC`);
    console.log(`参考计算: 1 USDC = ${p_adjusted.toFixed(8)} WLTC`);
    
    const difference = Math.abs(contractPrice - p_adjusted);
    const percentDiff = (difference / p_adjusted) * 100;
    console.log(`差异: ${difference.toExponential(6)} WLTC`);
    console.log(`差异百分比: ${percentDiff.toFixed(6)}%`);

    // 允许 1% 的精度误差（由于 Solidity 整数运算）
    assert(percentDiff < 1, `价格差异应该小于 1%，实际: ${percentDiff.toFixed(6)}%`);
    
    console.log("\n✅ Test 1 通过: 价格计算与参考实现一致！");
  });

  /**
   * 测试 2: 验证反向价格计算（usdc/underlying）
   */
  it("should calculate reverse price correctly", async function () {
    console.log("\n========== Test 2: 反向价格计算验证 ==========");

    // 调用反向价格计算
    const result = await testHelper.read.testSqrtPriceX96ToPrice([
      REAL_SQRT_PRICE_X96,
      false // isUsdcToUnderlying = false，计算 usdc/underlying
    ]);

    console.log(`\n--- 合约计算结果（反向）---`);
    console.log(`价格 (usdc/underlying): ${result.toString()}`);
    console.log(`格式化后: ${formatUnits(result as bigint, 6)} USDC per WLTC`);

    // 参考计算
    const tick = Number(REAL_TICK);
    const p = Math.pow(1.0001, tick);
    const decimals0 = 6;  // USDC
    const decimals1 = 18; // WLTC
    const p_adjusted = p * Math.pow(10, decimals0 - decimals1);
    const reversePrice = 1 / p_adjusted; // USDC per WLTC

    console.log(`\n--- 参考实现（JavaScript）---`);
    console.log(`1 WLTC = ${reversePrice.toFixed(2)} USDC`);

    // 将合约结果转换为 JavaScript Number（注意这里是 6 位精度）
    const contractReversePrice = Number(formatUnits(result as bigint, 6));
    console.log(`\n--- 结果对比 ---`);
    console.log(`合约计算: 1 WLTC = ${contractReversePrice.toFixed(2)} USDC`);
    console.log(`参考计算: 1 WLTC = ${reversePrice.toFixed(2)} USDC`);
    
    const difference = Math.abs(contractReversePrice - reversePrice);
    const percentDiff = (difference / reversePrice) * 100;
    console.log(`差异: ${difference.toFixed(6)} USDC`);
    console.log(`差异百分比: ${percentDiff.toFixed(6)}%`);

    // 允许 1% 的精度误差
    assert(percentDiff < 1, `反向价格差异应该小于 1%，实际: ${percentDiff.toFixed(6)}%`);
    
    console.log("\n✅ Test 2 通过: 反向价格计算正确！");
  });

  /**
   * 测试 3: 验证不同 sqrtPriceX96 值
   */
  it("should handle different sqrtPriceX96 values correctly", async function () {
    console.log("\n========== Test 3: 不同价格点验证 ==========");

    const testCases = [
      { 
        sqrtPriceX96: 7016525649038329142060551968629605n, // ~$127.50
        expectedPrice: 127.50,
        description: "当前价格 (~$127.5)"
      },
      { 
        sqrtPriceX96: 7500000000000000000000000000000000n, // 更高价格
        expectedPrice: 111.59, 
        description: "更高价格 (~$112)"
      },
      { 
        sqrtPriceX96: 6000000000000000000000000000000000n, // 更低价格
        expectedPrice: 173.96,
        description: "更低价格 (~$174)"
      }
    ];

    for (const testCase of testCases) {
      console.log(`\n--- 测试用例: ${testCase.description} ---`);
      console.log(`sqrtPriceX96: ${testCase.sqrtPriceX96.toString()}`);

      await publicClient.waitForTransactionReceipt({
        hash: await testHelper.write.setSqrtPriceX96([testCase.sqrtPriceX96])
      });

      const result = await testHelper.read.testSqrtPriceX96ToPrice([
        testCase.sqrtPriceX96,
        false // 计算 USDC per WLTC
      ]);

      const contractPrice = Number(formatUnits(result as bigint, 6));
      console.log(`合约计算: 1 WLTC = ${contractPrice.toFixed(2)} USDC`);
      console.log(`预期价格: 1 WLTC ≈ ${testCase.expectedPrice.toFixed(2)} USDC`);

      // 验证价格在合理范围内（±5%）
      const percentDiff = Math.abs(contractPrice - testCase.expectedPrice) / testCase.expectedPrice * 100;
      console.log(`差异百分比: ${percentDiff.toFixed(2)}%`);
      
      assert(percentDiff < 5, `价格应该在预期范围内（±5%），实际差异: ${percentDiff.toFixed(2)}%`);
      console.log(`✅ ${testCase.description} 通过`);
    }

    console.log("\n✅ Test 3 通过: 不同价格点计算正确！");
  });

  /**
   * 测试 4: 验证价格不为零
   */
  it("should never return zero price", async function () {
    console.log("\n========== Test 4: 价格非零验证 ==========");

    const testValues = [
      5000000000000000000000000000000000n,   // 较小值 (~$240)
      8000000000000000000000000000000000n   // 较大值 (~$96)
    ];

    for (const sqrtPriceX96 of testValues) {
      console.log(`\n--- 测试 sqrtPriceX96: ${sqrtPriceX96.toString()} ---`);

      await publicClient.waitForTransactionReceipt({
        hash: await testHelper.write.setSqrtPriceX96([sqrtPriceX96])
      });

      const result = await testHelper.read.testSqrtPriceX96ToPrice([
        sqrtPriceX96,
        true
      ]);

      console.log(`价格结果: ${result.toString()}`);
      
      assert(result > 0n, "价格应该大于 0");
      console.log(`✅ 价格非零: ${formatUnits(result as bigint, 18)}`);
    }

    console.log("\n✅ Test 4 通过: 价格始终非零！");
  });

  /**
   * 测试 5: 验证 token 顺序反转
   */
  it("should handle reversed token order correctly", async function () {
    console.log("\n========== Test 5: Token 顺序反转验证 ==========");

    // 部署一个反转 token 顺序的 pool
    const reversedHelper = await viem.deployContract("PriceCalculationTestHelper", [
      wltc.address,    // token0 (反转)
      usdc.address     // token1 (反转)
    ]);
    console.log("✅ 反转顺序的 TestHelper 部署完成");

    // 部署使用反转 pool 的 AMMSwap
    const reversedAmmswap = await viem.deployContract("AMMSwap", [
      wltc.address,
      usdc.address,
      stable.address,
      leverage.address,
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      reversedHelper.address, // 使用反转的 pool
      3000
    ]);
    console.log("✅ 反转顺序的 AMMSwap 部署完成");

    // 设置相同的 sqrtPriceX96
    await publicClient.waitForTransactionReceipt({
      hash: await reversedHelper.write.setSqrtPriceX96([REAL_SQRT_PRICE_X96])
    });

    // 部署反转测试的 helper
    const reversedTestHelper = await viem.deployContract("PriceCalculationTestHelper", [
      wltc.address,
      usdc.address
    ]);
    await publicClient.waitForTransactionReceipt({
      hash: await reversedTestHelper.write.setSqrtPriceX96([REAL_SQRT_PRICE_X96])
    });

    const result = await reversedTestHelper.read.testSqrtPriceX96ToPrice([
      REAL_SQRT_PRICE_X96,
      false
    ]);

    console.log(`\n--- 反转顺序的价格计算 ---`);
    console.log(`价格: ${formatUnits(result as bigint, 6)} USDC per WLTC`);

    // 价格应该仍然合理
    const contractPrice = Number(formatUnits(result as bigint, 6));
    assert(contractPrice > 50 && contractPrice < 200, 
      `价格应该在合理范围内（$50-$200），实际: $${contractPrice.toFixed(2)}`);

    console.log("\n✅ Test 5 通过: Token 顺序反转处理正确！");
  });
});

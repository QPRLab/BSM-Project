/*
 * 测试 AMMLiquidity 资产状况和 Stable -> USDC 兑换预览
 * 运行：npx tsx scripts/test_amm_liquidity_status.ts
 */

import { createPublicClient, createWalletClient, http, formatEther, formatUnits, getContract } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
dotenv.config();

const USER_ADDRESS = '0x4845d4db01b81A15559b8734D234e6202C556d32' as const;

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取部署的合约信息
const USDCMockArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#USDCMock.json'), 'utf8'));
const StableTokenArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#StableToken.json'), 'utf8'));
const AMMSwapArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/ammModules#AMMSwap.json'), 'utf8'));
const AMMLiquidityArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/ammModules#AMMLiquidity.json'), 'utf8'));
const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/deployed_addresses.json'), "utf-8"));

// 创建客户端
const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
if (!privateKey) {
  throw new Error('SEPOLIA_PRIVATE_KEY not found in .env');
}
const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function main() {
  console.log("🔍 ===== AMMLiquidity 资产状况检查 =====\n");

  // 创建合约实例
  const usdcContract = getContract({ 
    address: deployedAddresses["tokenModules#USDCMock"], 
    abi: USDCMockArtifact.abi, 
    client: publicClient 
  });
  
  const stableContract = getContract({ 
    address: deployedAddresses["tokenModules#StableToken"], 
    abi: StableTokenArtifact.abi, 
    client: publicClient 
  });
  
  const ammSwapContract = getContract({ 
    address: deployedAddresses["ammModules#AMMSwap"], 
    abi: AMMSwapArtifact.abi, 
    client: publicClient 
  });
  
  const ammLiquidityContract = getContract({ 
    address: deployedAddresses["ammModules#AMMLiquidity"], 
    abi: AMMLiquidityArtifact.abi, 
    client: publicClient 
  });

  // ========== 1. 查询 AMMLiquidity 基本信息 ==========
  console.log("📊 1. AMMLiquidity 池子储备:");
  const reserves = await ammLiquidityContract.read.getReserves([]) as readonly [bigint, bigint];
  const stableReserve = reserves[0];
  const usdcReserve = reserves[1];
  
  console.log(`   💧 Stable Token 储备: ${formatEther(stableReserve)} Stable`);
  console.log(`   💰 USDC 储备: ${formatUnits(usdcReserve, 6)} USDC`);
  
  // 计算价格比率
  if (stableReserve > 0n && usdcReserve > 0n) {
    // USDC per Stable = (USDC储备 * 10^18) / Stable储备
    const usdcPerStable = (usdcReserve * 10n**18n) / stableReserve;
    console.log(`   📈 当前价格比率: 1 Stable = ${formatUnits(usdcPerStable, 6)} USDC`);
  }

  // ========== 2. 查询 AMMLiquidity 合约的代币余额（实际持有） ==========
  console.log("\n💼 2. AMMLiquidity 合约实际代币余额:");
  const actualStableBalance = await stableContract.read.balanceOf([deployedAddresses["ammModules#AMMLiquidity"]]) as bigint;
  const actualUsdcBalance = await usdcContract.read.balanceOf([deployedAddresses["ammModules#AMMLiquidity"]]) as bigint;
  
  console.log(`   🏦 Stable Token 余额: ${formatEther(actualStableBalance)} Stable`);
  console.log(`   💵 USDC 余额: ${formatUnits(actualUsdcBalance, 6)} USDC`);

  // 检查储备和实际余额是否一致
  if (stableReserve !== actualStableBalance || usdcReserve !== actualUsdcBalance) {
    console.log("\n   ⚠️ 警告：储备量与实际余额不一致！");
    console.log(`   Stable 差异: ${formatEther(actualStableBalance - stableReserve)}`);
    console.log(`   USDC 差异: ${formatUnits(actualUsdcBalance - usdcReserve, 6)}`);
  } else {
    console.log(`   ✅ 储备量与实际余额一致`);
  }

  // ========== 3. 查询管理费和LP费累积 ==========
  console.log("\n💰 3. 累积费用信息:");
  try {
    // 假设合约有这些公开变量
    const totalAdminFeeStable = await ammLiquidityContract.read.adminStableBalance([]) as bigint;
    const totalAdminFeeUsdc = await ammLiquidityContract.read.adminUsdcBalance([]) as bigint;
    const totalLpFeeStable = await ammLiquidityContract.read.lpStableBalance([]) as bigint;
    const totalLpFeeUsdc = await ammLiquidityContract.read.lpUsdcBalance([]) as bigint;
    
    console.log(`   🏛️ 管理费累积:`);
    console.log(`      - Stable: ${formatEther(totalAdminFeeStable)}`);
    console.log(`      - USDC: ${formatUnits(totalAdminFeeUsdc, 6)}`);
    console.log(`   💎 LP费累积:`);
    console.log(`      - Stable: ${formatEther(totalLpFeeStable)}`);
    console.log(`      - USDC: ${formatUnits(totalLpFeeUsdc, 6)}`);
  } catch (e: any) {
    console.log(`   ⚠️ 无法获取费用信息: ${e.shortMessage || e.message}`);
  }

  // ========== 4. 查询流动性代币总量 ==========
  console.log("\n🎫 4. 流动性代币信息:");
  try {
    const totalSupply = await ammLiquidityContract.read.totalSupply([]) as bigint;
    console.log(`   📊 LP Token 总供应量: ${formatEther(totalSupply)}`);
    
    const userLpBalance = await ammLiquidityContract.read.balanceOf([USER_ADDRESS]) as bigint;
    console.log(`   👤 用户 LP Token 余额: ${formatEther(userLpBalance)}`);
    
    if (totalSupply > 0n) {
      const userShare = (userLpBalance * 10000n) / totalSupply;
      console.log(`   📈 用户持有比例: ${Number(userShare) / 100}%`);
    }
  } catch (e: any) {
    console.log(`   ⚠️ 无法获取流动性代币信息: ${e.shortMessage || e.message}`);
  }

  // ========== 5. 测试不同数量的 Stable -> USDC 兑换预览 ==========
  console.log("\n\n🔄 ===== Stable -> USDC 兑换预览测试 =====\n");
  
  const testAmounts = [
    10n * 10n**18n,    // 10 Stable
    100n * 10n**18n,   // 100 Stable
    1000n * 10n**18n,  // 1000 Stable
  ];

  for (const stableAmount of testAmounts) {
    console.log(`\n📝 测试卖出 ${formatEther(stableAmount)} Stable:`);
    console.log(`   ${'─'.repeat(50)}`);
    
    try {
      const previewResult = await ammSwapContract.read.previewSwapStableToUsdc([stableAmount]) as readonly [bigint, bigint, bigint, bigint, bigint, boolean];
      
      const expectedUsdcOut = previewResult[0];      // 预期获得的 USDC
      const stableAmountWithFee = previewResult[1];  // 包含费用的 Stable 数量
      const adminFeeUsdc = previewResult[2];         // 管理费（USDC）
      const lpFeeUsdc = previewResult[3];            // LP费（USDC）
      const priceImpact = previewResult[4];          // 价格影响（basis points）
      const isValid = previewResult[5];              // 是否有效
      
      if (!isValid) {
        console.log(`   ❌ 预览失败：交易参数无效`);
        continue;
      }
      
      console.log(`   ✅ 预览结果:`);
      console.log(`      💰 预期获得 USDC: ${formatUnits(expectedUsdcOut, 6)} USDC`);
      console.log(`      📊 有效兑换率: ${formatUnits((expectedUsdcOut * 10n**18n) / stableAmount, 6)} USDC per Stable`);
      console.log(`      💸 管理费: ${formatUnits(adminFeeUsdc, 6)} USDC`);
      console.log(`      💎 LP费: ${formatUnits(lpFeeUsdc, 6)} USDC`);
      console.log(`      📈 总费用: ${formatUnits(adminFeeUsdc + lpFeeUsdc, 6)} USDC`);
      console.log(`      📉 价格影响: ${Number(priceImpact) / 100}%`);
      
      // 计算总USDC输出（包括费用）
      const totalUsdcOutput = expectedUsdcOut + adminFeeUsdc + lpFeeUsdc;
      console.log(`      🔢 总USDC输出（含费用）: ${formatUnits(totalUsdcOutput, 6)} USDC`);
      
      // 检查池子是否有足够的 USDC
      if (totalUsdcOutput > usdcReserve) {
        console.log(`      ⚠️ 警告：池子 USDC 不足！需要 ${formatUnits(totalUsdcOutput, 6)}，只有 ${formatUnits(usdcReserve, 6)}`);
      } else {
        const remainingUsdc = usdcReserve - totalUsdcOutput;
        console.log(`      ✅ 池子 USDC 充足，剩余: ${formatUnits(remainingUsdc, 6)} USDC`);
      }
      
    } catch (error: any) {
      console.log(`   ❌ 预览失败: ${error.shortMessage || error.message}`);
      if (error.cause) {
        console.log(`      原因: ${error.cause}`);
      }
    }
  }

  // ========== 6. 池子健康度评估 ==========
  console.log("\n\n🏥 ===== 池子健康度评估 =====\n");
  
  if (stableReserve > 0n && usdcReserve > 0n) {
    // 计算流动性深度
    const liquidityDepth = (stableReserve * usdcReserve) / 10n**18n;
    console.log(`💎 流动性深度 (K值): ${formatUnits(liquidityDepth, 6)}`);
    
    // 计算价格偏离（假设目标是 1:1）
    const targetRatio = 1000000n; // 1.0 (6 decimals)
    const currentRatio = (usdcReserve * 10n**18n) / stableReserve;
    const currentRatio6Decimals = currentRatio / 10n**12n;
    const deviation = currentRatio6Decimals > targetRatio 
      ? (currentRatio6Decimals - targetRatio) * 10000n / targetRatio
      : (targetRatio - currentRatio6Decimals) * 10000n / targetRatio;
    
    console.log(`📊 当前价格比率: ${formatUnits(currentRatio6Decimals, 6)}`);
    console.log(`🎯 目标价格比率: 1.0`);
    console.log(`📉 偏离度: ${Number(deviation) / 100}%`);
    
    // 健康度评级
    if (deviation < 100n) { // < 1%
      console.log(`✅ 池子健康度: 优秀`);
    } else if (deviation < 500n) { // < 5%
      console.log(`🟡 池子健康度: 良好`);
    } else if (deviation < 1000n) { // < 10%
      console.log(`🟠 池子健康度: 一般`);
    } else {
      console.log(`🔴 池子健康度: 较差（价格严重偏离）`);
    }
    
    // 建议
    console.log(`\n💡 建议:`);
    if (currentRatio6Decimals > targetRatio * 11n / 10n) {
      console.log(`   - 池子中 USDC 过多，建议添加 Stable 流动性或卖出 USDC`);
    } else if (currentRatio6Decimals < targetRatio * 9n / 10n) {
      console.log(`   - 池子中 Stable 过多，建议添加 USDC 流动性或卖出 Stable`);
    } else {
      console.log(`   - 池子平衡良好，可以正常交易`);
    }
  } else {
    console.log(`❌ 池子未初始化或余额为零`);
  }

  console.log("\n✅ 检查完成！");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 测试失败:", error);
    process.exit(1);
  });

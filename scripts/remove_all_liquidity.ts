/*
 * 移除 AMMLiquidity 中的所有流动性
 * 运行：npx tsx scripts/remove_all_liquidity.ts
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
dotenv.config();

// ======================================1. 从本项目中引入已部署合约的 abi 及地址======================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 Ignition 生成的 artifacts
const AMMLiquidityArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/ammModules#AMMLiquidity.json'), 'utf8'));
const LPTokenArtifact = JSON.parse(readFileSync(join(__dirname, '../artifacts/contracts/tokens/LPToken.sol/LPToken.json'), 'utf8'));
const StableTokenArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#StableToken.json'), 'utf8'));
const USDCMockArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#USDCMock.json'), 'utf8'));

// 读取部署地址
const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/deployed_addresses.json'), "utf-8"));

const CONTRACTS = {
  AMMLiquidity: deployedAddresses["ammModules#AMMLiquidity"] as `0x${string}`,
  StableToken: deployedAddresses["tokenModules#StableToken"] as `0x${string}`,
  USDC: deployedAddresses["tokenModules#USDCMock"] as `0x${string}`,
};

async function main() {
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (!privateKey) throw new Error('SEPOLIA_PRIVATE_KEY not found');
  
  const account = privateKeyToAccount((privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`);
  const publicClient = createPublicClient({ 
    chain: sepolia, 
    transport: http(process.env.SEPOLIA_RPC_URL) 
  });
  const walletClient = createWalletClient({ 
    account, 
    chain: sepolia, 
    transport: http(process.env.SEPOLIA_RPC_URL) 
  });

  console.log('═'.repeat(80));
  console.log('🗑️  移除 AMMLiquidity 中的所有流动性');
  console.log('═'.repeat(80));
  console.log('\n操作账户:', account.address);
  console.log('AMMLiquidity 地址:', CONTRACTS.AMMLiquidity);

  // ======================================2. 查询当前池子状态======================================
  console.log('\n📊 查询当前池子状态...');
  
  const reserves = await publicClient.readContract({
    address: CONTRACTS.AMMLiquidity,
    abi: AMMLiquidityArtifact.abi,
    functionName: 'getReserves',
    args: [],
  }) as any;
  
  const stableReserve = reserves[0] as bigint;
  const usdcReserve = reserves[1] as bigint;

  console.log(`  Stable 储备: ${formatUnits(stableReserve, 18)} S`);
  console.log(`  USDC 储备: ${formatUnits(usdcReserve, 6)} USDC`);

  if (stableReserve === 0n && usdcReserve === 0n) {
    console.log('\n✅ 池子已经是空的，无需移除流动性');
    return;
  }

  // ======================================3. 查询 LP Token 地址和余额======================================
  console.log('\n💰 查询 LP Token...');
  
  // 先获取 lpToken 合约地址
  const lpTokenAddress = await publicClient.readContract({
    address: CONTRACTS.AMMLiquidity,
    abi: AMMLiquidityArtifact.abi,
    functionName: 'lpToken',
    args: [],
  }) as `0x${string}`;
  
  console.log(`  LP Token 地址: ${lpTokenAddress}`);
  
  // 查询用户的 LP Token 余额
  const lpBalance = await publicClient.readContract({
    address: lpTokenAddress,
    abi: LPTokenArtifact.abi,
    functionName: 'balanceOf',
    args: [account.address],
  }) as bigint;

  console.log(`  LP Token 余额: ${formatUnits(lpBalance, 18)} LP`);

  if (lpBalance === 0n) {
    console.log('\n⚠️  您没有 LP Token，无法移除流动性');
    console.log('如果流动性是其他账户添加的，请使用该账户执行此脚本');
    return;
  }

  // ======================================4. 查询预期可以赎回的代币数量======================================
  console.log('\n🔍 预览移除流动性...');
  
  const preview = await publicClient.readContract({
    address: CONTRACTS.AMMLiquidity,
    abi: AMMLiquidityArtifact.abi,
    functionName: 'removeLiquidityPreview',
    args: [lpBalance],
  }) as any;
  
  const expectedStable = preview[0] as bigint;
  const expectedUsdc = preview[1] as bigint;

  console.log(`  预期获得 Stable: ${formatUnits(expectedStable, 18)} S`);
  console.log(`  预期获得 USDC: ${formatUnits(expectedUsdc, 6)} USDC`);

  // ======================================5. 执行移除流动性======================================
  console.log('\n🔄 执行移除流动性...');
  
  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.AMMLiquidity,
      abi: AMMLiquidityArtifact.abi,
      functionName: 'removeLiquidity',
      args: [lpBalance], // 只需要 lpTokens 参数
    });

    console.log('交易哈希:', hash);
    console.log('⏳ 等待交易确认...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      console.log('✅ 移除流动性成功！');
      console.log(`Gas 消耗: ${receipt.gasUsed.toString()}`);

      // ======================================6. 查询移除后的状态======================================
      console.log('\n📊 查询移除后的状态...');

      const newReserves = await publicClient.readContract({
        address: CONTRACTS.AMMLiquidity,
        abi: AMMLiquidityArtifact.abi,
        functionName: 'getReserves',
        args: [],
      }) as any;
      
      const newStableReserve = newReserves[0] as bigint;
      const newUsdcReserve = newReserves[1] as bigint;

      const newLpBalance = await publicClient.readContract({
        address: lpTokenAddress,
        abi: LPTokenArtifact.abi,
        functionName: 'balanceOf',
        args: [account.address],
      }) as bigint;

      const stableBalance = await publicClient.readContract({
        address: CONTRACTS.StableToken,
        abi: StableTokenArtifact.abi,
        functionName: 'balanceOf',
        args: [account.address],
      }) as bigint;

      const usdcBalance = await publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: USDCMockArtifact.abi,
        functionName: 'balanceOf',
        args: [account.address],
      }) as bigint;

      console.log('\n池子状态:');
      console.log(`  Stable 储备: ${formatUnits(stableReserve, 18)} → ${formatUnits(newStableReserve, 18)}`);
      console.log(`  USDC 储备: ${formatUnits(usdcReserve, 6)} → ${formatUnits(newUsdcReserve, 6)}`);
      
      console.log('\n您的余额:');
      console.log(`  LP Token: ${formatUnits(lpBalance, 18)} → ${formatUnits(newLpBalance, 18)}`);
      console.log(`  Stable: ${formatUnits(stableBalance, 18)}`);
      console.log(`  USDC: ${formatUnits(usdcBalance, 6)}`);

      console.log('\n✅ 所有流动性已成功移除！');
    } else {
      console.log('❌ 交易失败');
    }
  } catch (error: any) {
    console.error('❌ 移除流动性失败:', error.message);
    if (error.cause) {
      console.error('原因:', error.cause.reason || error.cause);
    }
  }
}

main().catch(console.error);

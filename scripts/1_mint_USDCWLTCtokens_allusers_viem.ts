/*
  批量铸币脚本：为多个地址铸造 WLTC 和 USDC
  执行方法：npx tsx scripts/1_mint_USDCWLTCtokens_allusers_viem.ts
*/

import { createPublicClient, createWalletClient, http, formatEther, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import path, { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
dotenv.config();

// 从环境变量获取私钥并创建用户账户
const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
if (!privateKey) {
  throw new Error('SEPOLIA_PRIVATE_KEY not found in .env');
}
const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);

// 创建客户端
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

// ====================================== 从本项目中引入已部署合约的abi及地址 ======================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 Ignition 生成的 artifacts
const WLTCMockArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#WLTCMock.json'), 'utf8'));
const USDCMockArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#USDCMock.json'), 'utf8'));

// 读取 Ignition 生成的 address 部分
const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/deployed_addresses.json'), "utf-8"));

// 合约地址
const WLTC_ADDRESS = deployedAddresses["tokenModules#WLTCMock"];
const USDC_ADDRESS = deployedAddresses["tokenModules#USDCMock"];

// 需要铸币的地址列表
const mint_WLTCUSDC_Address = [
  "0x4845d4db01b81A15559b8734D234e6202C556d32",
  "0x6bCf5fbb6569921c508eeA15fF16b92426F99218",
  "0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B",
  "0xA4b399a194e2DD9b84357E92474D0c32e3359A74",
];

// 每个地址的铸币数量
const WLTC_AMOUNT = 1000000n * 10n ** 18n; // 1,000,000 WLTC (18 decimals)
const USDC_AMOUNT = 120000000n * 10n ** 6n; // 120,000,000 USDC (6 decimals)

async function main() {
  console.log('🚀 开始批量铸币脚本...');
  console.log(`📝 将为 ${mint_WLTCUSDC_Address.length} 个地址铸币`);
  console.log(`💎 每个地址: ${formatEther(WLTC_AMOUNT)} WLTC`);
  console.log(`💵 每个地址: ${formatUnits(USDC_AMOUNT, 6)} USDC\n`);

  // 遍历每个地址
  for (let i = 0; i < mint_WLTCUSDC_Address.length; i++) {
    const userAddress = mint_WLTCUSDC_Address[i] as `0x${string}`;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📍 处理地址 ${i + 1}/${mint_WLTCUSDC_Address.length}: ${userAddress}`);
    console.log(`${'='.repeat(80)}`);

    try {
      // 1. 查询 ETH 余额
      console.log('\n📊 查询 ETH 余额...');
      const ethBalance = await publicClient.getBalance({ address: userAddress });
      console.log(`💰 ETH 余额: ${formatEther(ethBalance)} ETH`);

      // 2. 查询代币余额（铸币前）
      console.log('\n📊 查询铸币前代币余额...');
      
      const usdcBalanceBefore = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDCMockArtifact.abi,
        functionName: 'balanceOf',
        args: [userAddress],
      }) as bigint;
      console.log(`💵 USDC 余额（铸币前）: ${formatUnits(usdcBalanceBefore, 6)} USDC`);

      const wltcBalanceBefore = await publicClient.readContract({
        address: WLTC_ADDRESS,
        abi: WLTCMockArtifact.abi,
        functionName: 'balanceOf',
        args: [userAddress],
      }) as bigint;
      console.log(`🪙 WLTC 余额（铸币前）: ${formatEther(wltcBalanceBefore)} WLTC`);

      // 3. 铸造 WLTC
      console.log(`\n🏭 铸造 ${formatEther(WLTC_AMOUNT)} WLTC...`);
      const wltcTx = await walletClient.writeContract({
        address: WLTC_ADDRESS,
        abi: WLTCMockArtifact.abi,
        functionName: 'mint',
        args: [userAddress, WLTC_AMOUNT],
      });
      console.log(`📝 WLTC 交易哈希: ${wltcTx}`);

      // 4. 铸造 USDC
      console.log(`\n🏭 铸造 ${formatUnits(USDC_AMOUNT, 6)} USDC...`);
      const usdcTx = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: USDCMockArtifact.abi,
        functionName: 'mint',
        args: [userAddress, USDC_AMOUNT],
      });
      console.log(`📝 USDC 交易哈希: ${usdcTx}`);

      // 5. 等待交易确认
      console.log('\n⏳ 等待交易确认...');
      await publicClient.waitForTransactionReceipt({ hash: wltcTx });
      console.log('✅ WLTC 交易已确认');
      
      await publicClient.waitForTransactionReceipt({ hash: usdcTx });
      console.log('✅ USDC 交易已确认');

      // 6. 查询代币余额（铸币后）
      console.log('\n📊 查询铸币后代币余额...');
      
      const usdcBalanceAfter = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDCMockArtifact.abi,
        functionName: 'balanceOf',
        args: [userAddress],
      }) as bigint;
      console.log(`💵 USDC 余额（铸币后）: ${formatUnits(usdcBalanceAfter, 6)} USDC`);
      console.log(`   ➕ 增加: ${formatUnits(usdcBalanceAfter - usdcBalanceBefore, 6)} USDC`);

      const wltcBalanceAfter = await publicClient.readContract({
        address: WLTC_ADDRESS,
        abi: WLTCMockArtifact.abi,
        functionName: 'balanceOf',
        args: [userAddress],
      }) as bigint;
      console.log(`🪙 WLTC 余额（铸币后）: ${formatEther(wltcBalanceAfter)} WLTC`);
      console.log(`   ➕ 增加: ${formatEther(wltcBalanceAfter - wltcBalanceBefore)} WLTC`);

      console.log(`\n✅ 地址 ${userAddress} 铸币成功！`);

    } catch (error) {
      console.error(`\n❌ 地址 ${userAddress} 铸币失败:`, error);
      console.log('继续处理下一个地址...');
    }
  }

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('🎉 批量铸币脚本执行完成！');
  console.log(`${'='.repeat(80)}`);
  console.log(`✅ 成功为 ${mint_WLTCUSDC_Address.length} 个地址完成铸币操作`);
  console.log(`💎 每个地址获得: ${formatEther(WLTC_AMOUNT)} WLTC`);
  console.log(`💵 每个地址获得: ${formatUnits(USDC_AMOUNT, 6)} USDC`);
}

main().catch(console.error);

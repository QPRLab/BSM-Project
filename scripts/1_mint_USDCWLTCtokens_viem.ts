/*
  执行方法：npx tsx scripts/1_mint_USDCWLTCtokens_viem.ts
*/

import { createPublicClient, createWalletClient, http, formatEther ,formatUnits} from 'viem';
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
const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;// 确保私钥以 0x 开头
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


// ======================================1.从本项目中引入已部署合约的abi及地址======================================
// 获取当前文件的目录 (ES module 替代 __dirname)
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
const USER_ADDRESS =  '0x4845d4db01b81A15559b8734D234e6202C556d32';

// 铸币数量
const WLTC_AMOUNT = 1000000n * 10n ** 18n; //  1000000 WLTC (18 decimals)
const USDC_AMOUNT = 120000000n * 10n ** 6n; // 120000000 USDC (6 decimals)

async function main() {
  console.log('Starting independent token minting script...');

  //获取余额，不依赖于walletClient

  // 1. 输出用户的 Sepolia ETH 余额
  console.log('\n📊 查询用户 ETH 余额...');
  const ethBalance = await publicClient.getBalance({ address: USER_ADDRESS });
  console.log(`💰 用户 (${USER_ADDRESS}) ETH 余额: ${formatEther(ethBalance)} ETH`);

  // 2. 查询用户地址上的 USDC 和 WLTC 余额
  console.log('\n📊 查询用户代币余额...');

  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDCMockArtifact.abi,
    functionName: 'balanceOf',
    args: [USER_ADDRESS],
  }) as bigint;
  console.log(`💵 USDC 余额: ${formatUnits(usdcBalance, 6)} USDC`);

  const wltcBalance = await publicClient.readContract({
    address: WLTC_ADDRESS,
    abi: WLTCMockArtifact.abi,
    functionName: 'balanceOf',
    args: [USER_ADDRESS],
  }) as bigint;
  console.log(`🪙 WLTC 余额: ${formatEther(wltcBalance)} WLTC`);

  // 3. 进行铸币
  console.log('\n🏭 开始铸币...');

  // 铸造 WLTC
  console.log(`铸造 ${formatEther(WLTC_AMOUNT)} WLTC 到 ${USER_ADDRESS}...`);
  const wltcTx = await walletClient.writeContract({
    address: WLTC_ADDRESS,
    abi: WLTCMockArtifact.abi,
    functionName: 'mint',
    args: [USER_ADDRESS, WLTC_AMOUNT],
  });
  console.log(`WLTC 铸币交易哈希: ${wltcTx}`);

  // 铸造 USDC
  console.log(`铸造 ${formatUnits(USDC_AMOUNT, 6)} USDC 到 ${USER_ADDRESS}...`);
  const usdcTx = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: USDCMockArtifact.abi,
    functionName: 'mint',
    args: [USER_ADDRESS, USDC_AMOUNT],
  });
  console.log(`USDC 铸币交易哈希: ${usdcTx}`);

  // 等待交易确认
  console.log('\n⏳ 等待交易确认...');
  await publicClient.waitForTransactionReceipt({ hash: wltcTx });
  await publicClient.waitForTransactionReceipt({ hash: usdcTx });

  console.log('✅ 铸币完成！');
}

main().catch(console.error);
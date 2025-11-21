/*
  独立的铸币脚本：mint_SLtokens_viem.ts
  调用 CustodianFixed 的 mint 函数，给用户铸币 S 和 L token
  执行方法：npx tsx scripts/2_mint_SLtokens_viem.ts
*/

import { createPublicClient, createWalletClient, http, formatEther, formatUnits } from 'viem';
import {getContract } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// 获取当前文件的目录 (ES module 替代 __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 Ignition 生成的 artifacts
const WLTCMockArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#WLTCMock.json'), 'utf8'));
const USDCMockArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#USDCMock.json'), 'utf8'));
const StableTokenArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#StableToken.json'), 'utf8'));
const CustodianFixedArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/coreModules#CustodianFixed.json'), 'utf8'));
// 读取 Ignition 生成的 address 部分
const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/deployed_addresses.json'), "utf-8"));

// 从环境变量获取私钥
const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
if (!privateKey) {
  throw new Error('SEPOLIA_PRIVATE_KEY not found in .env');
}

// 确保私钥以 0x 开头
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

// 合约地址
const WLTC_ADDRESS = deployedAddresses["tokenModules#WLTCMock"];
const USDC_ADDRESS = deployedAddresses["tokenModules#USDCMock"];
const StableToken_ADDRESS = deployedAddresses["tokenModules#StableToken"];
const LeverageToken_ADDRESS = deployedAddresses["tokenModules#LeverageToken"];
const CUSTODIAN_ADDRESS = deployedAddresses["coreModules#CustodianFixed"];
// const USER_ADDRESS = '0x4845d4db01b81A15559b8734D234e6202C556d32' as const;
const USER_ADDRESS = '0x6bCf5fbb6569921c508eeA15fF16b92426F99218' as const;


const WLTC_ABI = WLTCMockArtifact.abi;
const USDC_ABI = USDCMockArtifact.abi;
const StableToken_ABI = StableTokenArtifact.abi;
const CUSTODIAN_ABI = CustodianFixedArtifact.abi;

// LeverageType enum
enum LeverageType {
  CONSERVATIVE = 0,
  MODERATE = 1,
  AGGRESSIVE = 2,
}

// 铸币参数
const MINT_AMOUNT = 10n * 10n ** 18n; 
const MINT_PRICE = 120n * 10n ** 18n; // 铸币价格 120

async function main() {
  console.log('Starting S/L token minting script...');

  // 假设 account.address 是用户地址
  // const userAddress = account.address;
  const userAddress = USER_ADDRESS;
  console.log(`用户地址: ${userAddress}`);


//   // 2. Approve Custodian 使用 WLTC
//   console.log(`\n🔓 Approve Custodian 使用 ${formatEther(MINT_AMOUNT)} WLTC...`);
//   const approveTx = await walletClient.writeContract({
//     address: WLTC_ADDRESS,
//     abi: WLTC_ABI,
//     functionName: 'approve',
//     args: [CUSTODIAN_ADDRESS, MINT_AMOUNT],
//   });
//   console.log(`Approve 交易哈希: ${approveTx}`);

//   // 等待 approve 确认
//   await publicClient.waitForTransactionReceipt({ hash: approveTx });
//   console.log('✅ Approve 完成');

//   // 3. 为每种 leverage 调用 CustodianFixed.mint
//   const leverages = [
//     { type: LeverageType.CONSERVATIVE, name: 'CONSERVATIVE' },
//     { type: LeverageType.MODERATE, name: 'MODERATE' },
//     { type: LeverageType.AGGRESSIVE, name: 'AGGRESSIVE' },
//   ];


//   console.log(`\n🎯 铸造 ${leverages[2].name} L token，使用 ${formatEther(MINT_AMOUNT)} WLTC...`);

// const mintTx = await walletClient.writeContract({
//     address: CUSTODIAN_ADDRESS,
//     abi: CUSTODIAN_ABI,
//     functionName: 'mint',
//     args: [MINT_AMOUNT, MINT_PRICE, leverages[2].type],
// });

// console.log(`${leverages[2].name} 铸币交易哈希: ${mintTx}`);

//     // 等待确认
//   await publicClient.waitForTransactionReceipt({ hash: mintTx });
//   console.log('\n🎉 所有铸币完成！');

//   console.log('\n 检查账户ETH余额...');
//   let balance = await publicClient.getBalance({ address: userAddress });
//   console.log(`💰 用户 (${userAddress}) ETH 余额: ${formatEther(balance)} ETH`);
  
  //====================查询erc20余额方式一：通过publicClient.readContract()====================
  console.log('\n erc20余额方式一：通过publicClient.readContract()');
  const wltcBalance = await publicClient.readContract({
    address: WLTC_ADDRESS as `0x${string}`,
    abi: WLTC_ABI,
    functionName: 'balanceOf',
    args: [userAddress]
  }) as bigint;
  console.log(`💰 用户 (${userAddress}) WLTC 余额: ${formatUnits(wltcBalance, 18)} WLTC`);

  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [userAddress]
  }) as bigint;
  console.log(`💰 用户 (${userAddress}) USDC 余额: ${formatUnits(usdcBalance, 6)} USDC`);

  const stableTokenBalance = await publicClient.readContract({
    address: StableToken_ADDRESS as `0x${string}`,
    abi: StableToken_ABI,
    functionName: 'balanceOf',
    args: [userAddress]
  }) as bigint;
  console.log(`💰 用户 (${userAddress}) SToken 余额: ${formatUnits(stableTokenBalance, 18)} SToken`);

  //====================查询erc20余额方式二：通过getContract()获取合约实例，并调用.read.balanceOf方法获取余额====================

  const wltcReadContract = getContract({ address: WLTC_ADDRESS, abi: WLTC_ABI , client: publicClient});
  const usdcReadContract = getContract({ address: USDC_ADDRESS, abi: USDC_ABI , client: publicClient});
  const stableTokenReadContract = getContract({ address: StableToken_ADDRESS, abi: StableToken_ABI , client: publicClient});

  const wltcBalance2 = await wltcReadContract.read.balanceOf([userAddress]) as bigint;
  const usdcBalance2 = await usdcReadContract.read.balanceOf([userAddress]) as bigint;
  const stableTokenBalance2 = await stableTokenReadContract.read.balanceOf([userAddress]) as bigint;

  console.log('\n erc20余额方式二：通过createContract()或getContract()获取合约实例，并调用getBalance()方法获取余额');
  console.log(`💰 用户 (${userAddress}) WLTC 余额: ${formatUnits(wltcBalance2, 18)} WLTC`);
  console.log(`💰 用户 (${userAddress}) USDC 余额: ${formatUnits(usdcBalance2, 6)} USDC`);
  console.log(`💰 用户 (${userAddress}) SToken 余额: ${formatUnits(stableTokenBalance2, 18)} SToken`);

  // ================= 获取用户所有 Leverage Token 详细信息 =================
  console.log('\n🔎 查询用户所有 Leverage Token 详细信息...');
  try {
    const info = await publicClient.readContract({
      address: CUSTODIAN_ADDRESS,
      abi: CUSTODIAN_ABI,
      functionName: 'getAllLeverageTokenInfo',
      args: [USER_ADDRESS],
    }) as any;

    const tokenIds: bigint[] = info[0] || [];
    const balances: bigint[] = info[1] || [];
    const leverages: number[] = info[2] || [];
    const mintPrices: bigint[] = info[3] || [];
    const accruedInterests: bigint[] = info[4] || [];

    if (tokenIds.length === 0) {
      console.log('📭 用户暂无 Leverage Token 持仓');
    } else {
      console.log(`📊 找到 ${tokenIds.length} 个 Leverage Token:`);
      for (let i = 0; i < tokenIds.length; i++) {
        const id = tokenIds[i].toString();
        const bal = balances[i] ?? 0n;
        const lev = leverages[i] ?? 0;
        const price = mintPrices[i] ?? 0n;
        const interest = accruedInterests[i] ?? 0n;

        const levName = lev === 0 ? 'CONSERVATIVE' : lev === 1 ? 'MODERATE' : 'AGGRESSIVE';

        console.log('\n----------------------------------------');
        console.log(`Token ID: ${id}`);
        console.log(`  Balance: ${formatUnits(bal, 18)} L`);
        console.log(`  Leverage: ${lev} (${levName})`);
        console.log(`  Mint Price (P0): $${formatUnits(price, 18)}`);
        console.log(`  Accrued Interest: ${formatUnits(interest, 18)}`);
      }
    }
  } catch (err: any) {
    console.error('⚠️ 查询 getAllLeverageTokenInfo 失败:', err?.message ?? err);
  }
}

main().catch(console.error);

/**
 * 详细检查 Pool 的 token 余额和状态
 */

import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
dotenv.config();

const POOL_ADDRESS = '0xd1CFdAb73eF0345F437a9c33acF179BB55633094';
const USDC = '0x587cE1C25CED93c7d61A9826CaE407d70Ac82Aa3';
const WLTC = '0x9e6B5F70Fe9f741702d6ed2fFcC534a35740E14a';

async function main() {
  const pub = createPublicClient({ 
    chain: sepolia, 
    transport: http(process.env.SEPOLIA_RPC_URL) 
  });

  console.log('\n=== Pool 余额详细检查 ===\n');

  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);

  const [usdcBalance, wltcBalance] = await Promise.all([
    pub.readContract({ address: USDC as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [POOL_ADDRESS] }),
    pub.readContract({ address: WLTC as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [POOL_ADDRESS] }),
  ]);

  console.log('USDC in Pool:', formatUnits(usdcBalance as bigint, 6));
  console.log('WLTC in Pool:', formatUnits(wltcBalance as bigint, 18));

  // 计算理论价格
  const price = Number(formatUnits(usdcBalance as bigint, 6)) / Number(formatUnits(wltcBalance as bigint, 18));
  console.log('\n简单比例价格:', price.toFixed(2), 'USDC per WLTC');

  // 检查如果卖 1 WLTC，应该得到多少 USDC
  const wltcToSell = 1;
  const expectedUsdc = wltcToSell * price * 0.997; // 减去 0.3% 手续费
  console.log('\n理论上卖出 1 WLTC 应得:', expectedUsdc.toFixed(2), 'USDC');
  console.log('Pool 是否有足够 USDC:', expectedUsdc < Number(formatUnits(usdcBalance as bigint, 6)) ? '✅' : '❌');

  // 检查 Pool 的 slot0
  const poolAbi = parseAbi([
    'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  ]);

  const slot0 = await pub.readContract({
    address: POOL_ADDRESS as `0x${string}`,
    abi: poolAbi,
    functionName: 'slot0'
  }) as readonly [bigint, number, number, number, number, number, boolean];

  console.log('\n=== Pool slot0 ===');
  console.log('sqrtPriceX96:', slot0[0].toString());
  console.log('tick:', slot0[1]);
  console.log('observationIndex:', slot0[2]);
  console.log('observationCardinality:', slot0[3]);
  console.log('observationCardinalityNext:', slot0[4]);
  console.log('feeProtocol:', slot0[5]);
  console.log('unlocked:', slot0[6], slot0[6] ? '✅' : '❌ LOCKED!');

  if (!slot0[6]) {
    console.log('\n⚠️  Pool 被锁定了！这可能是问题所在！');
  }

  // 尝试读取 liquidity
  const liquidityAbi = parseAbi([
    'function liquidity() view returns (uint128)',
  ]);

  const liquidity = await pub.readContract({
    address: POOL_ADDRESS as `0x${string}`,
    abi: liquidityAbi,
    functionName: 'liquidity'
  });

  console.log('\n=== Liquidity ===');
  console.log('Current liquidity:', liquidity.toString());

  if (liquidity === 0n) {
    console.log('❌ Pool 没有流动性！');
  } else {
    console.log('✅ Pool 有流动性');
  }
}

main().catch(console.error);

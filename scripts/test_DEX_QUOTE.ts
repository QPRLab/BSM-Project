import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createPublicClient, http, getContract, formatUnits,encodePacked } from 'viem';
import { sepolia } from 'viem/chains';
import { Address } from 'cluster';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/deployed_addresses.json'), 'utf8'));

const QUOTER_ADDRESS = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3' as const;
const POOL_ADDRESS = '0xCa250B562Beb3Be4fC75e79826390F9f14c622d0' as const;
const UNIVERSAL_ROUTER = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b' as const;
const WLTC = deployedAddresses['tokenModules#WLTCMock'] as string | undefined;
const USDC = deployedAddresses['tokenModules#USDCMock'] as string | undefined;
const fee = 3000; // 0.3% fee
const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

// helper to encode path: tokenIn(20)+fee(3)+tokenOut(20) — encodePacked-like
function encodePath(tokenA: string, fee: number, tokenB: string) {
    // simple concat: not full abi.encodePacked but works for raw bytes output expected by routers
    const trim0x = (s: string) => s.toLowerCase().replace(/^0x/, '');
    const feeHex = fee.toString(16).padStart(6, '0');
    return '0x' + trim0x(tokenA) + feeHex + trim0x(tokenB);
}
async function main() {
  console.log('🧭 Running DEX Quoter check');

  // Quoter ABI (Uniswap V3 style quoter: quoteExactInputSingle)
  const quoterAbi = [
    { inputs: [ { name: 'path', type: 'bytes' }, { name: 'amountIn', type: 'uint256' } ], name: 'quoteExactInput', outputs: [{ name: 'amountOut', type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [ { name: 'path', type: 'bytes' }, { name: 'amountOut', type: 'uint256' } ], name: 'quoteExactOutput', outputs: [{ name: 'amountIn', type: 'uint256' }], stateMutability: 'view', type: 'function' }
  ] as const;
  const quoter = getContract({ address: QUOTER_ADDRESS, abi: quoterAbi as any, client: publicClient });

  console.log('\n=== Running quoteExactInput for 1 WLTC and 1 USDC ===');
  {
    const amountInWltc = 100n * 10n ** 18n; // 1 WLTC
    const amountInUsdc = 12000n * 10n ** 6n; // 1 USDC
    // encode forward path for exactInput: tokenIn|fee|tokenOut
    const encodePathExactIn = (tokenIn: string, fee: number, tokenOut: string) => encodePath(tokenIn, fee, tokenOut);//encodePath总是确定量的地址放前面

    const pathWltcToUsdc = encodePathExactIn(WLTC as string, fee, USDC as string);
    const AmoutOutUsdc = await quoter.read.quoteExactInput([pathWltcToUsdc as `0x${string}`, amountInWltc]);
    console.log(`100 WLTC -> ${formatUnits(AmoutOutUsdc as bigint, 6)} USDC`);

    const pathUsdcToWltc = encodePathExactIn(USDC as string, fee, WLTC as string);
    const AmoutOutWltc = await quoter.read.quoteExactInput([pathUsdcToWltc as `0x${string}`, amountInUsdc]);
    console.log(`12000 USDC -> ${formatUnits(AmoutOutWltc as bigint, 18)} WLTC`);  
  }

  console.log('\n=== Running quoteExactOutput for 1 WLTC and 1 USDC ===');
  {
    const amountOutWltc = 100n * 10n ** 18n; // 1 WLTC
    const amountOutUsdc = 12000n * 10n ** 6n; // 1 USDC
    // encode reverse path for exactOutput: tokenOut|fee|tokenIn
    const encodePathExactOut = (tokenOut: string, fee: number, tokenIn: string) => encodePath(tokenOut, fee, tokenIn); //encodePath总是确定量的地址放前面

    const pathWltcToUsdc = encodePathExactOut(USDC as string, fee, WLTC as string);//swap 确定数量的USDC
    const AmoutInWltc = await quoter.read.quoteExactOutput([pathWltcToUsdc as `0x${string}`, amountOutUsdc]);
    console.log(`${formatUnits(AmoutInWltc as bigint, 18)} WLT -> 12000 USDC`);  
    

    const pathUsdcToWltc = encodePathExactOut(WLTC as string, fee, USDC as string);
    const AmoutInUsdc = await quoter.read.quoteExactOutput([pathUsdcToWltc as `0x${string}`, amountOutWltc]);
    console.log(`${formatUnits(AmoutInUsdc as bigint, 6)} USDC -> 100 WLTC`);
  }

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

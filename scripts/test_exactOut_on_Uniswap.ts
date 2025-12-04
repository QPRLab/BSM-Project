/* 
 * 运行：npx tsx scripts/test_uniswap.ts
 * 测试 USDC -> Leverage 交易（DEX购买WLTC + 铸币 + AMM卖Stable）
 */

import { createPublicClient, createWalletClient, http, formatEther, formatUnits, getContract, encodePacked, decodeAbiParameters
  ,encodeAbiParameters, parseAbiParameters, decodeFunctionData ,parseUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { add } from 'date-fns';
dotenv.config();

// 创建client
const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
if (!privateKey) throw new Error('SEPOLIA_PRIVATE_KEY not found in .env');
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

const UNIVERSAL_ROUTER_ADDRESS = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b' as const;// Universal Router 地址
const QUOTER_ADDRESS = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3' as const;//报价合约地址
const WLTC_ADDRESS = '0x75B8CDe44E33135E6A08a59A23fC1e244A762501' as const;// WLTC 地址
const USDC_ADDRESS = '0x790fB0d2b3EDd1962A58d8F6095F3508c017E742' as const;// USDC 地址
// const STABLE_ADDRESS = '0x90CB2dac5A4c16C5bee95e27685f79F1AE61a2C6' as const; // Stable Token 地址
// Permit2 contract address provided by user
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
const USER_ADDRESS = account.address as `0x${string}`;
console.log(`User address: ${USER_ADDRESS}`);

//-------------------------------------基于address和abi创建合约实例-------------------------------------//
// Quoter ABI (Uniswap V3 style quoter: quoteExactInputSingle)
const quoterAbi = [
  { inputs: [ { name: 'path', type: 'bytes' }, { name: 'amountIn', type: 'uint256' } ], name: 'quoteExactInput', outputs: [{ name: 'amountOut', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [ { name: 'path', type: 'bytes' }, { name: 'amountOut', type: 'uint256' } ], name: 'quoteExactOutput', outputs: [{ name: 'amountIn', type: 'uint256' }], stateMutability: 'view', type: 'function' }
] as const;
const quoter = getContract({ address: QUOTER_ADDRESS, abi: quoterAbi as any, client: publicClient });

const universalRouterAbi = [
  {"inputs": [{"name": "commands", "type": "bytes"},{"name": "inputs", "type": "bytes[]"},{"name": "deadline", "type": "uint256"}],"name": "execute","outputs": [],"stateMutability": "payable","type": "function"}
] as const;
const universalRouter = getContract({ address: UNIVERSAL_ROUTER_ADDRESS, abi: universalRouterAbi, client: walletClient });

//仅需要ERC20的approve, balanceOf, allowance函数
const erc20Abi = [
  { inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }
]
const wltcContract = getContract({ address: WLTC_ADDRESS, abi: erc20Abi, client: walletClient });
const usdcContract = getContract({ address: USDC_ADDRESS, abi: erc20Abi, client: walletClient });
// Permit2 ABI (include owner param) — try calling permit(owner, permit, signature)
const permit2Abi = [
  {
    name: 'permit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      {
        name: 'permitSingle',
        type: 'tuple',
        components: [
          {
            name: 'details',
            type: 'tuple',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint160' },
              { name: 'expiration', type: 'uint48' },
              { name: 'nonce', type: 'uint48' },
            ],
          },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
   {
    "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      { "internalType": "address", "name": "token", "type": "address" }
    ],
    "name": "nonce",
    "outputs": [
      { "internalType": "uint48", "name": "", "type": "uint48" }
    ],
    "stateMutability": "view",
    "type": "function"
  },

] as const;
const permit2Contract = getContract({ address: PERMIT2_ADDRESS, abi: permit2Abi as any, client: walletClient });


//-------------------------------------辅助函数-------------------------------------//
// helper to encode path: tokenIn(20)+fee(3)+tokenOut(20) — encodePacked-like
function encodePath(tokenA: string, fee: number, tokenB: string) {
    // simple concat: not full abi.encodePacked but works for raw bytes output expected by routers
    const trim0x = (s: string) => s.toLowerCase().replace(/^0x/, '');
    const feeHex = fee.toString(16).padStart(6, '0');
    return '0x' + trim0x(tokenA) + feeHex + trim0x(tokenB);
}
const encodePathExactOut = (tokenOut: string, fee: number, tokenIn: string) => encodePath(tokenOut, fee, tokenIn); //encodePath总是确定量的地址放前面
const fee = 3000; // 0.3%

// 1. 构造 PermitTransferFrom 签名
async function buildPermitTransferSignature(amountInMax: bigint) {
  const chainId = sepolia.id
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)  as bigint;

  const domain = {
    name: 'Permit2',
    chainId,
    verifyingContract: PERMIT2_ADDRESS,
  }

  const types = {
    PermitTransferFrom: [
      { name: 'permitted', type: 'TokenPermissions' },
      { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    TokenPermissions: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  }

  const values = {
    permitted: { token: USDC_ADDRESS, amount: amountInMax },
    spender: UNIVERSAL_ROUTER_ADDRESS,
    nonce: 0n,
    deadline: deadline,
  }

  const signature = await walletClient.signTypedData({
    domain,
    types,
    primaryType: 'PermitTransferFrom',
    message: values,
  })

  return { signature, values, deadline }
}

// 1. 构造 PermitSingle 签名
async function buildPermitSignature(amountIn: bigint) {
      console.log('PERMIT2_ADDRESS:', PERMIT2_ADDRESS);
console.log('USER_ADDRESS:', USER_ADDRESS);
console.log('USDC_ADDRESS:', USDC_ADDRESS);
  const chainId = sepolia.id
  const deadline = Math.floor(Date.now() / 1000) + 3600 // 秒级时间戳
  // const nonce = 0
  const nonce = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: 'nonce',
    args: [USER_ADDRESS, USDC_ADDRESS],
  });
  console.log('nonce:', nonce);
  const domain = {
    name: 'Permit2',
    chainId,
    verifyingContract: PERMIT2_ADDRESS,
  }

  const types = {
    PermitSingle: [
      { name: 'details', type: 'PermitDetails' },
      { name: 'spender', type: 'address' },
      { name: 'sigDeadline', type: 'uint256' },
    ],
    PermitDetails: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  }

  const values = {
    details: {
      token: USDC_ADDRESS,
      amount: Number(amountIn),   // ✅ uint160
      expiration: deadline,       // ✅ uint48
      nonce,                      // ✅ uint48
    },
    spender: UNIVERSAL_ROUTER_ADDRESS,
    sigDeadline: deadline,
  }

  const signature = await walletClient.signTypedData({
    domain,
    types,
    primaryType: 'PermitSingle',
    message: values,
  })

  return { signature, values, deadline }
}


// 1. swap input
const swapAbiParams = parseAbiParameters(
  'address recipient, uint256 amountOut, uint256 amountInMaximum, bytes path'
);
function buildSwapInput(
  recipient: `0x${string}`,
  amountOut: bigint,
  amountInMaximum: bigint,
  path: `0x${string}`
): `0x${string}` {
  return encodeAbiParameters(swapAbiParams, [
    recipient,
    amountOut,
    amountInMaximum,
    path,
  ]);
}

// 2. sweep/unwrap input
const sweepAbiParams = parseAbiParameters(
  'address token, address recipient, uint256 amount'
);
function buildSweepOrUnwrapInput(
  token: `0x${string}`,
  recipient: `0x${string}`,
  amount: bigint
): `0x${string}` {
  return encodeAbiParameters(sweepAbiParams, [
    token,
    recipient,
    amount,
  ]);
}

//-------------------------------------主流程-------------------------------------//
async function main() {

    console.log("🔄 ===== test use USDC to buy WLTC =====\n");
    const usdcBalanceStart = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
    const wltcBalanceBefore = await wltcContract.read.balanceOf([USER_ADDRESS]) as bigint;    

    //目标：需要购买的Leverage数量及参数
    const LAmountDesired = 10n * 10n ** 18n;
    const leverageType = 2n as bigint; // AGGRESSIVE
    const mintPrice = 120n * 10n ** 18n;


    try {

      console.log("📤 step 1: 资产初始计算:");
      let wltcExact: bigint //精确的WLTC数量
      let stableRequired: bigint // WLTC拆分出的Stable 数量
      if (leverageType === 0n) { // Conservative
        stableRequired = LAmountDesired / 8n
        wltcExact = (9n * stableRequired * 10n ** 18n) / mintPrice;//mintPrice is in 1e18
      } else if (leverageType === 1n) { // Moderate
        stableRequired = LAmountDesired / 4n
        wltcExact = (5n * stableRequired * 10n ** 18n) / mintPrice;//mintPrice is in 1e18
      } else { // Aggressive
        stableRequired = LAmountDesired
        wltcExact = (2n * stableRequired * 10n ** 18n) / mintPrice;//mintPrice is in 1e18
      }
      // 向上取整到5位小数: ceil(value / 10^13) * 10^13, 以保证有足够的WLTC用于铸造
      const wltcNeeded = ((wltcExact + 10n ** 13n - 1n) / (10n ** 13n)) * (10n ** 13n);//18位
      console.log(`  需从DEX购买 WLTC数量: ${formatEther(wltcNeeded)} (向上取整至5位小数)`); 
      console.log(`  将铸造 Stable数量: ${formatEther(stableRequired)}`);
      console.log(`  将铸造 Leverage数量: ${formatEther(LAmountDesired)}\n`);

      

      console.log("📤 step 2: 计算需要USDC数量:");
      const pathUsdcToWltc = encodePathExactOut(WLTC_ADDRESS as string, fee, USDC_ADDRESS as string);
      const AmountInUsdc = await quoter.read.quoteExactOutput([pathUsdcToWltc as `0x${string}`, wltcNeeded]) as bigint; // 6 decimals (USDC)
      console.log(`  根据UniSwap Quoter, 需要 USDC: ${formatUnits(AmountInUsdc as bigint, 6)}\n`);
      
      console.log("📤 step 3: 最大支出USDC: +5%滑点 & 无限授权:");
      // 添加5% slippage buffer (使用整数运算以保持 bigint 精度)
      // 使用向上取整：ceil(AmountInUsdc * 105 / 100) = (AmountInUsdc*105 + 99) / 100
      const slippageNumerator = 105n;
      const slippageDenominator = 100n;
      const AmountInUsdcWithSlippage = (AmountInUsdc * slippageNumerator + slippageDenominator - 1n) / slippageDenominator;
      console.log(`  根据滑点, 最多愿意支付需要 USDC: ${formatUnits(AmountInUsdcWithSlippage, 6)}`);
      
      //无限授权
      const AmountInUsdcApproved = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      // const AmountInUsdcApproved = 2n ** 256n - 1n;
      const txHash0 = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [
          PERMIT2_ADDRESS, // Permit2 地址
          AmountInUsdcApproved, // 授权额度（BigInt，单位为 USDC 的最小单位）
        ],
      });
      console.log("  Approve tx hash:", txHash0);
      const allowance = await usdcContract.read.allowance([USER_ADDRESS, PERMIT2_ADDRESS]) as bigint;
      console.log(`  已授权给 Permit2 的 USDC 额度: ${formatUnits(allowance, 6)}\n`);

      console.log("📤 step 4: 构造参数(0x010504)并发送交易");
      // 4. 构造并发送交易
      //参数一：commands
      // 0x01 = V3 exactOut swap
      // 0x05 = Sweep
      // 0x04 = Unwrap
      // 顺序执行
      const commands = "0x010504";
      const path = encodePacked(['address', 'uint24', 'address'], [WLTC_ADDRESS, fee, USDC_ADDRESS]);
      const add1 = '0x0000000000000000000000000000000000000002'; // recipient address (2 for user)
      // swap input
      const swapInput = buildSwapInput(
        add1 as `0x${string}`,
        wltcNeeded,
        AmountInUsdcWithSlippage,
        path
      );
      // sweep input（假设 sweep 剩余的 WLTC，数量可根据实际情况调整）
      const add2 = '0xE49ACc3B16c097ec88Dc9352CE4Cd57aB7e35B95';
      const sweepInput = buildSweepOrUnwrapInput(
        WLTC_ADDRESS,
        add2 as `0x${string}`,
        0n // 如果你不确定数量，可以填0n，合约会 sweep 全部
      );
      // unwrap input（如果 WLTC 是包裹币，否则可省略）
      const unwrapInput = buildSweepOrUnwrapInput(
        WLTC_ADDRESS,
        USER_ADDRESS,
        wltcNeeded
      );
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
      // 组合 inputs
      const inputs = [swapInput, sweepInput, unwrapInput];


      // console.log("\n--- 解码execute是否正确(包含commands, inputs, deadline) ---");
      // const abi = [
      // {
      //   type: 'function',
      //   name: 'execute',
      //   stateMutability: 'payable',
      //   inputs: [
      //     { name: 'commands', type: 'bytes' },
      //     { name: 'inputs', type: 'bytes[]' },
      //     { name: 'deadline', type: 'uint256' },
      //   ],
      //   outputs: [],
      // },
      // ] as const;

      // const data = '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000069316776000000000000000000000000000000000000000000000000000000000000000301050400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de998704354400000000000000000000000000000000000000000000000000000000000072ffd9800000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b75b8cde44e33135e6a08a59a23fc1e244a762501000bb8790fb0d2b3edd1962a58d8f6095f3508c017e742000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000075b8cde44e33135e6a08a59a23fc1e244a762501000000000000000000000000e49acc3b16c097ec88dc9352ce4cd57ab7e35b950000000000000000000000000000000000000000000000000008e1bc9bf04000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000075b8cde44e33135e6a08a59a23fc1e244a7625010000000000000000000000006bdb7c080fd5393fc96e7c8c9f6320a83b5138740000000000000000000000000000000000000000000000000de0b6b3a7640000756e697800000000000c'
      // // const data = '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000693161f6000000000000000000000000000000000000000000000000000000000000000301050400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de998704354400000000000000000000000000000000000000000000000000000000000072ffa7400000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b75b8cde44e33135e6a08a59a23fc1e244a762501000bb8790fb0d2b3edd1962a58d8f6095f3508c017e742000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000075b8cde44e33135e6a08a59a23fc1e244a762501000000000000000000000000e49acc3b16c097ec88dc9352ce4cd57ab7e35b950000000000000000000000000000000000000000000000000008e1bc9bf04000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000075b8cde44e33135e6a08a59a23fc1e244a7625010000000000000000000000000f4d9b55a1bbd0aa8e9c55ea1442dce69b1e226b0000000000000000000000000000000000000000000000000de0b6b3a76400000c'
      // const decoded = decodeFunctionData({
      //   abi,
      //   data,
      // });
      // console.log(decoded.functionName);       // 'execute'
      // console.log(decoded.args[0]);            // commands: 0x010504...
      // console.log(decoded.args[1]);            // inputs: ['0x...', '0x...', ...]
      // console.log(decoded.args[2]);            // deadline: BigInt(...)
      // const inputs = decoded.args[1];

      console.log("\n--- 解码inputs参数是否正确 ---");
      // 解码查看参数
      const swapAbi = parseAbiParameters('address recipient, uint256 amountOut, uint256 amountInMaximum, bytes path');
      const swapDecoded = decodeAbiParameters(swapAbi, inputs[0] as `0x${string}`);
      console.log('swapDecoded', swapDecoded);
      const sweepAbi = parseAbiParameters('address token, address recipient, uint256 amount');
      const sweepDecoded = decodeAbiParameters(sweepAbi, inputs[1] as `0x${string}`);
      console.log('sweepDecoded', sweepDecoded);    
      const unwrapDecoded = decodeAbiParameters(sweepAbi, inputs[2] as `0x${string}`);
      console.log('unwrapDecoded', unwrapDecoded);

      const txHash = await walletClient.writeContract({
        address: UNIVERSAL_ROUTER_ADDRESS,
        abi: universalRouterAbi,
        functionName: 'execute',
        args: [
          commands,
          inputs as `0x${string}`[],
          deadline,
        ],
      });
      console.log("  Swap tx hash:", txHash);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("✅ 交易成功!\n");

      // 5. 结果验证
      const usdcBalanceEnd = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const wltcBalanceAfter = await wltcContract.read.balanceOf([USER_ADDRESS]) as bigint;    
      console.log("📊 结果验证:");
      console.log(`  USDC 花费: ${formatUnits(usdcBalanceStart - usdcBalanceEnd, 6)} USDC`);
      console.log(`  WLTC 获得: ${formatEther(wltcBalanceAfter - wltcBalanceBefore)} WLTC (应为: ${formatEther(wltcNeeded)} WLTC)`);

   
      
    } catch (error: any) {
      console.error(`❌ 交易失败: ${error.shortMessage || error.message}`);
    }
    

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 测试失败:", error);
    process.exit(1);
  });

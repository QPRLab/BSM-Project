import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, encodePacked, encodeAbiParameters, parseAbiParameters } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { UniversalRouterABI, UniversalRouterCommands, ERC20ABI, UniswapV3PoolABI } from '../abis/index.js';
dotenv.config();

const UNIVERSAL_ROUTER = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b';
const POOL_ADDRESS = '0xCa250B562Beb3Be4fC75e79826390F9f14c622d0';
const USDC_ADDRESS = '0x790fB0d2b3EDd1962A58d8F6095F3508c017E742';
const WLTC_ADDRESS = '0x75B8CDe44E33135E6A08a59A23fC1e244A762501';
const SLIPPAGE = 5;

async function getCurrentPrice(pub: any) {
  const slot0 = await pub.readContract({ address: POOL_ADDRESS, abi: UniswapV3PoolABI, functionName: 'slot0' }) as any;
  return Math.pow(1.0001, Number(slot0[1])) * Math.pow(10, 18 - 6);
}

async function checkBalance(pub: any, token: string, account: string, decimals: number) {
  const bal = await pub.readContract({ address: token as `0x${string}`, abi: ERC20ABI, functionName: 'balanceOf', args: [account] }) as bigint;
  return formatUnits(bal, decimals);
}

async function checkApproval(pub: any, token: string, account: string, decimals: number) {
  const allowance = await pub.readContract({ address: token as `0x${string}`, abi: ERC20ABI, functionName: 'allowance', args: [account, UNIVERSAL_ROUTER] }) as bigint;
  return formatUnits(allowance, decimals);
}

async function approveToken(wallet: any, pub: any, token: string, spender: string, amount: bigint) {
  console.log('📝 批准代币...');
  const tx = await wallet.writeContract({ address: token as `0x${string}`, abi: ERC20ABI, functionName: 'approve', args: [spender, amount] });
  await pub.waitForTransactionReceipt({ hash: tx });
  console.log('✅ 批准完成');
}

async function executeSwap(wallet: any, pub: any, account: any, direction: 'USDC_TO_WLTC' | 'WLTC_TO_USDC', amountIn: string, amountOutMin: string, deadline: bigint) {
  const isUsdcToWltc = direction === 'USDC_TO_WLTC';
  const tokenIn = isUsdcToWltc ? USDC_ADDRESS : WLTC_ADDRESS;
  const tokenOut = isUsdcToWltc ? WLTC_ADDRESS : USDC_ADDRESS;
  const decimalsIn = isUsdcToWltc ? 6 : 18;
  const decimalsOut = isUsdcToWltc ? 18 : 6;

  const path = encodePacked(['address', 'uint24', 'address'], [tokenIn as `0x${string}`, 3000, tokenOut as `0x${string}`]);
  const inputs = [encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [account.address, parseUnits(amountIn, decimalsIn), parseUnits(amountOutMin, decimalsOut), path, true])];

  console.log('🔄 执行交易...');
  const tx = await wallet.writeContract({ address: UNIVERSAL_ROUTER, abi: UniversalRouterABI, functionName: 'execute', args: [UniversalRouterCommands.V3_SWAP_EXACT_IN, inputs, deadline] });
  console.log('交易哈希:', tx);
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  return receipt.status === 'success';
}

/**
 * 执行 EXACT_OUTPUT 交易：买入精确数量的输出代币
 * @param wallet - 钱包客户端
 * @param pub - 公共客户端
 * @param account - 账户
 * @param direction - 交易方向
 * @param amountOut - 精确的输出数量（想要得到多少）
 * @param amountInMax - 最大输入数量（最多愿意支付多少）
 * @param deadline - 截止时间
 */
async function executeSwapExactOutput(wallet: any, pub: any, account: any, direction: 'USDC_TO_WLTC' | 'WLTC_TO_USDC', amountOut: string, amountInMax: string, deadline: bigint) {
  const isUsdcToWltc = direction === 'USDC_TO_WLTC';
  const tokenIn = isUsdcToWltc ? USDC_ADDRESS : WLTC_ADDRESS;
  const tokenOut = isUsdcToWltc ? WLTC_ADDRESS : USDC_ADDRESS;
  const decimalsIn = isUsdcToWltc ? 6 : 18;
  const decimalsOut = isUsdcToWltc ? 18 : 6;

  // const wl
  // const { encodePacked, encodeAbiParameters, parseAbiParameters } = await import('viem')
  // const path = encodePacked(['address', 'uint24', 'address'], [WLTC_ADDRESS as `0x${string}`, 3000, USDC_ADDRESS as `0x${string}`])
  // const swapInput = encodeAbiParameters(
  //   parseAbiParameters('address, uint256, uint256, bytes, bool'),
  //   [wallet.account as `0x${string}`, wltcNeeded, maxUsdcForWltc, path, true]
  // )

  // ⚠️ 重要：EXACT_OUTPUT 的 path 是反向的（tokenOut -> fee -> tokenIn）
  const path = encodePacked(['address', 'uint24', 'address'], [tokenOut as `0x${string}`, 3000, tokenIn as `0x${string}`]);
  console.log('path:', path);
  // V3_SWAP_EXACT_OUT 参数: (address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser)
  const inputs = [encodeAbiParameters(
    parseAbiParameters('address, uint256, uint256, bytes, bool'), 
    [account.address, parseUnits(amountOut, decimalsOut), parseUnits(amountInMax, decimalsIn), path, true]
  )];

  console.log('🔄 执行 EXACT_OUTPUT 交易...');
  console.log(`  想要得到: ${amountOut} ${isUsdcToWltc ? 'WLTC' : 'USDC'}`);
  console.log(`  最多支付: ${amountInMax} ${isUsdcToWltc ? 'USDC' : 'WLTC'}`);
  
  const universalRouterAbi = [{"inputs": [{"name": "commands", "type": "bytes"},{"name": "inputs", "type": "bytes[]"},{"name": "deadline", "type": "uint256"}],"name": "execute","outputs": [],"stateMutability": "payable","type": "function"}] as const
  const tx = await wallet.writeContract({ 
    address: UNIVERSAL_ROUTER, 
    abi: universalRouterAbi, 
    functionName: 'execute', 
    args: [UniversalRouterCommands.V3_SWAP_EXACT_OUT, inputs, deadline] 
  });
  console.log('交易哈希:', tx);
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  return receipt.status === 'success';
}

/**
 * 从智能合约调用 UniversalRouter (测试合约调用场景)
 */
async function executeSwapFromContract(
  wallet: any, 
  pub: any, 
  testerContract: any,
  direction: 'USDC_TO_WLTC' | 'WLTC_TO_USDC', 
  amountOut: string, 
  amountInMax: string, 
  deadline: bigint
) {
  const isUsdcToWltc = direction === 'USDC_TO_WLTC';
  const tokenIn = isUsdcToWltc ? USDC_ADDRESS : WLTC_ADDRESS;
  const tokenOut = isUsdcToWltc ? WLTC_ADDRESS : USDC_ADDRESS;
  const decimalsIn = isUsdcToWltc ? 6 : 18;
  const decimalsOut = isUsdcToWltc ? 18 : 6;

  // EXACT_OUTPUT 的 path 是反向的
  const path = encodePacked(['address', 'uint24', 'address'], [tokenOut as `0x${string}`, 3000, tokenIn as `0x${string}`]);
  
  // 参数: (address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser)
  // ⚠️ recipient 改为合约地址
  const inputs = [encodeAbiParameters(
    parseAbiParameters('address, uint256, uint256, bytes, bool'), 
    [testerContract.address, parseUnits(amountOut, decimalsOut), parseUnits(amountInMax, decimalsIn), path, true]
  )];

  console.log('🔄 从智能合约执行 EXACT_OUTPUT 交易...');
  console.log(`  合约地址: ${testerContract.address}`);
  console.log(`  想要得到: ${amountOut} ${isUsdcToWltc ? 'WLTC' : 'USDC'}`);
  console.log(`  最多支付: ${amountInMax} ${isUsdcToWltc ? 'USDC' : 'WLTC'}`);
  
  // 构造命令和输入
  const commands = UniversalRouterCommands.V3_SWAP_EXACT_OUT;
  const approveAmount = parseUnits(amountInMax, decimalsIn);
  
  try {
    const tx = await testerContract.write.executeSwapFromContract([
      UNIVERSAL_ROUTER,
      tokenIn,
      approveAmount,
      commands,
      inputs,
      deadline
    ]);
    console.log('交易哈希:', tx);
    const receipt = await pub.waitForTransactionReceipt({ hash: tx });
    return receipt.status === 'success';
  } catch (error: any) {
    console.error('❌ 合约调用失败:', error.shortMessage || error.message);
    if (error.message.includes('Panic')) {
      console.error('⚠️ 检测到 Panic 错误 - 这证明了从合约调用 UniversalRouter 存在问题！');
    }
    throw error;
  }
}

async function main() {
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (!privateKey) throw new Error('SEPOLIA_PRIVATE_KEY not found');
  
  const account = privateKeyToAccount((privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`);
  const pub = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

  // console.log('═'.repeat(80));
  // console.log('🔄 Uniswap V3 交易 - EOA vs 合约调用对比测试');
  // console.log('═'.repeat(80));
  // console.log('\n账户:', account.address);

  const currentPrice = await getCurrentPrice(pub);
  const wltcPrice = currentPrice;
  console.log(`\n📊 当前价格: 1 WLTC = ${wltcPrice.toFixed(2)} USDC`);

  const initialUsdc = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
  const initialWltc = await checkBalance(pub, WLTC_ADDRESS, account.address, 18);
  console.log('\n💰 初始余额:');
  console.log(`  USDC: ${initialUsdc}`);
  console.log(`  WLTC: ${initialWltc}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  // // ============ 新增：部署测试合约并测试合约调用 ============
  // console.log('\n' + '━'.repeat(80));
  // console.log('🧪 测试从智能合约调用 UniversalRouter');
  // console.log('━'.repeat(80));
  
  // console.log('\n📝 部署 UniversalRouterTester 合约...');
  // const testerContractAbi = [
  //   {
  //     "inputs": [],
  //     "stateMutability": "nonpayable",
  //     "type": "constructor"
  //   },
  //   {
  //     "inputs": [{ "name": "token", "type": "address" }, { "name": "amount", "type": "uint256" }],
  //     "name": "depositToken",
  //     "outputs": [],
  //     "stateMutability": "nonpayable",
  //     "type": "function"
  //   },
  //   {
  //     "inputs": [
  //       { "name": "router", "type": "address" },
  //       { "name": "tokenIn", "type": "address" },
  //       { "name": "approveAmount", "type": "uint256" },
  //       { "name": "commands", "type": "bytes" },
  //       { "name": "inputs", "type": "bytes[]" },
  //       { "name": "deadline", "type": "uint256" }
  //     ],
  //     "name": "executeSwapFromContract",
  //     "outputs": [],
  //     "stateMutability": "nonpayable",
  //     "type": "function"
  //   },
  //   {
  //     "inputs": [{ "name": "token", "type": "address" }],
  //     "name": "getBalance",
  //     "outputs": [{ "name": "", "type": "uint256" }],
  //     "stateMutability": "view",
  //     "type": "function"
  //   }
  // ] as const;
  
  // // 部署合约的字节码 (需要先编译合约)
  // console.log('⚠️ 注意：需要先编译 UniversalRouterTester.sol');
  // console.log('运行: npx hardhat compile');
  // console.log('\n由于需要编译合约，这里跳过合约测试部分。');
  // console.log('如果你想测试合约调用，请：');
  // console.log('1. 运行 npx hardhat compile');
  // console.log('2. 手动部署 UniversalRouterTester 合约');
  // console.log('3. 取消下面代码的注释并填入合约地址\n');
  

  // // 🧪 测试从合约调用 UniversalRouter
  // const TESTER_CONTRACT_ADDRESS = '0x23262099724da48fce99abd1326621e6d37a1e31';
  // const testerContract = {
  //   address: TESTER_CONTRACT_ADDRESS,
  //   abi: testerContractAbi,
  //   write: {
  //     executeSwapFromContract: async (args: any) => {
  //       return wallet.writeContract({
  //         address: TESTER_CONTRACT_ADDRESS as `0x${string}`,
  //         abi: testerContractAbi,
  //         functionName: 'executeSwapFromContract',
  //         args
  //       });
  //     }
  //   }
  // };
  
  // // 测试从合约调用 EXACT_OUTPUT
  // const wltcToTest = 1;
  // const maxUsdcTest = wltcToTest * wltcPrice * 1.1;
  
  // console.log('\n' + '━'.repeat(80));
  // console.log('🧪 测试：从智能合约调用 UniversalRouter EXACT_OUTPUT');
  // console.log(`合约地址: ${TESTER_CONTRACT_ADDRESS}`);
  // console.log(`尝试购买: ${wltcToTest} WLTC, 最多支付: ${maxUsdcTest.toFixed(2)} USDC`);
  // console.log(`payerIsUser: true (这是导致问题的关键参数)`);
  
  // try {
  //   await executeSwapFromContract(
  //     wallet, 
  //     pub, 
  //     testerContract, 
  //     'USDC_TO_WLTC', 
  //     wltcToTest.toString(), 
  //     maxUsdcTest.toFixed(6), 
  //     deadline
  //   );
  //   console.log('✅ 合约调用成功！（意外）');
  // } catch (error: any) {
  //   console.error('❌ 合约调用失败（预期结果）');
  //   console.error('错误:', error.shortMessage || error.message);
    
  //   if (error.message.includes('Panic') || error.message.includes('0x0') || error.message.includes('reverted')) {
  //     console.log('\n' + '═'.repeat(80));
  //     console.log('💡 结论：从智能合约调用 UniversalRouter EXACT_OUTPUT 确实失败！');
  //     console.log('═'.repeat(80));
  //     console.log('✅ 从 EOA 调用: 成功 (trade_withUniswap.ts 操作1)');
  //     console.log('❌ 从合约调用: 失败 (刚才的测试)');
  //     console.log('');
  //     console.log('📋 原因分析:');
  //     console.log('  UniversalRouter 的 payerIsUser=true 会执行:');
  //     console.log('  IERC20(tokenIn).transferFrom(msg.sender, pool, amount)');
  //     console.log('  ');
  //     console.log('  当 msg.sender 是 EOA: ✅ 可以工作');
  //     console.log('  当 msg.sender 是合约: ❌ 内部断言失败 → Panic 0x0');
  //     console.log('');
  //     console.log('🎯 解决方案: 在 AMMSwap 中使用 SwapRouter02');
  //     console.log('  SwapRouter02.exactOutputSingle() 不检查调用者类型');
  //     console.log('  同样支持 EXACT_OUTPUT 功能');
  //     console.log('═'.repeat(80) + '\n');
  //   }
  // }


  // 操作1: 买入精确1个WLTC (使用 EXACT_OUTPUT - EOA 调用)
  console.log('\n' + '━'.repeat(80));
  console.log('📈 操作1: 买入精确1个WLTC (V3_SWAP_EXACT_OUT)');
  const wltcToBuyExact = 1;
  //const wltcPrice = Number(120n*10n**18n);
  const maxUsdcToSpend = wltcToBuyExact * wltcPrice * (1 + 10 / 100); // 加上滑点容忍度
  console.log(`💵 精确获得: ${wltcToBuyExact} WLTC, 最多支付: ${maxUsdcToSpend.toFixed(2)} USDC`);
  

  await approveToken(wallet, pub, USDC_ADDRESS, UNIVERSAL_ROUTER, parseUnits(maxUsdcToSpend.toFixed(6), 6));
  //检查allowance
  const allow = await checkApproval(pub, USDC_ADDRESS, account.address, 6);
  console.log(`✅ 当前 USDC 允许额度: ${allow} USDC`);
  const s1 = await executeSwapExactOutput(wallet, pub, account, 'USDC_TO_WLTC', wltcToBuyExact.toString(), maxUsdcToSpend.toFixed(6), deadline);
  // const s1 = await executeSwapExactOutput(wallet, pub, account, 'USDC_TO_WLTC', wltcNeeded.toString(), maxUsdcForWltc.toString(), deadline);
  
  if (s1) {
    const a1u = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
    const a1w = await checkBalance(pub, WLTC_ADDRESS, account.address, 18);
    const usdcSpent = parseFloat(initialUsdc) - parseFloat(a1u);
    const wltcGained = parseFloat(a1w) - parseFloat(initialWltc);
    console.log(`✅ 成功!`);
    console.log(`   WLTC: ${initialWltc} -> ${a1w} (+${wltcGained.toFixed(6)})`);
    console.log(`   USDC: ${initialUsdc} -> ${a1u} (-${usdcSpent.toFixed(2)})`);
    console.log(`   实际价格: ${(usdcSpent / wltcGained).toFixed(2)} USDC/WLTC`);
  } else { console.log('❌ 失败'); return; }
  
  await new Promise(r => setTimeout(r, 3000));

  // // 操作2: 买入5个WLTC (原操作1，使用 EXACT_INPUT)
  // console.log('\n' + '━'.repeat(80));
  // console.log('📈 操作2: 买入5个WLTC (V3_SWAP_EXACT_IN - 用于对比)');
  // const wltcToBuy = 5;
  // const usdcNeed = wltcToBuy * wltcPrice;
  // const minWltc2 = wltcToBuy * (1 - SLIPPAGE / 100);
  // console.log(`💵 花费: ${usdcNeed.toFixed(2)} USDC, 最少获得: ${minWltc2.toFixed(6)} WLTC`);
  
  // const b2u = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
  // const b2w = await checkBalance(pub, WLTC_ADDRESS, account.address, 18);
  // await approveToken(wallet, pub, USDC_ADDRESS, UNIVERSAL_ROUTER, parseUnits(usdcNeed.toFixed(6), 6));
  // const s2 = await executeSwap(wallet, pub, account, 'USDC_TO_WLTC', usdcNeed.toFixed(6), minWltc2.toFixed(18), deadline);
  
  // if (s2) {
  //   const a2u = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
  //   const a2w = await checkBalance(pub, WLTC_ADDRESS, account.address, 18);
  //   const usdcSpent = parseFloat(b2u) - parseFloat(a2u);
  //   const wltcGained = parseFloat(a2w) - parseFloat(b2w);
  //   console.log(`✅ 成功!`);
  //   console.log(`   WLTC: ${b2w} -> ${a2w} (+${wltcGained.toFixed(6)})`);
  //   console.log(`   USDC: ${b2u} -> ${a2u} (-${usdcSpent.toFixed(2)})`);
  //   console.log(`   实际价格: ${(usdcSpent / wltcGained).toFixed(2)} USDC/WLTC`);
  // } else { console.log('❌ 失败'); return; }
  
  // await new Promise(r => setTimeout(r, 3000));

  // // 操作3: 卖出30个WLTC
  // console.log('\n' + '━'.repeat(80));
  // console.log('📉 操作3: 卖出30个WLTC');
  // const wltcSell = 30;
  // const usdcExp = wltcSell * wltcPrice;
  // const minUsdc3 = usdcExp * (1 - SLIPPAGE / 100);
  // console.log(`💵 卖出: ${wltcSell} WLTC, 最少获得: ${minUsdc3.toFixed(2)} USDC`);
  
  // const b3u = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
  // await approveToken(wallet, pub, WLTC_ADDRESS, UNIVERSAL_ROUTER, parseUnits(wltcSell.toString(), 18));
  // const s3 = await executeSwap(wallet, pub, account, 'WLTC_TO_USDC', wltcSell.toString(), minUsdc3.toFixed(6), deadline);
  
  // if (s3) {
  //   const a3u = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
  //   console.log(`✅ 成功! USDC: ${b3u} -> ${a3u} (+${(parseFloat(a3u) - parseFloat(b3u)).toFixed(2)})`);
  // } else { console.log('❌ 失败'); return; }
  
  // await new Promise(r => setTimeout(r, 3000));

  // // 操作4: 买入1200 USDC (卖WLTC)
  // console.log('\n' + '━'.repeat(80));
  // console.log('📈 操作4: 买入1200 USDC (卖WLTC)');
  // const usdcBuy = 1200;
  // const wltcNeed = usdcBuy / wltcPrice;
  // const minUsdc4 = usdcBuy * (1 - SLIPPAGE / 100);
  // console.log(`💵 卖出: ${wltcNeed.toFixed(6)} WLTC, 最少获得: ${minUsdc4.toFixed(2)} USDC`);
  
  // const b4u = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
  // await approveToken(wallet, pub, WLTC_ADDRESS, UNIVERSAL_ROUTER, parseUnits(wltcNeed.toFixed(18), 18));
  // const s4 = await executeSwap(wallet, pub, account, 'WLTC_TO_USDC', wltcNeed.toFixed(18), minUsdc4.toFixed(6), deadline);
  
  // if (s4) {
  //   const a4u = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
  //   console.log(`✅ 成功! USDC: ${b4u} -> ${a4u} (+${(parseFloat(a4u) - parseFloat(b4u)).toFixed(2)})`);
  // } else { console.log('❌ 失败'); return; }
  
  // await new Promise(r => setTimeout(r, 3000));

  // // 操作5: 卖出500 USDC (买WLTC)
  // console.log('\n' + '━'.repeat(80));
  // console.log('📉 操作5: 卖出500 USDC (买WLTC)');
  // const usdcSell = 500;
  // const wltcExp = usdcSell / wltcPrice;
  // const minWltc5 = wltcExp * (1 - SLIPPAGE / 100);
  // console.log(`💵 花费: ${usdcSell} USDC, 最少获得: ${minWltc5.toFixed(6)} WLTC`);
  
  // const b5w = await checkBalance(pub, WLTC_ADDRESS, account.address, 18);
  // await approveToken(wallet, pub, USDC_ADDRESS, UNIVERSAL_ROUTER, parseUnits(usdcSell.toString(), 6));
  // const s5 = await executeSwap(wallet, pub, account, 'USDC_TO_WLTC', usdcSell.toString(), minWltc5.toFixed(18), deadline);
  
  // if (s5) {
  //   const finalUsdc = await checkBalance(pub, USDC_ADDRESS, account.address, 6);
  //   const finalWltc = await checkBalance(pub, WLTC_ADDRESS, account.address, 18);
  //   console.log(`✅ 成功! WLTC: ${b5w} -> ${finalWltc} (+${(parseFloat(finalWltc) - parseFloat(b5w)).toFixed(6)})`);
    
  //   console.log('\n' + '═'.repeat(80));
  //   console.log('📝 交易总结');
  //   console.log('═'.repeat(80));
  //   console.log('\n💰 最终余额:');
  //   console.log(`  USDC: ${initialUsdc} -> ${finalUsdc} (${(parseFloat(finalUsdc) - parseFloat(initialUsdc) > 0 ? '+' : '')}${(parseFloat(finalUsdc) - parseFloat(initialUsdc)).toFixed(2)})`);
  //   console.log(`  WLTC: ${initialWltc} -> ${finalWltc} (${(parseFloat(finalWltc) - parseFloat(initialWltc) > 0 ? '+' : '')}${(parseFloat(finalWltc) - parseFloat(initialWltc)).toFixed(6)})`);
  //   console.log('\n📊 操作对比:');
  //   console.log('  操作1 (EXACT_OUTPUT): 精确买入 5 WLTC');
  //   console.log('  操作2 (EXACT_INPUT):  大约买入 5 WLTC');
  //   console.log('  对比：EXACT_OUTPUT 保证得到精确数量，EXACT_INPUT 保证支付精确数量');
  //   console.log('\n✅ 所有5个交易完成!');
  // } else { console.log('❌ 失败'); }
}

main().catch(console.error);

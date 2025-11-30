/*
 * 测试 AMMSwap 合约的四个交易函数 (重构版)
 * 运行：npx tsx scripts/4_interact_amm_viem.ts
 *
 * 测试流程：
 * 1. 初始准备工作：检查池子、Oracle、DEX 状态
 * 2. 测试 Stable -> USDC 交易
 * 3. 测试 USDC -> Stable 交易  
 * 4. 测试 Leverage -> USDC 交易
 * 5. 测试 USDC -> Leverage 交易（DEX购买WLTC + 铸币 + AMM卖Stable）
 */

import { createPublicClient, createWalletClient, http, formatEther, formatUnits, getContract, encodePacked, encodeAbiParameters, parseAbiParameters, parseUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
dotenv.config();

const USER_ADDRESS = '0x4845d4db01b81A15559b8734D234e6202C556d32' as const;

// 从本项目中引入已部署合约的abi及地址
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WLTCMockArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#WLTCMock.json'), 'utf8'));
const USDCMockArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#USDCMock.json'), 'utf8'));
const StableTokenArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#StableToken.json'), 'utf8'));
const MultiLeverageTokenArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/tokenModules#MultiLeverageToken.json'), 'utf8'));
const CustodianFixedArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/coreModules#CustodianFixed.json'), 'utf8'));
const LTCPriceOracleArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/coreModules#LTCPriceOracle.json'), 'utf8'));
const AMMSwapArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/ammModules#AMMSwap.json'), 'utf8'));
const AMMLiquidityArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/ammModules#AMMLiquidity.json'), 'utf8'));
const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/deployed_addresses.json'), "utf-8"));

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

const UNIVERSAL_ROUTER = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b' as const;
const QUOTER_ADDRESS = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3' as const;
// Quoter ABI (Uniswap V3 style quoter: quoteExactInputSingle)
const quoterAbi = [
  { inputs: [ { name: 'path', type: 'bytes' }, { name: 'amountIn', type: 'uint256' } ], name: 'quoteExactInput', outputs: [{ name: 'amountOut', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [ { name: 'path', type: 'bytes' }, { name: 'amountOut', type: 'uint256' } ], name: 'quoteExactOutput', outputs: [{ name: 'amountIn', type: 'uint256' }], stateMutability: 'view', type: 'function' }
] as const;
const quoter = getContract({ address: QUOTER_ADDRESS, abi: quoterAbi as any, client: publicClient });

const universalRouterAbi = [
  {"inputs": [{"name": "commands", "type": "bytes"},{"name": "inputs", "type": "bytes[]"},{"name": "deadline", "type": "uint256"}],"name": "execute","outputs": [],"stateMutability": "payable","type": "function"}
] as const;
const universalRouter = getContract({ address: UNIVERSAL_ROUTER, abi: universalRouterAbi, client: walletClient });
 
// Helper: 从 Uniswap V3 池读取 WLTC 价格并返回 18-decimal 的 bigint（单位：USDC per WLTC, 18 decimals）
async function getWltcPriceFromUniswap(publicClient: any, poolAddress = '0xCa250B562Beb3Be4fC75e79826390F9f14c622d0') {
  const poolAbi = [
    {
      inputs: [],
      name: 'slot0',
      outputs: [
        { name: 'sqrtPriceX96', type: 'uint160' },
        { name: 'tick', type: 'int24' },
        { name: 'observationIndex', type: 'uint16' },
        { name: 'observationCardinality', type: 'uint16' },
        { name: 'observationCardinalityNext', type: 'uint16' },
        { name: 'feeProtocol', type: 'uint8' },
        { name: 'unlocked', type: 'bool' }
      ],
      stateMutability: 'view',
      type: 'function'
    }
  ] as const;

  const poolContract = getContract({ address: poolAddress as `0x${string}`, abi: poolAbi as any, client: publicClient });
  const slot0 = await (poolContract as any).read.slot0([]) as readonly [bigint, number, number, number, number, number, boolean];
  const sqrtPriceX96 = slot0[0];
  const tick = slot0[1];

  // 使用 tick 计算价格（近似）：price = 1.0001^tick * 10^(decimals_wltc - decimals_usdc)
  // 假设 WLTC = 18 decimals, USDC = 6 decimals
  const wltcDecimals = 18;
  const usdcDecimals = 6;
  const priceFloat = Math.pow(1.0001, tick) * Math.pow(10, wltcDecimals - usdcDecimals);

  // 转换为 18-decimal 的 bigint（Oracle 使用 18 decimals）
  const newOraclePrice = BigInt(Math.floor(priceFloat * 1e18));
  return newOraclePrice;
}

// helper to encode path: tokenIn(20)+fee(3)+tokenOut(20) — encodePacked-like
function encodePath(tokenA: string, fee: number, tokenB: string) {
    // simple concat: not full abi.encodePacked but works for raw bytes output expected by routers
    const trim0x = (s: string) => s.toLowerCase().replace(/^0x/, '');
    const feeHex = fee.toString(16).padStart(6, '0');
    return '0x' + trim0x(tokenA) + feeHex + trim0x(tokenB);
}

const encodePathExactOut = (tokenOut: string, fee: number, tokenIn: string) => encodePath(tokenOut, fee, tokenIn); //encodePath总是确定量的地址放前面
const fee = 3000; // 0.3%

// Ensure allowance helper: reads current allowance and, if insufficient,
// (optionally) resets to 0 then approves the desired bigint amount.
// Returns the final allowance as bigint.
async function ensureAllowance(
  tokenContract: any,
  owner: `0x${string}`,
  spender: `0x${string}`,
  desiredAmount: bigint
) {
  const currentAllowance = (await tokenContract.read.allowance([owner, spender])) as bigint;
  if (currentAllowance >= desiredAmount) {
    return currentAllowance;
  }

  if (currentAllowance > 0n) {
    // Some ERC-20 implementations require setting allowance to 0 first
    const resetTx = await tokenContract.write.approve([spender, 0n]);
    await publicClient.waitForTransactionReceipt({ hash: resetTx });
  }

  const approveTx = await tokenContract.write.approve([spender, desiredAmount]);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const newAllowance = (await tokenContract.read.allowance([owner, spender])) as bigint;
  return newAllowance;
}



async function main() {
  console.log("🚀 ===== 开始测试 AMMSwap 交易函数 =====\n");

  // 创建合约实例
  const wltcContract = getContract({ address: deployedAddresses["tokenModules#WLTCMock"], abi: WLTCMockArtifact.abi, client: walletClient });
  const usdcContract = getContract({ address: deployedAddresses["tokenModules#USDCMock"], abi: USDCMockArtifact.abi, client: walletClient });
  const stableContract = getContract({ address: deployedAddresses["tokenModules#StableToken"], abi: StableTokenArtifact.abi, client: walletClient });
  const leverageContract = getContract({ address: deployedAddresses["tokenModules#MultiLeverageToken"], abi: MultiLeverageTokenArtifact.abi, client: walletClient });
  const custodianContract = getContract({ address: deployedAddresses["coreModules#CustodianFixed"], abi: CustodianFixedArtifact.abi, client: walletClient });
  const oracleContract = getContract({ address: deployedAddresses["coreModules#LTCPriceOracle"], abi: LTCPriceOracleArtifact.abi, client: walletClient });
  const ammSwapContract = getContract({ address: deployedAddresses["ammModules#AMMSwap"], abi: AMMSwapArtifact.abi, client: walletClient });
  const ammLiquidityContract = getContract({ address: deployedAddresses["ammModules#AMMLiquidity"], abi: AMMLiquidityArtifact.abi, client: walletClient });

  // =====================================================================
  // 第1部分：初始准备工作
  // =====================================================================
  {
    console.log("📋 ===== 第1部分：初始准备工作 =====\n");
    
    // 1.1 查询用户余额
    console.log("💰 1.1 查询用户余额...");
    const ethBalance = await publicClient.getBalance({ address: USER_ADDRESS });
    const wltcBalance = await wltcContract.read.balanceOf([USER_ADDRESS]) as bigint;
    const usdcBalance = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
    const stableBalance = await stableContract.read.balanceOf([USER_ADDRESS]) as bigint;
    
    console.log(`  ETH: ${formatEther(ethBalance)}`);
    console.log(`  WLTC: ${formatEther(wltcBalance)}`);
    console.log(`  USDC: ${formatUnits(usdcBalance, 6)}`);
    console.log(`  Stable: ${formatEther(stableBalance)}\n`);

    // 1.2 检查AMM池子流动性
    console.log("🏊 1.2 检查AMM池子流动性...");
    const reserves = await ammLiquidityContract.read.getReserves([]) as readonly [bigint, bigint];
    const reserveStable = reserves[0];
    const reserveUsdc = reserves[1];
    
    console.log(`  Stable 储备: ${formatUnits(reserveStable, 18)}`);
    console.log(`  USDC 储备: ${formatUnits(reserveUsdc, 6)}`);
    
    const minLiquidityStable = 10000n * 10n ** 18n;
    const minLiquidityUsdc = 10000n * 10n ** 6n;
    
    if (reserveStable < minLiquidityStable || reserveUsdc < minLiquidityUsdc) {
      console.log("  ⚠️ 流动性不足，添加流动性...");
      const approveTx = await stableContract.write.approve([deployedAddresses["ammModules#AMMLiquidity"], 6000000n * 10n ** 18n]);
      const approveTx2 = await usdcContract.write.approve([deployedAddresses["ammModules#AMMLiquidity"], 6000000n * 10n ** 6n]);
      //等待批准交易完成
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      await publicClient.waitForTransactionReceipt({ hash: approveTx2 });
      console.log("  ✅ 批准完成");
      const addTx = await ammLiquidityContract.write.addLiquidityStable([5000000n * 10n ** 18n]);
      await publicClient.waitForTransactionReceipt({ hash: addTx });
      const newReserves = await ammLiquidityContract.read.getReserves([]) as readonly [bigint, bigint];
      console.log(`  ✅ 流动性已添加: Stable ${formatUnits(newReserves[0], 18)}, USDC ${formatUnits(newReserves[1], 6)}`);
    } else {
      console.log("  ✅ 流动性充足\n");
    }

    // 1.3 检查Oracle价格
    console.log("🔮 1.3 检查Oracle价格...");
    const oracleStatus = await oracleContract.read.getPriceStatus([]) as readonly [bigint, bigint, bigint, boolean, boolean, bigint];
    const currentPrice = oracleStatus[0]; // 第0个是currentPrice，第1个是lastUpdate
    const isPriceValid = oracleStatus[3];
    
    // Oracle价格是18位小数的USDC价格，显示为 1 WLTC = X USDC
    console.log(`  当前Oracle价格: 1 WLTC = ${formatEther(currentPrice)} USDC`);
    console.log(`  当前价格有效性: ${isPriceValid ? '✅ 有效' : '❌ 无效'}`);
    
    if (!isPriceValid) {
        const newOraclePrice = await getWltcPriceFromUniswap(publicClient);
        
        // 更新 Oracle 价格
        try {
            const updateTx = await oracleContract.write.updatePrice([newOraclePrice]);
            await publicClient.waitForTransactionReceipt({ hash: updateTx });
            console.log(`✅ Oracle 价格已更新为 Uniswap 价格: $${formatEther(newOraclePrice)}`);
            
            // 验证更新
            const updatedStatus = await oracleContract.read.getPriceStatus([]) as readonly [bigint, bigint, bigint, boolean, boolean, bigint];
            console.log(`验证更新后的价格: $${formatEther(updatedStatus[0])}`);
            console.log(`更新后的有效性: ${updatedStatus[3] ? '✅ 有效' : '❌ 无效'}`);
        } catch (error: any) {
        console.error(`❌ 更新 Oracle 价格失败:`, error.shortMessage || error.message);
        throw error;
        }
    }
    
    console.log("\n✅ 第1部分完成\n");
  }

  // =====================================================================
  // 第2部分：测试 Stable -> USDC 交易
  // =====================================================================
  {
    console.log("🔄 ===== 第2部分：Stable -> USDC 交易测试 =====\n");
    
    const stableIn = 10n * 10n ** 18n;
    
    const stableBalanceBefore = await stableContract.read.balanceOf([USER_ADDRESS]) as bigint;
    const usdcBalanceBefore = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;

    //check allowance
    const stableAllowance = await stableContract.read.allowance([USER_ADDRESS, deployedAddresses["ammModules#AMMLiquidity"]]) as bigint;
    if (stableAllowance < stableIn) {
      console.log(`⚠️  Stable 账户授权不足，正在授权...`);
      const approveTx = await stableContract.write.approve([deployedAddresses["ammModules#AMMLiquidity"], stableIn]);
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      console.log(`✅ 授权成功`);
    } else {
      console.log(`✅ Stable 账户授权充足`);
    }
    
    console.log("📤 执行交易...");
    const tx = await ammSwapContract.write.swapStableToUsdc([stableIn]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    
    const stableBalanceAfter = await stableContract.read.balanceOf([USER_ADDRESS]) as bigint;
    const usdcBalanceAfter = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
    
    const stableSpent = stableBalanceBefore - stableBalanceAfter;
    const usdcReceived = usdcBalanceAfter - usdcBalanceBefore;
    const unitCost = (stableSpent * 10n**6n) / usdcReceived;
    
    console.log("\n📊 交易结果:");
    console.log(`  付出 Stable: ${formatEther(stableSpent)}`);
    console.log(`  得到 USDC: ${formatUnits(usdcReceived, 6)}`);
    console.log(`  单位成本: ${formatUnits(unitCost, 18)} Stable per USDC`);
    console.log(`  兑换率: ${formatUnits((usdcReceived * 10n**18n) / stableSpent, 6)} USDC per Stable`);
    
    console.log("\n✅ 第2部分完成\n");
  }

  // =====================================================================
  // 第3部分：测试 USDC -> Stable 交易
  // =====================================================================
  {
    console.log("🔄 ===== 第3部分：USDC -> Stable 交易测试 =====\n");
    
    const usdcIn = 10n * 10n ** 6n;
    
    const usdcBalanceBefore = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
    const stableBalanceBefore = await stableContract.read.balanceOf([USER_ADDRESS]) as bigint;

    //check allowance
    const usdcAllowance = await usdcContract.read.allowance([USER_ADDRESS, deployedAddresses["ammModules#AMMLiquidity"]]) as bigint;
    if (usdcAllowance < usdcIn) {
      console.log(`⚠️  USDC 账户授权不足，正在授权...`);
      const approveTx = await usdcContract.write.approve([deployedAddresses["ammModules#AMMLiquidity"], usdcIn]);
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      console.log(`✅ 授权成功`);
    } else {
      console.log(`✅ USDC 账户授权充足`);
    }
    
    console.log("📤 执行交易...");
    const tx = await ammSwapContract.write.swapUsdcToStable([usdcIn]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    
    const usdcBalanceAfter = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
    const stableBalanceAfter = await stableContract.read.balanceOf([USER_ADDRESS]) as bigint;
    
    const usdcSpent = usdcBalanceBefore - usdcBalanceAfter;
    const stableReceived = stableBalanceAfter - stableBalanceBefore;
    const unitCost = (usdcSpent * 10n**18n) / stableReceived;
    
    console.log("\n📊 交易结果:");
    console.log(`  付出 USDC: ${formatUnits(usdcSpent, 6)}`);
    console.log(`  得到 Stable: ${formatEther(stableReceived)}`);
    console.log(`  单位成本: ${formatUnits(unitCost, 6)} USDC per Stable`);
    console.log(`  兑换率: ${formatUnits((stableReceived * 10n**6n) / usdcSpent, 18)} Stable per USDC`);
    
    console.log("\n✅ 第3部分完成\n");
  }

  // =====================================================================
  // 第4部分：测试 Leverage -> USDC 交易
  // =====================================================================
  {
    console.log("🔄 ===== 第4部分：Leverage -> USDC 交易测试 =====\n");
    
    const leverageTokenId = 2n;
    const userLeverageBalance = await leverageContract.read.balanceOf([USER_ADDRESS, leverageTokenId]) as bigint;
    
    if (userLeverageBalance > 0n) {
      const lAmountPercentage = 10n; // 赎回 10%
      
      try {
        console.log("📤 步骤1: 授权Leverage Token...");
        await leverageContract.write.setApprovalForAll([deployedAddresses["ammModules#AMMSwap"], true]);
        
        const usdcBefore = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
        const leverageBefore = await leverageContract.read.balanceOf([USER_ADDRESS, leverageTokenId]) as bigint;
        
        console.log("📤 步骤2: 执行交易...");
        const tx = await ammSwapContract.write.swapLeverageToUsdc([leverageTokenId, lAmountPercentage]);
        await publicClient.waitForTransactionReceipt({ hash: tx });
        
        const usdcAfter = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
        const leverageAfter = await leverageContract.read.balanceOf([USER_ADDRESS, leverageTokenId]) as bigint;
        
        const leverageSpent = leverageBefore - leverageAfter;
        const usdcReceived = usdcAfter - usdcBefore;
        const unitCost = (leverageSpent * 10n**6n) / usdcReceived;
        
        console.log("\n📊 交易结果:");
        console.log(`  付出 Leverage: ${formatEther(leverageSpent)} L`);
        console.log(`  得到 USDC: ${formatUnits(usdcReceived, 6)}`);
        console.log(`  单位成本: ${formatUnits(unitCost, 18)} L per USDC`);
        
      } catch (error: any) {
        console.log(`⚠️ 交易失败: ${error.shortMessage || error.message}`);
      }
    } else {
      console.log("⚠️ 用户没有Leverage Token，跳过测试");
    }
    
    console.log("\n✅ 第4部分完成\n");
  }

  // =====================================================================
  // 第5部分：测试 USDC -> Leverage 交易（完整流程）
  // =====================================================================
  {
    console.log("🔄 ===== 第5部分：USDC -> Leverage 交易测试 =====\n");
    console.log("流程：DEX购买WLTC → 铸造Stable+Leverage → AMM卖出Stable\n");
    
    const LAmountDesired = 10000n * 10n ** 18n;
    const leverageType = 2n; // AGGRESSIVE
    const mintPrice = 120n * 10n ** 18n;
    
    try {
      // 步骤0: 计算需要的资产
      const stableRequired = LAmountDesired;
      
      // 计算精确需要的WLTC，然后向上取整到5位小数
      const wltcExact = (2n * stableRequired * 10n ** 18n) / mintPrice; //18位
      // 向上取整到5位小数: ceil(value / 10^13) * 10^13
      const wltcNeeded = ((wltcExact + 10n ** 13n - 1n) / (10n ** 13n)) * (10n ** 13n);//18位
      
      console.log("📊 资产初始计算:");
      console.log(`  需从DEX购买 WLTC数量: ${formatEther(wltcNeeded)} (向上取整至5位小数)`); 
      console.log(`  将铸造 Stable数量: ${formatEther(stableRequired)}`);
      console.log(`  将铸造 Leverage数量: ${formatEther(LAmountDesired)}\n`);
      
      const usdcBalanceStart = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const leverageBalanceStart = await leverageContract.read.balanceOf([USER_ADDRESS, leverageType]) as bigint;
      const wltcBalanceBefore = await wltcContract.read.balanceOf([USER_ADDRESS]) as bigint;
      
      // 步骤1: DEX购买WLTC
      console.log("📤 步骤1: 在DEX购买WLTC...");
      
      const WLTC_ADDRESS = deployedAddresses["tokenModules#WLTCMock"];
      const USDC_ADDRESS = deployedAddresses["tokenModules#USDCMock"];

      //1.1 授权 USDC 给 Universal Router
      const pathUsdcToWltc = encodePathExactOut(WLTC_ADDRESS as string, fee, USDC_ADDRESS as string);
      const AmountInUsdc = await quoter.read.quoteExactOutput([pathUsdcToWltc as `0x${string}`, wltcNeeded]) as bigint; // 6 decimals (USDC)
      console.log(`  根据UniSwap Quoter, 需要 USDC: ${formatUnits(AmountInUsdc as bigint, 6)}`);
      // 添加5% slippage buffer (使用整数运算以保持 bigint 精度)
      // 使用向上取整：ceil(AmountInUsdc * 105 / 100) = (AmountInUsdc*105 + 99) / 100
      const slippageNumerator = 105n;
      const slippageDenominator = 100n;
      const AmountInUsdcWithSlippage = (AmountInUsdc * slippageNumerator + slippageDenominator - 1n) / slippageDenominator;
      // 基于 uniswap quoter 的价格 * 1.05 作为 approve 额度，防止 slippage 导致失败
      // 检查并设置 allowance：如果当前 allowance 足够则跳过；否则先（可选）清零再批准。
      const spender = UNIVERSAL_ROUTER as `0x${string}`;
      let allowance = await ensureAllowance(usdcContract, USER_ADDRESS,spender, AmountInUsdcWithSlippage);
      console.log(`  ✅ 当前Allowance(user -> Universal Router) [+5%]: ${formatUnits(allowance, 6)} USDC`);
      
      //1.2 执行 swap
      const path = encodePacked(['address', 'uint24', 'address'], [WLTC_ADDRESS, fee, USDC_ADDRESS]);
      const swapInput = encodeAbiParameters(
        parseAbiParameters('address, uint256, uint256, bytes, bool'),
        [USER_ADDRESS as `0x${string}`, wltcNeeded, AmountInUsdcWithSlippage, path, true]
      );
      const swapTx = await universalRouter.write.execute(['0x01', [swapInput], BigInt(Math.floor(Date.now() / 1000) + 1800)]);
      await publicClient.waitForTransactionReceipt({ hash: swapTx });
      const usdcAfterBuy = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const usdcSpentOnWltc = usdcBalanceStart - usdcAfterBuy;
      
      //1.3 验证实际购买到的WLTC数量
      const wltcBalanceAfter = await wltcContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const wltcActualBought = wltcBalanceAfter - wltcBalanceBefore;
      console.log(`  ✅ 花费 ${formatUnits(usdcSpentOnWltc, 6)} USDC`);
      console.log(`  ✅ 购买 ${formatEther(wltcActualBought)} WLTC（应购买: ${formatEther(wltcNeeded)}）\n`);
      

      // 步骤2: 授权并铸造
      console.log("📤 步骤2: 授权WLTC并铸造代币...");

      // 2.1 授权Custodian合约花费WLTC
      allowance = await ensureAllowance(wltcContract, USER_ADDRESS, deployedAddresses["coreModules#CustodianFixed"], wltcNeeded);//原始的wltc在用户地址
      console.log(`  ✅ 当前Allowance(user -> CustodianFixed): ${formatUnits(allowance, 18)} WLTC`);
      
      // 2.2 铸造Stable & leverage
      const stableBeforeMint = await stableContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const mintTx = await custodianContract.write.mint([wltcNeeded, mintPrice, leverageType]);
      await publicClient.waitForTransactionReceipt({ hash: mintTx });
      const stableAfterMint = await stableContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const actualStableMinted = stableAfterMint - stableBeforeMint;
      console.log(`  ✅ 铸造 ${formatEther(actualStableMinted)} Stable\n`);
      
      // 步骤3: AMM卖出Stable
      console.log("📤 步骤3: AMM卖出Stable换USDC...");

      // 3.1 授权AMM合约花费Stable
      allowance = await ensureAllowance(stableContract, USER_ADDRESS, deployedAddresses["ammModules#AMMLiquidity"], actualStableMinted)
      console.log(`  ✅ 当前Allowance(user -> AMMLiquidity): ${formatUnits(allowance, 18)} Stable`);
      
      const usdcBeforeSell = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const sellTx = await ammSwapContract.write.swapStableToUsdc([actualStableMinted]);
      await publicClient.waitForTransactionReceipt({ hash: sellTx });
      
      const usdcAfterSell = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const usdcFromSell = usdcAfterSell - usdcBeforeSell;
      console.log(`  ✅ 收入 ${formatUnits(usdcFromSell, 6)} USDC\n`);
      

      console.log("📊 Swap(USDC->Leverage)最终统计");
      // 最终统计
      const usdcBalanceEnd = await usdcContract.read.balanceOf([USER_ADDRESS]) as bigint;
      const leverageBalanceEnd = await leverageContract.read.balanceOf([USER_ADDRESS, leverageType]) as bigint;
      const totalUsdcCost = usdcBalanceStart - usdcBalanceEnd;
      const totalLeverageGained = leverageBalanceEnd - leverageBalanceStart;
      const currentOracleStatus = await oracleContract.read.getPriceStatus([]) as readonly [bigint, bigint, bigint, boolean, boolean, bigint];
      const currentPrice = currentOracleStatus[0]; // 当前WLTC价格
      // AGGRESSIVE: NAV = (2*Pt - P0) / P0
      const PRICE_PRECISION = 10n ** 18n;
      let grossNavInWei: bigint;
      if (leverageType === 2n) { // AGGRESSIVE
        const numerator = 2n * currentPrice - mintPrice;
        const denominator = mintPrice;
        grossNavInWei = (numerator * PRICE_PRECISION) / denominator;
      } else if (leverageType === 1n) { // MODERATE
        const numerator = 5n * currentPrice - mintPrice;
        const denominator = 4n * mintPrice;
        grossNavInWei = (numerator * PRICE_PRECISION) / denominator;
      } else { // CONSERVATIVE
        const numerator = 9n * currentPrice - mintPrice;
        const denominator = 8n * mintPrice;
        grossNavInWei = (numerator * PRICE_PRECISION) / denominator;
      }
      
      console.log(`  总付出 USDC: ${formatUnits(totalUsdcCost, 6)}`);
      console.log(`  总得到 Leverage: ${formatEther(totalLeverageGained)} L`);
      console.log(`  铸造价格 P0: ${formatEther(mintPrice)} USDC`);
      console.log(`  当前价格 Pt: ${formatEther(currentPrice)} USDC`);

      if (totalLeverageGained > 0n) {
        const unitCost = (totalUsdcCost * 10n**18n) / totalLeverageGained;
        console.log(`  单位份额成本: ${formatUnits(unitCost, 6)} USDC per L`);
      }      
      console.log(`  单位份额净值: ${formatEther(grossNavInWei)} USDC`);

      console.log(`  总价值: ${formatEther(totalLeverageGained * grossNavInWei / PRICE_PRECISION)} USDC`);
      
    } catch (error: any) {
      console.error(`❌ 交易失败: ${error.shortMessage || error.message}`);
    }
    
    console.log("\n✅ 第5部分完成\n");
  }

  console.log("🎉 ===== 所有测试完成 =====");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 测试失败:", error);
    process.exit(1);
  });

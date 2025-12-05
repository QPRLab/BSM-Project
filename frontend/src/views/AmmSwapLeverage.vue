<template>
  <div class="swap-container">
    <div class="swap-header">
      <h2>Swap Leverage Token ↔ USDC</h2>
      <!-- <p class="subtitle">Trade Leverage Tokens with USDC</p> -->
    </div>

    <div class="card">
      <!-- <header class="card-header">
        <div>
          <h2 class="title">Swap Leverage</h2>
        </div>
      </header> -->
      <section class="card-body">
      <!-- 切换买卖方向 -->
      <div class="swap-direction">
        <button :class="['direction-btn', { active: isSellLeverage }]" @click="switchToSell">
          Sell Leverage
        </button>
        <button :class="['direction-btn', { active: !isSellLeverage }]" @click="switchToBuy">
          Buy Leverage
        </button>
      </div>

      <!-- Sell Leverage -> USDC -->
      <div v-if="isSellLeverage" class="swap-form">
        <!-- Token ID 选择 -->
        <div class="input-group">
          <label>Select Leverage Token</label>
          <select v-model="selectedTokenId" @change="onTokenIdChange" class="token-select" :disabled="loadingTokens">
            <option value="">{{ loadingTokens ? 'Loading Tokens... ' : userTokens.length === 0 ? 'No Tokens Found' : 'Select Token ID' }}</option>
            <option v-for="token in userTokens" :key="token.id" :value="token.id">
              ID: {{ token.id }} - Balance: {{ Math.floor(Number(token.balance)) }}
            </option>
          </select>
        </div>

        <!-- 卖出比例选择 -->
        <div v-if="selectedTokenId" class="percentage-group">
          <label>Sell Percentage</label>
          <div class="percentage-buttons">
            <button 
              v-for="pct in [10, 25, 50, 70, 100]" 
              :key="pct"
              :class="['pct-btn', { active: sellPercentage === pct }]"
              @click="sellPercentage = pct"
            >
              {{ pct }}%
            </button>
          </div>
        </div>

        <div class="swap-arrow">↓</div>

        <div class="input-group output">
          <label>You Receive (USDC)</label>
          <input 
            :value="sellPreview.usdcOut" 
            type="text" 
            placeholder="0.0" 
            readonly
          />
          <span class="token-label">USDC</span>
        </div>

        <div v-if="sellPreview.usdcOut > 0" class="swap-info">
          <div class="info-row">
            <span>Leverage Amount:</span>
            <span>{{ sellPreview.leverageAmount }} L</span>
          </div>
          <div class="info-row">
            <span>Stable Needed:</span>
            <span>{{ sellPreview.stableNeeded }} STABLE</span>
          </div>
        </div>

        <button 
          class="swap-btn" 
          @click="executeSellLeverage"
          :disabled="!selectedTokenId || !sellPercentage || loading"
        >
          {{ loading ? 'Swapping...' : 'Swap Leverage → USDC' }}
        </button>
      </div>

      <!-- Buy Leverage <- USDC -->
      <div v-else class="swap-form">
        <div class="input-group">
          <label>Leverage Amount (L Token)</label>
          <input 
            v-model="leverageAmountIn" 
            type="number" 
            placeholder="0.0" 
            @input="calculateBuyPreview"
          />
          <span class="token-label">LEVERAGE</span>
        </div>

        <div class="input-group">
          <label>Mint Price (USD)</label>
          <input 
            v-model="mintPrice" 
            type="number" 
            placeholder="110" 
            step="0.01"
            @input="calculateBuyPreview"
          />
          <span class="token-label">USD</span>
        </div>

        <div class="input-group">
          <label>Leverage Type</label>
          <select v-model="leverageType" @change="calculateBuyPreview" class="token-select">
            <option value="0">Conservative (1:9)</option>
            <option value="1">Moderate (1:4)</option>
            <option value="2">Aggressive (1:1)</option>
          </select>
        </div>

        <div class="swap-arrow">↓</div>

        <div class="input-group output">
          <label>Required USDC</label>
          <input 
            :value="buyPreview.usdcRequired" 
            type="text" 
            placeholder="0.0" 
            readonly
          />
          <span class="token-label">USDC</span>
        </div>

        <div v-if="buyPreview.usdcRequired > 0" class="swap-info">
          <div class="info-row">
            <span>Stable Required:</span>
            <span>{{ buyPreview.stableRequired }} STABLE</span>
          </div>
          <div class="info-row">
            <span>Underlying Amount:</span>
            <span>{{ buyPreview.underlyingAmount }} LTC</span>
          </div>
        </div>

        <button 
          class="swap-btn" 
          @click="executeBuyLeverage"
          :disabled="!leverageAmountIn || !mintPrice || loading"
        >
          {{ loading ? 'Buying...' : 'Buy Leverage Token' }}
        </button>
      </div>

      <div v-if="txHash" class="tx-result">
        <p>✅ Transaction successful!</p>
        <a :href="`https://sepolia.etherscan.io/tx/${txHash}`" target="_blank">View on Etherscan</a>
      </div>

      <div v-if="errorMsg" class="error-msg">
        ❌ {{ errorMsg }}
      </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted, watch } from 'vue'
  import { parseUnits, formatUnits, getContract, formatEther, encodePacked, encodeAbiParameters, parseAbiParameters } from 'viem'
  import { publicClient, createWalletClientInstance } from '../utils/client'
  import { useWalletStore } from '../stores/wallet'
  import { getReadonlyContract, getWalletContract } from '../utils/contracts'
  import { AMMSwapAddress, AMMLiquidityAddress, MultiLeverageTokenAddress, USDCMockAddress, WLTCMockAddress, StableTokenAddress, CustodianFixedAddress } from '../config/addresses'

  const wallet = useWalletStore()

  // helper to get the actual WalletClient instance (from ref.value or init)
  function getActiveWalletClient(): any {
    try {
      const c = (wallet.walletClient as any)?.value
      if (c) return c
    } catch {}
    try {
      const init = wallet.initWalletClient()
      return init ?? null
    } catch { return null }
  }

  // Ensure we have an authorized wallet client tied to the provider that the user selected.
  // This mirrors the logic in `Mint.vue` to request accounts from the chosen provider and
  // create a viem WalletClient using that exact provider instance so subsequent writes
  // are sent through the authorized provider.
  async function ensureWalletClient() {
    try {
      const existingClient = (wallet.walletClient as any)?.value
      const existingAccount = wallet.account as string | null
      if (existingClient && existingAccount) {
        return { caller: existingAccount, walletClient: existingClient }
      }
    } catch {}

    const w = (window as any)
    let chosenProvider: any = null

    if (w.okxwallet && wallet.preferredProvider === 'okx') chosenProvider = w.okxwallet

    if (!chosenProvider && Array.isArray(w.ethereum?.providers)) {
      const providers = w.ethereum.providers
      if (wallet.preferredProvider === 'okx') {
        chosenProvider = providers.find((p: any) => p.isOkxWallet || p.isOKX || p.isOkx || p.isOKExWallet)
      } else if (wallet.preferredProvider === 'metamask') {
        chosenProvider = providers.find((p: any) => p.isMetaMask)
      }
      chosenProvider = chosenProvider || providers[0]
    }

    if (!chosenProvider) chosenProvider = w.ethereum || w.okxwallet || null

    if (!chosenProvider) throw new Error('No injected wallet found')

    const { requestAccountsFrom } = await import('../utils/client')
    const accounts = await requestAccountsFrom(chosenProvider) as string[]
    const caller = accounts && accounts.length > 0 ? accounts[0] : null
    if (!caller) throw new Error('No account available')

    const walletClient: any = createWalletClientInstance(caller, wallet.preferredProvider ?? undefined, chosenProvider)
    if (!walletClient) throw new Error('Could not create wallet client')

    try { wallet.setAccount(caller, wallet.preferredProvider ?? undefined, walletClient) } catch {}

    return { caller, walletClient }
  }

  if (!AMMSwapAddress) throw new Error('AMMSwap address missing in frontend config: ammModules#AMMSwap')
  if (!MultiLeverageTokenAddress) throw new Error('MultiLeverageToken address missing in frontend config: coreModules#MultiLeverageToken')
  if (!USDCMockAddress) throw new Error('USDC address missing in frontend config: tokenModules#USDCMock')
  if (!StableTokenAddress) throw new Error('StableToken address missing in frontend config: tokenModules#StableToken')
  if (!WLTCMockAddress) throw new Error('WLTC token address missing in frontend config: tokenModules#WLTCMock')
  if (!CustodianFixedAddress) throw new Error('Custodian address missing in frontend config: coreModules#CustodianFixed')

  //==========GELEI==========
  const UniversalRouterAddress = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b'
  const QuoterAddress = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3' as const;
  // Quoter ABI (Uniswap V3 style quoter: quoteExactInputSingle)
  const quoterAbi = [
    { inputs: [ { name: 'path', type: 'bytes' }, { name: 'amountIn', type: 'uint256' } ], name: 'quoteExactInput', outputs: [{ name: 'amountOut', type: 'uint256' }], stateMutability: 'view', type: 'function' },
    { inputs: [ { name: 'path', type: 'bytes' }, { name: 'amountOut', type: 'uint256' } ], name: 'quoteExactOutput', outputs: [{ name: 'amountIn', type: 'uint256' }], stateMutability: 'view', type: 'function' }
  ] as const;
  const quoter = getContract({ address: QuoterAddress, abi: quoterAbi as any, client: publicClient });
  const universalRouterAbi = [
    {"inputs": [{"name": "commands", "type": "bytes"},{"name": "inputs", "type": "bytes[]"},{"name": "deadline", "type": "uint256"}],"name": "execute","outputs": [],"stateMutability": "payable","type": "function"}
  ] as const;
  function getUniversalRouter(client?: any) {
    const c = client ?? getActiveWalletClient()
    return getContract({ address: UniversalRouterAddress, abi: universalRouterAbi, client: c as any })
  }

  const permit2Abi = [
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "token",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "spender",
          "type": "address"
        },
        {
          "internalType": "uint160",
          "name": "amount",
          "type": "uint160"
        },
        {
          "internalType": "uint48",
          "name": "expiration",
          "type": "uint48"
        }
      ],
      "name": "approve",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
  ] as const;
  const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
  const add1 = '0x0000000000000000000000000000000000000002' as const;
  const add2 = '0xE49ACc3B16c097ec88Dc9352CE4Cd57aB7e35B95' as const;
  function getPermit2Contract(client?: any) {
    const c = client ?? getActiveWalletClient()
    return getContract({ address: PERMIT2_ADDRESS, abi: permit2Abi, client: c as any })
  }
  //==========GELEI==========

  // Token address aliases used in swap path encoding
  const WLTCAddress = WLTCMockAddress as `0x${string}`
  const USDCAddress = USDCMockAddress as `0x${string}`

  const isSellLeverage = ref(true)
  const selectedTokenId = ref('')
  const sellPercentage = ref(0)
  const leverageAmountIn = ref('')
  const mintPrice = ref('')
  const leverageType = ref('2') // 默认 Aggressive
  const loading = ref(false)
  const loadingTokens = ref(false)
  const txHash = ref('')
  const errorMsg = ref('')

  interface UserToken {
    id: number
    balance: string
  }

  const userTokens = ref<UserToken[]>([])

  const sellPreview = ref({
    usdcOut: 0,
    leverageAmount: 0,
    stableNeeded: 0
  })

  const buyPreview = ref({
    usdcRequired: 0,
    stableRequired: 0,
    underlyingAmount: 0
  })

  const switchToSell = () => {
    isSellLeverage.value = true
    errorMsg.value = ''
    loadUserTokens()
  }

  const switchToBuy = () => {
    isSellLeverage.value = false
    errorMsg.value = ''
  }

  // 加载用户的 Leverage Token IDs
  const loadUserTokens = async () => {
    if (!wallet.account) {
      errorMsg.value = 'Please connect wallet first'
      return
    }
    
    loadingTokens.value = true
    userTokens.value = [] // 清空旧数据
    
    try {
      const leverageToken = await getReadonlyContract('coreModules#MultiLeverageToken', 'MultiLeverageToken')
      
      // 查询用户拥有的 token IDs (1-100范围)
      const tokens: UserToken[] = []
      for (let id = 1; id <= 100; id++) {
        try {
          const balance = await (leverageToken as any).read.balanceOf?.([wallet.account, BigInt(id)]) as bigint
          if (balance > 0n) {
            tokens.push({
              id,
              balance: formatEther(balance)
            })
          }
        } catch (e) {
          // Token 不存在，继续
        }
      }
      userTokens.value = tokens
      console.log('User tokens loaded:', tokens)
    } catch (e) {
      console.error('Failed to load user tokens:', e)
      errorMsg.value = 'Failed to load your leverage tokens'
    } finally {
      loadingTokens.value = false
    }
  }

  const onTokenIdChange = () => {
    sellPercentage.value = 0
    sellPreview.value = { usdcOut: 0, leverageAmount: 0, stableNeeded: 0 }
  }

  const calculateBuyPreview = () => {
    if (!leverageAmountIn.value || !mintPrice.value) {
      buyPreview.value = { usdcRequired: 0, stableRequired: 0, underlyingAmount: 0 }
      return
    }
    
    try {
      const lAmount = Number(leverageAmountIn.value)
      const priceInUsd = Number(mintPrice.value) // USDC 价格
      const type = Number(leverageType.value)
      
      let stableRequired = 0
      let underlyingAmount = 0
      
      if (type === 0) { // Conservative
        stableRequired = lAmount / 8
        underlyingAmount = (9 * stableRequired) / priceInUsd
      } else if (type === 1) { // Moderate
        stableRequired = lAmount / 4
        underlyingAmount = (5 * stableRequired) / priceInUsd
      } else { // Aggressive
        stableRequired = lAmount
        underlyingAmount = (2 * stableRequired) / priceInUsd
      }
      
      // 简化计算：假设1 USDC ≈ 从池子换取的 Stable
      const usdcRequired = stableRequired * 1.01 // 加1%滑点
      
      buyPreview.value = {
        usdcRequired: Number(usdcRequired.toFixed(6)),
        stableRequired: Number(stableRequired.toFixed(6)),
        underlyingAmount: Number(underlyingAmount.toFixed(6))
      }
    } catch (e) {
      console.error('Calculate preview failed:', e)
    }
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
  const executeSellLeverage = async () => {
    // if (!wallet.account || !leverageAmountIn.value || !mintPrice.value) return
    let walletClient: any
    let caller: string | null = null
    try {
      const res = await ensureWalletClient()
      caller = res.caller
      walletClient = res.walletClient
    } catch (err) {
      errorMsg.value = 'Please connect wallet first'
      loading.value = false
      return
    }
    
    loading.value = true
    errorMsg.value = ''
    txHash.value = ''
    
    try {
      const ammSwap = await getWalletContract('ammModules#AMMSwap', walletClient, 'AMMSwap')
      const leverageToken = await getWalletContract('coreModules#MultiLeverageToken', walletClient, 'MultiLeverageToken')
      
      console.log(`准备卖出: Token ID ${selectedTokenId.value}, 比例 ${sellPercentage.value}%`)
      
      // 步骤1: 检查是否已授权
      console.log('📤步驟1：检查Leverage token授权')
      const isApproved = await (leverageToken as any).read.isApprovedForAll?.([wallet.account, AMMSwapAddress]) as boolean
      if (!isApproved) {
        const approveTx = await (leverageToken as any).write.setApprovalForAll?.([AMMSwapAddress, true])
        if (!approveTx) throw new Error('Approve failed')
        await publicClient.waitForTransactionReceipt({ hash: approveTx })
        console.log('✅ 授权成功')
      } else {
        console.log('✅ 已授权，跳过授权步骤')
      }
      
      // 在执行swapLeverageToUsdc之前，检查oracle价格是否有效
      let priceValid = false;
      try {
        const oracle = await getReadonlyContract('coreModules#LTCPriceOracle', 'LTCPriceOracle');
        const result = await (oracle as any).read.getPriceStatus?.();
        if (!result) {
          errorMsg.value = '无法获取预言机价格，请稍后重试';
          loading.value = false;
          console.error('Oracle returned falsy result:', result);
          return;
        }
        // 如果返回是数组，优先显式解构；若是对象则按字段读取
        // 示例（假设第4项是有效标志）：
        const isValid = Array.isArray(result) ? Boolean(result[3]) : Boolean((result as any).isValid ?? result[3]);
        priceValid = isValid;
      } catch (err: any) {
        errorMsg.value = '获取预言机价格失败：' + (err?.message ?? String(err));
        loading.value = false;
        console.error('Failed to read oracle price:', err);
        return;
      }

      if (!priceValid) {
        errorMsg.value = 'Oracle price is not valid. Please update oracle price manually. If you are the oracle updater, go to the Oracle page to submit a new price. Otherwise, please contact gelei1988@gmail.com to add you as price feeder.';
        loading.value = false;
        return;
      }
      // 成功继续，清理可能的旧错误
      errorMsg.value = '';



      // 步骤2: 执行 swap (注意：gas limit 使用默认值，不手动设置)
      console.log('📤步驟2：执行 swap')
      const swapTx = await (ammSwap as any).write.swapLeverageToUsdc?.([
        BigInt(selectedTokenId.value),
        BigInt(sellPercentage.value)
      ])
      if (!swapTx) throw new Error('Swap failed')
      
      console.log('等待交易确认...')
      await publicClient.waitForTransactionReceipt({ hash: swapTx })
      
      console.log('✅ 交易成功:', swapTx)
      txHash.value = swapTx
      await loadUserTokens() // 刷新余额
    } catch (e: any) {
      console.error('交易失败:', e)
      errorMsg.value = e.shortMessage || e.message || 'Transaction failed'
    } finally {
      loading.value = false
    }
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
  const executeBuyLeverage = async () => {
    if (!wallet.account || !leverageAmountIn.value || !mintPrice.value) return
    let walletClient: any
    let caller: string | null = null
    try {
      const res = await ensureWalletClient()
      caller = res.caller
      walletClient = res.walletClient
    } catch (err) {
      errorMsg.value = 'Please connect wallet first'
      loading.value = false
      return
    }
    
    loading.value = true
    errorMsg.value = ''
    txHash.value = ''
    
    try {

      // 在浏览器控制台或在组件里临时打印
      console.log('store.account:', wallet.account);
      // @ts-ignore
      console.log('window.ethereum.selectedAddress:', window.ethereum?.selectedAddress);
      // @ts-ignore
      const ethAccounts = await window.ethereum?.request?.({ method: 'eth_accounts' });
      console.log('provider accounts:', ethAccounts);

      console.log('🔄 ===== 开始购买 Leverage Token =====')
      console.log(`流程: DEX购买WLTC → 铸造Stable+Leverage → AMM卖出Stable\n`)
      
      // 合约实例
      const ammSwap = await getWalletContract('ammModules#AMMSwap', walletClient, 'AMMSwap')
      const usdcToken = await getWalletContract('tokenModules#USDCMock', walletClient, 'USDCMock')
      
      
      const wltcToken = await getWalletContract('tokenModules#WLTCMock', walletClient, 'WLTCMock')
      const stableToken = await getWalletContract('tokenModules#StableToken', walletClient, 'StableToken')
      const custodian = await getWalletContract('coreModules#CustodianFixed', walletClient, 'CustodianFixed')
      
      // 步骤0: 计算需要的资产
      const LAmountDesired = parseUnits(String(leverageAmountIn.value), 18)
      const priceInWei = parseUnits(String(mintPrice.value), 18)
      const type = BigInt(leverageType.value)
      
      let stableRequired: bigint
      let wltcExact: bigint
      if (type === 0n) { // Conservative
        stableRequired = LAmountDesired / 8n
        wltcExact = (9n * stableRequired * 10n ** 18n) / priceInWei;//mintPrice is in 1e18
      } else if (type === 1n) { // Moderate
        stableRequired = LAmountDesired / 4n
        wltcExact = (5n * stableRequired * 10n ** 18n) / priceInWei;//mintPrice is in 1e18
      } else { // Aggressive
        stableRequired = LAmountDesired
        wltcExact = (2n * stableRequired * 10n ** 18n) / priceInWei;//mintPrice is in 1e18
      }
      // 计算需要的 WLTC (向上取整到5位小数)
      const wltcNeeded = ((wltcExact + 10n ** 13n - 1n) / (10n ** 13n)) * (10n ** 13n)
      
      console.log('📊 资产计算:')
      console.log(`  需购买 WLTC: ${formatEther(wltcNeeded)}`)
      console.log(`  将铸造 Stable: ${formatEther(stableRequired)}`)
      console.log(`  将铸造 Leverage: ${leverageAmountIn.value}\n`)
      
      const usdcBalanceStart = await (usdcToken as any).read.balanceOf?.([wallet.account]) as bigint
      
      // 步骤1: DEX购买WLTC
      console.log('📤 步骤1: 在 Uniswap DEX 购买 WLTC...')
      //1.1 授权 USDC 给 Universal Router
      const pathUsdcToWltc = encodePathExactOut(WLTCAddress as string, fee, USDCAddress as string);
      const quoteFn = (quoter as any)?.read?.quoteExactOutput;
      if (typeof quoteFn !== 'function') {
        throw new Error('Quoter contract does not expose quoteExactOutput in this environment');
      }
      // invoke the read function directly
      const AmountInUsdc = (await quoteFn([pathUsdcToWltc as `0x${string}`, wltcNeeded])) as bigint; // 6 decimals (USDC)
      console.log(`  根据UniSwap Quoter, 需要 USDC: ${formatUnits(AmountInUsdc as bigint, 6)}`);
      // 添加5% slippage buffer (使用整数运算以保持 bigint 精度)
      // 使用向上取整：ceil(AmountInUsdc * 105 / 100) = (AmountInUsdc*105 + 99) / 100
      const slippageNumerator = 105n;
      const slippageDenominator = 100n;
      const AmountInUsdcWithSlippage = (AmountInUsdc * slippageNumerator + slippageDenominator - 1n) / slippageDenominator;
      console.log(`  实际需要 USDC: ${formatUnits(AmountInUsdcWithSlippage as bigint, 6)}`);
      // 基于 uniswap quoter 的价格 * 1.05 作为 approve 额度，防止 slippage 导致失败
      // 检查并设置 allowance：如果当前 allowance 足够则跳过；否则先（可选）清零再批准。

      


      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20) as bigint;
      let allowance: bigint;
      //usdc -> permit2 授权
      allowance =  await ensureAllowance(usdcToken, wallet.account as `0x${string}`, PERMIT2_ADDRESS, AmountInUsdcWithSlippage);
      console.log(`  ✅ 当前Allowance(user -> Permit2): ${formatUnits(allowance, 6)} USDC`);

      // Use the wallet-bound Permit2 contract instance (pass the walletClient)
      const permit2 = getPermit2Contract(walletClient)
      const txHash1 = await (permit2 as any).write.approve([USDCAddress, UniversalRouterAddress, AmountInUsdcWithSlippage, Number(deadline)])
      await publicClient.waitForTransactionReceipt({ hash: txHash1 })

    //参数一：commands
    // 0x01 = V3 exactOut swap
    // 0x05 = Sweep
    // 0x04 = Unwrap
    // 顺序执行
    const commands = "0x010504";
    const path = encodePacked(['address', 'uint24', 'address'], [WLTCAddress, fee, USDCAddress]);
    // swap input
    const swapInput = buildSwapInput(
      add1 as `0x${string}`,
      wltcNeeded,
      AmountInUsdcWithSlippage,
      path
    );

    // sweep input（假设 sweep 剩余的 WLTC，数量可根据实际情况调整）
    const sweepInput = buildSweepOrUnwrapInput(
      WLTCAddress,
      add2 as `0x${string}`,
      0n // 如果你不确定数量，可以填0n，合约会 sweep 全部
    );

    // unwrap input（如果 WLTC 是包裹币，否则可省略）
    const unwrapInput = buildSweepOrUnwrapInput(
      WLTCAddress,
      wallet.account as `0x${string}`,
      wltcNeeded
    );

    // 组合 inputs
    const inputs = [swapInput, sweepInput, unwrapInput];

      const universalRouter = getUniversalRouter(walletClient)
      const swapTx = await (universalRouter as any).write.execute([commands, inputs, deadline])
      await publicClient.waitForTransactionReceipt({ hash: swapTx })
      const usdcAfterBuy = await (usdcToken as any).read.balanceOf?.([wallet.account]) as bigint
      const usdcSpentOnWltc = usdcBalanceStart - usdcAfterBuy
      console.log(`  ✅ 花费 ${formatUnits(usdcSpentOnWltc, 6)} USDC 购买 WLTC\n`)

      
      // 步骤2: 授权并铸造
      console.log('📤 步骤2: 授权 WLTC 并铸造代币...')
      // 2.1 授权Custodian合约花费WLTC
      allowance = await ensureAllowance(wltcToken, wallet.account as `0x${string}`, CustodianFixedAddress as `0x${string}`, wltcNeeded);//原始的wltc在用户地址
      console.log(`  ✅ 当前Allowance(user -> CustodianFixed): ${formatUnits(allowance, 18)} WLTC`);
      
      const stableBeforeMint = await (stableToken as any).read.balanceOf?.([wallet.account]) as bigint
      console.log(`  ✅ 铸币前Stable余额: ${formatEther(stableBeforeMint)} Stable`);
      console.log('  铸造 Stable + Leverage...')
      const mintTx = await (custodian as any).write.mint?.([wltcNeeded, priceInWei, type])
      if (!mintTx) throw new Error('Mint failed')
      await publicClient.waitForTransactionReceipt({ hash: mintTx })
      console.log(`  ✅ Mint transaction hash: ${mintTx}`);
      const stableAfterMint = await (stableToken as any).read.balanceOf?.([wallet.account]) as bigint
      console.log(`  ✅ 铸币后Stable余额: ${formatEther(stableAfterMint)} Stable`);
      const actualStableMinted = stableAfterMint - stableBeforeMint
      console.log(`  ✅ 铸造 ${formatEther(actualStableMinted)} Stable\n`)
      
      // 步骤3: AMM卖出Stable
      console.log('📤 步骤3: AMM 卖出 Stable 换回 USDC...')

      // 3.1 授权AMM合约花费Stable
      allowance = await ensureAllowance(stableToken, wallet.account as `0x${string}`, AMMLiquidityAddress as `0x${string}`, actualStableMinted)
      console.log(`  ✅ 当前Allowance(user -> AMMLiquidity): ${formatUnits(allowance, 18)} Stable`);

      const usdcBeforeSell = await (usdcToken as any).read.balanceOf?.([wallet.account]) as bigint
      const sellTx = await (ammSwap as any).write.swapStableToUsdc?.([actualStableMinted])
      if (!sellTx) throw new Error('Swap Stable to USDC failed')
      await publicClient.waitForTransactionReceipt({ hash: sellTx })
      
      const usdcAfterSell = await (usdcToken as any).read.balanceOf?.([wallet.account]) as bigint
      const usdcFromSell = usdcAfterSell - usdcBeforeSell
      console.log(`  ✅ 收回 ${formatUnits(usdcFromSell, 6)} USDC\n`)
      
      // 最终统计
      const usdcBalanceEnd = await (usdcToken as any).read.balanceOf?.([wallet.account]) as bigint
      const totalUsdcCost = usdcBalanceStart - usdcBalanceEnd
      
      console.log('📊 ===== 最终统计 =====')
      console.log(`  总付出 USDC: ${formatUnits(totalUsdcCost, 6)}`)
      console.log(`  总得到 Leverage: ${leverageAmountIn.value} L`)
      console.log(`  单位成本: ${formatUnits((totalUsdcCost * 10n**18n) / LAmountDesired, 6)} USDC per L`)
      
      txHash.value = mintTx
      
      // 刷新余额
      await loadUserTokens()
    } catch (e: any) {
      console.error('❌ 购买失败:', e)
      errorMsg.value = e.shortMessage || e.message || 'Transaction failed'
    } finally {
      loading.value = false
    }
  }

  // 监听钱包账户变化 - 自动加载 token 列表
  watch(() => wallet.account, (newAccount, oldAccount) => {
    // 当钱包从未连接状态变为已连接，或账户切换时
    if (newAccount && newAccount !== oldAccount && isSellLeverage.value) {
      console.log('Wallet connected, loading tokens for:', newAccount)
      loadUserTokens()
    }
    // 当钱包断开连接时，清空列表
    if (!newAccount && oldAccount) {
      userTokens.value = []
      selectedTokenId.value = ''
    }
  })

  onMounted(() => {
    if (wallet.account) {
      loadUserTokens()
    }
  })
</script>

<style scoped>
.swap-container { max-width:600px; margin:auto; color:#0f172a; }
.swap-header { text-align:center; margin-bottom:2rem; }
.swap-header h2 { font-size:2rem; font-weight:700; background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%); background-clip:text; -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:.5rem; }
.subtitle { font-size:1rem; color:#9ca3af; }
.swap-card { background:linear-gradient(135deg,#1f2937 0%,#111827 100%); border:1px solid #374151; border-radius:1rem; padding:2rem; }
.swap-direction { display:flex; gap:1rem; margin-bottom:2rem; }
/* .direction-btn { flex:1; padding:1rem; border:1px solid #374151; background:transparent; color:#9ca3af; border-radius:.75rem; cursor:pointer; font-size:1rem; font-weight:600; transition:all .2s; }
.direction-btn.active { background:#3b82f6; border-color:#3b82f6; color:#fff; }
.direction-btn:hover { border-color:#3b82f6; } */
.direction-btn { flex:1; padding:0.6rem; border:1px solid #e6e9ee; background:transparent; color:#374151; border-radius:8px; cursor:pointer; font-size:0.95rem; font-weight:600; transition:all .2s }
.direction-btn.active { background:linear-gradient(90deg,#4f46e5,#06b6d4); border-color:transparent; color:#fff }
.direction-btn:hover { filter:brightness(0.97) }
.swap-form { display:flex; flex-direction:column; gap:1.5rem; }
.input-group { position:relative; }
.input-group label { display:block; font-size:.85rem; color:#374151; margin-bottom:.35rem; }
.input-group input, .token-select { width:100%; padding:0.75rem 3.5rem 0.75rem 0.85rem; background:#ffffff; border:1px solid #e6e9ee; border-radius:8px; color:#0f172a; font-size:1rem; box-sizing:border-box; }
.token-select { padding-right:1rem; }
.input-group input:focus, .token-select:focus { outline:none; border-color:#4f46e5; }
.input-group.output input { background:#ffffff; }
.token-label { position:absolute; right:0.6rem; top:50%; transform:translateY(-50%); margin-top:0.35rem; padding:0.25rem 0.6rem; background:rgba(79,70,229,0.06); border:1px solid rgba(79,70,229,0.12); border-radius:6px; font-size:.8rem; color:#4f46e5; font-weight:600 }
.percentage-group label { display:block; font-size:.75rem; color:#9ca3af; margin-bottom:.5rem; }
.percentage-buttons { display:flex; gap:.5rem; }
.pct-btn { flex:1; padding:.6rem; background:#ffffff; border:1px solid #e6e9ee; border-radius:6px; color:#374151; cursor:pointer; transition:all .15s; }
.pct-btn.active { background:#3b82f6; border-color:#3b82f6; color:#fff; font-weight:600; }
.pct-btn:hover { border-color:#3b82f6; }
.swap-arrow { text-align:center; font-size:1.5rem; color:#3b82f6; }
.swap-info { background:#ffffff; border-radius:8px; padding:0.75rem; border:1px solid #f1f3f5; }
.info-row { display:flex; justify-content:space-between; font-size:.9rem; color:#6b7280; margin-bottom:.35rem; }
.info-row:last-child { margin-bottom:0; }
.swap-btn { width:100%; padding:0.8rem; background:linear-gradient(90deg,#4f46e5,#06b6d4); border:none; border-radius:8px; color:#fff; font-size:0.98rem; font-weight:700; cursor:pointer; }
.swap-btn:hover:not(:disabled) { filter:brightness(0.98); }
.swap-btn:disabled { opacity:.6; cursor:not-allowed; }
.tx-result { margin-top:1rem; padding:1rem; background:rgba(16,185,129,0.12); border-radius:.75rem; text-align:center; }
.tx-result a { color:#10b981; text-decoration:underline; }
.error-msg { margin-top:1rem; padding:1rem; background:rgba(239,68,68,0.12); border-radius:.75rem; color:#ef4444; text-align:center; }
.tx-result { margin-top:1rem; padding:0.75rem; background:rgba(16,185,129,0.06); border-radius:8px; text-align:center; }
.tx-result a { color:#059669; text-decoration:underline; }
.error-msg { margin-top:1rem; padding:0.75rem; background:rgba(239,68,68,0.06); border-radius:8px; color:#ef4444; text-align:center; }
</style>

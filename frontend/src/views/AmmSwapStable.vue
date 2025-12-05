<template>
  <div class="swap-container">
    <div class="swap-header">
      <h2>Swap Stable ↔ USDC</h2>
      <!-- <p class="subtitle">Exchange Stable Token and USDC with low slippage</p> -->
    </div>

    <div class="card">
      <section class="card-body">
      <!-- 切换买卖方向 -->
      <div class="swap-direction">
        <button :class="['direction-btn', { active: isSellStable }]" @click="isSellStable = true">
          Sell Stable
        </button>
        <button :class="['direction-btn', { active: !isSellStable }]" @click="isSellStable = false">
          Buy Stable
        </button>
      </div>

      <!-- Sell Stable -> USDC -->
      <div v-if="isSellStable" class="swap-form">
        <div class="input-group">
          <label>You Pay (Stable)</label>
          <input
            v-model="stableAmountIn"
            type="number"
            placeholder="0.0"
            @input="previewSellStable"
          />
          <span class="token-label">STABLE</span>
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
            <span>Trading Fee:</span>
            <span>{{ sellPreview.tradingFee }} USDC</span>
          </div>
          <div class="info-row">
            <span>Price Impact:</span>
            <span :class="{ warning: sellPreview.priceImpact > 100 }">
              {{ (sellPreview.priceImpact / 100).toFixed(2) }}%
            </span>
          </div>
        </div>

        <button
          class="swap-btn"
          @click="executeSellStable"
          :disabled="!stableAmountIn || Number(stableAmountIn) <= 0 || loading"
        >
          {{ loading ? 'Swapping...' : 'Swap Stable → USDC' }}
        </button>
      </div>

      <!-- Buy USDC -> Stable -->
      <div v-else class="swap-form">
        <div class="input-group">
          <label>You Pay (USDC)</label>
          <input
            v-model="usdcAmountIn"
            type="number"
            placeholder="0.0"
            @input="previewBuyStable"
          />
          <span class="token-label">USDC</span>
        </div>

        <div class="swap-arrow">↓</div>

        <div class="input-group output">
          <label>You Receive (Stable)</label>
          <input
            :value="buyPreview.stableOut"
            type="text"
            placeholder="0.0"
            readonly
          />
          <span class="token-label">STABLE</span>
        </div>

        <div v-if="buyPreview.stableOut > 0" class="swap-info">
          <div class="info-row">
            <span>Trading Fee:</span>
            <span>{{ buyPreview.tradingFee }} STABLE</span>
          </div>
          <div class="info-row">
            <span>Price Impact:</span>
            <span :class="{ warning: buyPreview.priceImpact > 100 }">
              {{ (buyPreview.priceImpact / 100).toFixed(2) }}%
            </span>
          </div>
        </div>

        <button
          class="swap-btn"
          @click="executeBuyStable"
          :disabled="!usdcAmountIn || Number(usdcAmountIn) <= 0 || loading"
        >
          {{ loading ? 'Swapping...' : 'Swap USDC → Stable' }}
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
import { ref } from 'vue'
import { parseUnits, formatUnits } from 'viem'
import { publicClient, createWalletClientInstance } from '../utils/client'
import { useWalletStore } from '../stores/wallet'
import { getReadonlyContract, getWalletContract } from '../utils/contracts'
import { AMMSwapAddress, AMMLiquidityAddress, StableTokenAddress, USDCMockAddress } from '../config/addresses'

const wallet = useWalletStore()

async function ensureWalletClient() {
  // If store already has an initialized client and account, reuse it
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
if (!AMMLiquidityAddress) throw new Error('AMMLiquidity address missing in frontend config: ammModules#AMMLiquidity')
if (!StableTokenAddress) throw new Error('StableToken address missing in frontend config: tokenModules#StableToken')
if (!USDCMockAddress) throw new Error('USDC address missing in frontend config: tokenModules#USDCMock')
const AMMLiquidityAddr = AMMLiquidityAddress as `0x${string}`

const isSellStable = ref(true)
const stableAmountIn = ref('')
const usdcAmountIn = ref('')
const loading = ref(false)
const txHash = ref('')
const errorMsg = ref('')

const sellPreview = ref({
  usdcOut: 0,
  tradingFee: 0,
  priceImpact: 0
})

const buyPreview = ref({
  stableOut: 0,
  tradingFee: 0,
  priceImpact: 0
})

const previewSellStable = async () => {
  if (!stableAmountIn.value || Number(stableAmountIn.value) <= 0) {
    sellPreview.value = { usdcOut: 0, tradingFee: 0, priceImpact: 0 }
    return
  }
  try {
    console.log('Preview input:', stableAmountIn.value, typeof stableAmountIn.value)
    const ammSwap = await getReadonlyContract('ammModules#AMMSwap', 'AMMSwap')
    const amountIn = parseUnits(String(stableAmountIn.value), 18)
    console.log('AmountIn (wei):', amountIn.toString())
    const result = await (ammSwap as any).read.previewSwapStableToUsdc?.([amountIn]) as any
    console.log('Preview result:', result)
    if (result) {
      sellPreview.value = {
        usdcOut: Number(formatUnits(result[0], 6)),
        tradingFee: Number(formatUnits(result[1], 6)),
        priceImpact: Number(result[4])
      }
      console.log('Parsed preview:', sellPreview.value)
    }
  } catch (e) {
    console.error('Preview failed', e)
    errorMsg.value = `Preview error: ${e instanceof Error ? e.message : 'Unknown error'}`
  }
}

const previewBuyStable = async () => {
  if (!usdcAmountIn.value || Number(usdcAmountIn.value) <= 0) {
    buyPreview.value = { stableOut: 0, tradingFee: 0, priceImpact: 0 }
    return
  }
  try {
    console.log('Preview input:', usdcAmountIn.value, typeof usdcAmountIn.value)
    const ammSwap = await getReadonlyContract('ammModules#AMMSwap', 'AMMSwap')
    const amountIn = parseUnits(String(usdcAmountIn.value), 6)
    console.log('AmountIn (wei):', amountIn.toString())
    const result = await (ammSwap as any).read.previewSwapUsdcToStable?.([amountIn]) as any
    console.log('Preview result:', result)
    if (result) {
      buyPreview.value = {
        stableOut: Number(formatUnits(result[0], 18)),
        tradingFee: Number(formatUnits(result[1], 18)),
        priceImpact: Number(result[4])
      }
      console.log('Parsed preview:', buyPreview.value)
    }
  } catch (e) {
    console.error('Preview failed', e)
    errorMsg.value = `Preview error: ${e instanceof Error ? e.message : 'Unknown error'}`
  }
}

const executeSellStable = async () => {
  let caller: string | null = null
  let walletClient: any
  try {
    const res = await ensureWalletClient()
    caller = res.caller
    walletClient = res.walletClient
  } catch (err) {
    errorMsg.value = 'Please connect wallet first'
    return
  }
  loading.value = true
  errorMsg.value = ''
  txHash.value = ''
  try {
    const ammSwap = await getWalletContract('ammModules#AMMSwap', walletClient, 'AMMSwap')
    const stableToken = await getWalletContract('tokenModules#StableToken', walletClient, 'StableToken')
    const amountIn = parseUnits(String(stableAmountIn.value), 18)
    
    // 授权
    //原始code
    // const approveTx = await stableToken.write.approve?.([AMMSwapAddress, amountIn])
    //修改後code
    const approveTx = await (stableToken as any).write.approve?.([AMMLiquidityAddr, amountIn])

    if (!approveTx) throw new Error('Approve transaction failed')
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    
    // 执行 swap
    const swapTx = await (ammSwap as any).write.swapStableToUsdc?.([amountIn])
    if (!swapTx) throw new Error('Swap transaction failed')
    await publicClient.waitForTransactionReceipt({ hash: swapTx })
    txHash.value = swapTx
  } catch (e: any) {
    errorMsg.value = e.message || 'Swap failed'
  } finally {
    loading.value = false
  }
}

const executeBuyStable = async () => {
  let caller: string | null = null
  let walletClient: any
  try {
    const res = await ensureWalletClient()
    caller = res.caller
    walletClient = res.walletClient
  } catch (err) {
    errorMsg.value = 'Please connect wallet first'
    return
  }
  loading.value = true
  errorMsg.value = ''
  txHash.value = ''
  try {
    const ammSwap = await getWalletContract('ammModules#AMMSwap', walletClient, 'AMMSwap')
    const usdcToken = await getWalletContract('tokenModules#USDCMock', walletClient, 'USDCMock')
    const amountIn = parseUnits(String(usdcAmountIn.value), 6)
    
    // 授权
    //原始code
    // const approveTx = await usdcToken.write.approve?.([AMMSwapAddress, amountIn])
    //修改後code
    const approveTx = await (usdcToken as any).write.approve?.([AMMLiquidityAddr, amountIn])

    if (!approveTx) throw new Error('Approve transaction failed')
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    
    // 执行 swap
    const swapTx = await (ammSwap as any).write.swapUsdcToStable?.([amountIn])
    if (!swapTx) throw new Error('Swap transaction failed')
    await publicClient.waitForTransactionReceipt({ hash: swapTx })
    txHash.value = swapTx
  } catch (e: any) {
    errorMsg.value = e.message || 'Swap failed'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.swap-container { max-width:600px; margin:auto; color:#0f172a; }
.swap-header { text-align:center; margin-bottom:2rem; }
.swap-header h2 { font-size:2rem; font-weight:700; background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%); background-clip:text; -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:.5rem; }
.subtitle { font-size:1rem; color:#6b7280; }
.card { width:100%; max-width:920px; background: #fff; border-radius:12px; box-shadow: 0 8px 30px rgba(25, 31, 40, 0.08); overflow:hidden; display:flex; flex-direction:column }
.card-header { display:flex; justify-content:space-between; align-items:center; padding:1rem 1.25rem; border-bottom:1px solid #f1f3f5 }
.card-body { padding:1rem 1.25rem }
.swap-direction { display:flex; gap:1rem; margin-bottom:1rem; }
.direction-btn { flex:1; padding:0.6rem; border:1px solid #e6e9ee; background:transparent; color:#374151; border-radius:8px; cursor:pointer; font-size:0.95rem; font-weight:600; transition:all .2s }
.direction-btn.active { background:linear-gradient(90deg,#4f46e5,#06b6d4); border-color:transparent; color:#fff }
.direction-btn:hover { filter:brightness(0.97) }
.swap-form { display:flex; flex-direction:column; gap:1rem }
.input-group { position:relative }
.input-group label { display:block; font-size:.85rem; color:#374151; margin-bottom:.35rem }
.input-group input { width:100%; padding:0.75rem 3.5rem 0.75rem 0.85rem; background:#ffffff; border:1px solid #e6e9ee; border-radius:8px; color:#0f172a; font-size:1rem; box-sizing:border-box }
.input-group input:focus { outline:none; border-color:#4f46e5 }
.input-group.output input { background:#ffffff }
.token-label { position:absolute; right:0.6rem; top:50%; transform:translateY(-50%); margin-top:0.35rem; padding:0.25rem 0.6rem; background:rgba(79,70,229,0.06); border:1px solid rgba(79,70,229,0.12); border-radius:6px; font-size:.8rem; color:#4f46e5; font-weight:600 }
.swap-arrow { text-align:center; font-size:1.5rem; color:#6b7280 }
.swap-info { background:#ffffff; border-radius:8px; padding:0.75rem; border:1px solid #f1f3f5 }
.info-row { display:flex; justify-content:space-between; font-size:.9rem; color:#6b7280; margin-bottom:.35rem }
.info-row:last-child { margin-bottom:0 }
.info-row .warning { color:#f59e0b }
.swap-btn { width:100%; padding:0.8rem; background:linear-gradient(90deg,#4f46e5,#06b6d4); border:none; border-radius:8px; color:#fff; font-size:0.98rem; font-weight:700; cursor:pointer }
.swap-btn:hover:not(:disabled) { filter:brightness(0.98) }
.swap-btn:disabled { opacity:.6; cursor:not-allowed }
.tx-result { margin-top:1rem; padding:0.75rem; background:rgba(16,185,129,0.06); border-radius:8px; text-align:center }
.tx-result a { color:#059669; text-decoration:underline }
.error-msg { margin-top:1rem; padding:0.75rem; background:rgba(239,68,68,0.06); border-radius:8px; color:#ef4444; text-align:center }
</style>

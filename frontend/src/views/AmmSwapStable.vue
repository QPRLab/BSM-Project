<template>
  <div class="swap-container">
    <div class="swap-header">
      <h2>Swap Stable ↔ USDC</h2>
      <p class="subtitle">Exchange Stable Token and USDC with low slippage</p>
    </div>

    <div class="swap-card">
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

      <!-- Buy Stable <- USDC -->
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { parseUnits, formatUnits } from 'viem'
import { publicClient } from '../utils/client'
import { useWalletStore } from '../stores/wallet'
import { getReadonlyContract, getWalletContract } from '../utils/contracts'
import { AMMSwapAddress, AMMLiquidityAddress, StableTokenAddress, USDCMockAddress } from '../config/addresses'

const wallet = useWalletStore()

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
  if (!wallet.walletClient) {
    errorMsg.value = 'Please connect wallet first'
    return
  }
  loading.value = true
  errorMsg.value = ''
  txHash.value = ''
  try {
    const ammSwap = await getWalletContract('ammModules#AMMSwap', wallet.walletClient, 'AMMSwap')
    const stableToken = await getWalletContract('tokenModules#StableToken', wallet.walletClient, 'StableToken')
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
  if (!wallet.walletClient) {
    errorMsg.value = 'Please connect wallet first'
    return
  }
  loading.value = true
  errorMsg.value = ''
  txHash.value = ''
  try {
    const ammSwap = await getWalletContract('ammModules#AMMSwap', wallet.walletClient, 'AMMSwap')
    const usdcToken = await getWalletContract('tokenModules#USDCMock', wallet.walletClient, 'USDCMock')
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
.swap-container { max-width:600px; margin:auto; color:#e5e7eb; }
.swap-header { text-align:center; margin-bottom:2rem; }
.swap-header h2 { font-size:2rem; font-weight:700; background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%); background-clip:text; -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:.5rem; }
.subtitle { font-size:1rem; color:#9ca3af; }
.swap-card { background:linear-gradient(135deg,#1f2937 0%,#111827 100%); border:1px solid #374151; border-radius:1rem; padding:2rem; }
.swap-direction { display:flex; gap:1rem; margin-bottom:2rem; }
.direction-btn { flex:1; padding:1rem; border:1px solid #374151; background:transparent; color:#9ca3af; border-radius:.75rem; cursor:pointer; font-size:1rem; font-weight:600; transition:all .2s; }
.direction-btn.active { background:#3b82f6; border-color:#3b82f6; color:#fff; }
.direction-btn:hover { border-color:#3b82f6; }
.swap-form { display:flex; flex-direction:column; gap:1.5rem; }
.input-group { position:relative; }
.input-group label { display:block; font-size:.75rem; color:#9ca3af; margin-bottom:.5rem; }
.input-group input { width:100%; padding:1rem 6rem 1rem 1rem; background:#111827; border:1px solid #374151; border-radius:.75rem; color:#f3f4f6; font-size:1.25rem; box-sizing:border-box; }
.input-group input:focus { outline:none; border-color:#3b82f6; }
.input-group.output input { background:#0f172a; }
.token-label { position:absolute; right:1rem; top:50%; transform:translateY(-50%); margin-top:0.75rem; padding:0.25rem 0.75rem; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); border-radius:0.5rem; font-size:.75rem; color:#60a5fa; font-weight:600; }
.swap-arrow { text-align:center; font-size:1.5rem; color:#3b82f6; }
.swap-info { background:#0f172a; border-radius:.75rem; padding:1rem; }
.info-row { display:flex; justify-content:space-between; font-size:.875rem; color:#9ca3af; margin-bottom:.5rem; }
.info-row:last-child { margin-bottom:0; }
.info-row .warning { color:#f59e0b; }
.swap-btn { width:100%; padding:1rem; background:#3b82f6; border:none; border-radius:.75rem; color:#fff; font-size:1rem; font-weight:600; cursor:pointer; transition:all .2s; }
.swap-btn:hover:not(:disabled) { background:#2563eb; }
.swap-btn:disabled { opacity:.5; cursor:not-allowed; }
.tx-result { margin-top:1rem; padding:1rem; background:rgba(16,185,129,0.12); border-radius:.75rem; text-align:center; }
.tx-result a { color:#10b981; text-decoration:underline; }
.error-msg { margin-top:1rem; padding:1rem; background:rgba(239,68,68,0.12); border-radius:.75rem; color:#ef4444; text-align:center; }
</style>

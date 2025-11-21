<template>
  <div class="liquidity-container">
    <div class="liquidity-header">
      <h2>Liquidity Management</h2>
      <p class="subtitle">Add or Remove Stable/USDC Liquidity</p>
    </div>

    <!-- Pool Info -->
    <div class="pool-info-card">
      <h3>Pool Reserves</h3>
      <div class="reserves-grid">
        <div class="reserve-item">
          <span class="label">Stable Reserve:</span>
          <span class="value">{{ formatNumber(reserveStable) }}</span>
        </div>
        <div class="reserve-item">
          <span class="label">USDC Reserve:</span>
          <span class="value">{{ formatNumber(reserveUsdc) }}</span>
        </div>
        <div class="reserve-item">
          <span class="label">My LP Token:</span>
          <span class="value">{{ formatNumber(myLpBalance) }}</span>
        </div>
        <div class="reserve-item">
          <span class="label">Total LP Supply:</span>
          <span class="value">{{ formatNumber(totalLpSupply) }}</span>
        </div>
      </div>
      <button class="refresh-btn" @click="loadPoolInfo">🔄 Refresh</button>
    </div>

    <div class="liquidity-card">
      <!-- Toggle Add/Remove -->
      <div class="liquidity-direction">
        <button :class="['direction-btn', { active: isAddLiquidity }]" @click="switchToAdd">
          Add Liquidity
        </button>
        <button :class="['direction-btn', { active: !isAddLiquidity }]" @click="switchToRemove">
          Remove Liquidity
        </button>
      </div>

      <!-- Add Liquidity Form -->
      <div v-if="isAddLiquidity" class="liquidity-form">
        <div class="token-selector">
          <button 
            :class="['token-btn', { active: addTokenType === 'stable' }]" 
            @click="addTokenType = 'stable'"
          >
            Add Stable
          </button>
          <button 
            :class="['token-btn', { active: addTokenType === 'usdc' }]" 
            @click="addTokenType = 'usdc'"
          >
            Add USDC
          </button>
        </div>

        <div class="input-group">
          <label>{{ addTokenType === 'stable' ? 'Stable Amount' : 'USDC Amount' }}</label>
          <input 
            v-model="addAmount" 
            type="number" 
            placeholder="0.0" 
            @input="previewAddLiquidity"
          />
          <span class="token-label">{{ addTokenType === 'stable' ? 'STABLE' : 'USDC' }}</span>
        </div>

        <div v-if="addPreview.lpTokens > 0" class="preview-info">
          <h4>Expected Output</h4>
          <div class="info-row">
            <span>LP Tokens:</span>
            <span>{{ formatNumber(addPreview.lpTokens) }}</span>
          </div>
          <div class="info-row">
            <span>{{ addTokenType === 'stable' ? 'USDC' : 'Stable' }} Required:</span>
            <span>{{ formatNumber(addPreview.otherToken) }}</span>
          </div>
          <div class="info-row">
            <span>Pool Share:</span>
            <span>{{ addPreview.sharePercentage }}%</span>
          </div>
        </div>

        <button 
          class="action-btn" 
          @click="executeAddLiquidity"
          :disabled="!addAmount || loading"
        >
          {{ loading ? 'Adding...' : 'Add Liquidity' }}
        </button>
      </div>

      <!-- Remove Liquidity Form -->
      <div v-else class="liquidity-form">
        <div class="input-group">
          <label>LP Token Amount</label>
          <input 
            v-model="removeAmount" 
            type="number" 
            placeholder="0.0" 
            @input="previewRemoveLiquidity"
          />
          <span class="token-label">LP</span>
        </div>

        <!-- Quick Select Percentage -->
        <div class="percentage-group">
          <label>Quick Select</label>
          <div class="percentage-buttons">
            <button 
              v-for="pct in [25, 50, 75, 100]" 
              :key="pct"
              class="pct-btn"
              @click="selectRemovePercentage(pct)"
            >
              {{ pct }}%
            </button>
          </div>
        </div>

        <div v-if="removePreview.stableOut > 0" class="preview-info">
          <h4>Expected Output</h4>
          <div class="info-row">
            <span>Stable:</span>
            <span>{{ formatNumber(removePreview.stableOut) }}</span>
          </div>
          <div class="info-row">
            <span>USDC:</span>
            <span>{{ formatNumber(removePreview.usdcOut) }}</span>
          </div>
        </div>

        <button 
          class="action-btn" 
          @click="executeRemoveLiquidity"
          :disabled="!removeAmount || loading"
        >
          {{ loading ? 'Removing...' : 'Remove Liquidity' }}
        </button>
      </div>

      <div v-if="txHash" class="tx-result">
        <p>✅ Transaction Successful!</p>
        <a :href="`https://sepolia.etherscan.io/tx/${txHash}`" target="_blank">View on Etherscan</a>
      </div>

      <div v-if="errorMsg" class="error-msg">
        ❌ {{ errorMsg }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { parseUnits, formatUnits, getContract } from 'viem'
import LPToken from '../abi/LPToken.json'
import { getReadonlyContract, getWalletContract } from '../utils/contracts'
import { publicClient } from '../utils/client'
import { useWalletStore } from '../stores/wallet'
import { AMMLiquidityAddress, StableTokenAddress, USDCMockAddress } from '../config/addresses'

const wallet = useWalletStore()

//=====获取Address & ABI，创建Contract实例=====
if (!AMMLiquidityAddress) throw new Error('AMMLiquidity address missing in frontend config: ammModules#AMMLiquidity')
if (!StableTokenAddress) throw new Error('StableToken address missing in frontend config: tokenModules#StableToken')
if (!USDCMockAddress) throw new Error('USDC address missing in frontend config: tokenModules#USDCMock')


// centralized helper getters (use these to get contract instances)
const getAmmLiquidityReadonly = async () => await getReadonlyContract('ammModules#AMMLiquidity', 'AMMLiquidity')
const getAmmLiquidityWallet = (walletClient: any) => getWalletContract('ammModules#AMMLiquidity', walletClient, 'AMMLiquidity')

//=====获取Address & ABI，创建Contract实例=====

const isAddLiquidity = ref(true)
const addTokenType = ref<'stable' | 'usdc'>('stable')
const addAmount = ref('')
const removeAmount = ref('')
const loading = ref(false)
const txHash = ref('')
const errorMsg = ref('')

// 池子信息
const reserveStable = ref(0)
const reserveUsdc = ref(0)
const myLpBalance = ref(0)
const totalLpSupply = ref(0)

// 预览信息
const addPreview = ref({
  lpTokens: 0,
  otherToken: 0,
  sharePercentage: 0
})

const removePreview = ref({
  stableOut: 0,
  usdcOut: 0
})

const switchToAdd = () => {
  isAddLiquidity.value = true
  errorMsg.value = ''
  txHash.value = ''
}

const switchToRemove = () => {
  isAddLiquidity.value = false
  errorMsg.value = ''
  txHash.value = ''
}

const formatNumber = (value: number | string) => {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num) || num === 0) return '0'
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K'
  return num.toFixed(2)
}

// 加载池子信息
const loadPoolInfo = async () => {
  try {

    // 获取储备
    const amm = await getAmmLiquidityReadonly()
    const reserves = await (amm as any).read.getReserves?.([]) as readonly [bigint, bigint]
    reserveStable.value = Number(formatUnits(reserves[0], 18))
    reserveUsdc.value = Number(formatUnits(reserves[1], 6))

    // 获取LP Token地址
    const lpTokenAddress = await (amm as any).read.lpToken?.([]) as string
    const lpToken = getContract({
      address: lpTokenAddress as `0x${string}`,
      abi: LPToken.abi,
      client: publicClient
    })

    // 获取总供应量
    const totalSupply = await (lpToken as any).read.totalSupply?.([]) as bigint
    totalLpSupply.value = Number(formatUnits(totalSupply, 18))

    // 获取用户余额
    if (wallet.account) {
      const balance = await (lpToken as any).read.balanceOf?.([wallet.account]) as bigint
      myLpBalance.value = Number(formatUnits(balance, 18))
    }

    console.log('Pool info loaded:', { reserveStable: reserveStable.value, reserveUsdc: reserveUsdc.value, myLpBalance: myLpBalance.value })
  } catch (e) {
    console.error('Failed to load pool info:', e)
  }
}

// 预览添加流动性
const previewAddLiquidity = async () => {
  if (!addAmount.value || Number(addAmount.value) <= 0) {
    addPreview.value = { lpTokens: 0, otherToken: 0, sharePercentage: 0 }
    return
  }

  try {


    let amountIn: bigint
    let result: readonly [bigint, bigint]

    if (addTokenType.value === 'stable') {
      amountIn = parseUnits(String(addAmount.value), 18)
      const amm = await getAmmLiquidityReadonly()
      result = await (amm as any).read.addLiquidityStablePreview?.([amountIn]) as readonly [bigint, bigint]
      // result[0] = requiredUsdcAmount, result[1] = expectedLpTokens
      addPreview.value = {
        lpTokens: Number(formatUnits(result[1], 18)),
        otherToken: Number(formatUnits(result[0], 6)),
        sharePercentage: totalLpSupply.value > 0 
          ? Number(((Number(formatUnits(result[1], 18)) / (totalLpSupply.value + Number(formatUnits(result[1], 18)))) * 100).toFixed(4))
          : 100
      }
    } else {
      amountIn = parseUnits(String(addAmount.value), 6)
      const amm = await getAmmLiquidityReadonly()
      result = await (amm as any).read.addLiquidityUSDCPreview?.([amountIn]) as readonly [bigint, bigint]
      // result[0] = requiredStableAmount, result[1] = expectedLpTokens
      addPreview.value = {
        lpTokens: Number(formatUnits(result[1], 18)),
        otherToken: Number(formatUnits(result[0], 18)),
        sharePercentage: totalLpSupply.value > 0
          ? Number(((Number(formatUnits(result[1], 18)) / (totalLpSupply.value + Number(formatUnits(result[1], 18)))) * 100).toFixed(4))
          : 100
      }
    }
  } catch (e: any) {
    console.error('Preview failed:', e)
  }
}

// 预览移除流动性
const previewRemoveLiquidity = async () => {
  if (!removeAmount.value || Number(removeAmount.value) <= 0) {
    removePreview.value = { stableOut: 0, usdcOut: 0 }
    return
  }

  try {
    const amm = await getAmmLiquidityReadonly()

    const lpAmount = parseUnits(String(removeAmount.value), 18)
    const result = await (amm as any).read.removeLiquidityPreview?.([lpAmount]) as readonly [bigint, bigint]
    
    removePreview.value = {
      stableOut: Number(formatUnits(result[0], 18)),
      usdcOut: Number(formatUnits(result[1], 6))
    }
  } catch (e: any) {
    console.error('Preview failed:', e)
  }
}

// 快速选择移除百分比
const selectRemovePercentage = (percentage: number) => {
  const amount = (myLpBalance.value * percentage / 100).toFixed(6)
  removeAmount.value = amount
  previewRemoveLiquidity()
}

// 执行添加流动性
const executeAddLiquidity = async () => {
  if (!wallet.account || !wallet.walletClient) {
    errorMsg.value = '请先连接钱包'
    return
  }

  loading.value = true
  errorMsg.value = ''
  txHash.value = ''

  try {
    const ammLiquidity = await getAmmLiquidityWallet(wallet.walletClient)

    if (addTokenType.value === 'stable') {
      // Add Stable
      const stableAmount = parseUnits(String(addAmount.value), 18)
      const stableContract = await getWalletContract('tokenModules#StableToken', wallet.walletClient, 'StableToken')

      // Approve Stable
      console.log('Approving Stable...')
      const approveStableTx = await (stableContract as any).write.approve?.([AMMLiquidityAddress, stableAmount * 2n])
      if (!approveStableTx) throw new Error('Stable approve failed')
      await publicClient.waitForTransactionReceipt({ hash: approveStableTx })

      // Approve USDC (estimated amount * 1.1 for slippage)
      const usdcNeeded = parseUnits((addPreview.value.otherToken * 1.1).toFixed(6), 6)
      const usdcContract = await getWalletContract('tokenModules#USDCMock', wallet.walletClient, 'USDCMock')
      
      console.log('Approving USDC...')
      const approveUsdcTx = await (usdcContract as any).write.approve?.([AMMLiquidityAddress, usdcNeeded])
      if (!approveUsdcTx) throw new Error('USDC approve failed')
      await publicClient.waitForTransactionReceipt({ hash: approveUsdcTx })

      // Add liquidity
      console.log('Adding liquidity...')
      const addTx = await (ammLiquidity as any).write.addLiquidityStable?.([stableAmount])
      if (!addTx) throw new Error('Add liquidity failed')
      await publicClient.waitForTransactionReceipt({ hash: addTx })
      
      txHash.value = addTx
    } else {
      // Add USDC
      const usdcAmount = parseUnits(String(addAmount.value), 6)
      const usdcContract = await getWalletContract('tokenModules#USDCMock', wallet.walletClient, 'USDCMock')

      // Approve USDC
      console.log('Approving USDC...')
      const approveUsdcTx = await (usdcContract as any).write.approve?.([AMMLiquidityAddress, usdcAmount * 2n])
      if (!approveUsdcTx) throw new Error('USDC approve failed')
      await publicClient.waitForTransactionReceipt({ hash: approveUsdcTx })

      // Approve Stable (estimated amount * 1.1 for slippage)
      const stableNeeded = parseUnits((addPreview.value.otherToken * 1.1).toFixed(18), 18)
      const stableContract = await getWalletContract('tokenModules#StableToken', wallet.walletClient, 'StableToken')
      
      console.log('Approving Stable...')
      const approveStableTx = await (stableContract as any).write.approve?.([AMMLiquidityAddress, stableNeeded])
      if (!approveStableTx) throw new Error('Stable approve failed')
      await publicClient.waitForTransactionReceipt({ hash: approveStableTx })

      // Add liquidity
      console.log('Adding liquidity...')
      const addTx = await (ammLiquidity as any).write.addLiquidityUSDC?.([usdcAmount])
      if (!addTx) throw new Error('Add liquidity failed')
      await publicClient.waitForTransactionReceipt({ hash: addTx })
      
      txHash.value = addTx
    }

    // Refresh data
    await loadPoolInfo()
    addAmount.value = ''
    addPreview.value = { lpTokens: 0, otherToken: 0, sharePercentage: 0 }
  } catch (e: any) {
    errorMsg.value = e.message || 'Failed to add liquidity'
    console.error('Add liquidity error:', e)
  } finally {
    loading.value = false
  }
}

// Execute remove liquidity
const executeRemoveLiquidity = async () => {
  if (!wallet.account || !wallet.walletClient) {
    errorMsg.value = 'Please connect wallet first'
    return
  }

  loading.value = true
  errorMsg.value = ''
  txHash.value = ''

  try {
    const ammLiquidity = await getAmmLiquidityWallet(wallet.walletClient)

    // Get LP Token address
    const ammLiquidityRead = await getAmmLiquidityReadonly()
    const lpTokenAddress = await (ammLiquidityRead as any).read.lpToken?.([]) as string

    // Approve LP Token
    const lpToken = getContract({
      address: lpTokenAddress as `0x${string}`,
      abi: LPToken.abi,
      client: wallet.walletClient
    })

    const lpAmount = parseUnits(String(removeAmount.value), 18)
    
    console.log('Approving LP Token...')
    const approveTx = await (lpToken as any).write.approve?.([AMMLiquidityAddress, lpAmount])
    if (!approveTx) throw new Error('LP Token approve failed')
    await publicClient.waitForTransactionReceipt({ hash: approveTx })

    // Remove liquidity
    console.log('Removing liquidity...')
    const removeTx = await (ammLiquidity as any).write.removeLiquidity?.([lpAmount])
    if (!removeTx) throw new Error('Remove liquidity failed')
    await publicClient.waitForTransactionReceipt({ hash: removeTx })
    
    txHash.value = removeTx

    // Refresh data
    await loadPoolInfo()
    removeAmount.value = ''
    removePreview.value = { stableOut: 0, usdcOut: 0 }
  } catch (e: any) {
    errorMsg.value = e.message || 'Failed to remove liquidity'
    console.error('Remove liquidity error:', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadPoolInfo()
})
</script>

<style scoped>
.liquidity-container { max-width:800px; margin:auto; color:#e5e7eb; padding:1rem; }
.liquidity-header { text-align:center; margin-bottom:2rem; }
.liquidity-header h2 { font-size:2rem; font-weight:700; background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%); background-clip:text; -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:.5rem; }
.subtitle { font-size:1rem; color:#9ca3af; }

.pool-info-card { background:linear-gradient(135deg,#1f2937 0%,#111827 100%); border:1px solid #374151; border-radius:1rem; padding:1.5rem; margin-bottom:2rem; position:relative; }
.pool-info-card h3 { font-size:1.25rem; font-weight:600; color:#f3f4f6; margin-bottom:1rem; }
.reserves-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
.reserve-item { display:flex; justify-content:space-between; padding:.75rem; background:#0f172a; border-radius:.5rem; }
.reserve-item .label { color:#9ca3af; font-size:.875rem; }
.reserve-item .value { color:#60a5fa; font-weight:600; }
.refresh-btn { position:absolute; top:1.5rem; right:1.5rem; padding:.5rem 1rem; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); border-radius:.5rem; color:#60a5fa; cursor:pointer; transition:all .2s; }
.refresh-btn:hover { background:rgba(59,130,246,0.2); }

.liquidity-card { background:linear-gradient(135deg,#1f2937 0%,#111827 100%); border:1px solid #374151; border-radius:1rem; padding:2rem; }
.liquidity-direction { display:flex; gap:1rem; margin-bottom:2rem; }
.direction-btn { flex:1; padding:1rem; border:1px solid #374151; background:transparent; color:#9ca3af; border-radius:.75rem; cursor:pointer; font-size:1rem; font-weight:600; transition:all .2s; }
.direction-btn.active { background:#3b82f6; border-color:#3b82f6; color:#fff; }
.direction-btn:hover { border-color:#3b82f6; }

.token-selector { display:flex; gap:.5rem; margin-bottom:1.5rem; }
.token-btn { flex:1; padding:.75rem; background:#111827; border:1px solid #374151; border-radius:.5rem; color:#9ca3af; cursor:pointer; transition:all .2s; font-size:.875rem; }
.token-btn.active { background:#3b82f6; border-color:#3b82f6; color:#fff; font-weight:600; }
.token-btn:hover { border-color:#3b82f6; }

.liquidity-form { display:flex; flex-direction:column; gap:1.5rem; }
.input-group { position:relative; }
.input-group label { display:block; font-size:.75rem; color:#9ca3af; margin-bottom:.5rem; }
.input-group input { width:100%; padding:1rem 6rem 1rem 1rem; background:#111827; border:1px solid #374151; border-radius:.75rem; color:#f3f4f6; font-size:1.25rem; box-sizing:border-box; }
.input-group input:focus { outline:none; border-color:#3b82f6; }
.token-label { position:absolute; right:1rem; top:50%; transform:translateY(-50%); margin-top:0.75rem; padding:0.25rem 0.75rem; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); border-radius:0.5rem; font-size:.75rem; color:#60a5fa; font-weight:600; }

.percentage-group label { display:block; font-size:.75rem; color:#9ca3af; margin-bottom:.5rem; }
.percentage-buttons { display:flex; gap:.5rem; }
.pct-btn { flex:1; padding:.75rem; background:#111827; border:1px solid #374151; border-radius:.5rem; color:#9ca3af; cursor:pointer; transition:all .2s; }
.pct-btn:hover { border-color:#3b82f6; background:rgba(59,130,246,0.1); }

.preview-info { background:#0f172a; border-radius:.75rem; padding:1rem; }
.preview-info h4 { font-size:.875rem; color:#9ca3af; margin-bottom:.75rem; }
.info-row { display:flex; justify-content:space-between; font-size:.875rem; color:#9ca3af; margin-bottom:.5rem; }
.info-row:last-child { margin-bottom:0; }
.info-row span:last-child { color:#60a5fa; font-weight:600; }

.action-btn { width:100%; padding:1rem; background:#3b82f6; border:none; border-radius:.75rem; color:#fff; font-size:1rem; font-weight:600; cursor:pointer; transition:all .2s; }
.action-btn:hover:not(:disabled) { background:#2563eb; }
.action-btn:disabled { opacity:.5; cursor:not-allowed; }

.tx-result { margin-top:1rem; padding:1rem; background:rgba(16,185,129,0.12); border-radius:.75rem; text-align:center; }
.tx-result a { color:#10b981; text-decoration:underline; }
.error-msg { margin-top:1rem; padding:1rem; background:rgba(239,68,68,0.12); border-radius:.75rem; color:#ef4444; text-align:center; }

@media (max-width: 640px) {
  .reserves-grid { grid-template-columns:1fr; }
  .liquidity-container { padding:.5rem; }
}
</style>

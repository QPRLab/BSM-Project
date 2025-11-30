<template>
  <div class="mint-page">
    <div class="card">
      <header class="card-header">
        <div>
          <h2 class="title">Mint WLTC</h2>
          <p class="subtitle">Quickly mint leverage positions — use with caution</p>
        </div>
        <div class="price-badge">Price: <strong>{{ selectedPrice ?? '-' }}</strong></div>
      </header>

      <section class="card-body">
        <div class="form-grid">
          <div class="field">
            <label class="label">Mint Amount</label>
            <div style="display:flex; gap:0.5rem; align-items:center">
              <input class="input" v-model="wltcAmount" placeholder="e.g. 1.5" />
              <button type="button" class="small-btn" @click="refreshBalance">Refresh Balance</button>
            </div>
            <small class="hint">Enter the amount of WLTC to use for minting • Total WLTC Balance: <strong>{{ wltcBalance ?? '-' }}</strong></small>
          </div>

          <div class="field">
            <label class="label">Leverage</label>
            <select class="select" v-model.number="leverage">
              <option :value="2">Aggressive (High risk)</option>
              <option :value="1">Moderate (Medium risk)</option>
              <option :value="0">Conservative (Low risk)</option>
            </select>
            <small class="hint">Choose leverage level (affects L/S ratio)</small>
          </div>

          <div class="field full">
            <label class="label">Mint Price</label>
            <div class="price-row">
              <label class="chip"><input type="radio" value="110" v-model="priceMode" /> 110</label>
              <label class="chip"><input type="radio" value="120" v-model="priceMode" /> 120</label>
              <label class="chip"><input type="radio" value="130" v-model="priceMode" /> 130</label>
              <label class="chip"><input type="radio" value="custom" v-model="priceMode" /> Custom</label>
              <input v-if="priceMode==='custom'" class="input small" v-model="customPrice" placeholder="e.g. 115.5" />
            </div>
            <small class="hint">Select or enter mint price (USD)</small>
          </div>
        </div>
      </section>

      <footer class="card-footer">
        <div class="left">
          <div v-if="error" class="error">{{ error }}</div>
          <div v-else-if="txHash" class="success">Tx: {{ txHash }}</div>
        </div>
        <div class="right">
          <button class="btn-primary" @click="doMint" :disabled="writing || !wltcAmount || !selectedPrice">
            <span v-if="!writing">Mint</span>
            <span v-else>Processing...</span>
          </button>
        </div>
      </footer>
    </div>
  </div>
  <div v-if="txHash" class="tx-banner">
    <span class="tx-success">✅ Transaction successful!</span>
    <a :href="`https://etherscan.io/tx/${txHash}`" target="_blank" rel="noopener noreferrer">View on Etherscan</a>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getContract, parseEther } from 'viem'
import { publicClient, createWalletClientInstance } from '../utils/client'
import { getReadonlyContract, getWalletContract } from '../utils/contracts'
import { CustodianFixedAddress } from '../config/addresses'

// minimal ERC20 ABI (approve + decimals + balanceOf)
const ERC20_ABI = [
  { "type": "function", "name": "approve", "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "outputs": [{ "type": "bool" }], "stateMutability":"nonpayable" },
  { "type": "function", "name": "decimals", "inputs": [], "outputs": [{ "type": "uint8" }], "stateMutability":"view" },
  { "type": "function", "name": "balanceOf", "inputs": [{ "name": "account", "type": "address" }], "outputs": [{ "type": "uint256" }], "stateMutability":"view" }
]


const wltcAmount = ref('')
const leverage = ref<number>(2) // default Aggressive
const priceMode = ref('110')
const customPrice = ref('')
const writing = ref(false)
const error = ref<string | null>(null)
const txHash = ref<string | null>(null)
const wltcBalance = ref<string | null>(null)

const selectedPrice = computed(() => {
  if (priceMode.value === 'custom') return customPrice.value && customPrice.value.trim() !== '' ? customPrice.value.trim() : null
  return priceMode.value
})

function toWeiDecimal(amountStr: string, decimals: number) {
  // convert decimal string to BigInt with given decimals (no rounding beyond decimals precision)
  if (!amountStr) throw new Error('Empty amount')
  const parts = String(amountStr).split('.')
  const intPart = parts[0] || '0'
  const fracPart = parts[1] || ''
  const fracPadded = (fracPart + '0'.repeat(decimals)).slice(0, decimals)
  const intBig = BigInt(intPart || '0') * 10n ** BigInt(decimals)
  const fracBig = fracPadded ? BigInt(fracPadded) : 0n
  return intBig + fracBig
}

function formatDecimalFromBigInt(value: bigint | number, decimals: number, fixed = 4) {
  const val = typeof value === 'bigint' ? value : BigInt(value)
  const negative = val < 0n
  const abs = negative ? -val : val
  const base = 10n ** BigInt(decimals)
  const intPart = abs / base
  const fracPart = abs % base
  const fracStr = fracPart.toString().padStart(decimals, '0').slice(0, Math.min(decimals, fixed))
  const s = `${intPart.toString()}.${fracStr}`
  return negative ? `-${s}` : s
}

async function refreshBalance() {
  try {
    if (typeof (window as any).ethereum === 'undefined') return
    let accounts = await (window as any).ethereum.request({ method: 'eth_accounts' }) as string[]
    if (!accounts || accounts.length === 0) {
      accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' }) as string[]
    }
    const caller = accounts && accounts.length > 0 ? accounts[0] : null
    if (!caller) return

    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    const underlyingAddr: any = await (custodian as any).read.underlyingToken?.()
    if (!underlyingAddr) return

    const underlying = getContract({ address: underlyingAddr as `0x${string}`, abi: ERC20_ABI as any, client: publicClient })
    let decimals = 18
    try {
      const d: any = await (underlying as any).read.decimals?.()
      if (d !== undefined && d !== null) decimals = Number(d)
    } catch (_) {}

    const bal: any = await (underlying as any).read.balanceOf?.([caller])
    if (bal !== undefined && bal !== null) {
      wltcBalance.value = formatDecimalFromBigInt(BigInt(bal), decimals, 4)
    }
  } catch (e) {
    // ignore
  }
}

onMounted(() => {
  // try to load balance if wallet already connected
  refreshBalance()
})

async function ensureWalletClient() {
  if (typeof (window as any).ethereum === 'undefined') throw new Error('No injected wallet found')
  const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' }) as string[]
  const caller = accounts && accounts.length > 0 ? accounts[0] : null
  if (!caller) throw new Error('No account available')
  const walletClient: any = createWalletClientInstance(caller)
  if (!walletClient) throw new Error('Could not create wallet client')
  return { caller, walletClient }
}

async function doMint() {
  error.value = null
  txHash.value = null
  writing.value = true
  try {
    if (!selectedPrice.value) throw new Error('Please select a price')
    if (!wltcAmount.value) throw new Error('Please enter WLTC amount')

    const { walletClient } = await ensureWalletClient()

    // get underlying token address from custodian
    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    const underlyingAddr: any = await (custodian as any).read.underlyingToken?.()
    if (!underlyingAddr) throw new Error('Underlying token address not available')

    // read decimals
    const underlying = getContract({ address: underlyingAddr as `0x${string}`, abi: ERC20_ABI as any, client: publicClient })
    let decimals = 18
    try {
      const d: any = await (underlying as any).read.decimals?.()
      if (d !== undefined && d !== null) decimals = Number(d)
    } catch (_) {
      // fallback to 18
    }

    // amount (WLTC) -> wei based on decimals
    const amountWei = toWeiDecimal(wltcAmount.value, decimals)

    // price -> 18-decimal int
    const priceHuman = String(selectedPrice.value)
    const priceWei = parseEther(priceHuman)

    // approve underlying to custodian
    const underlyingWrite = getContract({ address: underlyingAddr as `0x${string}`, abi: ERC20_ABI as any, client: walletClient })
    const approveTx = await (underlyingWrite as any).write.approve([CustodianFixedAddress as `0x${string}`, amountWei])
    await publicClient.waitForTransactionReceipt({ hash: approveTx as `0x${string}` })

    // call mint on custodian
    const custodianWrite = await getWalletContract('coreModules#CustodianFixed', walletClient, 'CustodianFixed')
    const tx = await (custodianWrite as any).write.mint([amountWei, priceWei, leverage.value])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    txHash.value = String(tx)
    // reset inputs
    wltcAmount.value = ''
    customPrice.value = ''
    priceMode.value = '110'
    alert('Mint successful: ' + txHash.value)
  } catch (e:any) {
    console.error('mint failed', e)
    error.value = e?.message ?? String(e)
    alert('Mint failed: ' + error.value)
  } finally {
    writing.value = false
  }
}
</script>

<style scoped>
.mint-page { padding: 1.25rem; display:flex; justify-content:center }
.card { width:100%; max-width:920px; background: #fff; border-radius:12px; box-shadow: 0 8px 30px rgba(25, 31, 40, 0.08); overflow:hidden; display:flex; flex-direction:column }
.card-header { display:flex; justify-content:space-between; align-items:center; padding:1.25rem 1.5rem; border-bottom:1px solid #f1f3f5 }
.title { margin:0; font-size:1.25rem }
.subtitle { margin:0; color:#6b7280; font-size:0.9rem }
.price-badge { background:linear-gradient(90deg,#06b6d4,#3b82f6); color:#fff; padding:0.35rem 0.6rem; border-radius:999px; font-weight:600 }
.card-body { padding:1rem 1.5rem }
.form-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap:1rem }
.field { display:flex; flex-direction:column }
.field.full { grid-column: 1 / -1 }
.label { font-weight:600; margin-bottom:0.35rem }
.input { padding:0.6rem 0.75rem; border-radius:8px; border:1px solid #e6e9ee }
.input.small { width:140px; margin-left:0.6rem }
.select { padding:0.5rem 0.6rem; border-radius:8px; border:1px solid #e6e9ee }
.hint { color:#9ca3af; font-size:0.85rem; margin-top:0.25rem }
.price-row { display:flex; gap:0.5rem; align-items:center }
.chip { background:#f3f4f6; padding:0.35rem 0.6rem; border-radius:999px; display:inline-flex; align-items:center; gap:0.4rem; cursor:pointer }
.chip input { margin-right:0.25rem }
.card-footer { padding:1rem 1.5rem; display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f3f5 }
.btn-primary { background:linear-gradient(90deg,#4f46e5,#06b6d4); color:#fff; padding:0.6rem 1rem; border-radius:8px; border:none; cursor:pointer; font-weight:600 }
.btn-primary:disabled { opacity:0.55; cursor:not-allowed }
.error { color:#ef4444 }
.success { color:#16a34a }
.small-btn { background: #eef2ff; color:#3730a3; border: none; padding:0.35rem 0.6rem; border-radius:8px; cursor:pointer; font-weight:600 }
.small-btn:active { transform: translateY(1px) }

/* bottom transaction banner */
.tx-banner { position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; background: #0f172a; color: #fff; padding: 0.65rem 1rem; border-radius: 10px; box-shadow: 0 8px 30px rgba(2,6,23,0.4); display:flex; gap:0.6rem; align-items:center; z-index:1100 }
.tx-banner a { color: #7dd3fc; font-weight:600; text-decoration:underline }
.tx-success { font-weight:700 }

@media (max-width: 720px) {
  .form-grid { grid-template-columns: 1fr }
  .price-badge { display:none }
  .card { margin: 0 0.5rem }
}
</style>
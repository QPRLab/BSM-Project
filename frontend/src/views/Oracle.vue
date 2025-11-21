<template>
  <div class="oracle-page">
    <header class="page-header">
      <h2>预言机</h2>
      <div class="header-actions">
        <button class="icon-btn" @click="loadStatus" :disabled="loading" aria-label="刷新">
          <span v-if="!loading">⟳</span>
          <span v-else>⏳</span>
        </button>
      </div>
    </header>

    <div class="grid">
      <!-- 获取价格 卡片 -->
      <section class="card" :class="{ 'card-valid': isValid === true, 'card-invalid': isValid === false }">
        <div class="card-head">
          <h3>获取价格</h3>
        </div>
        <div class="card-body">
          <div class="price-row">
            <div class="value">{{ priceDisplay }}</div>
            <div class="badge" :class="{ valid: isValid, invalid: isValid === false }">{{ isValid === null ? '-' : (isValid ? 'Valid' : 'Invalid') }}</div>
          </div>
          <div class="meta">Last update: <span class="mono">{{ lastUpdateDisplay }}</span></div>
        </div>
        <div class="card-foot">
          <button class="btn primary" @click="loadStatus" :disabled="loading">刷新价格</button>
          <div class="status-inline">
            <span v-if="loading" class="muted">加载中…</span>
            <span v-if="error" class="error">{{ error }}</span>
          </div>
        </div>
      </section>

      <!-- 更新价格 卡片 -->
      <section class="card">
        <div class="card-head">
          <h3>更新价格</h3>
        </div>
        <div class="card-body">
          <label class="input-row">
            <input v-model="newPrice" placeholder="例如 75.50" />
          </label>
          <div class="note muted">输入美元价格，将以 18 位精度提交到链上</div>
        </div>
        <div class="card-foot">
          <button class="btn primary" @click="submitUpdate" :disabled="writing || !newPrice">更新价格</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { formatEther, parseEther } from 'viem'
import { publicClient, createWalletClientInstance } from '../utils/client'
import { getReadonlyContract, getWalletContract } from '../utils/contracts'


const priceRaw = ref<bigint | null>(null)
const lastUpdate = ref<number | null>(null)
const isValid = ref<boolean | null>(null)
const priceDisplay = ref<string>('-')
const lastUpdateDisplay = ref<string>('-')
const newPrice = ref<string>('')
const loading = ref(false)
const writing = ref(false)
const error = ref<string | null>(null)

async function loadStatus() {
  loading.value = true
  error.value = null
  try {
    const oracle = await getReadonlyContract('coreModules#LTCPriceOracle', 'LTCPriceOracle')
    const s: any = await (oracle as any).read.getPriceStatus?.()
    if (!s) {
      priceRaw.value = null
      isValid.value = null
      lastUpdate.value = null
      priceDisplay.value = '-'
      lastUpdateDisplay.value = '-'
      return
    }
    const price = s[0] as bigint
    const last = s[1] as bigint
    const valid = Boolean(s[3])
    priceRaw.value = price
    lastUpdate.value = Number(last)
    isValid.value = valid
    priceDisplay.value = price ? Number(formatEther(price as bigint)).toFixed(2) : '-'
    lastUpdateDisplay.value = last ? new Date(Number(last) * 1000).toLocaleString() : '-'
  } catch (e:any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => { loadStatus() })

async function ensureWalletClient() {
  if (typeof (window as any).ethereum === 'undefined') throw new Error('No injected wallet found')
  const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' }) as string[]
  const caller = accounts && accounts.length > 0 ? accounts[0] : null
  if (!caller) throw new Error('No account available')
  const walletClient: any = createWalletClientInstance(caller)
  if (!walletClient) throw new Error('Could not create wallet client')
  return { caller, walletClient }
}

async function submitUpdate() {
  try {
    writing.value = true
    error.value = null
    if (!newPrice || String(newPrice.value).trim() === '') throw new Error('Please enter a price')
    const { walletClient } = await ensureWalletClient()
    // parse human input to 18-decimal int (parseEther handles decimals)
    const priceBig: bigint = parseEther(String(newPrice.value)) as bigint
    const oracleWrite = await getWalletContract('coreModules#LTCPriceOracle', walletClient, 'LTCPriceOracle')
    const tx = await (oracleWrite as any).write.updatePrice([priceBig])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    await loadStatus()
    newPrice.value = ''
  } catch (e:any) {
    error.value = e?.message ?? String(e)
    console.error('updatePrice failed', e)
    alert('Update failed: ' + (e?.message ?? String(e)))
  } finally {
    writing.value = false
  }
}
</script>

<style scoped>
.oracle-page { padding: 1.25rem; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial }
.page-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem }
.page-header h2 { margin:0; font-weight:700; font-size:1.25rem; color:#111827 }
.header-actions .icon-btn { background:linear-gradient(90deg,#8b5cf6,#06b6d4); color:#fff; border:none; padding:0.4rem 0.6rem; border-radius:8px; cursor:pointer }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:1rem }
.card { background: linear-gradient(180deg,#ffffff, #fbfbff); border-radius:12px; box-shadow: 0 6px 18px rgba(16,24,40,0.08); overflow:hidden; display:flex; flex-direction:column }
.card-valid { /* keep neutral card background; only badge indicates validity */ color: inherit; }
.card-invalid { /* keep neutral card background; only badge indicates invalid */ color: inherit; }
.card { transition: background-color 180ms ease, color 180ms ease }
.card-head { display:flex; align-items:center; justify-content:space-between; padding:1rem 1rem 0.5rem 1rem }
.card-head h3 { margin:0; font-size:1rem }
.card-body { padding:0.5rem 1rem 1rem 1rem }
.card-foot { padding:0.75rem 1rem 1rem 1rem; display:flex; gap:0.5rem; align-items:center }
.value { font-size:1.5rem; font-weight:700; color:#0f172a }
.price-row { display:flex; align-items:center; gap:0.75rem }
.badge { font-size:0.75rem; padding:0.25rem 0.6rem; border-radius:999px; background:#e6e7eb; color:#111827; min-width:48px; text-align:center }
.badge.valid { background:#16a34a; color:#ffffff; box-shadow: inset 0 -2px 0 rgba(0,0,0,0.06) }
.badge.invalid { background:#b91c1c; color:#ffffff; box-shadow: inset 0 -2px 0 rgba(0,0,0,0.06) }
.card-valid .badge { background: #16a34a; color:#fff }
.card-invalid .badge { background: #7f1d1d; color:#fff }
.meta { margin-top:0.5rem; color:#6b7280; font-size:0.85rem }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Helvetica Neue", monospace }
.muted { color:#9ca3af; font-size:0.85rem }
.btn { background:#111827; color:#fff; border:none; padding:0.5rem 0.75rem; border-radius:8px; cursor:pointer }
.btn.primary { background:linear-gradient(90deg,#2563eb,#7c3aed) }
.btn.outline { background:transparent; border:1px solid #e6e7eb; color:#111827 }
.status-inline { margin-left:auto; font-size:0.9rem }
.error { color:#ef4444 }
.input-row input { width:100%; padding:0.6rem 0.75rem; border-radius:8px; border:1px solid #e6e7eb }
.note { margin-top:0.5rem }

/* Stronger overrides to ensure valid/invalid states visibly replace the neutral card background */
.card.card-valid { background: linear-gradient(180deg,#ffffff,#fbfbff); color: inherit; }
.card.card-invalid { background: linear-gradient(180deg,#ffffff,#fbfbff); color: inherit; }

@media (max-width:520px) {
  .value { font-size:1.25rem }
  .card-foot { flex-direction:column; align-items:flex-start }
}
</style>


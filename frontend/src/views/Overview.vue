<template>
  <div class="page-wrap">
    <header class="page-header">
      <div class="title-area">
        <h1 class="page-title">项目概览</h1>
        <p class="lead muted">质押 WLTC，发行稳定币 S 与杠杆币 L — 稳定币净值 1，杠杆币获取底层收益。</p>
      </div>
      <div>
        <button class="icon-btn" @click="refresh" :disabled="loading">⟳ 刷新</button>
      </div>
    </header>

    <main class="container">
      <section class="card">
        <div class="card-body">
          <p>本项目允许用户基于标的价格 P0 与不同杠杆率（如 1:1 / 1:4 / 1:8）铸造 S 与 L 代币。S 保持锚定 1，L 分配收益与风险。</p>
        </div>
      </section>

      <section class="card stats-card">
        <div class="card-head">
          <h3>项目资产信息</h3>
        </div>
        <div class="card-body stats">
          <div class="stat">
            <div class="label">质押 WLTC</div>
            <div class="value">{{ collateral }}</div>
          </div>
          <div class="stat">
            <div class="label">稳定币 S</div>
            <div class="value">{{ sToken }}</div>
          </div>
          <div class="stat">
            <div class="label">杠杆币 L</div>
            <div class="value">{{ lToken }}</div>
          </div>
        </div>
        <div class="card-foot">
          <div class="status-inline">
            <span v-if="loading" class="muted">加载中…</span>
            <span v-if="error" class="error">{{ error }}</span>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>


<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { formatUnits } from 'viem'
import { getReadonlyContract } from '../utils/contracts'

const loading = ref(true)
const error = ref('')

const collateral = ref('0')
const sToken = ref('0')
const lToken = ref('0')

async function loadOverview() {
  loading.value = true
  error.value = ''
  try {
    const custodianFixed = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed') as any
    const totalStableTokenSupply = await custodianFixed.read.totalSupplyS?.() as bigint
    const totalLeverageTokenSupply = await custodianFixed.read.totalSupplyL?.() as bigint
    const totalUnderlyingLocked = await custodianFixed.read.CollateralInWei?.() as bigint

    sToken.value = Number(formatUnits(totalStableTokenSupply ?? 0n, 18)).toFixed(4)
    lToken.value = Number(formatUnits(totalLeverageTokenSupply ?? 0n, 18)).toFixed(4)
    collateral.value = Number(formatUnits(totalUnderlyingLocked ?? 0n, 18)).toFixed(4)
  } catch (e: any) {
    error.value = e?.message ?? '查询失败'
  } finally {
    loading.value = false
  }
}

function refresh() { loadOverview() }

onMounted(() => { loadOverview() })
</script>

<style scoped>
:root { --max-width:1100px }
.page-wrap { padding: 1.25rem; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial }
.page-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; max-width:var(--max-width); margin:0 auto 1rem }
.title-area { display:flex; flex-direction:column }
.page-title { margin:0; font-size:1.6rem; font-weight:800 }
.lead { margin:0.25rem 0 0; color:#6b7280 }
.container { max-width:var(--max-width); margin:0 auto; display:grid; grid-template-columns:1fr; gap:1rem }
.card { background: linear-gradient(180deg,#ffffff, #fbfbff); border-radius:12px; box-shadow: 0 8px 24px rgba(16,24,40,0.06); overflow:hidden }
.card-head { padding:1rem 1rem 0.5rem 1rem }
.card-body { padding:1rem }
.card-foot { padding:0.75rem 1rem; display:flex; align-items:center }
.stats { display:flex; gap:1.25rem; align-items:center; flex-wrap:wrap }
.stat { min-width:140px }
.label { color:#6b7280; font-size:0.9rem }
.value { font-size:1.25rem; font-weight:700; color:#0f172a }
.muted { color:#9ca3af }
.icon-btn { background:linear-gradient(90deg,#8b5cf6,#06b6d4); color:#fff; border:none; padding:0.4rem 0.6rem; border-radius:8px; cursor:pointer }
.error { color:#ef4444 }

@media (min-width:720px) {
  .container { grid-template-columns: 1fr 1fr }
  .stats-card { grid-column: span 1 }
}

@media (max-width:520px) {
  .page-title { font-size:1.25rem }
}
</style>


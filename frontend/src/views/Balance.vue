 
<template>
  <div class="balance-page">
    <header class="page-header">
      <div>
        <h2>Wallet Balances</h2>
        <p class="muted">View and manage your WLTC / S / USDC balances</p>
      </div>
      <div style="display:flex; align-items:center; gap:0.5rem">
          <button class="icon-btn" @click="refreshBalances" :disabled="!account || loading">🔄 Refresh</button>
        </div>
    </header>
    

    <div v-if="account" class="grid">
      <section class="card">
        <div class="card-head"><h3>WLTC</h3></div>
        <div class="card-body">
          <div class="value">{{ WLTCbalance ?? '—' }}</div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>S Token</h3></div>
        <div class="card-body"><div class="value">{{ Sbalance ?? '—' }}</div></div>
      </section>

      <section class="card">
        <div class="card-head"><h3>USDC</h3></div>
        <div class="card-body"><div class="value">{{ USDCbalance ?? '—' }}</div></div>
      </section>
    </div>

    <div v-else class="empty muted">Wallet not connected — click top-right to connect</div>

    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>


<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount, onActivated } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'
import { useWalletStore } from '../stores/wallet'
import { storeToRefs } from 'pinia'
import { getWalletContract } from '../utils/contracts'
import { formatUnits } from 'viem'

const wallet = useWalletStore()
const { account, Sbalance, Lbalance, USDCbalance, WLTCbalance, error, loading, preferredProvider } = storeToRefs(wallet)

async function refreshBalances() {
  try {
    if (!wallet.account) return
    // prefer existing wallet client
    const walletClient = (wallet.walletClient as any)?.value ?? wallet.initWalletClient()
    if (!walletClient) return

    const Scontract = await getWalletContract('tokenModules#StableToken', walletClient, 'StableToken') as any
    const USDCcontract = await getWalletContract('tokenModules#USDCMock', walletClient, 'USDCMock') as any
    const WLTContract = await getWalletContract('tokenModules#WLTCMock', walletClient, 'WLTCMock') as any

    const rawSBalance = await (Scontract.read.balanceOf?.([wallet.account]) as Promise<bigint>)
    const S = rawSBalance ? Number(formatUnits(rawSBalance, 18)).toFixed(4) : '0.0000'
    const rawUSDCBalance = await (USDCcontract.read.balanceOf?.([wallet.account]) as Promise<bigint>)
    const USDC = rawUSDCBalance ? Number(formatUnits(rawUSDCBalance, 6)).toFixed(4) : '0.0000'
    const rawWLTCBalance = await (WLTContract.read.balanceOf?.([wallet.account]) as Promise<bigint>)
    const WLTC = rawWLTCBalance ? Number(formatUnits(rawWLTCBalance, 18)).toFixed(4) : '0.0000'

    try { wallet.setBalances({ S, L: '', USDC, WLTC }) } catch {}
  } catch (e) {
    try { wallet.setError(String(e)) } catch {}
  }
}

// 点击 Connect 在全局导航处理，Balance 页面只展示状态
function disconnectWallet() {
  wallet.reset()
  wallet.setError('Frontend connection cleared. To fully disconnect, remove this site from your wallet (e.g., MetaMask)')
}
onMounted(() => {
  // when this page mounts, refresh balances automatically
  try { refreshBalances() } catch (_) {}

  const handler = (e: any) => {
    // when wallet connects elsewhere, refresh balances
    try { refreshBalances() } catch (_) {}
  }
  window.addEventListener('wallet:connected', handler)
  onBeforeUnmount(() => window.removeEventListener('wallet:connected', handler))
})

// If this component is kept-alive, refresh when activated
onActivated(() => {
  try { refreshBalances() } catch (_) {}
})

// If the route updates but the same component instance is reused, refresh when route changes to Balance
onBeforeRouteUpdate((to, from) => {
  try { refreshBalances() } catch (_) {}
})
</script>

<style scoped>
.balance-page { padding: 1.25rem; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial }
.page-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem; max-width:1100px; margin-left:auto; margin-right:auto }
.page-header h2 { margin:0; font-weight:700; font-size:1.25rem }
.muted { color:#6b7280 }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:1rem; max-width:1100px; margin:0 auto }
.card { background: linear-gradient(180deg,#ffffff,#fbfbff); border-radius:12px; box-shadow: 0 6px 18px rgba(16,24,40,0.06); overflow:hidden }
.card-head { padding:0.75rem 1rem; border-bottom:1px solid rgba(15,23,42,0.04) }
.card-head h3 { margin:0; font-size:0.95rem }
.card-body { padding:1rem }
.value { font-size:1.25rem; font-weight:700; color:#0f172a }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace; color:#6b7280; font-size:0.85rem }
.small { font-size:0.8rem }
.empty { max-width:1100px; margin:0 auto; padding:1rem; text-align:center }
.btn { background:linear-gradient(90deg,#2563eb,#7c3aed); color:#fff; border:none; padding:0.5rem 0.75rem; border-radius:8px; cursor:pointer }
.error { color:#ef4444; margin-top:0.75rem }

/* Modal styles */
.modal-overlay { position:fixed; inset:0; background:rgba(2,6,23,0.5); display:flex; align-items:center; justify-content:center; z-index:60 }
.modal { background:white; padding:1rem 1.25rem; border-radius:12px; width:min(520px,90%); box-shadow:0 12px 40px rgba(2,6,23,0.4) }
.modal h3 { margin:0 0 0.25rem 0 }
.modal-list { display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem }
.modal-item { padding:0.5rem 0.75rem; border-radius:8px; border:1px solid rgba(15,23,42,0.06); background:linear-gradient(90deg,#f8fafc,#fff); cursor:pointer; text-align:left }
.btn.secondary { background:transparent; color:#374151; border:1px solid rgba(55,65,81,0.08); padding:0.4rem 0.6rem }
.icon-btn { background:linear-gradient(90deg,#8b5cf6,#06b6d4); color:#fff; border:none; padding:0.4rem 0.6rem; border-radius:8px; cursor:pointer }

@media (max-width:520px) {
  .page-header { padding:0 0.5rem }
  .value { font-size:1rem }
}
</style>
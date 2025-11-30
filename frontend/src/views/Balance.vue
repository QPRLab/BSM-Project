 
<template>
  <div class="balance-page">
    <header class="page-header">
      <div>
        <h2>Wallet Balances</h2>
        <p class="muted">View and manage your WLTC / S / USDC balances</p>
      </div>
      <div>
        <button class="btn" @click="toggleWallet" :disabled="loading">
          <span v-if="loading">Processing...</span>
          <span v-else>{{ account ? 'Disconnect' : 'Connect Wallet' }}</span>
        </button>
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
import { onMounted } from 'vue'
import { formatUnits } from 'viem'
import { getWalletContract } from '../utils/contracts'
import { useWalletStore } from '../stores/wallet'
import { storeToRefs } from 'pinia'

const wallet = useWalletStore()
const { account, Sbalance, Lbalance, USDCbalance, WLTCbalance, error, loading } = storeToRefs(wallet)

async function connectWallet() {
  if (wallet.loading) return;
  wallet.setLoading(true);
  try {
    // @ts-ignore
    const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' })
    // setAccount 会自动初始化 walletClient
    wallet.setAccount(address)

    // 获取已初始化的 walletClient
    const walletClient = wallet.walletClient
    if (!walletClient) throw new Error('Failed to initialize wallet client')

    const Scontract = await getWalletContract('tokenModules#StableToken', walletClient, 'StableToken') as any
    const Lcontract = await getWalletContract('coreModules#MultiLeverageToken', walletClient, 'MultiLeverageToken') as any
    const USDCcontract = await getWalletContract('tokenModules#USDCMock', walletClient, 'USDCMock') as any
    const WLTContract = await getWalletContract('tokenModules#WLTCMock', walletClient, 'WLTCMock') as any

    const rawSBalance = await (Scontract.read.balanceOf?.([address]) as Promise<bigint>);
    const S = rawSBalance ? Number(formatUnits(rawSBalance, 18)).toFixed(4) : '0.0000'
    // const rawLBalance = await (Lcontract.read.balanceOf?.([address]) as Promise<bigint>);
    // const L = rawLBalance ? Number(formatUnits(rawLBalance, 18)).toFixed(4) : '0.0000'
    const L = ''
    const rawUSDCBalance = await (USDCcontract.read.balanceOf?.([address]) as Promise<bigint>);
    const USDC = rawUSDCBalance ? Number(formatUnits(rawUSDCBalance, 6)).toFixed(4) : '0.0000'
    const rawWLTCBalance = await (WLTContract.read.balanceOf?.([address]) as Promise<bigint>);
    const WLTC = rawWLTCBalance ? Number(formatUnits(rawWLTCBalance, 18)).toFixed(4) : '0.0000'

    wallet.setBalances({ S, L, USDC, WLTC })
    wallet.setError('')
  } catch (e: any) {
    wallet.setError(e.message || 'Connection failed')
  } finally {
    wallet.setLoading(false)
  }
}

function disconnectWallet() {
  wallet.reset()
  wallet.setError('Frontend connection cleared. To fully disconnect, remove this site from your wallet (e.g., MetaMask)')
}

function toggleWallet() {
  if (wallet.account) {
    disconnectWallet()
  } else {
    connectWallet()
  }
}
onMounted(() => {
  // keep as-is; no auto-connect for now
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

@media (max-width:520px) {
  .page-header { padding:0 0.5rem }
  .value { font-size:1rem }
}
</style>
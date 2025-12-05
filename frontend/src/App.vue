<script setup lang="ts">
import { ref } from 'vue'
import { useWalletStore } from './stores/wallet'
import { getWalletContract } from './utils/contracts'
import { formatUnits } from 'viem'
import { onMounted, onBeforeUnmount } from 'vue'
import { getInjectedProviders } from './utils/client'
// connect logic is handled by the wallet store

const isAmmDropdownOpen = ref(false)
const isLiquidationDropdownOpen = ref(false)

function toggleAmmDropdown() {
  // Toggle AMM dropdown; ensure liquidation dropdown is closed to avoid overlap
  const next = !isAmmDropdownOpen.value
  isAmmDropdownOpen.value = next
  if (next) isLiquidationDropdownOpen.value = false
}

function toggleLiquidationDropdown() {
  // Toggle Liquidation dropdown; ensure AMM dropdown is closed to avoid overlap
  const next = !isLiquidationDropdownOpen.value
  isLiquidationDropdownOpen.value = next
  if (next) isAmmDropdownOpen.value = false
}

function closeAmmDropdown() {
  isAmmDropdownOpen.value = false
  isLiquidationDropdownOpen.value = false
}

// Wallet connect modal + state (global)
const wallet = useWalletStore()
const detected = ref<{ id: string; name: string; provider: any }[]>([])
const modalOpen = ref(false)
// use connecting flag from store: wallet.connecting

function switchConnection(key: string) {
  try { wallet.selectConnection && wallet.selectConnection(key) } catch (e) { console.error(e) }
}

function removeConnection(key: string) {
  try { wallet.disconnectOne && wallet.disconnectOne(key) } catch (e) { console.error(e) }
}

function shortAddr(addr: string | null | undefined) {
  if (!addr) return ''
  try { return addr.slice(0,6) + '…' + addr.slice(-4) } catch { return String(addr) }
}

async function onConnectClick() {
  // If already connected, disconnect on click
  if (wallet.account) {
    try { wallet.disconnect() } catch {}
    return
  }
  // Open modal to let user choose which injected wallet to use
  detected.value = getInjectedProviders() || []
  modalOpen.value = true
}

async function selectAndConnect(idx: number) {
  const chosen = detected.value[idx]
  if (!chosen) return
  // derive prefer id if not set
  const prefer = chosen.id || (chosen.provider?.isMetaMask ? 'metamask' : (chosen.provider?.isOkxWallet || chosen.provider?.isOKX || chosen.provider?.isOkx) ? 'okx' : 'injected')
  try {
    wallet.setError('')
    modalOpen.value = false
    const res = await wallet.connect(prefer, chosen.provider)
    // notify app that wallet connected so pages can refresh balances
    try {
      window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: res?.address ?? wallet.account } }))
    } catch (_e) {}
  } catch (e:any) {
    console.error('selectAndConnect failed', e)
    wallet.setError(e?.message ?? String(e))
    modalOpen.value = true
  }
}

function closeModal() {
  modalOpen.value = false
  detected.value = []
}

onMounted(async () => {
  // Try to silently restore previous wallet connection (no popup).
  try {
    if (wallet.restoreConnection) {
      const res = await wallet.restoreConnection()
      if (res && res.address) {
        try { window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: res.address } })) } catch (_e) {}
      }
    }
  } catch (e) {
    // ignore restore failures
  }
})

// No modal selection flow: provider registration is handled in `onConnectClick` above.
</script>

<template>
  <div class="layout" @click="closeAmmDropdown">
    <header class="topbar">
      <h2>BSM</h2>
      <nav class="nav">
        <router-link to="/" exact>Home</router-link>
        <router-link to="/Balance">Balances</router-link>
        <router-link to="/Mint">Mint</router-link>
        <router-link to="/Burn">Burn</router-link>
        <div class="nav-dropdown" @click.stop>
          <span class="nav-parent" @click="toggleAmmDropdown">AMM Pool ▾</span>
          <div class="nav-dropdown-content" :class="{ show: isAmmDropdownOpen }">
            <router-link to="/Amm" @click="closeAmmDropdown">AMM Home</router-link>
            <router-link to="/Amm/swap-stable" @click="closeAmmDropdown">Swap Stable</router-link>
            <router-link to="/Amm/swap-leverage" @click="closeAmmDropdown">Swap Leverage</router-link>
            <router-link to="/Amm/liquidity" @click="closeAmmDropdown">Liquidity Management</router-link>
          </div>
        </div>
        
        
        <div class="nav-dropdown" @click.stop>
          <span class="nav-parent" @click="toggleLiquidationDropdown">Liquidation ▾</span>
          <div class="nav-dropdown-content" :class="{ show: isLiquidationDropdownOpen }">
            <router-link to="/Liquidation/parameters" @click="closeAmmDropdown">Liquidation Parameters</router-link>
            <router-link to="/Liquidation/leverage-info" @click="closeAmmDropdown">Leverage Token Info</router-link>
            <router-link to="/Liquidation/auction" @click="closeAmmDropdown">Auction</router-link>
          </div>
        </div>
        <router-link to="/Oracle">Oracle</router-link>
        <router-link to="/Addresses">Deployed Addresses</router-link>
      </nav>
      <div class="right-controls">
        <!-- connection banner removed for modal-only selection flow -->
        <button class="btn-connect" @click="onConnectClick">{{ wallet.account ? 'Disconnect' : 'Connect Wallet' }}</button>
      </div>

      <!-- Global wallet selection modal -->
      <div v-if="modalOpen" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <h3>Select Wallet</h3>
          <p class="muted small">Choose which injected wallet to use for this site.</p>
          <div class="modal-list">
            <template v-if="detected && detected.length > 0">
              <div v-for="(d, i) in detected" :key="d.id + '-' + i" style="display:flex; align-items:center; gap:0.5rem">
                <button class="modal-item" :disabled="wallet.isConnecting && wallet.isConnecting()" @click="selectAndConnect(i)">
                  <div style="display:flex; flex-direction:column; align-items:flex-start">
                    <span style="font-weight:700">{{ d.name }}</span>
                    <small style="color:#6b7280">{{ d.provider && (d.provider.isMetaMask ? 'MetaMask' : d.provider.isOkxWallet ? 'OKX' : 'Injected') }}</small>
                  </div>
                </button>
              </div>
            </template>
            <template v-else>
              <div style="padding:1rem; color:#374151">
                <p style="margin:0 0 0.5rem 0; font-weight:600">No injected wallets detected</p>
                <p style="margin:0 0 0.5rem 0">{{ wallet.error || 'No injected wallet providers were found in your browser.' }}</p>
              </div>
            </template>
            <div v-if="wallet.isConnecting && wallet.isConnecting()" style="padding-top:0.5rem; color:#374151; display:flex; align-items:center; gap:0.5rem">
              <div class="loader" style="width:14px;height:14px;border-radius:50%;border:2px solid #cbd5e1;border-top-color:#42b983;animation:spin 0.9s linear infinite"></div>
              <div>Waiting for wallet popup... please check your wallet extension and approve the request.</div>
            </div>
            <div v-if="wallet.error" style="padding-top:0.5rem; color:#b91c1c">{{ wallet.error }}</div>
          </div>
          <div style="text-align:right; margin-top:0.5rem">
            <button class="btn secondary" @click="closeModal">Cancel</button>
          </div>
        </div>
      </div>
    </header>
    <main class="main-content">
      <h1>BSM Project</h1>
      <div class="global-wallet-status">
        <template v-if="wallet.account">
          <span class="provider-label">{{ wallet.preferredProvider === 'okx' ? 'OKX' : wallet.preferredProvider === 'metamask' ? 'MetaMask' : 'Injected' }}</span>
          <span class="mono">{{ shortAddr(wallet.account) }}</span>
        </template>
        <template v-else>
          <span class="not-connected">Wallet not connected</span>
        </template>
      </div>
      <router-view />
    </main>
  </div>
</template>



<style scoped>
.layout {
  min-height: 100vh;
  width: 100%;
  box-sizing: border-box;
  background: #f8f9fa;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}
  .topbar {
  width: 100%;
  background: #ffffff;
  color: #0f172a;
  display: flex;
  align-items: center;
  padding: 0 1.5rem 0 1rem;
  box-shadow: 0 2px 8px rgba(15,23,42,0.04);
  height: 64px;
  border-bottom: 1px solid #f1f3f5;
  box-sizing: border-box;
}
 .topbar h2 {
  margin-right: 1rem;
  font-size: 1.05em;
  letter-spacing: 1px;
  color: #0f172a;
  font-weight:800;
}
.nav {
  display: flex;
  gap: 1rem;
  flex: 1 1 auto;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
}
.nav a {
  color: #374151;
  text-decoration: none;
  font-size: 0.95em;
  padding: 0.35em 0.6em;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.nav a.router-link-active {
  background: linear-gradient(90deg,#4f46e5,#06b6d4);
  color: #fff;
  font-weight: 700;
}
.nav a:hover {
  background: #f1f5f9;
}
.nav-dropdown {
  position: relative;
  display: inline-block;
}
.nav-dropdown .nav-parent {
  color: #374151;
  text-decoration: none;
  font-size: 0.95em;
  padding: 0.35em 0.6em;
  border-radius: 6px;
  transition: background 0.15s;
  font-weight: 600;
  cursor: pointer;
  display: inline-block;
}
.nav-dropdown .nav-parent:hover {
  background: #f1f5f9;
}
.nav-dropdown-content {
  display: none;
  position: absolute;
  background: #ffffff;
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(2,6,23,0.06);
  z-index: 1000;
  border-radius: 8px;
  margin-top: 0.5em;
  border: 1px solid #f1f3f5;
}
.nav-dropdown-content.show {
  display: block;
}
.nav-dropdown-content a {
  color: #374151;
  padding: 0.6rem 0.9rem;
  text-decoration: none;
  display: block;
  font-size: 0.95em;
  border-radius: 6px;
}
.nav-dropdown-content a:hover {
  background: #f8fafc;
}
.global-wallet-status { margin: 0.5rem auto 1rem auto; display:flex; gap:0.6rem; align-items:center; justify-content:center; text-align:center }
.global-wallet-status .provider-label { font-weight:700; color:#374151; background:rgba(79,70,229,0.06); padding:0.18rem 0.45rem; border-radius:6px }
.global-wallet-status .mono { color:#6b7280; font-size:0.95rem }
.global-wallet-status .not-connected { color:#6b7280; font-size:0.95rem; font-weight:600 }
.nav-dropdown-content a.router-link-active {
  background: #42b983;
  font-weight: bold;
}
.main-content {
  width: 100%;
  margin: 0;
  flex: 1;
  padding: 0;
  box-sizing: border-box;
  overflow-x: hidden;
}
.btn-connect { background: linear-gradient(90deg,#4f46e5,#06b6d4); color:#fff; border:none; padding:0.35rem 0.7rem; border-radius:8px; cursor:pointer; font-size:0.9em; margin-right:0.25rem; font-weight:700 }
.account-badge { background:#eef2ff; color:#0f172a; padding:0.18rem 0.4rem; border-radius:6px; font-weight:600; font-size:0.9em }
.right-controls { margin-left: auto; display:flex; align-items:center; gap:0.5rem; padding-right:1.5rem; z-index:12 }
.modal-overlay { position:fixed; inset:0; background:rgba(2,6,23,0.5); display:flex; align-items:center; justify-content:center; z-index:60 }
.modal { background:white; padding:1rem 1.25rem; border-radius:12px; width:min(520px,90%); box-shadow:0 12px 40px rgba(2,6,23,0.4) }
.modal h3 { margin:0 0 0.25rem 0 }
.modal-list { display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem }
.modal-item { padding:0.5rem 0.75rem; border-radius:8px; border:1px solid rgba(15,23,42,0.06); background:linear-gradient(90deg,#f8fafc,#fff); cursor:pointer; text-align:left }
.btn.secondary { background:transparent; color:#374151; border:1px solid rgba(55,65,81,0.08); padding:0.4rem 0.6rem }
label {
  font-weight: bold;
  margin-right: 1em;
}
span {
  color: #333;
}
:global(html), :global(body) {
  overflow-x: hidden;
  width: 100%;
  margin: 0;
  padding: 0;
}

/* Global layout width: ensure all top-level page children share the same max width */
:global(:root) { --max-width: 980px }
.main-content { display: flex; flex-direction: column; align-items: center }
.main-content > * { width: 100%; max-width: var(--max-width); box-sizing: border-box }

@media (max-width: 900px) {
  .topbar { height: 52px }
  .nav { gap: 0.5rem }
  .nav a { padding: 0.25em 0.45em; font-size: 0.9em }
  .btn-connect { padding: 0.22rem 0.5rem; font-size: 0.85em }
}

@media (min-width: 1400px) {
  /* on very wide screens, give extra right breathing room */
  .right-controls { padding-right: 2.25rem }
}

@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
</style>

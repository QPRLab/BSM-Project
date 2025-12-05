import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WalletClient } from 'viem'
import { createWalletClientInstance } from '../utils/client'

export const useWalletStore = defineStore('wallet', () => {
  const account = ref<string | null>(null)
  const preferredProvider = ref<string | null>(null)
  const Sbalance = ref('')
  const Lbalance = ref('')
  const USDCbalance = ref('')
  const WLTCbalance = ref('')
  const error = ref('')
  const loading = ref(false)
  const walletClient = ref<WalletClient | null>(null)
  const connecting = ref(false)
  // support multiple provider connections (MetaMask, OKX, etc.)
  const connections = ref<Array<{ key: string; id: string; name: string; provider: any; address: string | null; client: WalletClient | null }>>([])
  // internal promise to dedupe concurrent connect callers
  let _connectPromise: Promise<any> | null = null

  function setAccount(addr: string | null, prefer?: string | null, client?: any | null) {
    account.value = addr
    if (prefer) preferredProvider.value = prefer
    // 如果调用方传入已经创建好的 client，直接使用它，避免重复选择不同的 provider
    if (client) {
      walletClient.value = client as WalletClient
      // find connection for this client/provider and update
      try {
        const conn = connections.value.find(c => c.client === null && c.address === null && c.id === (prefer ?? c.id))
        if (conn) {
          conn.address = addr
          conn.client = client as WalletClient
        }
      } catch (_e) {}
      return
    }
    // 当设置账户时，重新初始化 walletClient（只有在没有提供 client 的情况下）
    if (addr) {
      walletClient.value = createWalletClientInstance(addr, preferredProvider.value ?? undefined)
    }
  }

  function findConnectionByProvider(provider: any) {
    return connections.value.find(c => c.provider === provider)
  }

  function addOrGetConnection(provider: any, id: string, name: string) {
    // Prefer to dedupe by stable id if provided (e.g. 'metamask' / 'okx' / 'injected')
    if (id) {
      const byId = connections.value.find(c => c.id === id)
      if (byId) return byId
    }
    // Fallback: try matching by provider reference
    let existing = findConnectionByProvider(provider)
    if (existing) return existing

    // Create a stable-ish key based on id and current count for that id
    const sameIdCount = connections.value.filter(c => c.id === id).length
    const key = sameIdCount === 0 ? id : `${id}-${sameIdCount}`
    const conn = { key, id, name, provider, address: null as string | null, client: null as WalletClient | null }
    connections.value.push(conn)
    return conn
  }

  function getConnections() {
    return connections.value
  }

  function selectConnection(key: string) {
    const conn = connections.value.find(c => c.key === key)
    if (!conn) return
    account.value = conn.address
    walletClient.value = conn.client
    preferredProvider.value = conn.id
  }

  // Centralized connect flow: create wallet client with exact provider object used
  async function connect(prefer: string | null, provider: any) {
    // Deduplicate concurrent connect calls by returning the same promise
    if (_connectPromise) return _connectPromise
    _connectPromise = (async () => {
      if (connecting.value) return { address: account.value, client: walletClient.value }
      connecting.value = true
      // ensure a connection entry exists for this provider
      const conn = addOrGetConnection(provider, prefer ?? 'injected', provider?._name || (prefer ?? 'Injected Wallet'))
      try {
        // lazy import to avoid circular deps
        const { requestAccountsFrom } = await import('../utils/client')
        const accounts = await requestAccountsFrom(provider)
        const address = Array.isArray(accounts) ? accounts[0] : accounts
        if (!address) throw new Error('No account returned from provider')
        // create a wallet client using the exact provider object
        const client = createWalletClientInstance(address, prefer ?? undefined, provider)
        if (client) {
          // update connection and set active account
          conn.address = address
          conn.client = client as WalletClient
          setAccount(address, prefer ?? undefined, client)
        } else {
          // fallback: set only address on connection and active account
          conn.address = address
          setAccount(address, prefer ?? undefined)
        }
        setPreferredProvider(prefer)
        return { address, client: conn.client ?? walletClient.value }
      } finally {
        connecting.value = false
        _connectPromise = null
      }
    })()
    return _connectPromise
  }

  function isConnecting() {
    return connecting.value || !!_connectPromise
  }

  function disconnect() {
    // clear frontend state; wallets may still keep site authorized until user revokes in extension
    try { connecting.value = false } catch {}
    reset()
  }

  function disconnectOne(key?: string) {
    try { connecting.value = false } catch {};
    if (!key) return reset()
    const idx = connections.value.findIndex(c => c.key === key)
    if (idx === -1) return
    const removed = connections.value.splice(idx, 1)[0]
    // if removed connection was the active one, clear active client/account
    if (removed && removed.client && walletClient.value && removed.client === walletClient.value) {
      reset()
    }
  }
  
  function initWalletClient() {
    if (account.value) {
      walletClient.value = createWalletClientInstance(account.value, preferredProvider.value ?? undefined)
    } else {
      walletClient.value = createWalletClientInstance(undefined, preferredProvider.value ?? undefined)
    }
    return walletClient.value
  }

  function setPreferredProvider(p: string | null) {
    preferredProvider.value = p
    // persist preference
    try { localStorage.setItem('preferredProvider', p ?? '') } catch {}
  }

  // on load, restore preferredProvider
  try {
    const saved = localStorage.getItem('preferredProvider')
    if (saved) preferredProvider.value = saved
  } catch {}

  // Try to silently restore a previously authorized connection on page load.
  async function restoreConnection() {
    try {
      const w = (window as any)
      let chosenProvider: any = null
      // prefer explicit OKX object if user selected it
      if (w.okxwallet && preferredProvider.value === 'okx') chosenProvider = w.okxwallet
      // if multiple providers injected, try to pick by preference
      if (!chosenProvider && Array.isArray(w.ethereum?.providers)) {
        const providers = w.ethereum.providers
        if (preferredProvider.value === 'okx') {
          chosenProvider = providers.find((p: any) => p.isOkxWallet || p.isOKX || p.isOkx || p.isOKExWallet)
        } else if (preferredProvider.value === 'metamask') {
          chosenProvider = providers.find((p: any) => p.isMetaMask)
        }
        chosenProvider = chosenProvider || providers[0]
      }
      if (!chosenProvider) chosenProvider = w.ethereum || w.okxwallet || null
      if (!chosenProvider) return null

      // silent accounts query (eth_accounts) — should not prompt the user
      try {
        const accs = await chosenProvider.request({ method: 'eth_accounts' })
        if (Array.isArray(accs) && accs.length > 0) {
          const address = String(accs[0])
          const client = createWalletClientInstance(address, preferredProvider.value ?? undefined, chosenProvider)
          try {
            const conn = addOrGetConnection(chosenProvider, preferredProvider.value ?? 'injected', (chosenProvider?._name || preferredProvider.value) ?? 'Injected Wallet')
            conn.address = address
            conn.client = client as WalletClient | null
          } catch (_e) {}
          try { setAccount(address, preferredProvider.value ?? undefined, client) } catch (_e) {}
          return { address, client }
        }
      } catch (e) {
        // silent restore failed (no accounts or provider refused); ignore
        return null
      }
    } catch (e) {
      return null
    }
    return null
  }
  
  function setBalances({ S, L, USDC, WLTC }: { S: string; L: string; USDC: string; WLTC: string }) {
    Sbalance.value = S
    Lbalance.value = L
    USDCbalance.value = USDC
    WLTCbalance.value = WLTC
  }
  function setError(msg: string) {
    error.value = msg
  }
  function setLoading(val: boolean) {
    loading.value = val
  }
  function reset() {
    account.value = null
    Sbalance.value = ''
    Lbalance.value = ''
    USDCbalance.value = ''
    WLTCbalance.value = ''
    error.value = ''
    loading.value = false
    walletClient.value = null
  }

  return {
    account,
    preferredProvider,
    connections,
    Sbalance,
    Lbalance,
    USDCbalance,
    WLTCbalance,
    error,
    loading,
    connecting,
    walletClient,
    setAccount,
    setPreferredProvider,
    setBalances,
    setError,
    setLoading,
    initWalletClient,
    connect,
    disconnect,
    disconnectOne,
    addOrGetConnection,
    getConnections,
    selectConnection,
    reset
    ,restoreConnection
  }
})

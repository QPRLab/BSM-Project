import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WalletClient } from 'viem'
import { createWalletClientInstance } from '../utils/client.js'

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

  function setAccount(addr: string | null, prefer?: string | null) {
    account.value = addr
    if (prefer) preferredProvider.value = prefer
    // 当设置账户时，重新初始化 walletClient
    if (addr) {
      walletClient.value = createWalletClientInstance(addr, preferredProvider.value ?? undefined)
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
    Sbalance,
    Lbalance,
    USDCbalance,
    WLTCbalance,
    error,
    loading,
    walletClient,
    setAccount,
    setPreferredProvider,
    setBalances,
    setError,
    setLoading,
    initWalletClient,
    reset
  }
})

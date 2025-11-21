import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WalletClient } from 'viem'
import { createWalletClientInstance } from '../utils/client'

export const useWalletStore = defineStore('wallet', () => {
  const account = ref<string | null>(null)
  const Sbalance = ref('')
  const Lbalance = ref('')
  const USDCbalance = ref('')
  const WLTCbalance = ref('')
  const error = ref('')
  const loading = ref(false)
  const walletClient = ref<WalletClient | null>(null)

  function setAccount(addr: string | null) {
    account.value = addr
    // 当设置账户时，重新初始化 walletClient
    if (addr) {
      walletClient.value = createWalletClientInstance(addr)
    }
  }
  
  function initWalletClient() {
    if (account.value) {
      walletClient.value = createWalletClientInstance(account.value)
    } else {
      walletClient.value = createWalletClientInstance()
    }
    return walletClient.value
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
    Sbalance,
    Lbalance,
    USDCbalance,
    WLTCbalance,
    error,
    loading,
    walletClient,
    setAccount,
    setBalances,
    setError,
    setLoading,
    initWalletClient,
    reset
  }
})

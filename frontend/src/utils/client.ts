import { createPublicClient, createWalletClient, custom, http } from 'viem'
import { sepolia } from 'viem/chains'
import { useWalletStore } from '../stores/wallet.js'

// Allow safe referencing of `window` in this Vite/browser context for typechecking
declare const window: any

/**
 * Public Client - 用于读取区块链数据（只读操作）
 * 不需要钱包连接，可以直接使用
 */
export const publicClient = createPublicClient({
  chain: sepolia,
  //transport: http("https://sepolia.infura.io/v3/6d0e5a99e88d473f9f0399ffbeb74501"),//可用，自己注册的api
  //transport: http("https://rpc.sepolia.org"), // 不可用，公共 RPC 端点,打不开
  //transport: http("https://rpc.sepolia.gateway.fm"), //不可用
  transport: http("https://sepolia.gateway.tenderly.co"),//可用
  //其他可尝试的公共RPC端点
  /*
    https://ethereum-sepolia.publicnode.com
    https://endpoints.omniatech.io/v1/eth/sepolia/public
  */
})

// Discover injected providers in the page and return normalized entries.
export function getInjectedProviders() {
  const out: Array<{ id: string; name: string; provider: any; flags: Record<string, any> }> = []
  if (typeof window === 'undefined') return out
  const w = (window as any)

  // providers array (multiple injected providers)
  const providersArray = Array.isArray(w.ethereum?.providers) ? w.ethereum.providers : null
  if (providersArray && providersArray.length > 0) {
    for (const p of providersArray) {
      const flags: any = {
        isMetaMask: !!p?.isMetaMask,
        isOkxWallet: !!(p?.isOkxWallet || p?.isOKX || p?.isOkx || p?.isOKExWallet)
      }
      const id = flags.isMetaMask ? 'metamask' : (flags.isOkxWallet ? 'okx' : (p._name || 'injected'))
      out.push({ id, name: p._name || (flags.isMetaMask ? 'MetaMask' : flags.isOkxWallet ? 'OKX Wallet' : 'Injected Wallet'), provider: p, flags })
    }
    return out
  }

  // single-window.ethereum
  if (w.ethereum) {
    const p = w.ethereum
    const flags: any = { isMetaMask: !!p?.isMetaMask }
    const id = flags.isMetaMask ? 'metamask' : 'injected'
    out.push({ id, name: p._name || (flags.isMetaMask ? 'MetaMask' : 'Injected Wallet'), provider: p, flags })
  }

  // standalone okxwallet
  if (w.okxwallet) {
    const p = w.okxwallet
    const flags: any = { isOkxWallet: true }
    out.push({ id: 'okx', name: p._name || 'OKX Wallet', provider: p, flags })
  }

  return out
}

/**
 * 获取 Wallet Client - 用于发送交易（写入操作）
 * 需要用户先连接钱包
 */
export function getWalletClient() {
  const wallet = useWalletStore()

  // if store has an active walletClient, return it
  if (wallet.walletClient?.value) return wallet.walletClient.value

  // if there are explicit connections with clients, pick the first and set active
  try {
    const conns = (wallet.getConnections && wallet.getConnections()) || []
    const firstWithClient = conns.find((c: any) => c.client)
    if (firstWithClient) {
      wallet.selectConnection(firstWithClient.key)
      return wallet.walletClient?.value ?? firstWithClient.client
    }
  } catch (_e) {
    // ignore
  }

  // fallback: try init
  if (!wallet.walletClient?.value) {
    wallet.initWalletClient()
  }
  return wallet.walletClient?.value ?? null
}

/**
 * 检查钱包是否已连接
 */
export function isWalletConnected() {
  const wallet = useWalletStore()
  return !!wallet.account && !!wallet.walletClient?.value
}

/**
 * 直接创建 Wallet Client（如果需要）
 * 一般情况下应该使用 store 中的 walletClient
 * @param account - 用户的钱包地址
 */
// export function createWalletClientInstance(account?: string) {
//   if (typeof window !== 'undefined' && window?.ethereum) {
//     const clientConfig: any = {
//       chain: sepolia,
//       transport: custom(window.ethereum)
//     }
    
//     // 如果提供了账户地址，添加到配置中
//     if (account) {
//       clientConfig.account = account as `0x${string}`
//     }
    
//     return createWalletClient(clientConfig)
//   }
//   return null
// }


// frontend/src/utils/client.ts （核心片段）
export function createWalletClientInstance(account?: string, prefer?: 'okx' | 'metamask' | string, rawProvider?: any) {
  if (typeof window === 'undefined') return null;

  // 如果未传 prefer，则尝试从全局 store 中读取用户偏好
  try {
    const wallet = useWalletStore()
    if (!prefer && wallet?.preferredProvider) {
      prefer = wallet.preferredProvider as any
    }
  } catch (err) {
    // ignore store read errors in non-Vue contexts
  }

  // 如果多个 provider 注入，尝试选择指定钱包
  let chosenProvider = (window as any).ethereum || null;

  // 直接支持单独注入的 okxwallet 对象
  if (!chosenProvider && (window as any).okxwallet) {
    chosenProvider = (window as any).okxwallet;
  }

  // 如果有 providers 数组（多个钱包同时注入），按 prefer 或常用顺序选择
  const providersArray = Array.isArray((window as any).ethereum?.providers) ? (window as any).ethereum.providers as any[] : null;
  if (providersArray && providersArray.length > 0) {
    if (prefer === 'okx') {
      chosenProvider = providersArray.find(p => p.isOkxWallet || p.isOKX || p.isOKXWallet || p.isOkx || p.isOKExWallet) || chosenProvider;
    } else if (prefer === 'metamask') {
      chosenProvider = providersArray.find(p => p.isMetaMask) || chosenProvider;
    } else {
      // 默认优先 MetaMask -> OKX -> 首个 provider
      chosenProvider = providersArray.find(p => p.isMetaMask) || providersArray.find(p => p.isOkxWallet || p.isOKX || p.isOkx) || providersArray[0] || chosenProvider;
    }
  }

  // If caller provided a raw provider instance, prefer that transport so the
  // same provider object used for `eth_requestAccounts` is also used by viem.
  const providerToUse = rawProvider ?? chosenProvider;

  if (!providerToUse) {
    console.warn('No injected wallet provider found on window (ethereum / okxwallet)')
    return null
  }

  // 最终创建 viem wallet client，包裹在 try/catch 以便捕获 provider 不兼容的情况
  try {
    const clientConfig: any = {
      chain: sepolia,
      transport: custom(providerToUse),
    };
    if (account) clientConfig.account = account as `0x${string}`;
    return createWalletClient(clientConfig);
  } catch (err) {
    console.error('createWalletClientInstance failed to create client with chosen provider:', err);
    return null;
  }
}

// Serialize eth_requestAccounts calls across the app to avoid provider errors like
// "Already processing eth_requestAccounts. Please wait." when multiple callers
// try to request accounts concurrently. This returns the same shape as the
// provider.request call (array or single string as provided by wallet).
let _accountRequestPromise: Promise<any> | null = null
export async function requestAccountsFrom(provider: any, timeoutMs = 20000) {
  if (!provider) throw new Error('No provider passed to requestAccountsFrom')
  if (_accountRequestPromise) return _accountRequestPromise

  _accountRequestPromise = (async () => {
    // QUICK CHECK: if the site already has accounts authorized, prefer that
    try {
      const quick = await Promise.race([
        provider.request({ method: 'eth_accounts' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('quick-eth_accounts-timeout')), 500))
      ])
      if (Array.isArray(quick) && quick.length > 0) return quick
    } catch (_e) {
      // ignore quick check failures and proceed to prompt
    }
    const start = Date.now()
    const deadline = start + timeoutMs
    let lastErr: any = null
    // retry loop: handle provider errors like "Already processing eth_requestAccounts"
    let attempt = 0
    while (Date.now() < deadline) {
      attempt += 1
      try {
        // try a normal request and race with a short timeout to avoid hanging indefinitely
        const req = provider.request({ method: 'eth_requestAccounts' })
        const remaining = Math.max(1000, deadline - Date.now())
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('eth_requestAccounts timeout')), Math.min(remaining, 5000)))
        const accs = await Promise.race([req, timeout])
        return accs
      } catch (e: any) {
        lastErr = e
        const code = e?.code ?? e?.data?.code
        const msg = String(e?.message || e)
        // If provider reports it's already processing, wait a bit and retry
        if (code === -32002 || msg.includes('Already processing') || msg.includes('processing eth_requestAccounts')) {
          // If we've tried a few times, surface a clear error so UI can inform the user to check wallet popup
          if (attempt >= 4) {
            throw new Error('Wallet UI is already processing a request. Please check your wallet extension popup and approve/deny the request.')
          }
          // backoff a bit (increase wait with attempts)
          const waitMs = Math.min(1500, 300 + attempt * 200)
          await new Promise(r => setTimeout(r, waitMs))
          // try eth_accounts to see if the user granted access in the meantime
          try {
            const accs = await provider.request({ method: 'eth_accounts' })
            if (Array.isArray(accs) && accs.length > 0) return accs
          } catch (_e) {
            // ignore and continue retrying
          }
          continue
        }
        // For other errors, rethrow immediately
        throw e
      }
    }
    // timed out
    throw lastErr ?? new Error('eth_requestAccounts failed or timed out')
  })()
  try {
    return await _accountRequestPromise
  } finally {
    _accountRequestPromise = null
  }
}

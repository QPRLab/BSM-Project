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

/**
 * 获取 Wallet Client - 用于发送交易（写入操作）
 * 需要用户先连接钱包
 */
export function getWalletClient() {
  const wallet = useWalletStore()
  
  // 如果还没有初始化，尝试初始化
  if (!wallet.walletClient) {
    wallet.initWalletClient()
  }
  
  return wallet.walletClient
}

/**
 * 检查钱包是否已连接
 */
export function isWalletConnected() {
  const wallet = useWalletStore()
  return !!wallet.account && !!wallet.walletClient
}

/**
 * 直接创建 Wallet Client（如果需要）
 * 一般情况下应该使用 store 中的 walletClient
 * @param account - 用户的钱包地址
 */
export function createWalletClientInstance(account?: string) {
  if (typeof window !== 'undefined' && window?.ethereum) {
    const clientConfig: any = {
      chain: sepolia,
      transport: custom(window.ethereum)
    }
    
    // 如果提供了账户地址，添加到配置中
    if (account) {
      clientConfig.account = account as `0x${string}`
    }
    
    return createWalletClient(clientConfig)
  }
  return null
}

// contracts.ts
// 工具：集中创建合约实例（只读缓存 + 钱包工厂），并按需懒加载 ABI
// 使用示例见文件底部注释。

import { getContract } from 'viem'
import { publicClient } from './client'
import deployed from '../config/deployed_addresses.json'

// Static ABI imports for files that may not resolve with dynamic import during Vite dev
// Note: avoid static imports for ABI files with special characters to prevent Vite resolution errors

type AddrMap = Record<string, string>
const ADDRESSES = deployed as unknown as AddrMap

// 只读合约缓存：key = address::clientId
const readonlyCache = new Map<string, ReturnType<typeof getContract>>()
function cacheKey(address: string, clientId: string) {
  return `${address.toLowerCase()}::${clientId}`
}

// ABI 加载：尝试常见路径，优先使用明确 name 映射
async function loadAbi(name: string): Promise<any> {
  // 常用显式映射（根据项目中 ABI 文件命名约定）
  const map: Record<string, string> = {
    'AMMLiquidity': '../abi/AMMLiquidity.json',
    'AMMSwap': '../abi/AMMSwap.json',
    'LPToken': '../abi/LPToken.json',
    'StableToken': '../abi/StableToken.json',
    'USDCMock': '../abi/USDCMock.json',
    'WLTCMock': '../abi/WLTCMock.json',
    'MultiLeverageToken': '../abi/MultiLeverageToken.json',
    'CustodianFixed': '../abi/CustodianFixed.json',
    'LTCPriceOracle': '../abi/LTCPriceOracle.json',
    'LiquidationManager': '../abi/LiquidationManager.json',
    'AuctionManager': '../abi/AuctionManager.json'
  }


  const candidates: string[] = []
  if (map[name]) candidates.push(map[name])
  // fallback: ABI files are now named by short contract name (e.g. AMMLiquidity.json)
  candidates.push(`../abi/${name}.json`)

  for (const p of candidates) {
    try {
      // dynamic import ensures ABI not necessarily bundled until needed
      // Use Vite ignore to suppress static-analysis warning about variable import paths
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = await import(/* @vite-ignore */ p)
      // some JSON modules are exported as default, some directly
      return (mod && (mod.default ?? mod))
    } catch (e) {
      // try next
    }
  }
  throw new Error(`ABI for ${name} not found (tried: ${candidates.join(', ')})`)
}

/**
 * 获取只读合约（使用 publicClient），返回 Promise<Contract>
 * 可安全在组件间复用（内部缓存）
 * @param addressKey deployed_addresses.json 中的 key，例如 'ammModules#AMMLiquidity'
 * @param abiName 可选 ABI 名称（例如 'AMMLiquidity'），如未提供会尝试从 key 中提取短名
 */
export async function getReadonlyContract(addressKey: string, abiName?: string) {
  const address = ADDRESSES[addressKey]
  if (!address) throw new Error(`Missing address for ${addressKey}`)
  const key = cacheKey(address, 'publicClient')
  if (readonlyCache.has(key)) return readonlyCache.get(key)!

  const name = abiName ?? (addressKey.includes('#') ? addressKey.split('#').pop() as string : addressKey)
  const abiMod = await loadAbi(name)
  const abi = (abiMod && (abiMod.abi ?? abiMod))
  const c = getContract({ address: address as `0x${string}`, abi, client: publicClient })
  readonlyCache.set(key, c)
  return c
}

/**
 * 获取钱包绑定的合约（用于写操作）。注意：不要长期缓存 walletClient 绑定的实例，
 * 如果 walletClient 或 account/network 改变，需要重新调用该函数以获得新的实例。
 */
export async function getWalletContract(addressKey: string, walletClient: any, abiName?: string) {
  if (!walletClient) throw new Error('walletClient required for wallet-bound contract')
  const address = ADDRESSES[addressKey]
  if (!address) throw new Error(`Missing address for ${addressKey}`)
  const name = abiName ?? (addressKey.includes('#') ? addressKey.split('#').pop() as string : addressKey)
  const abiMod = await loadAbi(name)
  const abi = (abiMod && (abiMod.abi ?? abiMod))
  return getContract({ address: address as `0x${string}`, abi, client: walletClient })
}

// 可选：导出一些常用的快捷 Getter（示例）
export async function getAmmLiquidityReadonly() {
  return getReadonlyContract('AMMLiquidity', 'AMMLiquidity')
}

export async function getAmmSwapReadonly() {
  return getReadonlyContract('AMMSwap', 'AMMSwap')
}

/*
Usage example:

import { getReadonlyContract, getWalletContract } from '../utils/contracts'
import { useWalletStore } from '../stores/wallet'

// 只读
const amm = await getReadonlyContract('ammModules#AMMLiquidity', 'AMMLiquidity')
const reserves = await amm.read.getReserves?.()

// 写（钱包）
const wallet = useWalletStore()
if (wallet.walletClient) {
  const ammWrite = await getWalletContract('ammModules#AMMLiquidity', wallet.walletClient, 'AMMLiquidity')
  const tx = await ammWrite.write.addLiquidityStable?.([amount])
}

Notes:
- 不要把 wallet-bound 合约做为长期单例；在 walletClient 改变时重建。
- 只读合约使用 publicClient 缓存，安全且可复用。
*/

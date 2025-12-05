<template>
  <div class="leverage-info-page">
    <h2>Leverage Token Info (Test Addresses)</h2>

    <div class="controls">
      <button class="refresh-btn" @click="refreshAll" :disabled="loading">Refresh</button>
      <span v-if="loading">Loading...</span>
      <span v-if="error" class="error">{{ error }}</span>
    </div>

    <div class="user-block">
      <div v-if="tableRows.length > 0">
        <table class="param-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Token ID</th>
              <th>Balance</th>
              <th>Leverage</th>
              <th>Mint Price</th>
              <th>Accrued Interest</th>
              <th>NAV</th>
              <th>NAV(EX-Dividend)</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tableRows" :key="row.address + '-' + row.tokenId">
              <td>{{ formatAddress(row.address) }}</td>
              <td>{{ row.tokenId }}</td>
              <td>{{ formatNumber(row.balanceHuman) }}</td>
              <td><span :class="['lev', row.leverageClass]">{{ row.leverageLabel }}</span></td>
              <td>{{ formatNumber(row.mintPriceHuman) }}</td>
              <td>{{ formatNumber(row.accruedHuman) }}</td>
              <td>{{ formatNumber(row.totalNavHuman, 4) }}</td>
              <td>{{ formatNumber(row.netNavHuman, 4) }}</td>
              <td>
                <span v-if="row.netNavNumber === null">-</span>
                <span v-else-if="row.netNavNumber > 1" class="risk safe">Safe</span>
                <span v-else-if="row.netNavNumber >= 0.8" class="risk low">Low</span>
                <span v-else-if="row.netNavNumber >= 0.5" class="risk medium">Medium</span>
                <span v-else-if="row.netNavNumber >= 0.3" class="risk high">High</span>
                <span v-else class="risk bark">
                   <button class="bark-btn" @click="callBark(row.address, row.tokenId)" :disabled="barking">bark</button>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else>
        <p>No leverage tokens found for any of the configured users.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { formatEther } from 'viem'
import { publicClient } from '../utils/client'
import { getReadonlyContract, getWalletContract } from '../utils/contracts'
import { LiquidationManagerAddress } from '../config/addresses'
import { useWalletStore } from '../stores/wallet'
import { createWalletClientInstance } from '../utils/client'

const addresses = [
  '0x4845d4db01b81A15559b8734D234e6202C556d32',
  '0x6bCf5fbb6569921c508eeA15fF16b92426F99218',
  '0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B',
  '0xA4b399a194e2DD9b84357E92474D0c32e3359A74'
]

const results: Record<string, Array<any>> = {}
const tableRows = ref<Array<any>>([])
const loading = ref(false)
const error = ref<string | null>(null)
const barking = ref(false)

async function fetchForAddress(addr: string) {
  try {
    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    const rawInfo: any = await (custodian as any).read.getAllLeverageTokenInfo?.([addr])
    if (!rawInfo) return []
    const tokenIds = (rawInfo[0] ?? []) as bigint[]
    const balances = (rawInfo[1] ?? []) as bigint[]
    const leverages = (rawInfo[2] ?? []) as bigint[]
    const mintPrices = (rawInfo[3] ?? []) as bigint[]
    const accrued = (rawInfo[4] ?? []) as bigint[]

    const rows: Array<any> = []
    for (let i = 0; i < tokenIds.length; i++) {
      const tokenId = tokenIds[i]
      const balance = balances[i]
      const mintPrice = mintPrices[i]
      const acc = accrued[i]

      // attempt to fetch net NAV via getSingleLeverageTokenNavV2
      let netNav: bigint | null = null
      let totalNav: bigint | null = null
      try {
        const navTuple: any = await (custodian as any).read.getSingleLeverageTokenNavV2?.([addr, tokenId])
        if (navTuple) {
          netNav = navTuple[2] as bigint
          totalNav = navTuple[1] as bigint
          console.log('nav', netNav, totalNav)
        }
      } catch (e) {
        netNav = null
      }

      const netNavHuman = netNav ? formatEther(netNav) : undefined
      const netNavNumber = netNav ? Number(netNavHuman) : null
      const totalNavHuman = totalNav ? formatEther(totalNav) : undefined
      const totalNavNumber = totalNav ? Number(totalNavHuman) : null

      // safe defaults to avoid TS errors
      const safeBalance = balance ?? 0n
      const safeMint = mintPrice ?? 0n
      const safeAcc = acc ?? 0n

      // leverage label/class
      const levRaw = leverages[i]
      const levNum = levRaw !== undefined ? Number(levRaw) : null
      let levLabel = '-'
      let levClass = ''
      if (levNum === 0) {
        levLabel = 'Conservative'
        levClass = 'conservative'
      } else if (levNum === 1) {
        levLabel = 'Moderate'
        levClass = 'moderate'
      } else if (levNum === 2) {
        levLabel = 'Aggressive'
        levClass = 'aggressive'
      }

      rows.push({
        tokenId: tokenId?.toString() ?? '0',
        balanceRaw: safeBalance.toString(),
        balanceHuman: formatEther(safeBalance as bigint),
        mintPriceRaw: safeMint.toString(),
        mintPriceHuman: formatEther(safeMint as bigint),
        accruedRaw: safeAcc.toString(),
        accruedHuman: formatEther(safeAcc as bigint),
        netNavRaw: netNav ? netNav.toString() : undefined,
        netNavHuman,
        netNavNumber,
        totalNavHuman,
        totalNavNumber,
        leverageLabel: levLabel,
        leverageClass: levClass
      })
    }
    return rows
  } catch (e:any) {
    console.error('fetch failed', addr, e)
    throw e
  }
}

// (ABI normalization removed — ABI loaded by contract helpers)

async function refreshAll() {
  loading.value = true
  error.value = null
  try {
    const combined: Array<any> = []
    for (const addr of addresses) {
      const rows = await fetchForAddress(addr)
      results[addr] = rows
      if (rows && rows.length > 0) {
        for (const r of rows) {
          combined.push({ address: addr, ...r })
        }
      }
    }
    tableRows.value = combined
  } catch (e:any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

async function callBark(userAddr: string, tokenIdStr: string) {
  try {
    barking.value = true
    // prefer the connected wallet from the Pinia store
    const { caller, walletClient } = await ensureWalletClient()

    const liqContract = await getWalletContract('coreModules#LiquidationManager', walletClient, 'LiquidationManager')
    const liqAbi = (liqContract as any).abi
    if (!liqAbi || liqAbi.length === 0) throw new Error('LiquidationManager ABI not found or empty')

    // tokenId as BigInt
    const tokenId = BigInt(tokenIdStr)

    // estimate gas and clamp to a safe value under the latest block gasLimit
    let gasLimitOverride: bigint | undefined = undefined
    try {
      const estimated = await publicClient.estimateContractGas({
        address: LiquidationManagerAddress as `0x${string}`,
        abi: liqAbi,
        functionName: 'bark',
        args: [userAddr, tokenId, caller],
        account: caller as `0x${string}`
      })

      // add small headroom (30%) but keep it below block gas limit - 100k
      const headroom = (estimated * 13n) / 10n
      const latestBlock = await publicClient.getBlock({ blockTag: 'latest' })
      const blockGasLimit = latestBlock?.gasLimit ?? 16777216n
      const cap = blockGasLimit > 100000n ? blockGasLimit - 100000n : blockGasLimit
      gasLimitOverride = headroom > cap ? cap : headroom
    } catch (estErr) {
      // estimation failed; leave gasLimitOverride undefined so wallet can try a default
      console.warn('gas estimate failed, letting wallet choose gas', estErr)
    }

    const writeArgs: any[] = [userAddr, tokenId, caller]
    console.log('calling bark with args:', writeArgs)
    const writeOverrides: Record<string, any> = {}
    if (gasLimitOverride) writeOverrides.gas = gasLimitOverride

    const tx = await (liqContract as any).write.bark(writeArgs, writeOverrides)
    // wait for receipt (uses publicClient)
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    // refresh after successful bark
    await refreshAll()
  } catch (e:any) {
    // Log full error details to help debugging (viem errors have nested properties)
    try {
      console.error('bark failed full error:', e, '\nstringified:', JSON.stringify(e, Object.getOwnPropertyNames(e)))
    } catch (_) {
      console.error('bark failed (could not stringify) - raw:', e)
    }
    alert('bark failed: ' + (e?.message ?? String(e)))
  } finally {
    barking.value = false
  }
}

// helper: ensure wallet client and account (shared pattern with Mint/Auction)
async function ensureWalletClient() {
  const wallet = useWalletStore()

  // reuse existing stored client if present
  try {
    const existingClient = (wallet.walletClient as any)?.value
    const existingAccount = wallet.account as string | null
    if (existingClient && existingAccount) {
      return { caller: existingAccount, walletClient: existingClient }
    }
  } catch {}

  // pick provider according to saved preference (avoid unconditional window.ethereum.request)
  const w = (window as any)
  let chosenProvider: any = null

  // prefer explicit OKX object
  if (w.okxwallet && wallet.preferredProvider === 'okx') chosenProvider = w.okxwallet

  // if providers array exists, choose according to preference
  if (!chosenProvider && Array.isArray(w.ethereum?.providers)) {
    const providers = w.ethereum.providers
    if (wallet.preferredProvider === 'okx') {
      chosenProvider = providers.find((p: any) => p.isOkxWallet || p.isOKX || p.isOkx || p.isOKExWallet)
    } else if (wallet.preferredProvider === 'metamask') {
      chosenProvider = providers.find((p: any) => p.isMetaMask)
    }
    chosenProvider = chosenProvider || providers[0]
  }

  // fallback to window.ethereum or okxwallet
  if (!chosenProvider) chosenProvider = w.ethereum || w.okxwallet || null

  if (!chosenProvider) throw new Error('No injected wallet found')

  const { requestAccountsFrom } = await import('../utils/client')
  const accounts = await requestAccountsFrom(chosenProvider) as string[]
  const caller = accounts && accounts.length > 0 ? accounts[0] : null
  if (!caller) throw new Error('No account available')

  const walletClient: any = createWalletClientInstance(caller, wallet.preferredProvider ?? undefined, chosenProvider)
  if (!walletClient) throw new Error('Could not create wallet client')

  // persist account and the exact wallet client into store for other pages
  try { wallet.setAccount(caller, wallet.preferredProvider ?? undefined, walletClient) } catch {}

  return { caller, walletClient }
}

// auto refresh on mount
refreshAll()


function formatNumber(v?: string, decimals = 2) {
  if (v === undefined || v === null) return '-'
  const n = Number(v)
  if (isNaN(n)) return '-'
  return n.toFixed(decimals)
}

function formatAddress(a?: string) {
  if (!a) return '-'
  // show first 8 characters for brevity (including '0x' if present)
  return a.slice(0, 8)
}
</script>

<style scoped>
.leverage-info-page { max-width:1000px; margin:0 auto; color:#0f172a; padding:1rem }
.controls { display:flex; gap:0.75rem; align-items:center; margin-bottom:1rem }
.refresh-btn { padding:0.45rem 0.75rem; border-radius:6px; border:1px solid rgba(79,70,229,0.12); background:rgba(79,70,229,0.06); color:#4f46e5; cursor:pointer }
.refresh-btn:disabled { opacity:0.6; cursor:not-allowed }

.user-block { margin-bottom:1.25rem }
.param-table { width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #f1f3f5; border-radius:8px; overflow:hidden }
.param-table thead th { background:#ffffff; color:#374151; font-weight:700; padding:0.75rem; border-bottom:1px solid #f1f3f5; text-align:left }
.param-table tbody td { padding:0.65rem 0.75rem; border-bottom:1px solid #f7f9fb; color:#374151 }
.param-table tbody tr:last-child td { border-bottom:none }

.error { color:#ef4444 }

/* risk labels */
.risk { padding: 0.25rem 0.5rem; border-radius: 0.25rem; color: #fff; font-weight:600; display:inline-block; min-width:88px; text-align:center }
.risk.safe { background: #10b981 }
.risk.low { background: #f59e0b }
.risk.medium { background: #f97316 }
.risk.high { background: #dc2626 }
.risk.bark { display:inline-block }

/* bark button - primary gradient */
.bark-btn { background: linear-gradient(90deg,#4f46e5,#06b6d4); color:#fff; border:none; padding:0.35rem 0.6rem; border-radius:6px; cursor:pointer }
.bark-btn:disabled { opacity:0.6; cursor:not-allowed }

/* leverage labels */
.lev { display:inline-block; padding: 0.25rem 0.5rem; border-radius:0.25rem; color:#fff; font-weight:700; min-width:88px; text-align:center }
.lev.conservative { background: #f59e0b }
.lev.moderate { background: #f97316 }
.lev.aggressive { background: #b91c1c }

@media (max-width: 640px) { .param-table thead th { font-size:0.8rem } .param-table tbody td { font-size:0.85rem } }
</style>

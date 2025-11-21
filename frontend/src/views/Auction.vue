<template>
  <div class="liquidation-page">
    <h2>Auction List</h2>

    <div class="controls">
      <button class="refresh-btn" @click="refreshAll" :disabled="loading">Refresh</button>
      <span v-if="loading">Loading...</span>
      <span v-if="error" class="error">{{ error }}</span>
    </div>

    <!-- Auction summary -->
    <div class="auction-summary">
      <strong>Total auctions:</strong> {{ totalAuctionsCount ?? '-' }} &nbsp; 
      <strong>Active auctions:</strong> {{ activeAuctionsCount ?? '-' }}
    </div>

    <div v-if="auctionsRows.length > 0">
      <table class="param-table">
        <thead>
          <tr>
            <th>Auction ID</th>
            <th>Original Owner</th>
            <th>Token ID</th>
            <th>Underlying Amount</th>
            <th>Balance</th>
            <th>Starting Price</th>
            <th>Current Price</th>
            <th>NeedToReset</th>
            <th>IsUnderLiquidation</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in auctionsRows" :key="'auction-'+a.id">
            <td>{{ a.id }}</td>
            <td>{{ formatAddress(a.originalOwner) }}</td>
            <td>{{ a.tokenId }}</td>
            <td>{{ formatNumber(a.underlyingAmountHuman) }}</td>
            <td>{{ a.liqBalanceHuman ?? '-' }}</td>
            <td>{{ formatNumber(a.startingPriceHuman) }}</td>
            <td>{{ formatNumber(a.currentPriceHuman) }}</td>
            <td>{{ a.needsReset ? 'Yes' : 'No' }}</td>
            <td>{{ a.isUnderLiquidation ? 'Yes' : 'No' }}</td>
            <td>
              <div v-if="!a.isUnderLiquidation">
                <button class="action-btn" @click="handleWithdraw(a)" :disabled="!(connectedAccount && connectedAccount.toLowerCase() === a.originalOwner.toLowerCase())">Withdraw</button>
                <span v-if="!(connectedAccount && connectedAccount.toLowerCase() === a.originalOwner.toLowerCase())">-</span>
              </div>
              <div v-else>
                <button class="action-btn" v-if="a.needsReset" @click="handleReset(a)">Reset</button>
                <button class="action-btn" v-else @click="handleBid(a)">Bid</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else>
      <p>No auctions found.</p>
    </div>
    
    <hr style="margin:1.5rem 0" />

    <!-- Withdraw Status block (for connected wallet) -->
    <div class="withdraw-section">
      <h2>Withdraw Status</h2>
      <div v-if="withdrawError" class="error">{{ withdrawError }}</div>
      <div v-else>
        <table class="param-table" v-if="withdrawRows.length > 0">
          <thead>
            <tr>
              <th>Address</th>
              <th>Auction ID</th>
              <th>Token ID</th>
              <th>StableNums</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in withdrawRows" :key="'withdraw-'+r.tokenId">
              <td>{{ formatAddress(r.address) }}</td>
              <td>{{ r.auctionId }}</td>
              <td>{{ r.tokenId }}</td>
              <td>{{ formatNumber(r.stableNumsHuman) }}</td>
              <td>
                <button class="action-btn" @click="handleWithdraw(r)" :disabled="!(connectedAccount && connectedAccount.toLowerCase() === r.address.toLowerCase())">Withdraw</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else>
          <p>No withdrawable tokens for the connected account.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { getContract, formatEther, parseEther } from 'viem'
import { publicClient, createWalletClientInstance } from '../utils/client'
import { getReadonlyContract, getWalletContract } from '../utils/contracts'
import { CustodianFixedAddress} from '../config/addresses'
// minimal ERC20 ABI for approve
const ERC20_ABI = [
  { "type": "function", "name": "approve", "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "outputs": [{ "type": "bool" }] }
]

if (!CustodianFixedAddress) throw new Error('Custodian address missing in frontend config: coreModules#CustodianFixed')

const addresses = [
  '0x4845d4db01b81A15559b8734D234e6202C556d32',
  '0x6bCf5fbb6569921c508eeA15fF16b92426F99218',
  '0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B',
  '0xA4b399a194e2DD9b84357E92474D0c32e3359A74'
]

const rows = ref<Array<any>>([])
const loading = ref(false)
const error = ref<string | null>(null)
const totalAuctionsCount = ref<number | null>(null)
const activeAuctionsCount = ref<number | null>(null)
const auctionsRows = ref<Array<any>>([])
const connectedAccount = ref<string | null>(null)
const withdrawRows = ref<Array<any>>([])
const withdrawError = ref<string | null>(null)

async function loadConnectedAccount() {
  try {
    if (typeof (window as any).ethereum !== 'undefined') {
      const accs = await (window as any).ethereum.request({ method: 'eth_accounts' }) as string[]
      connectedAccount.value = (accs && accs.length > 0) ? String(accs[0]) : null
      if (connectedAccount.value) {
        // refresh withdraw info for this account
        try { await refreshWithdrawStatus() } catch (_) {}
      }
    }
  } catch (e) {
    connectedAccount.value = null
  }
}
loadConnectedAccount()

function formatNumber(v?: string) {
  if (v === undefined || v === null) return '-'
  const n = Number(v)
  if (isNaN(n)) return '-'
  return n.toFixed(2)
}
function formatAddress(a?: string) { if (!a) return '-'; return a.slice(0,8) }

async function refreshAll() {
  loading.value = true
  error.value = null
  rows.value = []
  try {
    console.log('Fetching liquidation info for addresses:', addresses[0])
    // resolve auction manager (prefer configured address)
    let auc = await getReadonlyContract('coreModules#AuctionManager', 'AuctionManager')


    //获取AuctionManger中的totalAuctions和activeAuctionCount
    const [totalAuctions, activeAuctionCount] = await Promise.all([
      (auc as any).read.totalAuctions?.(),
      (auc as any).read.activeAuctionCount?.()
    ])
    // set reactive counters
    totalAuctionsCount.value = totalAuctions ? Number(totalAuctions) : 0
    activeAuctionsCount.value = activeAuctionCount ? Number(activeAuctionCount) : 0
    console.log('Total auctions:', totalAuctionsCount.value, 'Active auctions:', activeAuctionsCount.value)

    // iterate all auctions and read mapping
    auctionsRows.value = []
    // resolve liquidation manager (prefer configured)
    let liq = await getReadonlyContract('coreModules#LiquidationManager', 'LiquidationManager')
    const total = totalAuctionsCount.value
    for (let i = 1; i <= total; i++) {
      try {
        const id = BigInt(i)
        const a: any = await (auc as any).read.auctions?.([id])
        if (!a) continue
        // struct Auction: (arrayIndex, underlyingAmount, originalOwner, tokenId, startTime, startingPrice, currentPrice, totalPayment)
        const underlyingAmount = a[1] as bigint
        const originalOwner = a[2] as string
        const tokenId = a[3] as bigint
        const startTime = a[4] as bigint
        const startingPrice = a[5] as bigint
        const currentPrice = a[6] as bigint
        const totalPayment = a[7] as bigint
        const isActive: boolean = Boolean((await (auc as any).read.auctionIsActive?.([id])) ?? false)

            // only include active auctions in the displayed table
            if (!isActive) continue

            // check if auction needs reset
            let needsReset = false
            try {
              const status: any = await (auc as any).read.getAuctionStatus?.([id])
              if (status) {
                needsReset = Boolean(status[0])
              }
            } catch (e) {
              // getAuctionStatus may revert for inactive auctions; we already filtered active ones, but guard anyway
              console.warn('getAuctionStatus failed for', i, e)
            }

            // attempt to read liquidation status for (originalOwner, tokenId)
        let liqBalanceHuman: string | undefined = undefined
        let isLiquidated = false
        let isUnderLiquidation = false
        let isFreezed = false
        if (liq) {
          try {
            const liqStatus: any = await (liq as any).read.userLiquidationStatus?.([originalOwner, tokenId])
            if (liqStatus) {
              const bal = liqStatus[0] as bigint
              liqBalanceHuman = formatEther(bal)
              isLiquidated = Boolean(liqStatus[3])
              isUnderLiquidation = Boolean(liqStatus[4])
              isFreezed = Boolean(liqStatus[5])
            }
          } catch (e) {
            console.warn('Failed to read userLiquidationStatus for', originalOwner, tokenId?.toString(), e)
          }
        }

        auctionsRows.value.push({
          id: i,
          underlyingAmountHuman: formatEther(underlyingAmount),
          originalOwner,
          tokenId: tokenId?.toString() ?? '0',
          liqBalanceHuman,
          isLiquidated,
          isUnderLiquidation,
          isFreezed,
          needsReset,
          startTimeHuman: startTime && Number(startTime) > 0 ? new Date(Number(startTime) * 1000).toLocaleString() : '-',
          startingPriceHuman: formatEther(startingPrice),
          currentPriceHuman: formatEther(currentPrice),
          totalPaymentHuman: formatEther(totalPayment),
          isActive
        })
      } catch (e) {
        // continue on error per-auction
        console.warn('Failed to read auction', i, e)
        continue
      }
    }
    

  } catch (e:any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
    // If a wallet is connected, refresh the withdraw status as well.
    // Run in background so the main refresh stays responsive and doesn't wait on token enumeration.
    try {
      if (connectedAccount.value) {
        // don't await to avoid blocking UI; handle errors silently
        refreshWithdrawStatus().catch((err: any) => console.warn('refreshWithdrawStatus failed', err))
      }
    } catch (_) {}
  }
}

// Refresh withdraw status for connectedAccount: list tokenIds where isFreezed==true && isUnderLiquidation==false
async function refreshWithdrawStatus() {
  withdrawRows.value = []
  withdrawError.value = null
  try {
    if (!connectedAccount.value) return
    // resolve custodian and liquidation manager
    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    const liqAddr: any = await (custodian as any).read.liquidationManager?.()
    if (!liqAddr) return
    let liq = await getReadonlyContract('coreModules#LiquidationManager', 'LiquidationManager')

    // get leverage token address from liquidation manager
    let leverageAddr: string | null = null
    try {
      leverageAddr = await (liq as any).read.leverageToken?.()
    } catch (e) {
      console.warn('Could not read leverageToken address from liquidation manager', e)
    }
    if (!leverageAddr) return

    // minimal ABI for getNextTokenId
    const multiAbi = [
      { "type": "function", "name": "getNextTokenId", "inputs": [], "outputs": [{ "type": "uint256" }], "stateMutability": "view" },
      { "type": "function", "name": "tokenExists", "inputs": [{"name":"tokenId","type":"uint256"}], "outputs": [{"type":"bool"}], "stateMutability": "view" }
    ]
    const multi = getContract({ address: leverageAddr as `0x${string}`, abi: multiAbi as any, client: publicClient })
    const nextIdRaw: any = await (multi as any).read.getNextTokenId?.()
    if (!nextIdRaw) return
    const nextId = Number(nextIdRaw)

    // iterate token ids 1 .. nextId-1
    const maxIter = nextId > 1000 ? 1000 : nextId // safety cap to avoid long loops; adjust if needed
    for (let t = 1; t < nextId && t <= maxIter; t++) {
      try {
        // optional: check tokenExists
        const exists = await (multi as any).read.tokenExists?.([BigInt(t)])
        if (exists === false) continue

        const status: any = await (liq as any).read.userLiquidationStatus?.([connectedAccount.value, BigInt(t)])
        if (!status) continue
        const isFreezed = Boolean(status[5])
        const isUnderLiquidation = Boolean(status[4])
        if (isFreezed && !isUnderLiquidation) {
          const stableNums = status[6] as bigint
          const auctionId = status[7] as bigint
          withdrawRows.value.push({
            address: connectedAccount.value,
            auctionId: auctionId ? auctionId.toString() : '0',
            tokenId: String(t),
            stableNumsRaw: stableNums?.toString?.() ?? '0',
            stableNumsHuman: stableNums ? formatEther(stableNums) : undefined
          })
        }
      } catch (e) {
        console.warn('Failed reading userLiquidationStatus for token', t, e)
        continue
      }
    }
  } catch (e:any) {
    withdrawError.value = e?.message ?? String(e)
  }
}

// helper: ensure wallet client and account
async function ensureWalletClient() {
  if (typeof (window as any).ethereum === 'undefined') throw new Error('No injected wallet found')
  const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' }) as string[]
  const caller = accounts && accounts.length > 0 ? accounts[0] : null
  if (!caller) throw new Error('No account available')
  const walletClient: any = createWalletClientInstance(caller)
  if (!walletClient) throw new Error('Could not create wallet client')
  connectedAccount.value = caller
  return { caller, walletClient }
}

// Withdraw: only original owner should see and click this
async function handleWithdraw(row: any) {
  try {
    const { caller, walletClient } = await ensureWalletClient()
    const ownerAddr = (row.originalOwner ?? row.address ?? '').toString()
    if (!ownerAddr) throw new Error('Row missing owner address')
    if (caller.toLowerCase() !== ownerAddr.toLowerCase()) {
      alert('Only the original owner can withdraw')
      return
    }
    // resolve liquidation manager for writes
    let liq= await getWalletContract('coreModules#LiquidationManager', walletClient, 'LiquidationManager')

    const tokenIdBig = BigInt(row.tokenId)
    const tx = await (liq as any).write.withdrawStable([caller, tokenIdBig])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    await refreshAll()
    await refreshWithdrawStatus()
  } catch (e:any) {
    console.error('withdraw failed', e)
    alert('Withdraw failed: ' + (e?.message ?? String(e)))
  }
}

// Reset auction (keeper action) - calls auctionManager.resetAuction(auctionId, triggerer)
async function handleReset(row: any) {
  try {
    const { caller, walletClient } = await ensureWalletClient()
    // resolve auction manager for writes
    let auc = await getWalletContract('coreModules#AuctionManager', walletClient, 'AuctionManager')
    const auctionId = BigInt(row.id)
    const tx = await (auc as any).write.resetAuction([auctionId, caller])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    await refreshAll()
  } catch (e:any) {
    console.error('reset failed', e)
    alert('Reset failed: ' + (e?.message ?? String(e)))
  }
}

// Bid / purchase underlying: prompt user for amounts, approve custodian, then call purchaseUnderlying
async function handleBid(row: any) {
  try {
    const { caller, walletClient } = await ensureWalletClient()
    // ask user for desired max underlying and max price per underlying
    const maxUnderlyingHuman = prompt('Max underlying to purchase (e.g. 1.5)')
    if (!maxUnderlyingHuman) return
    const maxPriceHuman = prompt('Max acceptable price per underlying in stable (e.g. 100)')
    if (!maxPriceHuman) return

    const maxPurchaseAmount = parseEther(maxUnderlyingHuman)
    const maxAcceptablePrice = parseEther(maxPriceHuman)

    // compute approval amount = maxPurchaseAmount * maxAcceptablePrice / 1e18
    const approveAmount = (maxPurchaseAmount * maxAcceptablePrice) / 1000000000000000000n

    // resolve custodian and stable token
    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    const stableAddr: any = await (custodian as any).read.stableToken?.()
    if (!stableAddr) throw new Error('Stable token address not available')
    const stable = getContract({ address: stableAddr as `0x${string}`, abi: ERC20_ABI as any, client: walletClient })

    // approve custodian to spend stable
    const approveTx = await (stable as any).write.approve([CustodianFixedAddress as `0x${string}`, approveAmount])
    await publicClient.waitForTransactionReceipt({ hash: approveTx as `0x${string}` })

    // call purchaseUnderlying on auction manager
    // resolve auction manager for wallet write
    let auc = await getWalletContract('coreModules#AuctionManager', walletClient, 'AuctionManager')


    const auctionId = BigInt(row.id)
    const tx = await (auc as any).write.purchaseUnderlying([auctionId, maxPurchaseAmount, maxAcceptablePrice, caller, '0x'])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    await refreshAll()
  } catch (e:any) {
    console.error('bid failed', e)
    alert('Bid failed: ' + (e?.message ?? String(e)))
  }
}

// initial load
refreshAll()
// also refresh withdraw section (if wallet connected)
refreshWithdrawStatus()
</script>

<style scoped>
.param-table { width:100%; border-collapse: collapse; margin-top:0.5rem }
.param-table th, .param-table td { border:1px solid #e5e7eb; padding:0.5rem 0.75rem; text-align:left }
.refresh-btn { background:#2563eb; color:#fff; border:none; padding:0.4rem 0.75rem; border-radius:0.375rem }
.action-btn { background:#111827; color:#fff; border:none; padding:0.25rem 0.5rem; border-radius:0.25rem }
.finished { color: #16a34a; font-weight:700 }
.error { color:#ff6b6b }
</style>
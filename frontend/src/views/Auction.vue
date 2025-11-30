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
            <td>
                <button class="action-btn" v-if="a.needsReset" @click="handleReset(a)">Reset</button>
                <button class="action-btn" v-else @click="handleBid(a)">Bid</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else>
      <p>No auctions found.</p>
    </div>
    
    <hr style="margin:1.5rem 0" />


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


async function loadConnectedAccount() {
  try {
    if (typeof (window as any).ethereum !== 'undefined') {
      const accs = await (window as any).ethereum.request({ method: 'eth_accounts' }) as string[]
      connectedAccount.value = (accs && accs.length > 0) ? String(accs[0]) : null
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
        const b: any = await (auc as any).read.getAuctionStatus?.([id])
        if (!a) continue
        if (!b) continue
        // struct Auction: (arrayIndex, underlyingAmount, originalOwner, tokenId, startTime, startingPrice, currentPrice, totalPayment)
        const underlyingAmount = a[1] as bigint
        const originalOwner = a[2] as string
        const tokenId = a[3] as bigint
        const startTime = a[4] as bigint
        const startingPrice = a[5] as bigint
        const totalPayment = a[7] as bigint

        const needsReset = b[0] as boolean
        const currentPrice = b[1] as bigint
        

        // attempt to read liquidation status for (originalOwner, tokenId)
        let liqBalanceHuman: string | undefined = undefined
        let isLiquidated = false
        let isFreezed = false
        if (liq) {
          try {
            const liqStatus: any = await (liq as any).read.userLiquidationStatus?.([originalOwner, tokenId])
            if (liqStatus) {
              const bal = liqStatus[0] as bigint
              liqBalanceHuman = formatEther(bal)
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
          isFreezed,
          needsReset,
          startTimeHuman: startTime && Number(startTime) > 0 ? new Date(Number(startTime) * 1000).toLocaleString() : '-',
          startingPriceHuman: formatEther(startingPrice),
          currentPriceHuman: formatEther(currentPrice),
          totalPaymentHuman: formatEther(totalPayment)
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
</script>

<style scoped>
.param-table { width:100%; border-collapse: collapse; margin-top:0.5rem }
.param-table th, .param-table td { border:1px solid #e5e7eb; padding:0.5rem 0.75rem; text-align:left }
.refresh-btn { background:#2563eb; color:#fff; border:none; padding:0.4rem 0.75rem; border-radius:0.375rem }
.action-btn { background:#111827; color:#fff; border:none; padding:0.25rem 0.5rem; border-radius:0.25rem }
.finished { color: #16a34a; font-weight:700 }
.error { color:#ff6b6b }
</style>
<template>
  <div class="liquidation-page">
    <h2>Liquidation Status</h2>

    <div class="controls">
      <button class="refresh-btn" @click="refreshAll" :disabled="loading">Refresh</button>
      <span v-if="loading">Loading...</span>
      <span v-if="error" class="error">{{ error }}</span>
    </div>

    <div v-if="rows.length > 0">
      <table class="param-table">
        <thead>
          <tr>
            <th>Auction ID</th>
            <th>Address</th>
            <th>Token ID</th>
            <th>Balance</th>
            <th>Leverage</th>
            <th>Risk</th>
            <th>isLiquidated</th>
            <th>isUnderLiquidation</th>
            <th>isFreezed</th>
            <th>stableNums</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.address + '-' + r.tokenId">
            <td>{{ r.auctionId || '-' }}</td>
            <td>{{ formatAddress(r.address) }}</td>
            <td>{{ r.tokenId }}</td>
            <td>{{ formatNumber(r.balanceHuman) }}</td>
              <td>{{ r.leverageLabel }}</td>
            <td>
              <!-- Actions -->
              <div v-if="r.isLiquidated && !r.isUnderLiquidation">
                <button v-if="r.isFreezed" class="action-btn" :disabled="!isConnectedUser(r.address)" @click="withdraw(r.address, r.tokenId)">withdraw</button>
                <span v-else class="finished">Finish</span>
              </div>
              <div v-else-if="!r.isLiquidated && r.isUnderLiquidation">
                <div v-if="r.auctionId && r.auctionId != 0">
                  <button v-if="r.needsReset" class="action-btn" @click="resetAuction(r.auctionId)">reset</button>
                  <button v-else class="action-btn" @click="bid(r.auctionId)">bid</button>
                </div>
                <div v-else>-</div>
              </div>
              <div v-else>-</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else>
      <p>No liquidation info found for configured users.</p>
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
    // read custodian (readonly) and resolve manager contracts (prefer configured addresses)
    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    const liq = await getReadonlyContract('coreModules#LiquidationManager', 'LiquidationManager')
    const auc = await getReadonlyContract('coreModules#AuctionManager', 'AuctionManager')


    for (const addr of addresses) {
      const info: any = await (custodian as any).read.getAllLeverageTokenInfo?.([addr])
      const tokenIds = (info && info[0]) ? info[0] as bigint[] : []
      for (const tokenId of tokenIds) {
        const status: any = await (liq as any).read.userLiquidationStatus?.([addr, tokenId])
        // map struct: (balance, leverageType, riskLevel, isLiquidated, isUnderLiquidation, isFreezed, stableNums, auctionId)
        const balance = status[0] as bigint
        const leverageRaw = status[1]
        const riskLevel = Number(status[2] ?? 0)
        const isLiquidated = Boolean(status[3])
        const isUnderLiquidation = Boolean(status[4])
        const isFreezed = Boolean(status[5])
        const stableNums = status[6] as bigint
        const auctionId = status[7] as bigint

        // default needsReset false
        let needsReset = false
        if (isUnderLiquidation && auctionId && auctionId != 0n && auc) {
          try {
            const stat: any = await (auc as any).read.getAuctionStatus?.([auctionId])
            needsReset = Boolean(stat && stat[0])
          } catch (e) {
            needsReset = false
          }
        }

        // compute leverage label
        let levLabel = '-' 
        if (leverageRaw !== undefined) {
          const ln = Number(leverageRaw)
          if (ln === 0) levLabel = 'Conservative'
          else if (ln === 1) levLabel = 'Moderate'
          else if (ln === 2) levLabel = 'Aggressive'
        }

        rows.value.push({
          auctionId: auctionId ? auctionId.toString() : '0',
          address: addr,
          tokenId: tokenId.toString(),
          balanceHuman: formatEther(balance),
          leverageLabel: levLabel,
          riskLevel,
          isLiquidated,
          isUnderLiquidation,
          isFreezed,
          stableNumsHuman: formatEther(stableNums),
          auctionIdRaw: auctionId,
          needsReset
        })
      }
    }
  } catch (e:any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

function isConnectedUser(address: string) {
  try {
    const a = (window as any).ethereum.selectedAddress || ((window as any).ethereum && (window as any).ethereum.accounts && (window as any).ethereum.accounts[0])
    if (!a) return false
    return a.toLowerCase() === address.toLowerCase()
  } catch { return false }
}

async function withdraw(user: string, tokenIdStr: string) {
  try {
    if (typeof (window as any).ethereum === 'undefined') throw new Error('No wallet')
    const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' }) as string[]
    const caller = accounts && accounts[0]
    if (!caller) throw new Error('No account')
    if (caller.toLowerCase() !== user.toLowerCase()) throw new Error('Only the liquidated user can withdraw')

    const walletClient: any = createWalletClientInstance(caller)
    // resolve liquidation manager for writes
    const liq = await getWalletContract('coreModules#LiquidationManager', walletClient, 'LiquidationManager')
    const tokenId = BigInt(tokenIdStr)
    const tx = await (liq as any).write.withdrawStable([user, tokenId])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    await refreshAll()
  } catch (e:any) {
    alert('withdraw failed: ' + (e?.message ?? String(e)))
  }
}

async function resetAuction(auctionIdStr: string) {
  try {
    if (typeof (window as any).ethereum === 'undefined') throw new Error('No wallet')
    const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' }) as string[]
    const caller = accounts[0]
    const walletClient: any = createWalletClientInstance(caller)

    const auc = await getWalletContract('coreModules#AuctionManager', walletClient, 'AuctionManager')

    const id = BigInt(auctionIdStr)
    const tx = await (auc as any).write.resetAuction([id, caller])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    await refreshAll()
  } catch (e:any) {
    alert('reset failed: ' + (e?.message ?? String(e)))
  }
}

async function bid(auctionIdStr: string) {
  try {
    if (typeof (window as any).ethereum === 'undefined') throw new Error('No wallet')
    const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' }) as string[]
    const caller = accounts[0]
    const walletClient: any = createWalletClientInstance(caller)

    // get auction and auction status
    // resolve read-only auction manager
    const auc = await getReadonlyContract('coreModules#AuctionManager', 'AuctionManager')
    const auctionId = BigInt(auctionIdStr)
    // prompt user for amount to buy (in underlying units)
    const input = prompt('Enter underlying amount to purchase (e.g., 1.0) — will attempt to buy this amount in underlying tokens:')
    if (!input) return
    const purchaseAmount = parseEther(input) // bigint

    // fetch current auction status to get price
    const status: any = await (auc as any).read.getAuctionStatus?.([auctionId])
    const currentPrice = status ? status[1] as bigint : 0n

    // approve stable to custodian
    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    const stableAddr: any = await (custodian as any).read.stableToken?.()
    const stable = getContract({ address: stableAddr as `0x${string}`, abi: ERC20_ABI, client: walletClient })

    // calculate max stable needed = purchaseAmount * currentPrice
    const stableNeeded = purchaseAmount * currentPrice / (10n ** 18n)
    // approve
    await (stable as any).write.approve([CustodianFixedAddress as `0x${string}`, stableNeeded])

    // call purchaseUnderlying on auction manager (wallet)
    let aucWallet = await getWalletContract('coreModules#AuctionManager', walletClient, 'AuctionManager')

    if (!aucWallet) throw new Error('Auction manager wallet contract not available')
    const tx = await (aucWallet as any).write.purchaseUnderlying([auctionId, purchaseAmount, currentPrice, caller, '0x'])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    await refreshAll()
  } catch (e:any) {
    alert('bid failed: ' + (e?.message ?? String(e)))
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
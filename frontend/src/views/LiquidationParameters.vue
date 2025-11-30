<template>
  <div class="liquidation-page">
    <h2>Liquidation Parameters</h2>


    <div v-if="error" class="error">Error: {{ error }}</div>

    <div v-if="loaded" class="config">
      <h3>Liquidation Manager - Global Config</h3>
      <table class="param-table">
        <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Adjustment Threshold</td><td>{{ formatNumber(adjustmentThreshold) }}</td></tr>
          <tr><td>Liquidation Threshold</td><td>{{ formatNumber(liquidationThreshold) }}</td></tr>
          <tr><td>Penalty</td><td>{{ formatNumber(penalty) }}</td></tr>
          <tr><td>Enabled</td><td>{{ String(enabled) }}</td></tr>
        </tbody>
      </table>
    </div>

    <div v-else class="hint">Component has automatically loaded parameters for default addresses; if it failed, check RPC or contract addresses.</div>

    <div class="spacer" />

    <div class="auction-section">
      <h3>Auction Manager - Auction Params</h3>
      <div v-if="auctionError" class="error">Auction Error: {{ auctionError }}</div>
      <div v-else-if="auctionLoaded">
        <table class="param-table">
          <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Price Multiplier</td><td>{{ priceMultiplier }}</td></tr>
            <tr><td>Reset Time (s)</td><td>{{ resetTime }}</td></tr>
            <tr><td>Price Drop Threshold</td><td>{{ priceDropThreshold }}</td></tr>
            <tr><td>Percentage Reward</td><td>{{ percentageReward }}</td></tr>
            <tr><td>Fixed Reward</td><td>{{ fixedReward }}</td></tr>
            <tr><td>Min Auction Amount</td><td>{{ minAuctionAmount }}</td></tr>
          </tbody>
        </table>
      </div>
      <div v-else class="hint">Loading auction params from {{ auctionAddr }} ...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { formatEther } from 'viem'
import { getReadonlyContract } from '../utils/contracts'

import { LiquidationManagerAddress, AuctionManagerAddress } from '../config/addresses'

// initialize from configured addresses if available; fields remain editable in UI
const managerAddr = ref(LiquidationManagerAddress)
const loaded = ref(false)
const error = ref<string | null>(null)

const adjustmentThreshold = ref<number>(0)
const liquidationThreshold = ref<number>(0)
const penalty = ref<number>(0)
const enabled = ref(false)

const adjustmentThresholdRaw = ref<string>('0')
const liquidationThresholdRaw = ref<string>('0')
const penaltyRaw = ref<string>('0')

// Auction params
const auctionLoaded = ref(false)
const auctionError = ref<string | null>(null)
const auctionAddr = ref(AuctionManagerAddress)
const priceMultiplier = ref<number>(0)
const resetTime = ref<number>(0)
const priceDropThreshold = ref<number>(0)
const percentageReward = ref<number>(0)
const fixedReward = ref<number>(0)
const minAuctionAmount = ref<number>(0)

const priceMultiplierRaw = ref<string>('0')
const priceDropThresholdRaw = ref<string>('0')
const percentageRewardRaw = ref<string>('0')
const fixedRewardRaw = ref<string>('0')
const minAuctionAmountRaw = ref<string>('0')

function formatNumber(n:number){
  return Number(n).toFixed(6)
}

async function fetchGlobalConfig(){
  error.value = null
  loaded.value = false
  try{

    const contract = await getReadonlyContract('coreModules#LiquidationManager', 'LiquidationManager') as any
    const res = await contract.read.globalConfig?.()
    if(!res) throw new Error('No response')
    // res is tuple: [adjustmentThreshold, liquidationThreshold, penalty, enabled]
    const adj = res[0] as bigint
    const liq = res[1] as bigint
    const pen = res[2] as bigint
    const en = res[3] as boolean

    adjustmentThresholdRaw.value = adj.toString()
    liquidationThresholdRaw.value = liq.toString()
    penaltyRaw.value = pen.toString()

    adjustmentThreshold.value = Number(formatEther(adj))
    liquidationThreshold.value = Number(formatEther(liq))
    penalty.value = Number(formatEther(pen))
    enabled.value = en
    loaded.value = true
  }catch(e:any){
    error.value = e?.message ?? String(e)
  }
}

async function fetchAuctionParams(){
  auctionError.value = null
  auctionLoaded.value = false
  try{
    const contract = await getReadonlyContract('coreModules#AuctionManager', 'AuctionManager') as any
    const res = await contract.read.auctionParams?.()
    if(!res) throw new Error('No response from AuctionManager')
    const pm = res[0] as bigint
    const rt = res[1] as bigint
    const pdt = res[2] as bigint
    const pr = res[3] as bigint
    const fr = res[4] as bigint
    const ma = res[5] as bigint

    priceMultiplierRaw.value = pm.toString()
    priceDropThresholdRaw.value = pdt.toString()
    percentageRewardRaw.value = pr.toString()
    fixedRewardRaw.value = fr.toString()
    minAuctionAmountRaw.value = ma.toString()

    priceMultiplier.value = Number(formatEther(pm))
    resetTime.value = Number(rt)
    priceDropThreshold.value = Number(formatEther(pdt))
    percentageReward.value = Number(formatEther(pr))
    fixedReward.value = Number(formatEther(fr))
    minAuctionAmount.value = Number(formatEther(ma))

    auctionLoaded.value = true
  }catch(e:any){
    auctionError.value = e?.message ?? String(e)
  }
}

onMounted(() => {
  // Auto-load the globalConfig for the hard-coded manager address
  if (managerAddr.value) fetchGlobalConfig()
  if (auctionAddr.value) fetchAuctionParams()
})
</script>

<style scoped>
.liquidation-page { padding: 1rem; }
.controls { display:flex; gap:0.5rem; align-items:center; margin-bottom:1rem }
.controls input{ padding:0.4rem; min-width:360px }
.config .row{ margin:0.35rem 0 }
.error{ color: #ff6b6b; margin: 0.5rem 0 }
.hint{ color:#9ca3af; margin-top:1rem }
.param-table { width:100%; border-collapse: collapse; margin-top:0.75rem }
.param-table th, .param-table td { border:1px solid #e5e7eb; padding:0.5rem 0.75rem; text-align:left; background:#fff; color:#111827 }
.auction-section { margin-top:1.5rem }
.spacer { height:1.2rem }
</style>

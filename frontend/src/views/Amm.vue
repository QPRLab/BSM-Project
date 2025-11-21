<template>
  <div class="amm-container">
    <div class="page-header">
      <h1 class="title">Stable-USDC AMM Pool</h1>
      <p class="subtitle">Automated Market Maker Liquidity Pool Analytics</p>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-content">
          <p class="stat-label">Stable Reserve</p>
          <p class="stat-value">{{ formatNumber(reserves.stable) }}</p>
          <p class="stat-subtext">{{ poolRatio.stable.toFixed(1) }}% of pool</p>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-content">
          <p class="stat-label">USDC Reserve</p>
          <p class="stat-value">{{ formatNumber(reserves.usdc) }}</p>
          <p class="stat-subtext">{{ poolRatio.usdc.toFixed(1) }}% of pool</p>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-content">
          <p class="stat-label">LP Token Supply</p>
          <p class="stat-value">{{ formatNumber(lpTokenSupply) }}</p>
          <p class="stat-subtext">Liquidity Providers</p>
        </div>
      </div>
    </div>
    <div class="stats-grid-2"> 
        <div class="section-card">
          <h3>Pool Composition</h3>
          <div class="pool-visualization">
            <div class="pool-bar">
              <div class="pool-segment stable" :style="{width:poolRatio.stable+'%'}"><span v-if="poolRatio.stable>15">{{ poolRatio.stable.toFixed(1) }}%</span></div>
              <div class="pool-segment usdc" :style="{width:poolRatio.usdc+'%'}"><span v-if="poolRatio.usdc>15">{{ poolRatio.usdc.toFixed(1) }}%</span></div>
            </div>
            <div class="pool-labels">
              <div class="label-item"><span class="label-dot stable"></span><span>Stable: {{ formatNumber(reserves.stable) }}</span></div>
              <div class="label-item"><span class="label-dot usdc"></span><span>USDC: {{ formatNumber(reserves.usdc) }}</span></div>
            </div>
          </div>
        </div>
    </div>
    <div class="main-content">
      <div class="chart-section">
        <div class="section-card">
          <div class="card-header">
            <h3>AMM Bonding Curve</h3>
            <div class="chart-controls">
              <button v-for="range in ['1H','24H','7D','30D']" :key="range" :class="['btn-range',{active:timeRange===range}]" @click="timeRange=range">{{ range }}</button>
            </div>
          </div>
          <div class="chart-container"><canvas ref="ammCurveChart"></canvas></div>
          <div class="chart-legend">
            <div class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span><span>Current State</span></div>
            <div class="legend-item"><span class="legend-dot" style="background:#10b981"></span><span>Theoretical Curve</span></div>
            <div class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span><span>Historical Points</span></div>
          </div>
        </div>
      </div>
      <div class="info-section">

        <div class="section-card">
          <h3>Current Price</h3>
          <div class="price-display">
            <div class="price-main"><span class="price-value">{{ currentPrice.toFixed(6) }}</span><span class="price-pair">USDC per Stable</span></div>
            <div class="price-inverse">1 USDC = {{ (1/currentPrice).toFixed(6) }} Stable</div>
            <div class="price-change" :class="priceChange24h>=0?'positive':'negative'">{{ priceChange24h>=0?'+':'' }}{{ priceChange24h.toFixed(2) }}% (24h)</div>
          </div>
        </div>
        <div class="section-card">
          <h3>StableSwap Parameters</h3>
          <div class="params-grid">
            <div class="param-item"><span class="param-label">Invariant D</span><span class="param-value">{{ formatNumber(invariantD) }}</span></div>
            <div class="param-item"><span class="param-label">Amplification (A)</span><span class="param-value">{{ amplificationFactor }}</span></div>
            <div class="param-item"><span class="param-label">Admin Fee</span><span class="param-value">{{ (adminFee*100).toFixed(2) }}%</span></div>
            <div class="param-item"><span class="param-label">Swap Fee</span><span class="param-value">{{ (swapFee*100).toFixed(2) }}%</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>


<script setup lang="ts">
    import { ref, onMounted, computed, watch } from 'vue'
    import { Chart, registerables } from 'chart.js'
    import { formatEther, formatUnits, getContract } from 'viem'
    import LPToken from '../abi/LPToken.json'
    import { publicClient } from '../utils/client'
    import { getReadonlyContract } from '../utils/contracts'
    Chart.register(...registerables)

    //=====获取Address & ABI，创建Contract实例=====
    const ammLiquidityPromise = getReadonlyContract('ammModules#AMMLiquidity', 'AMMLiquidity')
    const ammSwapPromise = getReadonlyContract('ammModules#AMMSwap', 'AMMSwap')
    //=====获取Address & ABI，创建Contract实例=====


    const reserves = ref({ stable: 0, usdc: 0 })
    const currentPrice = ref(1.0)
    const priceChange24h = ref(0)
    const invariantD = ref(0)
    const lpTokenSupply = ref(0)
    const amplificationFactor = ref(100)
    const adminFee = ref(0.0004)
    const swapFee = ref(0.003)
    const timeRange = ref('24H')

    const poolRatio = computed(() => {
    const total = reserves.value.stable + reserves.value.usdc
    if (total === 0) return { stable: 50, usdc: 50 }
    return { stable: (reserves.value.stable/total)*100, usdc: (reserves.value.usdc/total)*100 }
    })

    const formatNumber = (num:number) => {
    if (num >= 1_000_000) return (num/1_000_000).toFixed(2)+'M'
    if (num >= 1_000) return (num/1_000).toFixed(2)+'K'
    return num.toFixed(2)
    }

    const ammCurveChart = ref<HTMLCanvasElement|null>(null)
    let curveChartInstance: Chart | null = null

    const calculateStableSwapY = (x:number, d:number, a:number):number => {
    const ann = a * 4
    const c = (d*d*d)/(4*ann*x)
    const b = x + d/ann
    let y = d
    for (let i=0;i<255;i++) {
        const yPrev = y
        y = (y*y + c)/(2*y + b - d)
        if (Math.abs(y - yPrev) <= 1) break
    }
    return y
    }

    const calculateInvariantD = (x:number, y:number, a:number):number => {
    const s = x + y
    if (s === 0) return 0
    let d = s
    const ann = a * 4
    for (let i=0;i<255;i++) {
        const dPrev = d
        const dp = (d*d*d)/(4*x*y)
        d = ((ann*s + 2*dp) * d)/((ann - 1)*d + 3*dp)
        if (Math.abs(d - dPrev) <= 1) break
    }
    return d
    }

    const fetchDA = async (stable:number, usdc:number) => {
    const ammSwap = await ammSwapPromise as any
    const D = await ammSwap.read.getD?.([stable, usdc])
    const A = await ammSwap.read.getA?.()
    return { D: Number(D), A: Number(A) }
    }

    const getY = async (x:number, D:number, A:number):Promise<number> => {
    const ammSwap = await ammSwapPromise as any
    const y = await ammSwap.read.getY?.([x, D, A])
    return Number(y)
    }

    const refreshCurrentPrice = async () => {
    try {
        const { D, A } = await fetchDA(reserves.value.stable, reserves.value.usdc)
        const stableBefore = reserves.value.stable * Number(10n**18n)
        const stableAfter = stableBefore - Number(10n*10n**18n)
        const usdcBefore = reserves.value.usdc * Number(10n**18n)
        const usdcAfter = await getY(stableAfter, D, A)
        currentPrice.value = ( usdcAfter - usdcBefore ) / (stableAfter - stableBefore)
    } catch {
        currentPrice.value = 1.0
    }
    }

    const initAmmCurveChart = () => {
        if (!ammCurveChart.value) return
        const ctx = ammCurveChart.value.getContext('2d')
        if (!ctx) return
        const currentD = invariantD.value || calculateInvariantD(reserves.value.stable, reserves.value.usdc, amplificationFactor.value)
        const theoreticalCurve: {x:number,y:number}[] = []
        const minStable = Math.max(reserves.value.stable * 0.5, 1000)
        const maxStable = Math.max(minStable + 100, reserves.value.stable * 1.5)
        const step = (maxStable - minStable)/50
        for (let stable=minStable; stable<=maxStable; stable+=step) {
            const usdc = calculateStableSwapY(stable, currentD, amplificationFactor.value)
            if (usdc > 0) theoreticalCurve.push({x:stable,y:usdc})
        }
        const currentPoint = { x: reserves.value.stable, y: reserves.value.usdc }
        const historicalPoints = JSON.parse(localStorage.getItem('ammHistoricalPoints') || '[]')
        curveChartInstance = new Chart(ctx, {
            type: 'scatter',
            data: { datasets: [
            { label:'StableSwap Curve', data: theoreticalCurve, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.1)', showLine:true, pointRadius:0, borderWidth:2 },
            { label:'Current State', data:[currentPoint], backgroundColor:'#3b82f6', borderColor:'#2563eb', pointRadius:10, borderWidth:3 },
            { label:'Historical Points', data: historicalPoints, backgroundColor:'#f59e0b', borderColor:'#d97706', pointRadius:6 }
            ]},
            options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ x:{ title:{display:true, text:'Stable Reserve'} }, y:{ title:{display:true, text:'USDC Reserve'} } } }
        })
    }

    const fetchReservesFromChain = async () => {
    try {
        const ammLiquidity = await ammLiquidityPromise as any
        const reservesData = await ammLiquidity.read.getReserves?.() as readonly [bigint, bigint]
        const stableReserve = Number(formatEther(reservesData[0]))
        const usdcReserve = Number(formatUnits(reservesData[1], 6))
        reserves.value = { stable: stableReserve, usdc: usdcReserve }
        invariantD.value = calculateInvariantD(stableReserve, usdcReserve, amplificationFactor.value)
        const lpTokenAddress = await ammLiquidity.read.lpToken?.() as `0x${string}`
        const lpTokenContract = getContract({ address: lpTokenAddress, abi: LPToken.abi, client: publicClient })
        const totalSupply = await lpTokenContract.read.totalSupply?.() as bigint
        lpTokenSupply.value = Number(formatEther(totalSupply))
        const historicalPoints = JSON.parse(localStorage.getItem('ammHistoricalPoints') || '[]')
        historicalPoints.push({ x: stableReserve, y: usdcReserve, timestamp: Date.now() })
        if (historicalPoints.length > 50) historicalPoints.shift()
        localStorage.setItem('ammHistoricalPoints', JSON.stringify(historicalPoints))
    } catch (e) { console.error('Failed to fetch reserves', e) }
    }

    const updateCharts = () => {
    if (!curveChartInstance) return
    const currentD = calculateInvariantD(reserves.value.stable, reserves.value.usdc, amplificationFactor.value)
    invariantD.value = currentD
    const theoreticalCurve: {x:number,y:number}[] = []
    const minStable = Math.max(reserves.value.stable * 0.5, 1000)
    const maxStable = Math.max(minStable + 100, reserves.value.stable * 1.5)
    const step = (maxStable - minStable)/50
    for (let stable=minStable; stable<=maxStable; stable+=step) {
        const usdc = calculateStableSwapY(stable, currentD, amplificationFactor.value)
        if (usdc>0) theoreticalCurve.push({x:stable,y:usdc})
    }
    const historicalPoints = JSON.parse(localStorage.getItem('ammHistoricalPoints') || '[]')
    if (curveChartInstance.data && curveChartInstance.data.datasets && curveChartInstance.data.datasets.length >= 3) {
        ;(curveChartInstance.data.datasets[0] as any).data = theoreticalCurve as any
        ;(curveChartInstance.data.datasets[1] as any).data = [{ x: reserves.value.stable, y: reserves.value.usdc }] as any
        ;(curveChartInstance.data.datasets[2] as any).data = historicalPoints as any
    }
    curveChartInstance.update('none')
    }


    watch(reserves, () => { refreshCurrentPrice(); updateCharts() }, { deep:true })


    const fetchReservesAndSupply = async () => {
    try {
        const ammLiquidity = await ammLiquidityPromise as any
        const reservesData = await ammLiquidity.read.getReserves?.() as readonly [bigint, bigint]
        const [stable, usdc] = reservesData
        reserves.value = {
        stable: Number(formatEther(stable)),
        usdc: Number(formatUnits(usdc, 6))
        }
        const lpTokenAddr = await ammLiquidity.read.lpToken?.() as `0x${string}`
        const lpToken = getContract({ address: lpTokenAddr, abi: LPToken.abi, client: publicClient })
        const totalSupply = await lpToken.read.totalSupply?.() as bigint
        lpTokenSupply.value = Number(formatEther(totalSupply))
    } catch (e) {
        console.error('Failed to fetch reserves/supply', e)
    }
    }

    onMounted(() => {
        fetchReservesAndSupply()
        initAmmCurveChart()
        refreshCurrentPrice()
        setInterval(fetchReservesFromChain, 10000)
        setInterval(refreshCurrentPrice, 15000)
    })
</script>


<style scoped>
.amm-container {max-width:1500px; width:100%; margin:0 auto; color:#e5e7eb; }
.page-header { text-align:center; margin-bottom:2.5rem; }
.title { font-size:2.8rem; font-weight:700; background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%); background-clip:text; -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:.5rem; }
.subtitle { font-size:1.1rem; color:#9ca3af; }
.stats-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:1.5rem; margin-bottom:2rem; }
.stats-grid-2 { display:grid; grid-template-columns:repeat(1,1fr); gap:1.5rem; margin-bottom:2rem; }
.stat-card { background:linear-gradient(135deg,#1f2937 0%,#111827 100%); border:1px solid #374151; border-radius:1rem; padding:1.5rem; display:flex; align-items:center; gap:1rem; min-width:0; }
.stat-label { font-size:.75rem; color:#9ca3af; margin-bottom:.25rem; }
.stat-value { font-size:1.6rem; font-weight:700; color:#f3f4f6; margin-bottom:.25rem; }
.stat-subtext { font-size:.65rem; color:#6b7280; }
.main-content { display:flex; gap:1.5rem; margin-bottom:2rem; align-items:stretch; }
.chart-section,.info-section { min-width:0; flex:1; display:flex; flex-direction:column; }
.section-card { background:linear-gradient(135deg,#1f2937 0%,#111827 100%); border:1px solid #374151; border-radius:1rem; padding:1.5rem; min-width:0; margin-bottom:1.5rem; }
.card-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; }
.chart-controls { display:flex; gap:.5rem; }
.btn-range { padding:.5rem 1rem; border:1px solid #374151; background:transparent; color:#9ca3af; border-radius:.5rem; cursor:pointer; }
.btn-range.active { background:#3b82f6; border-color:#3b82f6; color:#fff; }
.chart-container { width:100%; height:420px; position:relative; display:flex; }
.chart-legend { display:flex; gap:1.5rem; justify-content:center; margin-top:1rem; }
.legend-item { display:flex; align-items:center; gap:.5rem; font-size:.75rem; color:#9ca3af; }
.legend-dot { width:12px; height:12px; border-radius:50%; }
.pool-bar { display:flex; height:60px; border-radius:.75rem; overflow:hidden; margin-bottom:1rem; }
.pool-segment { display:flex; align-items:center; justify-content:center; font-weight:600; font-size:.75rem; color:#fff; }
.pool-segment.stable { background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%); }
.pool-segment.usdc { background:linear-gradient(135deg,#10b981 0%,#059669 100%); }
.label-item { display:flex; align-items:center; gap:.5rem; font-size:.75rem; color:#9ca3af; }
.label-dot.stable { background:#3b82f6; }
.label-dot.usdc { background:#10b981; }
.price-display { text-align:center; padding:1.2rem; background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%); border-radius:.75rem; }
.price-value { font-size:2.2rem; font-weight:700; color:#3b82f6; }
.price-pair { font-size:.75rem; color:#9ca3af; }
.price-inverse { font-size:.65rem; color:#6b7280; margin-bottom:.5rem; }
.price-change { font-size:.75rem; font-weight:600; padding:.25rem .6rem; border-radius:.5rem; display:inline-block; }
.price-change.positive { background:rgba(16,185,129,0.12); color:#10b981; }
.price-change.negative { background:rgba(239,68,68,0.12); color:#ef4444; }
.params-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
.param-item { padding:.9rem; background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%); border-radius:.5rem; display:flex; flex-direction:column; gap:.4rem; }
.param-label { font-size:.6rem; color:#9ca3af; letter-spacing:.05em; }
.param-value { font-size:1.1rem; font-weight:600; color:#f3f4f6; }
@media (max-width:1280px){ .main-content{ flex-direction:column; } .stats-grid{ grid-template-columns:repeat(2,1fr); } }
@media (max-width:768px){ .stats-grid{ grid-template-columns:1fr; } .chart-container{ height:300px; } .title{ font-size:2rem; } .params-grid{ grid-template-columns:1fr; } }
</style>


<template>
  <div class="mint-page">
    <div class="card">
      <header class="card-header">
        <div>
          <h2 class="title">Burn L Token</h2>
          <p class="subtitle">Burn part of leverage position to redeem underlying assets (use caution)</p>
        </div>
        <div class="price-badge">Custodian</div>
      </header>

      <section class="card-body">
        <div class="form-grid">
          <div class="field">
            <label class="label">Select Token ID</label>
            <select class="select" v-model="selectedTokenId">
              <option disabled value="">-- Please select --</option>
              <option v-for="t in tokens" :key="t.tokenId" :value="t.tokenId">{{ t.tokenId }} — balance: {{ t.balanceHuman }}</option>
            </select>
            <small class="hint">Please select a Leverage Token ID you own</small>
          </div>

          <div class="field">
            <label class="label">Burn Percentage</label>
            <div class="price-row">
              <label class="chip" v-for="p in percents" :key="p"><input type="radio" :value="p" v-model.number="selectedPercent" /> {{ p }}%</label>
            </div>
            <small class="hint">Choose the percentage of L tokens to burn</small>
          </div>

          <div class="field full">
            <label class="label">Preview</label>
            <div class="preview">
              <div v-if="previewLoading" class="muted">Calculating…</div>
              <div v-else-if="previewError" class="error">{{ previewError }}</div>
              <div v-else-if="preview">
                <div>L to be burned: <strong>{{ preview.lAmountBurned }}</strong></div>
                <div>S required to burn: <strong>{{ preview.sAmountNeeded }}</strong></div>
                <div>Underlying redeemable: <strong>{{ preview.underlyingToUser }}</strong></div>
              </div>
              <div v-else class="muted">Select Token ID and percentage to view preview</div>
            </div>
          </div>
        </div>
      </section>

      <footer class="card-footer">
        <div class="left">
          <!-- <div v-if="error" class="error">{{ error }}</div>
          <div v-else-if="txHash" class="success">Tx: {{ txHash }}</div> -->
        </div>
        <div class="right">
          <button class="btn-primary" @click="doBurn" :disabled="writing || !selectedTokenId || !selectedPercent">
            <span v-if="!writing">Burn</span>
            <span v-else>Processing...</span>
          </button>
        </div>
      </footer>
    </div>
  </div>
  <div v-if="txHash" class="tx-banner">
    <span class="tx-success">✅ Transaction successful!</span>
    <a :href="`https://sepolia.etherscan.io/tx/${txHash}`" target="_blank" rel="noopener noreferrer">View on Etherscan</a>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { formatEther, formatUnits } from 'viem'
import { publicClient, createWalletClientInstance } from '../utils/client'
import { getReadonlyContract, getWalletContract } from '../utils/contracts'
import { useWalletStore } from '../stores/wallet'


const tokens = ref<Array<any>>([])
const selectedTokenId = ref<string | ''>('')
const percents = [10,25,50,75,100]
const selectedPercent = ref<number | null>(100)

const preview = ref<any | null>(null)
const previewLoading = ref(false)
const previewError = ref<string | null>(null)

const writing = ref(false)
const error = ref<string | null>(null)
const txHash = ref<string | null>(null)

const wallet = useWalletStore()

async function loadUserTokens() {
  try {
    // Prefer the application's stored account instead of directly calling injected providers.
    const addr = wallet.account
    if (!addr) {
      // do not request accounts here — let user click Connect in wallet flows
      return
    }
    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    const rawInfo: any = await (custodian as any).read.getAllLeverageTokenInfo?.([addr])
    if (!rawInfo) return
    const tokenIds = (rawInfo[0] ?? []) as bigint[]
    const balances = (rawInfo[1] ?? []) as bigint[]
    const rows: any[] = []
    for (let i = 0; i < tokenIds.length; i++) {
      const id = tokenIds[i]
      const bal = balances[i] ?? 0n
      rows.push({ tokenId: id.toString(), balanceRaw: bal.toString(), balanceHuman: formatEther(bal) })
    }
    tokens.value = rows
    // 如果当前选中的 tokenId 已经不存在或余额为 0，清除选择并更新预览提示
        if (selectedTokenId.value) {
      const found = rows.find(r => r.tokenId === selectedTokenId.value)
      if (!found || found.balanceRaw === '0') {
        selectedTokenId.value = ''
        preview.value = null
            previewError.value = 'Selected token has no balance, selection cleared'
      }
    }
  } catch (e:any) {
    console.error('loadUserTokens failed', e)
  }
}

async function computePreview() {
  preview.value = null
  previewError.value = null
  if (!selectedTokenId.value || !selectedPercent.value) return
  previewLoading.value = true
  try {
    const custodian = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
    // get current price
    const priceTuple: any = await (custodian as any).read.getLatestPriceView?.()
    const price = priceTuple ? (priceTuple[0] ?? priceTuple.priceInWei ?? 0n) : 0n
    if (!price || price === 0n) {
      previewError.value = 'Unable to fetch oracle price'
      return
    }
    const tokenIdBig = BigInt(selectedTokenId.value)
    const percent = BigInt(selectedPercent.value)

    // pre-check: use stored account to avoid prompting the wallet; ensure computed L amount to burn is non-zero
    const account = wallet.account
    try {
      const singleInfo: any = await (custodian as any).read.getSingleLeverageTokenInfo?.([account, tokenIdBig])
      const totalLAmountInWei = BigInt(singleInfo?.[0] ?? 0n)
      // 如果链上余额为 0，说明 token 已被销毁或不再持有，清除选择并返回
        if (totalLAmountInWei === 0n) {
        selectedTokenId.value = ''
        preview.value = null
        previewError.value = 'Selected token has no balance, selection cleared'
        previewLoading.value = false
        return
      }
      const lAmountBurned = (totalLAmountInWei * percent) / 100n
      if (lAmountBurned === 0n) {
        previewError.value = 'L amount after burn is 0. Choose a larger percentage or a token with higher balance.'
        previewLoading.value = false
        return
      }
    } catch (e:any) {
      // If the pre-check fails (e.g. call reverted), surface a friendly message and continue to allow previewBurn to return its own error
      console.warn('pre-check getSingleLeverageTokenInfo failed', e)
    }

    const p: any = await (custodian as any).read.previewBurn?.([ account, tokenIdBig, percent, price ])
    // p may be tuple or array; normalize
    const result = p && (p.lAmountBurnedInWei !== undefined ? p : (Array.isArray(p) ? p[0] ?? p : p))
    const toHuman = (v: any, decimals = 18) => v !== undefined ? formatEther(BigInt(v)) : '-'
    preview.value = {
      lAmountBurned: toHuman(result?.lAmountBurnedInWei),
      sAmountNeeded: toHuman(result?.sAmountNeededInWei),
      underlyingToUser: toHuman(result?.underlyingAmountToUser ?? result?.underlyingAmountInWei ?? 0n, 18)
    }
  } catch (e:any) {
    console.error('preview failed', e)
    previewError.value = e?.message ?? String(e)
  } finally {
    previewLoading.value = false
  }
}

async function ensureWalletClient() {
  // If store already has an initialized client and account, reuse it
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

  // create the viem WalletClient with the exact provider object we used to request accounts
  const walletClient: any = createWalletClientInstance(caller, wallet.preferredProvider ?? undefined, chosenProvider)
  if (!walletClient) throw new Error('Could not create wallet client')

  // persist account and the exact wallet client into store for other pages
  try { wallet.setAccount(caller, wallet.preferredProvider ?? undefined, walletClient) } catch {}

  return { caller, walletClient }
}

watch([selectedTokenId, selectedPercent], () => {
  // debounce not necessary for now
  computePreview()
})

async function doBurn() {
  error.value = null
  txHash.value = null
  writing.value = true
  try {
    const { caller, walletClient } = await ensureWalletClient()
    if (!selectedTokenId.value) throw new Error('Please select Token ID')
    if (!selectedPercent.value) throw new Error('Please select burn percentage')

    // pre-check on-chain balance to avoid sending a tx that will revert with "Calculated burn amount is zero"
    try {
      const custodianRead = await getReadonlyContract('coreModules#CustodianFixed', 'CustodianFixed')
      const singleInfo: any = await (custodianRead as any).read.getSingleLeverageTokenInfo?.([caller, BigInt(selectedTokenId.value)])
      const totalLAmountInWei = BigInt(singleInfo?.[0] ?? 0n)
      const lAmountBurned = (totalLAmountInWei * BigInt(selectedPercent.value)) / 100n
      if (lAmountBurned === 0n) {
        error.value = 'L amount after burn is 0. Choose a larger percentage or a token with higher balance.'
        writing.value = false
        return
      }
    } catch (e:any) {
      console.warn('pre-check getSingleLeverageTokenInfo failed', e)
      // continue - actual burn may still fail for other reasons; allow transaction to proceed if pre-check cannot complete
    }

    const custodianWrite = await getWalletContract('coreModules#CustodianFixed', walletClient, 'CustodianFixed')
    const tokenIdBig = BigInt(selectedTokenId.value)
    const percent = Number(selectedPercent.value)
    const tx = await (custodianWrite as any).write.burnFromUser([tokenIdBig, percent])
    await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
    txHash.value = String(tx)
    // refresh tokens & preview
    await loadUserTokens()
    await computePreview()
    // Also refresh global token balances so Balance page updates immediately
    try {
      const Scontract = await getWalletContract('tokenModules#StableToken', walletClient, 'StableToken') as any
      const USDCcontract = await getWalletContract('tokenModules#USDCMock', walletClient, 'USDCMock') as any
      const WLTContract = await getWalletContract('tokenModules#WLTCMock', walletClient, 'WLTCMock') as any

      const rawSBalance = await (Scontract.read.balanceOf?.([caller]) as Promise<bigint>);
      const S = rawSBalance ? Number(formatUnits(rawSBalance, 18)).toFixed(4) : '0.0000'
      const rawUSDCBalance = await (USDCcontract.read.balanceOf?.([caller]) as Promise<bigint>);
      const USDC = rawUSDCBalance ? Number(formatUnits(rawUSDCBalance, 6)).toFixed(4) : '0.0000'
      const rawWLTCBalance = await (WLTContract.read.balanceOf?.([caller]) as Promise<bigint>);
      const WLTC = rawWLTCBalance ? Number(formatUnits(rawWLTCBalance, 18)).toFixed(4) : '0.0000'

      try { wallet.setBalances({ S, L: '', USDC, WLTC }) } catch {}
    } catch (e) {
      // ignore balance refresh failures
    }
  } catch (e:any) {
    console.error('burn failed', e)
    error.value = e?.message ?? String(e)
    alert('Burn failed: ' + error.value)
  } finally {
    writing.value = false
  }
}

onMounted(() => {
  loadUserTokens()
})

// listen for global wallet connect events (dispatched by App.vue) and store changes
function onWalletConnected(_e?: any) {
  // reload token list when wallet connects/changes
  loadUserTokens()
}

onMounted(() => {
  window.addEventListener('wallet:connected', onWalletConnected)
})

onBeforeUnmount(() => {
  window.removeEventListener('wallet:connected', onWalletConnected)
})

// also react to store account changes (covers disconnects/rehydration)
watch(() => wallet.account, (acct) => {
  if (!acct) {
    tokens.value = []
    selectedTokenId.value = ''
    preview.value = null
  } else {
    loadUserTokens()
  }
})
</script>

<style scoped>
.mint-page { padding: 1.25rem; display:flex; justify-content:center }
.card { width:100%; max-width:920px; background: #fff; border-radius:12px; box-shadow: 0 8px 30px rgba(25, 31, 40, 0.08); overflow:hidden; display:flex; flex-direction:column }
.card-header { display:flex; justify-content:space-between; align-items:center; padding:1.25rem 1.5rem; border-bottom:1px solid #f1f3f5 }
.title { margin:0; font-size:1.25rem }
.subtitle { margin:0; color:#6b7280; font-size:0.9rem }
.price-badge { background:linear-gradient(90deg,#06b6d4,#3b82f6); color:#fff; padding:0.35rem 0.6rem; border-radius:999px; font-weight:600 }
.card-body { padding:1rem 1.5rem }
.form-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap:1rem }
.field { display:flex; flex-direction:column }
.field.full { grid-column: 1 / -1 }
.label { font-weight:600; margin-bottom:0.35rem }
.select { padding:0.6rem 0.75rem; border-radius:8px; border:1px solid #e6e9ee }
.hint { color:#9ca3af; font-size:0.85rem; margin-top:0.25rem }
.price-row { display:flex; gap:0.5rem; align-items:center }
.chip { background:#f3f4f6; padding:0.35rem 0.6rem; border-radius:999px; display:inline-flex; align-items:center; gap:0.4rem; cursor:pointer }
.card-footer { padding:1rem 1.5rem; display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f3f5 }
.btn-primary { background:linear-gradient(90deg,#4f46e5,#06b6d4); color:#fff; padding:0.6rem 1rem; border-radius:8px; border:none; cursor:pointer; font-weight:600 }
.error { color:#ef4444 }
.success { color:#16a34a }
.preview { background:#f8fafc; padding:0.75rem; border-radius:8px }

/* bottom transaction banner - light theme */
.tx-banner { position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; background: #ffffff; color: #0f172a; padding: 0.65rem 1rem; border-radius: 10px; box-shadow: 0 8px 30px rgba(15,23,42,0.06); display:flex; gap:0.6rem; align-items:center; z-index:1100; border:1px solid #f1f3f5 }
.tx-banner a { color: #2563eb; font-weight:600; text-decoration:underline }
.tx-success { font-weight:700 }

@media (max-width: 720px) {
  .form-grid { grid-template-columns: 1fr }
  .card { margin: 0 0.5rem }
}
</style>

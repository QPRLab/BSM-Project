<template>
  <div class="addresses-page">
    <h2>部署地址</h2>

    <div class="cards">
      <div v-for="item in uniqueEntries" :key="item.addr" class="card">
        <div class="card-left">
          <div class="key">{{ item.keys.join(', ') }}</div>
          <div class="addr">{{ item.addr }}</div>
        </div>
        <div class="card-right">
          <button class="btn" @click="openEtherscan(item.addr)">打开 Etherscan</button>
          <button class="btn ghost" @click="copyAddress(item.addr)">{{ copied === item.addr ? '已复制' : '复制' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import deployed from '../config/deployed_addresses.json'
import { ref } from 'vue'

type AddressesMap = Record<string, string>
const addresses = deployed as unknown as AddressesMap

const copied = ref<string | null>(null)

function openEtherscan(addr: string) {
  const url = `https://sepolia.etherscan.io/address/${addr}`
  window.open(url, '_blank')
}

async function copyAddress(addr: string) {
  try {
    await navigator.clipboard.writeText(addr)
    copied.value = addr
    setTimeout(() => { if (copied.value === addr) copied.value = null }, 2000)
  } catch (e) {
    // fallback
    const el = document.createElement('textarea')
    el.value = addr
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    copied.value = addr
    setTimeout(() => { if (copied.value === addr) copied.value = null }, 2000)
  }
}

// Build a deduplicated list: group keys by identical address so each address shows once
function formatKey(key: string) {
  const idx = key.indexOf('#')
  return idx >= 0 ? key.slice(idx + 1) : key
}

const uniqueEntries = Object.entries(addresses).reduce((acc: Array<{ addr: string; keys: string[] }>, [key, addr]) => {
  const existing = acc.find(e => e.addr.toLowerCase() === addr.toLowerCase())
  const prettyKey = formatKey(key)
  if (existing) {
    if (!existing.keys.includes(prettyKey)) {
      existing.keys.push(prettyKey)
    }
  } else {
    acc.push({ addr, keys: [prettyKey] })
  }
  return acc
}, [])
</script>

<style scoped>
.addresses-page { padding: 1.25rem; }
.addresses-page h2 { margin: 0 0 0.25rem 0; color: #2c3e50 }
.subtitle { margin: 0 0 1rem 0; color: #666 }
.cards { display: grid; grid-template-columns: 1fr; gap: 0.75rem }
.card { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: linear-gradient(180deg,#fff,#fbfdff); border: 1px solid #e6eef6; border-radius: 8px; box-shadow: 0 6px 18px rgba(44,62,80,0.04); }
.card-left { max-width: 72%; overflow: hidden }
.key { font-weight: 700; color: #123; margin-bottom: 0.25rem; font-size: 0.95rem }
.addr { color: #234; font-family: monospace; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.card-right { display: flex; gap: 0.5rem; align-items: center }
.btn { background: #42b983; color: #fff; border: none; padding: 0.45rem 0.7rem; border-radius: 6px; cursor: pointer; font-weight: 600 }
.btn.ghost { background: transparent; color: #42b983; border: 1px solid #d8efe2 }
.btn:hover { opacity: 0.95 }
</style>

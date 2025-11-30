<script setup lang="ts">
import { ref } from 'vue'

const isAmmDropdownOpen = ref(false)
const isLiquidationDropdownOpen = ref(false)

function toggleAmmDropdown() {
  isAmmDropdownOpen.value = !isAmmDropdownOpen.value
}

function toggleLiquidationDropdown() {
  isLiquidationDropdownOpen.value = !isLiquidationDropdownOpen.value
}

function closeAmmDropdown() {
  isAmmDropdownOpen.value = false
  isLiquidationDropdownOpen.value = false
}
</script>

<template>
  <div class="layout" @click="closeAmmDropdown">
    <header class="topbar">
      <h2>BSM</h2>
      <nav class="nav">
        <router-link to="/" exact>Home</router-link>
        <router-link to="/Balance">Balances</router-link>
        <router-link to="/Mint">Mint</router-link>
        <router-link to="/Burn">Burn</router-link>
        <div class="nav-dropdown" @click.stop>
          <span class="nav-parent" @click="toggleAmmDropdown">AMM Pool ▾</span>
          <div class="nav-dropdown-content" :class="{ show: isAmmDropdownOpen }">
            <router-link to="/Amm" @click="closeAmmDropdown">AMM Home</router-link>
            <router-link to="/Amm/swap-stable" @click="closeAmmDropdown">Swap Stable</router-link>
            <router-link to="/Amm/swap-leverage" @click="closeAmmDropdown">Swap Leverage</router-link>
            <router-link to="/Amm/liquidity" @click="closeAmmDropdown">Liquidity Management</router-link>
          </div>
        </div>
        
        
        <div class="nav-dropdown" @click.stop>
          <span class="nav-parent" @click="toggleLiquidationDropdown">Liquidation ▾</span>
          <div class="nav-dropdown-content" :class="{ show: isLiquidationDropdownOpen }">
            <router-link to="/Liquidation/parameters" @click="closeAmmDropdown">Liquidation Parameters</router-link>
            <router-link to="/Liquidation/leverage-info" @click="closeAmmDropdown">Leverage Token Info</router-link>
            <router-link to="/Liquidation/auction" @click="closeAmmDropdown">Auction</router-link>
          </div>
        </div>
        <router-link to="/Oracle">Oracle</router-link>
        <router-link to="/Addresses">Deployed Addresses</router-link>
      </nav>
    </header>
    <main class="main-content">
      <h1>BSM Project</h1>
      <router-view />
    </main>
  </div>
</template>



<style scoped>
.layout {
  min-height: 100vh;
  width: 100%;
  box-sizing: border-box;
  background: #f8f9fa;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}
.topbar {
  width: 100%;
  background: #2c3e50;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 2em;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  height: 64px;
}
.topbar h2 {
  margin-right: 2em;
  font-size: 1.2em;
  letter-spacing: 2px;
  color: #42b983;
}
.nav {
  display: flex;
  gap: 2em;
  flex: 1;
}
.nav a {
  color: #fff;
  text-decoration: none;
  font-size: 1em;
  padding: 0.5em 1em;
  border-radius: 4px;
  transition: background 0.2s;
  font-weight: 500;
}
.nav a.router-link-active {
  background: #42b983;
  color: #fff;
  font-weight: bold;
}
.nav a:hover {
  background: #34495e;
}
.nav-dropdown {
  position: relative;
  display: inline-block;
}
.nav-dropdown .nav-parent {
  color: #fff;
  text-decoration: none;
  font-size: 1em;
  padding: 0.5em 1em;
  border-radius: 4px;
  transition: background 0.2s;
  font-weight: 500;
  cursor: pointer;
  display: inline-block;
}
.nav-dropdown .nav-parent:hover {
  background: #34495e;
}
.nav-dropdown-content {
  display: none;
  position: absolute;
  background: #34495e;
  min-width: 160px;
  box-shadow: 0 8px 16px rgba(0,0,0,0.2);
  z-index: 1000;
  border-radius: 4px;
  margin-top: 0.5em;
}
.nav-dropdown-content.show {
  display: block;
}
.nav-dropdown-content a {
  color: #fff;
  padding: 0.75em 1em;
  text-decoration: none;
  display: block;
  font-size: 0.95em;
  border-radius: 0;
}
.nav-dropdown-content a:hover {
  background: #42b983;
}
.nav-dropdown-content a.router-link-active {
  background: #42b983;
  font-weight: bold;
}
.main-content {
  width: 100%;
  margin: 0;
  flex: 1;
  padding: 0;
  box-sizing: border-box;
  overflow-x: hidden;
}
label {
  font-weight: bold;
  margin-right: 1em;
}
span {
  color: #333;
}
:global(html), :global(body) {
  overflow-x: hidden;
  width: 100vw;
  margin: 0;
  padding: 0;
}
</style>

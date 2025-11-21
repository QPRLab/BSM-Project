import { createRouter, createWebHistory } from 'vue-router'
import Overview from '../views/Overview.vue'
import Balance from '../views/Balance.vue'
import Mint from '../views/Mint.vue'
import Burn from '../views/Burn.vue'
import Amm from '../views/Amm.vue'
import AmmSwapStable from '../views/AmmSwapStable.vue'
import AmmSwapLeverage from '../views/AmmSwapLeverage.vue'
import AmmLiquidity from '../views/AmmLiquidity.vue'
import LiquidationParameters from '../views/LiquidationParameters.vue'
import LeverageTokenInfo from '../views/LeverageTokenInfo.vue'
import Auction from '../views/Auction.vue'
import Oracle from '../views/Oracle.vue'
import DeployedAddresses from '../views/DeployedAddresses.vue'

const routes = [
  { path: '/', component: Overview },
  { path: '/Balance', component: Balance },
  { path: '/Mint', component: Mint },
  { path: '/Burn', component: Burn },
  { path: '/Amm', component: Amm },
  { path: '/Amm/swap-stable', component: AmmSwapStable },
  { path: '/Amm/swap-leverage', component: AmmSwapLeverage },
  { path: '/Amm/liquidity', component: AmmLiquidity },
  { path: '/Liquidation', component: LiquidationParameters },
  { path: '/Liquidation/parameters', component: LiquidationParameters },
  { path: '/Liquidation/leverage-info', component: LeverageTokenInfo },
  { path: '/Liquidation/auction', component: Auction },
  { path: '/Oracle', component: Oracle }
  ,{ path: '/Addresses', component: DeployedAddresses }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
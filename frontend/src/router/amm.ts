import { createRouter, createWebHistory } from 'vue-router'

export default [
  {
    path: '/Amm',
    component: () => import('../views/Amm.vue'),
    children: [
      {
        path: '',
        name: 'AmmDashboard',
        component: () => import('../views/Amm.vue'),
      },
      {
        path: 'swap-stable',
        name: 'AmmSwapStable',
        component: () => import('../views/AmmSwapStable.vue'),
      },
      {
        path: 'swap-leverage',
        name: 'AmmSwapLeverage',
        component: () => import('../views/AmmSwapLeverage.vue'),
      },
      {
        path: 'liquidity',
        name: 'AmmLiquidity',
        component: () => import('../views/AmmLiquidity.vue'),
      }
    ]
  }
]

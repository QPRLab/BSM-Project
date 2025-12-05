import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router/index.js'
import { createPinia } from 'pinia'
import { useWalletStore } from './stores/wallet'

const pinia = createPinia()
const app = createApp(App)
app.use(router)
app.use(pinia)
app.mount('#app')

// Attempt to initialize wallet client on app startup using saved preference
try {
	const wallet = useWalletStore()
	// init after next tick to ensure pinia is ready
	// calling initWalletClient() will read preferredProvider and create client if provider is injected
	wallet.initWalletClient()
} catch (err) {
	// swallow errors to avoid breaking app init if store isn't ready or window not available
	console.warn('Auto-init wallet client skipped:', err)
}

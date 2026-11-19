import { createApp, h } from 'vue'
import App from './App.vue'
import FollowGate from './components/FollowGate.vue'
import './style.css'
import './airplane.css'

createApp({
  render: () => h(FollowGate, null, { default: () => h(App) }),
}).mount('#app')

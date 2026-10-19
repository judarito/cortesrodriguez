import { createApp } from 'vue'
import App from './App.vue'
import OperationsApp from './operations/OperationsApp.vue'
import PublicRequestApp from './operations/PublicRequestApp.vue'
import FeedbackApp from './operations/FeedbackApp.vue'
import './styles.css'

const isOperationsRoute = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/')
const isPublicRequestRoute = window.location.pathname === '/solicitud' || window.location.pathname === '/solicitud/' || window.location.pathname.startsWith('/solicitud/agente/')
const isFeedbackRoute = window.location.pathname === '/feedback'
createApp(isOperationsRoute ? OperationsApp : isPublicRequestRoute ? PublicRequestApp : isFeedbackRoute ? FeedbackApp : App).mount('#app')

import { createApp } from 'vue'
import App from './App.vue'
import OperationsApp from './operations/OperationsApp.vue'
import PublicRequestApp from './operations/PublicRequestApp.vue'
import FeedbackApp from './operations/FeedbackApp.vue'
import ClientPortalApp from './operations/ClientPortalApp.vue'
import './styles.css'

const isOperationsRoute = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/')
const isPublicRequestRoute = window.location.pathname === '/solicitud' || window.location.pathname === '/solicitud/' || window.location.pathname.startsWith('/solicitud/agente/')
const isFeedbackRoute = window.location.pathname === '/feedback'
const isClientPortalRoute = window.location.pathname === '/portal-cliente' || window.location.pathname === '/portal-cliente/'
createApp(isOperationsRoute ? OperationsApp : isPublicRequestRoute ? PublicRequestApp : isFeedbackRoute ? FeedbackApp : isClientPortalRoute ? ClientPortalApp : App).mount('#app')

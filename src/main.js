import { createApp } from 'vue'
import App from './App.vue'
import OperationsApp from './operations/OperationsApp.vue'
import PublicRequestApp from './operations/PublicRequestApp.vue'
import PaymentReturnApp from './operations/PaymentReturnApp.vue'
import FeedbackApp from './operations/FeedbackApp.vue'
import ClientPortalApp from './operations/ClientPortalApp.vue'
import './styles.css'

const isOperationsRoute = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/')
const isPublicRequestRoute = window.location.pathname === '/solicitud' || window.location.pathname === '/solicitud/' || window.location.pathname.startsWith('/solicitud/agente/')
const isPaymentReturnRoute = window.location.pathname === '/solicitud/resultado-pago'
const isFeedbackRoute = window.location.pathname === '/feedback'
const isClientPortalRoute = window.location.pathname === '/portal-cliente' || window.location.pathname === '/portal-cliente/'
createApp(isOperationsRoute ? OperationsApp : isPaymentReturnRoute ? PaymentReturnApp : isPublicRequestRoute ? PublicRequestApp : isFeedbackRoute ? FeedbackApp : isClientPortalRoute ? ClientPortalApp : App).mount('#app')

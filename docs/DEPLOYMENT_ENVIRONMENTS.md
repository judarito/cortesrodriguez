# Flujo de entornos

## Producción

- Rama: `main`
- Worker: `cortes-rodriguez-asesores`
- Base actual: Turso producción
- Despliegue: únicamente mediante Pull Request aprobado y mergeado a `main`

## Desarrollo

- Rama: `dev`
- Worker: `cortes-rodriguez-asesores-dev`
- Base: Turso desarrollo para la landing
- Base operativa: Neon desarrollo para la plataforma operativa
- Configuración: `wrangler.dev.jsonc`

## Protección requerida en GitHub

En `main` se debe activar:

- Require a pull request before merging.
- Require at least one approval.
- Dismiss stale approvals after new commits.
- Require status checks to pass.
- Restrict direct pushes, incluido el administrador si el equipo lo permite.

## Variables del Worker dev

Configurar como secretos independientes del entorno de producción:

```bash
npx wrangler secret put TURSO_URL --config wrangler.dev.jsonc
npx wrangler secret put TURSO_AUTH_TOKEN --config wrangler.dev.jsonc
npx wrangler secret put ADMIN_EMAIL --config wrangler.dev.jsonc
npx wrangler secret put ADMIN_PASSWORD --config wrangler.dev.jsonc
npx wrangler secret put JWT_SECRET --config wrangler.dev.jsonc
npx wrangler secret put RESEND_API_KEY --config wrangler.dev.jsonc
npx wrangler secret put NEON_DATABASE_URL --config wrangler.dev.jsonc
npx wrangler secret put MP_ACCESS_TOKEN --config wrangler.dev.jsonc
npx wrangler secret put MP_WEBHOOK_SECRET --config wrangler.dev.jsonc
npx wrangler secret put TURNSTILE_SITE_KEY --config wrangler.dev.jsonc
npx wrangler secret put TURNSTILE_SECRET_KEY --config wrangler.dev.jsonc
```

Para Turnstile en Dev, crea un widget independiente desde **Cloudflare Dashboard → Turnstile → Add widget manually**. Usa modo **Managed**, nombre `CRA formulario público - Dev` y hostname `cortes-rodriguez-asesores-dev.juan-d-ricardo-t.workers.dev` (sin `https://` ni rutas). Copia el Sitekey y el Secret key y cárgalos con los dos comandos anteriores; no los pegues en el repositorio ni en el chat. La app muestra/verifica el desafío cuando ambas variables están configuradas. Crea otro widget y claves independientes para producción cuando se vaya a habilitar allí.

La landing conserva Turso; la plataforma operativa usa Neon. Mercado Pago permanece en sandbox en dev y debe usar una app/token de producción independiente antes de publicar.

## Integración Mercado Pago en dev

- App Checkout Pro sandbox: `cortesrodriguez-dev-test`.
- Worker: `cortes-rodriguez-asesores-dev`.
- URL dev: `https://cortes-rodriguez-asesores-dev.juan-d-ricardo-t.workers.dev`.
- Preferencias: `POST /api/public/payments/preference`.
- Webhook: `POST /api/public/payments/webhook`.
- Retornos: `/solicitud?payment=success`, `/solicitud?payment=pending` y `/solicitud?payment=failure`.
- No guardar tokens en el repositorio ni documentar su valor; usar `wrangler secret`.
- `MP_WEBHOOK_SECRET` debe contener la firma secreta configurada para el webhook sandbox; no es el Access Token.

### Refuerzo del flujo de pagos (2026-10-24)

- El backend crea checkout solo si la solicitud tiene `payment_required = true`; las solicitudes sin cobro terminan sin redirección a Mercado Pago.
- Antes de salir al checkout, el cliente ve USD, TRM con fecha y total COP, y debe confirmar que desea continuar.
- Cada intento tiene una clave de idempotencia y una fila propia. Los reintentos HTTP reutilizan la misma preferencia y los intentos posteriores no chocan por referencia única.
- El webhook exige y verifica `x-signature` con HMAC-SHA256. Antes de aprobar, comprueba referencia externa, preferencia, COP y monto exacto contra el intento persistido.
- La creación de solicitudes usa una clave UUID de idempotencia; la base de datos conserva hashes de la clave y del contenido para no guardar credenciales del navegador ni duplicar solicitudes.
- Los eventos de webhook relevantes se escriben como logs estructurados sin datos del cliente, referencias, tokens ni contenido de pago.
- Los adjuntos se validan por estructura/firma y dimensiones máximas, además de MIME declarado y límites de tamaño.
- La migración `022_payment_retries_and_webhook_validation.sql` elimina la unicidad por solicitud y agrega los datos de reintento.
- La migración `023_public_request_idempotency.sql` agrega idempotencia del formulario público.
- La migración `025_payment_diagnostics_and_email_outbox.sql` agrega auditoría segura de eventos de pago y una cola idempotente de correo para pagos aprobados.
- La migración `026_event_notification_queue.sql` amplía el outbox a una cola duradera para solicitudes, pagos, asignaciones, revisión de respuestas y feedback; la clave única representa cada evento de negocio y permite múltiples eventos del mismo tipo para una solicitud.
- La migración `027_transactional_notification_events.sql` agrega triggers para insertar eventos en la misma transacción de creación/actualización de solicitudes, pagos, asignaciones, respuestas y feedback.
- La migración `028_cloudflare_notification_queue.sql` agrega estados de despacho y lease para publicar el outbox en Cloudflare Queues sin perder su idempotencia transaccional.
- El panel administrativo permite verificar/reconciliar un pago consultando Mercado Pago; se guardan referencia, IDs, estado, moneda, monto y un código de diagnóstico, nunca secretos ni datos de tarjeta.
- El Cron despacha hasta 20 eventos del outbox por ciclo a Cloudflare Queues; el consumidor envía por Resend y usa la fila Neon como control idempotente. Los fallos de Resend vuelven al outbox para reintento incremental (máximo ocho intentos); fallos transitorios de consumo reintentan en Queues y los agotados van a la DLQ. El estado de pago y el estado de entrega del correo son independientes.
- Colas dev creadas y activas en Cloudflare: `cra-notification-events-dev` y `cra-notification-events-dev-dlq`. Wrangler confirma un productor y un consumidor en la cola principal; la DLQ queda asociada al consumidor.

## Regla de notificaciones pagadas

Las solicitudes que requieren pago se crean antes de cobrar para conservar su referencia; mientras no exista confirmación, la cola limita el aviso al administrador. El webhook registra `payment_approved` con idempotencia por solicitud y, tras la confirmación, se notifican las partes configuradas. Pagos rechazados/cancelados solo alertan al administrador. Los eventos se persisten antes del envío y se procesan en segundo plano; los fallos reintentan sin cambiar el estado del pago.

### Destinatarios y alcance de las reglas

- Los correos del cliente, agente, experto y administración se obtienen de los usuarios relacionados con la solicitud; no se deben duplicar en la lista de destinatarios adicionales.
- “Correos adicionales” sirve para buzones compartidos o de supervisión sin usuario propio en la plataforma. Estos pueden asociarse a reglas como Para, CC o CCO.
- Las reglas aplicables se combinan por evento, servicio, consulta y origen. Sus audiencias y direcciones adicionales se agregan a los destinatarios base del evento; una regla no puede quitar las notificaciones base al cliente o al experto asignado.
- Para solicitudes que requieren pago, `request_created` avisa solo a administración hasta que el pago sea aprobado. Los pagos rechazados o cancelados también avisan solo a administración.
- En `payment_approved`, el cliente recibe confirmación de que el pago fue recibido y que el equipo pronto lo contactará; la entrega de este correo sigue la cola idempotente y no cambia el estado del pago si Resend falla.

### Reconciliación de pagos

La acción administrativa **Verificar pago** consulta el recurso de pago en Mercado Pago y valida la referencia externa, moneda COP y monto contra el intento guardado. Si Mercado Pago devuelve `preference_id`, este debe coincidir con la preferencia local. Algunos recursos de pago aprobados no incluyen ese campo; su ausencia no bloquea la conciliación cuando la consulta autenticada del pago y las demás validaciones coinciden. Un `preference_id` presente pero distinto sí se rechaza. El diagnóstico guarda el motivo sin almacenar tokens ni datos de tarjeta.

### Estado de despliegue y validación (2026-10-24)

- Worker dev `cortes-rodriguez-asesores-dev`, versión activa `0420f649-3c4c-4e3e-8123-029c000881fe`; producción no se modificó.
- La migración `028_cloudflare_notification_queue.sql` está aplicada: Neon dev acepta consultas al outbox con el nuevo esquema. Al revisar el entorno, el outbox no tenía eventos pendientes ni históricos.
- Se verificó en Cloudflare que la cola dev tiene productor/consumidor y DLQ asociados.
- Suite de pruebas: 28 pruebas aprobadas. Incluye una simulación de Resend que falla y luego se recupera: la notificación pasa por `pending_retry` y `accepted`, conserva la misma clave `Idempotency-Key` y no altera el estado del pago.
- `npm run build` pasó correctamente.
- Las pruebas de fallo/recuperación simulan Resend localmente; no se generó un pago, no se envió correo real y no se usaron solicitudes reales de clientes. Queda pendiente una prueba E2E con solicitud de prueba aislada y credenciales sandbox.
- Pendiente operativo: configurar alerta/monitorización para fallos del Worker y DLQ, y completar E2E sandbox de pago y notificación en una solicitud dedicada de prueba.

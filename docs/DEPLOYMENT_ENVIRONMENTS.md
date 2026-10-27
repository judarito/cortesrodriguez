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

### Navegación unificada de solicitudes (2026-10-24)

- Commit: `74d216e` (`Unify requests navigation with admin tabs`), rama `dev` publicada en `origin/dev`.
- Worker dev: `cortes-rodriguez-asesores-dev`; versión `f3d9559c-bbdd-4dcc-b87c-e58002a05f18`.
- Verificación HTTP posterior al despliegue: `/` y `/api/public/features` respondieron 200.
- `npm run build`, 11 suites (`node --test tests/*.test.js`) y `git diff --check` pasaron.
- Producción no fue modificada. Pendiente: validación manual autenticada con cuentas de admin y experto.

### Aviso emergente de notificaciones (2026-10-24)

- Commit de aplicación y documentación: `b22d88e` (`Show toast for incoming app notifications`), subido a `origin/dev`.
- Worker dev: `cortes-rodriguez-asesores-dev`; versión `a5a32561-56ab-4357-8718-efb0a09fe566`.
- El toast muestra título y mensaje durante siete segundos; al abrirlo marca como leída la notificación y navega a la solicitud. La comparación de IDs evita avisos retroactivos/duplicados; el sondeo detecta novedades si realtime no está conectado.
- Verificación: build y 11 suites aprobados; `/` y `/api/public/features` respondieron HTTP 200. Producción no se modificó.

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

### Acceso operativo y retorno de Mercado Pago

- El inicio de sesión de la plataforma operativa valida usuarios y contraseñas contra `operations.users` y `operations.user_credentials` en Neon. Los secretos heredados `ADMIN_EMAIL` y `ADMIN_PASSWORD` no son las credenciales de acceso de este flujo; `ADMIN_EMAIL` sigue siendo usado por el script explícito de seed, por lo que no se debe ejecutar ese script para recuperar una cuenta sin revisar antes el correo configurado.
- Si cambia el correo de un administrador, debe iniciar sesión con el correo vigente en `operations.users`; la contraseña se conserva mientras no se restablezca explícitamente.
- La pantalla `/solicitud/resultado-pago` limita a 8 segundos la verificación iniciada por el navegador. Desde que abre confirma que la solicitud está registrada, muestra el código de seguimiento y advierte que no se debe pagar de nuevo si el cargo ya aparece. Si Mercado Pago o la base de datos tardan, conserva ese mensaje sin dejar un spinner indefinido. La confirmación del webhook y la conciliación administrativa siguen siendo las fuentes para actualizar el estado.

### Layout compartido del portal

- El portal autenticado reutiliza `OperationsShell`, el mismo armazón de navegación, encabezado y perfil que el admin y el experto; el menú muestra las opciones disponibles para cada rol.
- La landing, el formulario público, la plataforma operativa y el portal cliente comparten la preferencia de idioma `locale` en `localStorage`. Al abrir el portal en el mismo navegador y origen, se conserva el idioma seleccionado sin persistir una preferencia en la base de datos.
- Publicado en `cortes-rodriguez-asesores-dev`, versión `73d8bcec-6b03-4d42-b175-f0f5d05cbcea`. `/portal-cliente` y `/app/login` responden HTTP 200; build y `git diff --check` aprobados. Producción y `main` no se modificaron.

#### Ajuste de retorno de pago en Dev (2026-10-27)

- La verificación iniciada desde el navegador se cancela a los 15 segundos y pasa a un mensaje de confirmación pendiente con la instrucción explícita de no pagar de nuevo si el cargo ya aparece.
- Diagnóstico de acceso: el usuario administrador actual de Neon Dev está activo y conserva credencial; el correo del login es el que figura en `operations.users`. `.env.dev` aún contiene un correo anterior en `ADMIN_EMAIL`, variable que el login operativo no consulta.
- Publicado en `cortes-rodriguez-asesores-dev`, versión `e635d8f3-96eb-40d2-bf95-4db03f51a7f5`. Verificación HTTP: retorno de pago 200; ruta de login accesible (400 ante cuerpo vacío, sin intento de contraseña); verificación de pago configurada (400 ante datos vacíos, sin consultar una transacción). Build y `git diff --check` aprobados.
- No se modificó producción, `main`, credenciales ni estado de pagos.

#### Mensaje de retorno más claro (2026-10-27)

- Dev ahora presenta desde la carga inicial que la solicitud sigue registrada, incluye el código de seguimiento y avisa que no se debe pagar otra vez si el cliente ya ve el cargo. El icono ya no queda animándose indefinidamente.
- La consulta al backend tiene un límite visible de 8 segundos; al agotarse, la página conserva la solicitud y explica que Mercado Pago aún debe confirmar el estado.
- Publicado en `cortes-rodriguez-asesores-dev`, versión `8e3f71c8-3f8c-4e43-9045-e3475bae775d`. El HTML responde HTTP 200 y el bundle publicado contiene los nuevos mensajes.
- No se modificó producción ni `main`.

#### Retorno basado en pago confirmado (2026-10-27)

- La verificación del retorno consulta primero en Neon el pago `approved` asociado a la referencia. Si el webhook o la conciliación ya lo guardaron como pagado, responde confirmado directamente y no depende de repetir la consulta a Mercado Pago.
- La consulta pública solo devuelve el estado y la referencia, sin datos personales. Si no existe un pago aprobado localmente, se conserva la verificación con Mercado Pago.
- Se comprobó que la solicitud `CRA-20261027-A67C15` tiene un intento `approved` enlazado como confirmado en Neon Dev.
- Publicado en `cortes-rodriguez-asesores-dev`, versión `644211e2-6d18-4d22-9bc8-a1f14bea0e27`. La verificación de retorno de esa referencia respondió HTTP 200 con `approved` sin requerir un ID ni consultar de nuevo a Mercado Pago.
- Producción y `main` no se modificaron.

### Portal de clientes — despliegue y estado actual en dev (2026-10-25)

- Se inició el detalle autenticado de solicitudes, el historial de pago y el inicio/reanudación del checkout sobre la solicitud existente.
- Las migraciones `038_client_portal_payment_safety.sql`, `039_client_portal_access_rate_limit.sql` y `040_client_portal_ip_rate_limit.sql` se aplicaron en Neon dev mediante el script que carga `.env.dev`.
- El backend serializa la emisión y validación de códigos passwordless; los errores internos del Worker responden con texto genérico.
- Un segundo pago aprobado para una misma solicitud queda como `duplicate_approved` con diagnóstico, sin habilitar una segunda atención pagada.
- Worker `cortes-rodriguez-asesores-dev` publicado desde local, versión `2988635d-5844-4e94-98a0-fe5cd83fb6a5`.
- Código subido a `origin/dev` en el commit `3a8da30` (`Build secure client portal flows`).
- Verificación HTTP posterior: `/portal-cliente` 200, `/api/client/session` sin sesión 401, `/api/client/requests` sin sesión 401 y `/api/public/features` 200. Suite automatizada (24 archivos), build y `git diff --check` aprobados.
- Pendiente: login con código en buzón real, compra/reintento/retorno con Mercado Pago sandbox, conciliación administrativa de preferencia incierta y agregar enlaces del portal a los correos aplicables.
- No se desplegó este cambio a producción ni se modificó `main`.

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
- La migración `030_in_app_notifications.sql` está aplicada en Neon dev. La campanita realtime se desplegó en el Worker dev con endpoints autenticados y Durable Object `NotificationHub` (WebSocket Hibernation); producción no se modificó.
- Las notificaciones persistentes se materializan idempotentemente desde eventos del outbox después de que Resend acepta el correo; estados webhook posteriores actualizan la campanita. Neon sigue siendo la fuente de verdad y el WebSocket solo transmite el ID de la notificación.
- La bandeja exige una sesión operativa vigente tanto para la API como para emitir tickets WebSocket; los tickets se guardan hasheados, expiran en 90 segundos y se consumen una sola vez.
- Los avisos de experto se dirigen al `assigned_expert_id` persistido en cada solicitud. El correo obtiene únicamente la dirección del usuario unido a esa asignación y la campanita filtra por ese mismo ID; nunca se expande a todos los expertos asociados al tipo de consulta. Sin asignación individual no se envía aviso a expertos.

### Campanita realtime en dev (2026-10-24)

- Se aplicó `030_in_app_notifications.sql` en Neon dev y se desplegaron Worker/Assets con `wrangler.dev.jsonc`.
- Worker `cortes-rodriguez-asesores-dev`, versión activa `4f99031a-6312-4b49-a6db-f378060c77b3`; Durable Object `NotificationHub` y cola `cra-notification-events-dev` aparecen enlazados.
- Smoke tests HTTP: `/` y `/api/public/features` responden 200; `/api/app/notifications` sin sesión responde 401, como requiere el control de acceso.
- En correo y campanita, el experto destinatario se toma exclusivamente de `requests.assigned_expert_id`. No se notifica a todos los expertos elegibles; la prueba unitaria verifica el aislamiento del destinatario.
- Suite: 11 pruebas aprobadas; build y `git diff --check` correctos. Pendiente: prueba integrada autenticada de campanita y notificaciones con cuentas de admin, agente y experto.

### Corrección del alcance de notificaciones (2026-10-24)

- La API de la campanita filtra lista, contador y lectura por el rol vigente y la relación actual con la solicitud. Un experto solo consulta avisos de casos que siguen asignados a su usuario; los avisos históricos de otro rol/asignación ya no se muestran.
- Publicado en `cortes-rodriguez-asesores-dev`, versión `4a9327fb-2d9f-446c-a520-33f644655beb`; producción no se modificó.
- Verificación HTTP posterior: `/` y `/api/public/features` responden 200; `/api/app/notifications` sin sesión responde 401. Suite de 11 pruebas, build y `git diff --check` aprobados.

## Regla de notificaciones pagadas

Las solicitudes que requieren pago se crean antes de cobrar para conservar su referencia. Mientras no exista confirmación, el experto no recibe asignación por correo ni campana; administración sí conserva los avisos operativos aplicables. El webhook registra `payment_approved` con idempotencia por solicitud y, tras la confirmación, se notifican las partes configuradas. Los eventos se persisten antes del envío y se procesan en segundo plano; los fallos reintentan sin cambiar el estado del pago.

### Destinatarios y alcance de las reglas

- Los correos del cliente, agente, experto y administración se obtienen de los usuarios relacionados con la solicitud; no se deben duplicar en la lista de destinatarios adicionales.
- “Correos adicionales” sirve para buzones compartidos o de supervisión sin usuario propio en la plataforma. Estos pueden asociarse a reglas como Para, CC o CCO.
- Las reglas aplicables se combinan por evento, servicio, consulta y origen. Sus audiencias y direcciones adicionales se agregan a los destinatarios base del evento; una regla no puede quitar las notificaciones base al cliente o al experto asignado.
- Para solicitudes que requieren pago, `request_created` avisa solo a administración hasta que el pago sea aprobado. Los pagos rechazados o cancelados también avisan solo a administración.
- En `payment_approved`, el cliente recibe confirmación de que el pago fue recibido y que el equipo pronto lo contactará; la entrega de este correo sigue la cola idempotente y no cambia el estado del pago si Resend falla.
- La confirmación de pago también se conserva por correo para el admin. Correos administrativos permitidos: pago aprobado, experto asignado/asignación fallida y revisiones (similitud o respuesta pendiente). Se suprime para admin el correo redundante de `request_created` y los avisos rutinarios; cliente/agente/experto siguen sus reglas.
- La campana es independiente de Resend: se materializa desde cada evento idempotente aunque el email no aplique o falle. `email_status = 'not_sent'` se muestra como “No aplica”; los correos fallidos siguen mostrando reintento/fallo. Aplicar `031_app_notifications_without_email.sql` antes de desplegar esta versión.
- Las asignaciones automáticas iniciales también generan `expert_assigned`. Si la solicitud requiere pago, el experto no recibe la asignación antes de confirmarse el pago; administración sí puede recibir el aviso de asignación.
- `/app` → **Pagos** presenta un listado paginado de intentos, con búsqueda, filtros por estado/fecha y vínculo al detalle de solicitud cuando el usuario cuenta con `requests.read`; el endpoint requiere `payments.read`.

### Reconciliación de pagos

La acción administrativa **Verificar pago** consulta el recurso de pago en Mercado Pago y valida la referencia externa, moneda COP y monto contra el intento guardado. Si Mercado Pago devuelve `preference_id`, este debe coincidir con la preferencia local. Algunos recursos de pago aprobados no incluyen ese campo; su ausencia no bloquea la conciliación cuando la consulta autenticada del pago y las demás validaciones coinciden. Un `preference_id` presente pero distinto sí se rechaza. El diagnóstico guarda el motivo sin almacenar tokens ni datos de tarjeta.

### Retorno de Checkout e identidad de clientes

- Los tres retornos de Mercado Pago (aprobado, pendiente y fallido) llevan a `/solicitud/resultado-pago`, una vista separada del formulario. Cuando el proveedor devuelve ID de pago y referencia, la vista verifica el resultado con el backend y presenta el código de seguimiento; nunca declara el pago aprobado solo por el retorno del navegador.
- La migración `029_unique_clients_by_email.sql` agrega el correo normalizado al cliente, vincula nuevas solicitudes al cliente existente sin distinguir mayúsculas/minúsculas y crea una restricción única en base de datos. El correo continúa guardándose en cada solicitud como dato de contacto histórico.
- La migración agrupa clientes históricos duplicados por email, conserva todas sus solicitudes bajo el registro canónico más antiguo y guarda el nombre/identificador de los registros absorbidos en `operations.client_identity_merges` para trazabilidad.
- Aplicar la migración 029 en Neon dev antes de desplegar código que use `email_normalized`; producción requiere la misma migración en una publicación separada.

### Estado de despliegue y validación (2026-10-24)

- Worker dev `cortes-rodriguez-asesores-dev`, versión activa `0420f649-3c4c-4e3e-8123-029c000881fe`; producción no se modificó.
- La migración `028_cloudflare_notification_queue.sql` está aplicada: Neon dev acepta consultas al outbox con el nuevo esquema. Al revisar el entorno, el outbox no tenía eventos pendientes ni históricos.
- Se verificó en Cloudflare que la cola dev tiene productor/consumidor y DLQ asociados.
- Suite de pruebas: 28 pruebas aprobadas. Incluye una simulación de Resend que falla y luego se recupera: la notificación pasa por `pending_retry` y `accepted`, conserva la misma clave `Idempotency-Key` y no altera el estado del pago.
- `npm run build` pasó correctamente.
- Las pruebas de fallo/recuperación simulan Resend localmente; no se generó un pago, no se envió correo real y no se usaron solicitudes reales de clientes. Queda pendiente una prueba E2E con solicitud de prueba aislada y credenciales sandbox.
- Pendiente operativo: configurar alerta/monitorización para fallos del Worker y DLQ, y completar E2E sandbox de pago y notificación en una solicitud dedicada de prueba.

### Publicación dev (2026-10-24)

- Commit `008470a` (`Move expert response review into request details`) subido a `origin/dev`.
- Worker `cortes-rodriguez-asesores-dev` desplegado correctamente; versión activa `3d4fa4cb-ad9a-4d20-9059-2f6f5d81563e`.
- Incluye la revisión de respuesta en el detalle de la solicitud, el menú de Feedback de clientes separado y mejoras léxicas de detección de similitud. Producción no se modificó.
- Pruebas: 10 suites aprobadas; `npm run build` y `git diff --check` correctos.

### Listado de pagos y separación correo/campana (2026-10-24)

- Se aplicó `031_app_notifications_without_email.sql` en Neon dev.
- Worker `cortes-rodriguez-asesores-dev` desplegado con versión `9ecdf39a-44bb-4ee8-bc3f-e75eed84ae84`; producción no se modificó.
- Incluye listado paginado de pagos, correos administrativos limitados a pago confirmado/asignación/revisión y materialización independiente de notificaciones de campana para todos los eventos autorizados.
- Smoke test HTTP: `/` y `/api/public/features` responden 200; `/api/app/payments` sin sesión no concede acceso (403) y `/api/app/notifications` exige sesión (401).
- Build y 11 suites aprobados.

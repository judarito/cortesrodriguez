# Plan: Plataforma operativa

Construir una plataforma operativa independiente de la landing, usando Neon como base de datos. La landing actual permanecerá intacta, con su propio contenido, administración y base Turso; la nueva aplicación tendrá sus propios usuarios, permisos, solicitudes, pagos, trazabilidad y configuración.

## Arquitectura acordada

```text
Landing existente
  /
  /admin
  └── Turso

Plataforma operativa
  /app
  /solicitud
  /api/app/*
  /api/public/payments/webhook
  └── Neon
```

La landing no se migra, no comparte tablas operativas y no comparte usuarios administrativos con la nueva plataforma.

## Alcance

### Incluido

- Formulario público de solicitudes en `/solicitud`, accesible desde los botones de la landing.
- Solicitudes provenientes de múltiples fuentes: landing, panel interno, manual, API y aliados.
- Clientes y contactos.
- Solicitudes de importación y exportación.
- Pagos de asesoría mediante Mercado Pago Checkout Pro.
- Confirmación de pagos mediante webhook.
- Estados y trazabilidad de solicitudes.
- Usuarios, roles y permisos.
- Menús visibles según autorización.
- Panel administrativo en `/app`.
- Correos configurables.
- Documentos, tareas y comentarios internos.
- Auditoría de acciones.
- Base de datos Neon independiente.
- Política de pago configurable por fuente, servicio o convenio.

### No incluido

- Migración de la landing.
- Migración de tablas o datos de Turso.
- Mezcla de usuarios de la landing con usuarios operativos.
- Seguridad basada únicamente en ocultar menús.
- Confirmación de pago basada solo en el retorno del navegador.

## Plan de trabajo priorizado

### Fase 1: identidad, autorización y administración base

- [ ] Definir la arquitectura de módulos: landing en `/`, administración editorial en `/admin` y plataforma operativa en `/app`.
- [ ] Diseñar el modelo de identidad en Neon con usuarios, perfiles, roles, permisos, sesiones y recuperación de acceso.
- [ ] Crear tablas `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `sessions`, `password_reset_tokens` y `audit_log`.
- [ ] Definir roles iniciales: administrador, asesor, revisor, financiero, operador y consulta.
- [ ] Definir permisos por módulo, como `dashboard.read`, `requests.read`, `requests.update`, `payments.read`, `users.manage`, `reports.read` y `settings.manage`.
- [ ] Implementar autenticación segura para `/app/login`, con sesiones expirables, revocación, cierre de sesión y protección contra intentos repetidos.
- [ ] Implementar autorización en backend para cada endpoint y proteger las rutas frontend aunque el usuario acceda directamente a una URL.
- [ ] Crear el layout inicial de `/app` con navegación lateral, perfil de usuario, cierre de sesión y estados de carga/error.
- [ ] Implementar menús dinámicos según permisos para Inicio, Clientes, Solicitudes, Pagos, Documentos, Reportes, Usuarios y Configuración.
- [ ] Crear pantallas iniciales protegidas para cada módulo, aunque inicialmente estén vacías.
- [x] Crear el usuario administrador inicial en Neon dev y verificar login, sesión y permisos.
- [x] Crear módulo de seguridad para listar y crear usuarios y roles desde `/app`.
- [x] Permitir asignar un rol inicial al usuario y permisos al crear un rol.
- [ ] Probar combinaciones de roles, permisos insuficientes, rutas directas, sesiones expiradas y usuarios inactivos.

### Fase 2: clientes y solicitudes

- [x] Crear las entidades iniciales `operations.clients` y `operations.requests` en Neon dev.
- [x] Crear el cliente únicamente con `full_name` y guardar el resto de datos en la solicitud relacionada.
- [x] Crear el formulario público con nombre completo, constitución legal, medios de contacto, tipo de servicio (`exportacion`, `importacion` o `agente_carga`) y tipo de producto.
- [x] Modelar “Agente de carga” como un tipo de servicio, retirar el campo separado del formulario y habilitar sus reglas de notificación específicas.
- [x] Configurar el catálogo de “Asesoría personalizada” con valor y moneda administrables, mostrando el precio vigente y conservando una copia histórica en cada solicitud.
- [x] Registrar solicitudes de la landing con `source = landingpage` y estado inicial `pending`.
- [x] Mostrar confirmación al usuario con referencia de solicitud; si el servicio requiere pago, iniciar Checkout Pro desde `/solicitud` sin notificar al experto hasta la confirmación del webhook.
- [x] Mostrar clientes y solicitudes reales en el panel `/app`, protegidos por sesión y permisos.
- [x] Implementar paginación server-side y búsqueda por texto para los listados de clientes y solicitudes.
- [ ] Crear entidades de contactos, documentos, tareas, comentarios, eventos e historial de actividad.
- [ ] Registrar en cada solicitud `source_type`, `source_reference`, `source_metadata` y `created_by` para identificar su origen.
- [ ] Ampliar el formulario `/solicitud` con origen, destino, modalidad, fechas, documentos y observaciones.
- [ ] Definir una política de pago por fuente, tipo de servicio o convenio, incluyendo solicitudes exentas.
- [x] Separar el estado del pago del estado operativo de la solicitud mediante `operations.request_payments`; una solicitud puede continuar en `pending` mientras el pago queda registrado por separado.
- [x] Registrar referencia única, preferencia, identificador de pago, estado, USD, COP, TRM y fecha efectiva de TRM.
- [x] Definir estados de pago usados por el webhook: `pending`, `approved` y `cancelled`.
- [ ] Definir `request_status`: `draft`, `received`, `awaiting_payment`, `under_review`, `more_information_required`, `in_progress`, `completed` y `cancelled`.
- [ ] Crear el panel de solicitudes con listado, filtros, búsqueda, detalle, responsables, historial, documentos y comentarios.

### Fase 3: pagos y notificaciones

- [x] Integrar Mercado Pago Checkout Pro con referencias únicas, app sandbox separada y configuración por entorno.
- [x] Crear la app sandbox `cortesrodriguez-dev-test` para pruebas de Checkout Pro y guardar su token únicamente como secreto de Cloudflare dev (`MP_ACCESS_TOKEN`).
- [x] Crear preferencias con monto COP calculado desde el precio histórico USD y la TRM oficial; retornar al formulario mediante `/solicitud?payment=success|pending|failure`.
- [x] Implementar `/api/public/payments/webhook`, consultar el pago real en Mercado Pago y guardar el estado en `operations.request_payments`.
- [x] Hacer idempotente la notificación: solo la transición a `approved` dispara `payment_approved`; reintentos del webhook no duplican el correo.
- [x] Impedir notificaciones de solicitudes con `payment_required = true` mientras no exista un pago aprobado, incluidos envíos manuales desde el panel.
- [x] Enviar la notificación de pago aprobado a las audiencias configuradas, incluyendo al experto asignado, administración, agente de origen y cliente cuando aplique.
- [x] Implementar configuración inicial de destinatarios y reglas por evento/tipo de servicio desde `/app`, incluyendo destinatarios principales, CC para supervisión y CCO.
- [ ] Integrar remitente, plantillas, activación por entorno y proveedor de correo.
- [ ] Enviar notificaciones por solicitud creada, pago aprobado, pago rechazado, información adicional, cambio de estado y cierre.
- [x] Preparar trazabilidad de correos con `resend_email_id`, estados por solicitud y eventos idempotentes de Resend.
- [x] Mostrar el estado de correo en solicitudes y métricas de correos sin enviar/abiertos en el dashboard.
- [x] Conectar el envío operativo con reglas de destinatarios y guardar el identificador devuelto por Resend.
- [x] Persistir eventos de dominio en un outbox transaccional e idempotente en Neon; entregar los identificadores mediante Cloudflare Queues en dev, con consumidor, reintentos y DLQ.
- [x] Separar el resultado del pago del envío: un fallo de Resend programa reintento sin revertir el pago; mantener la misma clave idempotente al volver a enviar.
- [x] Probar con Resend simulado la selección de destinatarios de pago aprobado, fallo → `pending_retry` → éxito y reutilización de clave; no se enviaron correos reales.
- [ ] Completar prueba E2E de solicitud y pago en sandbox con una solicitud/destinatarios de prueba aislados, y verificar la DLQ mediante un fallo controlado.
- [x] Configurar `RESEND_WEBHOOK_SECRET`, activar open tracking en el dominio y registrar el webhook dev.
- [ ] Repetir la configuración de secretos, tracking y webhook en producción con una app Mercado Pago de producción distinta.

### Fase 4: auditoría, pruebas y despliegue

- [ ] Añadir auditoría de accesos, permisos, estados, pagos, documentos y configuraciones.
- [ ] Crear migraciones Neon versionadas para identidad, autorización, solicitudes, pagos, documentos y notificaciones.
- [ ] Crear pruebas integrales de autenticación, autorización, solicitudes multifuente, pagos condicionales y webhooks repetidos.
- [x] Configurar secretos independientes de dev, incluyendo `MP_ACCESS_TOKEN`, `NEON_DATABASE_URL` y credenciales de Resend.
- [x] Probar en dev con Neon dev, Mercado Pago sandbox, retorno aprobado y visualización del pago en el panel.
- [ ] Desplegar producción únicamente mediante Pull Request aprobado hacia `main`.

## Roles iniciales

| Rol | Propósito |
|---|---|
| Administrador | Control total de usuarios, permisos, configuración y operación |
| Asesor | Revisión y seguimiento de solicitudes asignadas |
| Revisor | Validación documental y técnica |
| Financiero | Consulta y validación de pagos |
| Operador | Gestión diaria de solicitudes y tareas |
| Consulta | Lectura limitada sin modificaciones |

## Reglas de autorización

- La visibilidad del menú es una ayuda de interfaz, no un mecanismo de seguridad.
- Cada endpoint debe validar sesión, rol y permiso.
- Las operaciones sensibles deben generar registros de auditoría.
- Los usuarios inactivos no pueden iniciar sesión.
- Los webhooks deben ser idempotentes.
- Los estados solo pueden cambiar mediante transiciones permitidas.
- Una solicitud sin pago requerido puede pasar directamente a `received` y continuar a revisión.
- Una solicitud con pago requerido debe mantener su estado de pago en `pending` hasta recibir confirmación válida de Mercado Pago.
- Una solicitud con pago requerido no envía notificaciones automáticas ni manuales a expertos antes de `payment_status = approved`.
- El webhook nunca debe asignar automáticamente un asesor ni avanzar por sí solo todo el proceso operativo.
- Los cambios de estado y pago deben conservar quién, cuándo, fuente y motivo del cambio.

## Preguntas abiertas

- ¿Los clientes tendrán portal propio o solo recibirán notificaciones?
- ¿Un usuario puede tener varios roles simultáneamente?
- ¿Los permisos deben limitarse también por empresa, asesor asignado o solicitud?

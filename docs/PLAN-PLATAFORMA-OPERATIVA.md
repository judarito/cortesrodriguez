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
  /api/webhooks/wompi
  └── Neon
```

La landing no se migra, no comparte tablas operativas y no comparte usuarios administrativos con la nueva plataforma.

## Alcance

### Incluido

- Formulario público de solicitudes en `/solicitud`, accesible desde los botones de la landing.
- Solicitudes provenientes de múltiples fuentes: landing, panel interno, manual, API y aliados.
- Clientes y contactos.
- Solicitudes de importación y exportación.
- Pagos de asesoría mediante Wompi.
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
- [x] Crear el formulario público con nombre completo, constitución legal, medios de contacto, servicio, agente de carga y tipo de producto.
- [x] Registrar solicitudes de la landing con `source = landingpage` y estado inicial `pending`.
- [x] Mostrar confirmación al usuario con referencia de solicitud, sin iniciar todavía pago ni notificaciones.
- [x] Mostrar clientes y solicitudes reales en el panel `/app`, protegidos por sesión y permisos.
- [x] Implementar paginación server-side y búsqueda por texto para los listados de clientes y solicitudes.
- [ ] Crear entidades de contactos, documentos, tareas, comentarios, eventos e historial de actividad.
- [ ] Registrar en cada solicitud `source_type`, `source_reference`, `source_metadata` y `created_by` para identificar su origen.
- [ ] Ampliar el formulario `/solicitud` con origen, destino, modalidad, fechas, documentos y observaciones.
- [ ] Definir una política de pago por fuente, tipo de servicio o convenio, incluyendo solicitudes exentas.
- [ ] Separar `payment_status` de `request_status` para que el pago no controle todo el flujo operativo.
- [ ] Definir `payment_status`: `not_required`, `pending`, `approved`, `rejected`, `cancelled` y `refunded`.
- [ ] Definir `request_status`: `draft`, `received`, `awaiting_payment`, `under_review`, `more_information_required`, `in_progress`, `completed` y `cancelled`.
- [ ] Crear el panel de solicitudes con listado, filtros, búsqueda, detalle, responsables, historial, documentos y comentarios.

### Fase 3: pagos y notificaciones

- [ ] Integrar Wompi con referencias únicas, firma de integridad, sandbox y configuración separada por entorno.
- [ ] Implementar el webhook de Wompi con validación de firma, idempotencia y registro de eventos.
- [ ] Después de un pago, limitar la automatización a actualizar el estado correspondiente, registrar el evento y enviar los correos configurados; la asignación y gestión operativa quedan para el equipo desde el panel.
- [x] Implementar configuración inicial de destinatarios y reglas por evento/tipo de servicio desde `/app`, incluyendo destinatarios principales, CC para supervisión y CCO.
- [ ] Integrar remitente, plantillas, activación por entorno y proveedor de correo.
- [ ] Enviar notificaciones por solicitud creada, pago aprobado, pago rechazado, información adicional, cambio de estado y cierre.
- [x] Preparar trazabilidad de correos con `resend_email_id`, estados por solicitud y eventos idempotentes de Resend.
- [x] Mostrar el estado de correo en solicitudes y métricas de correos sin enviar/abiertos en el dashboard.
- [x] Conectar el envío operativo con reglas de destinatarios y guardar el identificador devuelto por Resend.
- [x] Configurar `RESEND_WEBHOOK_SECRET`, activar open tracking en el dominio y registrar el webhook dev.
- [ ] Repetir la configuración de secretos, tracking y webhook en producción.

### Fase 4: auditoría, pruebas y despliegue

- [ ] Añadir auditoría de accesos, permisos, estados, pagos, documentos y configuraciones.
- [ ] Crear migraciones Neon versionadas para identidad, autorización, solicitudes, pagos, documentos y notificaciones.
- [ ] Crear pruebas integrales de autenticación, autorización, solicitudes multifuente, pagos condicionales y webhooks repetidos.
- [ ] Configurar secretos independientes de dev y producción.
- [ ] Probar todo en dev con Neon dev y Wompi sandbox.
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
- Una solicitud con pago requerido debe permanecer en `awaiting_payment` hasta recibir confirmación válida de Wompi.
- El webhook nunca debe asignar automáticamente un asesor ni avanzar por sí solo todo el proceso operativo.
- Los cambios de estado y pago deben conservar quién, cuándo, fuente y motivo del cambio.

## Preguntas abiertas

- ¿Los clientes tendrán portal propio o solo recibirán notificaciones?
- ¿Un usuario puede tener varios roles simultáneamente?
- ¿Los permisos deben limitarse también por empresa, asesor asignado o solicitud?

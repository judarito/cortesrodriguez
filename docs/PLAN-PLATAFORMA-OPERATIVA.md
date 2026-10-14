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
  /request
  /api/app/*
  /api/webhooks/wompi
  └── Neon
```

La landing no se migra, no comparte tablas operativas y no comparte usuarios administrativos con la nueva plataforma.

## Alcance

### Incluido

- Formulario público de solicitudes en `/request`.
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

## Plan de trabajo

- [ ] Definir la arquitectura de módulos: landing en `/`, administración editorial en `/admin`, aplicación operativa en `/app` y formulario público en `/request`.
- [ ] Diseñar el modelo de identidad en Neon con usuarios, perfiles, roles, permisos, sesiones y recuperación de acceso.
- [ ] Crear tablas `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `sessions` y `password_reset_tokens`.
- [ ] Definir roles iniciales: administrador, asesor, revisor, financiero, operador y consulta.
- [ ] Definir permisos por módulo, como `requests.read`, `requests.update`, `payments.read`, `users.manage`, `reports.read` y `settings.manage`.
- [ ] Implementar autenticación segura para `/app`, con sesiones expirables, revocación, cierre de sesión y protección contra intentos repetidos.
- [ ] Implementar autorización en backend para cada endpoint.
- [ ] Implementar navegación basada en permisos para clientes, solicitudes, pagos, documentos, reportes, usuarios y configuración.
- [ ] Proteger las rutas frontend y los endpoints aunque el usuario acceda directamente a una URL.
- [ ] Crear el formulario `/request` para datos del cliente, operación, mercancía, origen, destino, modalidad, fechas, documentos y observaciones.
- [ ] Crear entidades de clientes, contactos, solicitudes, documentos, tareas, comentarios, eventos y actividad.
- [ ] Registrar en cada solicitud `source_type`, `source_reference`, `source_metadata` y `created_by` para identificar su origen.
- [ ] Definir una política de pago por fuente, tipo de servicio o convenio, incluyendo solicitudes exentas.
- [ ] Separar `payment_status` de `request_status` para que el pago no controle todo el flujo operativo.
- [ ] Definir `payment_status`: `not_required`, `pending`, `approved`, `rejected`, `cancelled` y `refunded`.
- [ ] Definir `request_status`: `draft`, `received`, `awaiting_payment`, `under_review`, `more_information_required`, `in_progress`, `completed` y `cancelled`.
- [ ] Integrar Wompi con referencias únicas, firma de integridad, sandbox y configuración separada por entorno.
- [ ] Implementar el webhook de Wompi con validación de firma, idempotencia y registro de eventos.
- [ ] Después de un pago, limitar la automatización a actualizar el estado correspondiente, registrar el evento y enviar los correos configurados; la asignación y gestión operativa quedan para el equipo desde el panel.
- [ ] Crear el panel administrativo con listado, filtros, búsqueda, detalle, responsables, historial, pagos y documentos.
- [ ] Implementar configuración de correos: remitente, destinatarios, plantillas, eventos y activación por entorno.
- [ ] Enviar notificaciones por solicitud creada, pago aprobado, pago rechazado, información adicional, cambio de estado y cierre.
- [ ] Añadir auditoría de accesos, permisos, estados, pagos, documentos y configuraciones.
- [ ] Crear migraciones Neon para identidad, autorización, solicitudes, pagos, documentos, notificaciones y auditoría.
- [ ] Crear pruebas para autenticación, autorización, menús, acceso directo a URLs, sesiones expiradas, webhooks repetidos y estados inválidos.
- [ ] Configurar secretos independientes de dev y producción.
- [ ] Probar todo en dev con Wompi sandbox y Neon dev.
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

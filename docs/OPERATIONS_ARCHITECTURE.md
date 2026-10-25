# Plataforma operativa

La plataforma operativa vive en el mismo repositorio y despliegue que la landing, pero mantiene separados su frontend, API, dominio y base de datos.

## Frontend

- `src/landing/`: sitio público y administración editorial existente.
- `src/operations/`: panel interno para clientes, operaciones, documentos, tareas y reportes.
- `src/shared/`: componentes, autenticación, cliente API y utilidades compartidas.
- `src/shared/components/ListView.vue`: componente común de listados con encabezado, barra de herramientas, tabla, paginación y estados de carga/vacío. Su contenedor visual debe ser autocontenido (no depender de estilos scoped del padre); en móvil presenta filas como tarjetas para evitar scroll horizontal.

### Revisión de respuestas

- La aprobación o devolución de una respuesta del experto se realiza dentro de **Solicitudes → detalle de la solicitud → Respuestas del experto**. El administrador puede agregar una nota opcional y aprobar/enviar al cliente o devolver al experto.
- La bandeja independiente **Revisión de respuestas** se retiró para evitar duplicar acciones y contexto. **Feedback de clientes** permanece como vista administrativa separada.
- Los controles de aprobación solo se muestran a administración y usan el endpoint protegido `PUT /api/app/reviews/responses/:responseId`; la API vuelve a validar permisos y estado pendiente. Antes de aprobar, verifica que el cliente tenga correo para no dejar una respuesta aprobada sin posibilidad de notificación.
- El panel de detalle ocupa la mitad del viewport en escritorio y el ancho completo en pantallas pequeñas.
- **Preguntas similares** sigue siendo un flujo separado: administración revisa candidatos antes de asignar la solicitud o adaptar una respuesta previa.

## Backend

- `worker/routes/`: endpoints agrupados por dominio.
- `worker/db/`: conexión PostgreSQL/Neon, consultas y migraciones.
- `worker/db/migrations/`: cambios versionados del esquema operativo.

### Actualización realtime del estado de solicitudes

- Los eventos de negocio del outbox también emiten por `NotificationHub` una señal liviana `request-updated` a los usuarios autorizados: administradores, el agente de origen cuando aplica y el experto actualmente asignado.
- La señal solo contiene el ID interno de la solicitud y el código del evento; no incluye datos del cliente ni la respuesta. El cliente actualiza la vista consultando de nuevo la API, que mantiene los permisos como fuente de verdad.
- La API de la campanita vuelve a autorizar cada fila según el rol vigente y la relación actual con la solicitud: un experto solo lista/lee avisos cuyo caso siga asignado a su usuario; un agente solo los de sus propios enlaces. Esto también oculta registros históricos fuera de alcance y limita el contador de no leídas.
- Si el usuario tiene abierta la lista o el detalle de solicitudes, se refresca esa vista. La bandeja del experto actualiza sus asignaciones. Al reconectar se resincroniza la vista y, si el WebSocket está caído, se usa un refresco de respaldo cada minuto.
- La actualización realtime es independiente del resultado de Resend: publicar el estado no confirma la entrega del correo ni altera el estado de pago.

### Pagos y notificaciones por evento

- **Pagos** usa `ListView` y consulta `GET /api/app/payments`, protegido por `payments.read`. El listado pagina intentos individuales (incluidos reintentos), filtra por estado y fechas, busca por cliente/referencias y permite abrir el detalle de la solicitud solo si el usuario también tiene `requests.read`. El estado no se edita desde el listado.
- Los eventos de la campana se materializan de forma idempotente desde el outbox, independientemente de si se envía correo. Los avisos incluyen su estado de correo (`No aplica`, aceptado, reintento o fallo) y mantienen el alcance por rol/solicitud; la campana y realtime no dependen de Resend.
- El correo administrativo se limita a confirmación de pago, asignación/alerta de asignación y revisión (pregunta similar o respuesta pendiente). El admin no recibe el correo genérico de solicitud creada ni avisos rutinarios de cambio de estado. Los correos para cliente, experto y agente conservan sus reglas y restricciones de pago.
- Las asignaciones automáticas iniciales generan `expert_assigned`; si la solicitud exige pago y aún no se ha pagado, el aviso previo queda limitado al admin. El experto recibe notificación después de la confirmación de pago.
- `031_app_notifications_without_email.sql` agrega `not_sent` a los estados de email de la campana para representar eventos que no deben producir correo.

## Rutas previstas

- `/`: landing pública.
- `/admin`: administración del contenido público.
- `/app`: plataforma operativa autenticada.
- `/api/app/*`: API de la plataforma operativa.

## Base de datos

La operación usará PostgreSQL en Neon. Se recomienda separar las tablas editoriales existentes de las tablas operativas mediante el esquema `operations`.

```text
public.site_content
public.contact_leads
public.testimonial_submissions

operations.users
operations.companies
operations.contacts
operations.operations
operations.documents
operations.tasks
operations.activity_log
```

Esta estructura es inicial y no cambia todavía la aplicación en producción.

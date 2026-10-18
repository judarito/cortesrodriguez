# Plan: agentes, expertos y solicitudes de asesoría

Evolucionar la plataforma operativa para que cada solicitud de asesoría aduanera tenga un origen, una especialidad, un precio, un experto responsable y una respuesta aprobada por administración. Toda solicitud debe registrar claramente una de las dos fuentes actuales: **directa desde nuestra página** o **proveniente de un enlace compartido por un agente**. La landing seguirá siendo un módulo separado; el enlace de agente solo abrirá el formulario público y no permitirá que el agente cree solicitudes desde el panel.

## Alcance

- **Incluye:** catálogo de servicios y especialidades, precios configurables, enlaces de agentes, formulario público, asignación de expertos, preguntas con imágenes, revisión administrativa, notificaciones por reglas, privacidad por campos y reportes.
- **Fuentes de solicitud:** `direct_web` cuando el cliente llega directamente desde nuestra página; `agent_link` cuando llega mediante el enlace de un agente. Ambas fuentes usan el mismo formulario público, pero `agent_link` conserva el agente propietario para seguimiento, reportes y notificaciones.
- **Regla de atribución:** un cliente que inició el flujo mediante un enlace de agente debe conservar ese origen aunque navegue dentro de la página, recargue el formulario o abandone y regrese durante la vigencia del enlace. No se debe confiar en un campo oculto del navegador para determinar el agente.
- **No incluye:** migración de la landing, creación manual de solicitudes por agentes, comunicación directa experto-cliente sin aprobación, ni cambios directos en `main` o producción.

## Modelo funcional

```text
Fuente directa desde nuestra página       Fuente agente
                |                              |
        Cliente abre formulario público / enlace compartido
                |
       Cliente elige servicio y especialidad
        |
Solicitud + pregunta + imágenes + precio histórico
        |
Asignación a experto por especialidad
        |
Experto responde sin datos del cliente
        |
Admin revisa, corrige/aprueba y agrega nota opcional
        |
Resend envía respuesta al cliente y registra trazabilidad
        |
Cliente califica y deja feedback
        |
Admin revisa feedback y define seguimiento
```

## Plan de implementación

### 1. Roles, permisos y privacidad

- [ ] Consolidar los roles `admin`, `agent` y `expert`, dejando roles auxiliares solo cuando exista una necesidad operativa concreta.
- [ ] Añadir permisos separados para `agent_links.manage`, `services.manage`, `expert_requests.read`, `expert_responses.create`, `responses.review`, `attachments.read` y `reports.read`.
- [ ] Mantener la autorización en el backend por endpoint, fila y campo; ocultar un menú no es una medida de seguridad.
- [ ] Definir la matriz de acceso:

| Rol | Puede ver | Puede hacer | No puede hacer |
|---|---|---|---|
| Admin | Toda la operación y datos del cliente | Configurar catálogo, asignar, revisar, aprobar, reportar y administrar usuarios | — |
| Agente | Solicitudes originadas por sus enlaces y métricas propias | Crear/revocar enlaces y compartirlos | Crear solicitudes desde el panel, ver datos de otros agentes o aprobar respuestas |
| Experto | Solo solicitudes asignadas, especialidad, pregunta y adjuntos autorizados | Redactar y enviar respuesta a revisión | Ver nombre/contacto/constitución/agente/pago del cliente o enviarle directamente |

- [ ] Probar acceso por URL y API directa, no solo mediante los menús visibles.

### 2. Catálogo de servicios, especialidades y valores

- [ ] Crear `services` con código, nombre, descripción, estado y orden.
- [ ] Crear `specialties` con área aduanera, descripción y estado.
- [ ] Crear `service_specialties` con servicio, especialidad, precio, moneda, vigencia y política de pago.
- [ ] Permitir que un servicio tenga varias especialidades y que cada especialidad tenga su propio valor.
- [ ] Mostrar en el formulario público nombre, descripción y precio antes de enviar la solicitud.
- [ ] Guardar en la solicitud una copia histórica del servicio, especialidad, descripción, precio y moneda seleccionados.
- [ ] Impedir publicar una especialidad sin descripción, precio o regla de asignación válida.

### 3. Enlaces de agentes y formulario público

- [ ] Tratar como fuentes distintas y mutuamente excluyentes `direct_web` y `agent_link`.
- [ ] Para `direct_web`, registrar que el cliente llegó directamente desde nuestra página y dejar `agent_id` vacío.
- [ ] Para `agent_link`, registrar el enlace y `agent_id` del agente propietario; nunca aceptar ese valor desde campos editables del navegador.
- [ ] Crear `agent_links` con `agent_id`, etiqueta, hash de token, estado, expiración, revocación y fechas de auditoría.
- [ ] Usar tokens opacos en la URL; nunca guardar ni exponer el token original en la base de datos.
- [ ] Usar una ruta específica como `/solicitud/agente/:token` para iniciar el flujo de agente, en lugar de depender únicamente de parámetros editables.
- [ ] Resolver el token en el backend y emitir un contexto firmado de corta duración, asociado a la sesión o a una cookie `HttpOnly`, `Secure` y `SameSite` adecuada.
- [ ] Mantener el contexto de agente durante navegación, recarga y retorno al formulario; si el enlace venció o fue revocado, bloquear el envío y pedir un enlace nuevo.
- [ ] Hacer que el origen y `agent_id` queden fijados al crear la solicitud; nunca permitir que el cliente convierta `agent_link` en `direct_web` ni que cambie de agente.
- [ ] Si el cliente entra directamente a `/solicitud` sin contexto válido, crear solo solicitudes `direct_web`.
- [ ] Mostrar una identificación discreta del canal, por ejemplo “Solicitud referida por su asesor”, sin exponer datos internos ni permitir editarlo.
- [ ] Si el cliente inicia desde un enlace de agente y luego intenta continuar desde la URL directa, conservar el contexto válido; técnicamente no se bloquea la navegación pública, se protege la atribución de la solicitud.
- [ ] Permitir al agente generar, copiar, desactivar y regenerar sus enlaces.
- [ ] El formulario debe identificar el agente por el token, sin permitir que el cliente cambie el propietario.
- [ ] Mantener los campos actuales del cliente y añadir especialidad, pregunta detallada y consentimiento de tratamiento de datos.
- [ ] Crear el cliente con el nombre y la solicitud con el resto de la información.
- [ ] La solicitud desde enlace debe guardar `source = agent_link` y `agent_id`; la solicitud directa desde nuestra página debe guardar `source = direct_web` y quedar sin agente.
- [ ] El agente solo consulta solicitudes que provengan de sus enlaces; no tendrá botón ni endpoint para crear solicitudes internas.

### 4. Asignación y vista del experto

- [ ] Crear relación de expertos con especialidades y estado activo.
- [ ] Crear `request_assignments` con experto, especialidad, fecha, actor, motivo y estado.
- [ ] Implementar asignación automática por especialidad y carga de trabajo, con cola de excepción para el administrador.
- [ ] Permitir reasignación administrativa conservando el historial.
- [ ] Crear la bandeja del experto con solo sus asignaciones.
- [ ] Las consultas del experto deben seleccionar únicamente pregunta, especialidad, estado de respuesta y adjuntos autorizados.
- [ ] No incluir en respuestas API del experto nombre, correo, teléfono, WhatsApp, constitución legal, agente, fuente ni información de pago.

### 5. Preguntas, imágenes y respuesta experta

- [ ] Añadir a la solicitud el texto obligatorio de la pregunta del cliente.
- [ ] Crear `request_attachments` para nombre original, MIME, tamaño, hash, clave privada, estado y auditoría.
- [ ] Guardar imágenes en almacenamiento privado; validar MIME real, extensión, tamaño máximo y cantidad.
- [ ] Servir imágenes mediante endpoint autorizado o URL temporal según el rol y la asignación.
- [ ] Crear `expert_responses` con versión, texto, experto, estado, fechas y observaciones internas.
- [ ] Usar estados de respuesta: `draft`, `pending_admin_review`, `rejected`, `approved` y `sent`.
- [ ] El experto puede guardar y enviar a revisión, pero no puede enviar al cliente.
- [ ] El administrador puede aprobar, rechazar para corrección o editar antes de aprobar.
- [ ] Permitir una nota administrativa opcional que se incluya en el correo al cliente.
- [ ] Crear `client_feedback` relacionado con la solicitud y la respuesta enviada, con calificación, comentario, fecha, token de acceso y estado de revisión.
- [ ] Permitir al cliente enviar feedback desde un enlace seguro incluido en el correo, sin exigirle crear una cuenta.
- [ ] Limitar el feedback a una evaluación por respuesta enviada, con opción administrativa para solicitar una nueva evaluación si existe otra respuesta.
- [ ] Crear una alerta y tarea administrativa para calificaciones bajas; el comentario no debe convertirse automáticamente en una nueva respuesta del experto.
- [ ] Mostrar al experto solo el feedback que administración marque como compartible y sin datos de contacto del cliente.

### 6. Notificaciones y aprobación

- [ ] Ampliar las reglas de correo para filtrar por evento, servicio, especialidad, fuente y estado de pago.
- [ ] Al crear una solicitud directa desde nuestra página (`direct_web`): notificar al experto asignado y al administrador; no notificar a ningún agente.
- [ ] Al crear una solicitud desde enlace de agente: notificar al agente propietario, al experto asignado y al administrador.
- [ ] Al enviar una respuesta a revisión: notificar al administrador.
- [ ] Al aprobar: enviar al cliente la respuesta y la nota, registrar el identificador de Resend y actualizar el estado de envío.
- [ ] Notificar al cliente cuando su solicitud sea recibida, asignada, requiera información, tenga una respuesta aprobada o sea cerrada.
- [ ] Notificar al agente únicamente cuando sea el origen de la solicitud: creación, cambio relevante de estado, respuesta aprobada y feedback recibido.
- [ ] Notificar al experto solo sobre solicitudes asignadas, nueva información disponible, correcciones solicitadas y feedback que administración autorice compartir.
- [ ] Notificar al administrador sobre creación, asignación fallida, respuesta pendiente de revisión, aprobación, rechazo, error de envío, feedback recibido y calificación baja.
- [ ] Definir una matriz de reglas por evento, origen y destinatario, evitando duplicados cuando una persona tenga más de un rol.
- [ ] Mantener destinatarios principales, CC y CCO configurables.
- [ ] Hacer los envíos idempotentes y registrar reintentos, fallos, aperturas y clics.
- [ ] Si no existe correo del cliente, dejar la respuesta aprobada en el panel y crear una tarea de contacto alternativo.
- [ ] Enviar al cliente un enlace de feedback con token de un solo uso o expiración; no incluir identificadores internos en la URL.
- [ ] Notificar al administrador cuando se reciba feedback y especialmente cuando la calificación esté por debajo del umbral configurado.
- [ ] Permitir configurar el umbral de alerta y si el feedback se comparte con el experto.

#### Matriz mínima de notificaciones

| Evento | Cliente | Agente | Experto | Admin |
|---|---:|---:|---:|---:|
| Solicitud directa desde nuestra página (`direct_web`) | Confirmación | — | Solicitud asignada | Sí |
| Solicitud creada desde enlace de agente | Confirmación | Sí | Solicitud asignada | Sí |
| Solicitud asignada o reasignada | Sí | Si es su origen | Sí, solo si es asignado | Sí |
| Información adicional requerida | Sí | Si es su origen | Sí | Sí |
| Respuesta enviada a revisión | — | — | Confirmación | Sí |
| Respuesta aprobada | Respuesta + nota + feedback | Si es su origen | Confirmación opcional | Registro |
| Error o rebote de correo | — | Si es su origen | Si afecta su tarea | Sí |
| Feedback recibido | Confirmación opcional | Si es su origen | Solo feedback autorizado | Sí |
| Feedback con baja calificación | — | Si es su origen, según regla | Solo si admin lo comparte | Alerta |
| Solicitud cerrada | Sí | Si es su origen | Sí | Sí |

### 7. Administración y reportes

- [ ] Crear pantallas para servicios, especialidades, precios, expertos por especialidad, enlaces y reglas de notificación.
- [ ] Actualizar el dashboard: el agente ve solo sus solicitudes; el experto sus asignaciones; el admin el consolidado.
- [ ] Crear reportes por agente, experto, cliente, servicio, especialidad, fuente, estado y rango de fechas.
- [ ] Reportar volumen, tiempos de asignación, tiempos de respuesta, aprobaciones, rechazos y cierres.
- [ ] Reportar valores cotizados, pagos aprobados, pendientes, reembolsos y total por servicio/especialidad.
- [ ] Reportar satisfacción promedio, distribución de calificaciones, tasa de respuesta y casos con calificación baja.
- [ ] Relacionar feedback con servicio, especialidad, experto, agente y período respetando la privacidad del cliente.
- [ ] Definir el balance a partir de transacciones auditables, no solo de la suma del precio configurado.
- [ ] Restringir exportaciones y datos personales según el rol.

### 8. Pruebas, migración y despliegue

- [ ] Crear migraciones versionadas para roles, permisos, catálogo, enlaces, asignaciones, respuestas y adjuntos.
- [ ] Incluir la migración de feedback, tokens de evaluación, alertas y auditoría de lectura/modificación.
- [ ] Probar enlace revocado, enlace vencido, especialidad inactiva, precio cambiado y solicitud sin agente.
- [ ] Probar que una solicitud directa desde nuestra página queda como `direct_web` sin agente y que una solicitud por enlace queda como `agent_link` con el agente correcto.
- [ ] Probar que un agente no puede crear solicitudes ni consultar solicitudes ajenas.
- [ ] Probar que un experto no puede consultar datos personales por listados, detalle, búsqueda, exportación o API manipulada.
- [ ] Probar el flujo completo: enlace → formulario → solicitud → asignación → respuesta → aprobación → correo al cliente → feedback → revisión administrativa.
- [ ] Probar solicitudes con y sin cobro, errores de Resend, reintentos, imágenes inválidas y sesión vencida.
- [ ] Ejecutar migraciones, pruebas y correcciones primero en dev con Neon/R2/Resend dev.
- [ ] Subir cambios únicamente a `dev`; producción se actualiza solo mediante Pull Request aprobado hacia `main`.

## Estados recomendados

Separar el estado operativo del estado de respuesta y del pago:

- `request_status`: `pending`, `assigned`, `in_progress`, `awaiting_information`, `completed`, `cancelled`.
- `response_status`: `none`, `draft`, `pending_admin_review`, `rejected`, `approved`, `sent`.
- `feedback_status`: `not_requested`, `requested`, `received`, `reviewed`, `escalated`.
- `payment_status`: `not_required`, `pending`, `approved`, `rejected`, `refunded`.

## Decisiones pendientes

- [ ] Definir si el balance incluye únicamente valores cobrados o también comisiones de agentes/expertos, costos y reembolsos.
- [ ] Confirmar si la asignación será automática, manual por admin o híbrida con reglas de prioridad.
- [ ] Definir límite de imágenes por solicitud, tamaño máximo y política de conservación.
- [ ] Definir escala de calificación, por ejemplo de 1 a 5, y el umbral que debe generar alerta administrativa.

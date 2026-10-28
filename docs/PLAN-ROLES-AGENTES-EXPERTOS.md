# Plan: agentes, expertos y solicitudes de asesoría

Evolucionar la plataforma operativa para que cada solicitud de asesoría aduanera tenga un origen, una especialidad, un precio, un experto responsable y una respuesta aprobada por administración. Toda solicitud pública debe registrar una de las dos fuentes: **directa desde nuestra página** o **proveniente de un enlace compartido por un agente**. Las altas internas de administración usan el canal independiente admin_entry; no se cuentan como una referencia de agente ni como visita pública. La landing seguirá siendo un módulo separado; el enlace de agente solo abrirá el formulario público y no permitirá que el agente cree solicitudes desde el panel.

## Alcance

- **Incluye:** catálogo de servicios y especialidades, precios configurables, enlaces de agentes, formulario público, asignación de expertos, preguntas con imágenes, revisión administrativa, notificaciones por reglas, privacidad por campos y reportes.
- **Fuentes de solicitud:** `direct_web` cuando el cliente llega directamente desde nuestra página; `agent_link` cuando llega mediante el enlace de un agente. Ambas fuentes usan el mismo formulario público, pero `agent_link` conserva el agente propietario para seguimiento, reportes y notificaciones.
- **Altas administrativas:** guardar el canal admin_entry y `created_by` como el usuario operador; dejar `agent_id` vacío salvo que una atribución de enlace válida haya sido verificada. `created_by` sirve para auditoría y acceso a casos internos autorizados, nunca como sustituto de la atribución comercial.
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

## Modelo de catálogo reorganizado

La plataforma separará claramente el servicio general de la consulta que el cliente compra:

```text
Servicio general
  Importación / Exportación / Agente de carga
        |
Tipo de consulta
  Consulta básica · Datos legales · Importación de casa · ...
        |
Precio + descripción + política de pago
        |
Pool de expertos con esa capacidad
        |
Asignación aleatoria entre expertos activos
```

- **Servicio general:** clasifica la operación aduanera y sirve para filtros, reportes y reglas globales. Ejemplos: `importacion`, `exportacion` y `agente_carga`.
- **Tipo de consulta:** define exactamente qué solicita el cliente y cuánto cuesta. Ejemplos: “Consulta básica” por USD 10, “Consulta de datos legales” por USD 15 e “Importación de casa” por USD 20.
- **Asignación:** cada tipo de consulta puede tener uno o varios expertos. El sistema selecciona aleatoriamente uno de los expertos activos del pool y guarda el resultado para trazabilidad.
- **Configuración:** administración podrá crear, editar, activar, desactivar y cambiar precio, moneda, descripción, servicio general, expertos elegibles y reglas de correo sin modificar código.
- **Pantalla anterior:** el bloque único “Valor del servicio” se retira de la configuración principal; el valor histórico se conserva solo para solicitudes antiguas y compatibilidad de datos.
- **Histórico:** cada solicitud conserva una copia del servicio general, tipo de consulta, descripción, precio y moneda vigentes al momento de crearla.

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
| Cliente | Solo sus propias solicitudes y su estado | Consultar su listado de solicitudes | Ver solicitudes de otras personas, asignarse solicitudes o acceder a funciones internas |

- [ ] Probar acceso por URL y API directa, no solo mediante los menús visibles.

### 2. Catálogo de servicios, especialidades y valores

- [ ] Mantener `services` como servicios generales: Importación, Exportación y Agente de carga.
- [ ] Renombrar conceptualmente `specialties` a `consultation_types` para evitar confundir una consulta vendible con un área profesional.
- [ ] Crear `service_consultation_types` con servicio general, tipo de consulta, descripción, precio, moneda, vigencia y política de pago.
- [ ] Permitir que un servicio general tenga muchos tipos de consulta y que un tipo de consulta pueda reutilizarse en más de un servicio cuando aplique.
- [ ] Crear `consultation_type_experts` para asociar uno o varios expertos activos a cada tipo de consulta.
- [ ] En **Configuración**, permitir abrir cada tipo de consulta y seleccionar/deseleccionar uno o varios expertos activos para su pool de asignación.
- [ ] Mostrar en la configuración los expertos asociados, sus especialidades operativas, estado activo/inactivo y fecha de última modificación.
- [ ] Impedir asociar usuarios inactivos o usuarios que no tengan el rol `expert`.
- [ ] Registrar en auditoría quién agregó o retiró cada experto del tipo de consulta y cuándo.
- [ ] Mostrar primero el servicio general y después los tipos de consulta disponibles, con descripción y precio antes de enviar.
- [ ] Guardar en la solicitud una copia histórica del servicio general, tipo de consulta, descripción, precio y moneda seleccionados.
- [ ] Impedir publicar un tipo de consulta sin descripción, precio, servicio general y al menos un experto elegible o una cola administrativa.
- [ ] Permitir configurar si el valor se cobra, si requiere pago y qué evento habilita el avance del caso.

### 3. Enlaces de agentes y formulario público

- [ ] Tratar como fuentes distintas y mutuamente excluyentes `direct_web` y `agent_link`.
- [ ] Para `direct_web`, registrar que el cliente llegó directamente desde nuestra página y dejar `agent_id` vacío.
- [ ] Para `agent_link`, registrar el enlace y `agent_id` del agente propietario; nunca aceptar ese valor desde campos editables del navegador.
- [x] Para altas internas, usar admin_entry; no asociar al administrador creador como agente. Desplegado en Dev el 27-oct-2026; created_by se conserva para auditoría.
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
- [x] El agente solo consulta solicitudes que provengan de sus enlaces; no tendrá botón ni endpoint para crear solicitudes internas.

### 4. Asignación y vista del experto

- [ ] Asociar expertos a tipos de consulta mediante un pool configurable, con estado activo y fechas de vigencia.
- [x] Crear `request_assignments` con experto, tipo de consulta, fecha, actor, estrategia, motivo y estado.
- [x] Seleccionar aleatoriamente un experto activo del pool al crear la solicitud, usando una fuente aleatoria del servidor y registrando los candidatos considerados.
- [x] Definir fallback cuando no existan expertos activos: la solicitud queda sin asignar en la cola administrativa y se notifica a administración.
- [x] Permitir asignación y reasignación administrativa solo a expertos activos asociados a la consulta, conservando quién asignó, cuándo y por qué.
- [x] Crear la bandeja del experto con solo sus asignaciones.
- [x] Las consultas del experto deben seleccionar únicamente pregunta, especialidad, estado de respuesta y adjuntos autorizados.
- [x] No incluir en respuestas API del experto nombre, correo, teléfono, WhatsApp, constitución legal, agente, fuente ni información de pago.

### 5. Preguntas, imágenes y respuesta experta

- [ ] Añadir a la solicitud el texto obligatorio de la pregunta del cliente.
- [ ] Crear `request_attachments` para nombre original, MIME, tamaño, hash, clave privada, estado y auditoría.
- [ ] Guardar imágenes en almacenamiento privado; validar MIME real, extensión, tamaño máximo y cantidad.
- [ ] Servir imágenes mediante endpoint autorizado o URL temporal según el rol y la asignación.
- [x] Crear `expert_responses` con versión, texto, experto, estado, fechas y observaciones internas.
- [ ] Usar estados de respuesta: `draft`, `pending_admin_review`, `rejected`, `approved` y `sent`.
- [x] El experto puede guardar y enviar a revisión, pero no puede enviar al cliente.
- [x] El administrador puede aprobar, rechazar para corrección o editar antes de aprobar.
- [x] Permitir una nota administrativa opcional que se incluya en el correo al cliente.
- [x] Crear `client_feedback` relacionado con la solicitud y la respuesta enviada, con calificación, comentario, fecha, token de acceso y estado de revisión.
- [x] Permitir al cliente enviar feedback desde un enlace seguro incluido en el correo, sin exigirle crear una cuenta.
- [x] Limitar el feedback a una evaluación por respuesta enviada, con opción administrativa para solicitar una nueva evaluación si existe otra respuesta.
- [ ] Crear una alerta y tarea administrativa para calificaciones bajas; el comentario no debe convertirse automáticamente en una nueva respuesta del experto. (El feedback bajo queda marcado como `escalated` en esta primera etapa.)
- [ ] Mostrar al experto solo el feedback que administración marque como compartible y sin datos de contacto del cliente.

### 5.1. Reutilización asistida de preguntas similares

El “caché” es un índice interno para encontrar precedentes y una cola de revisión; no responde al cliente ni asigna una respuesta automáticamente. La solicitud nueva conserva su propio expediente, fuente y notificaciones durante todo el proceso.

- [x] Normalizar texto en español (minúsculas, tildes, puntuación y palabras vacías) y combinar similitud de términos tolerante a erratas con similitud de bigramas en la secuencia. Empareja una palabra significativa desde 5 caracteres cuando hay hasta 1 edición (hasta 2 desde 9 caracteres), incluyendo transposiciones. La búsqueda queda acotada al mismo servicio general y tipo de consulta; se revisan hasta 500 respuestas anteriores enviadas.
- [x] Usar solo precedentes con respuesta aprobada y enviada. Borradores, respuestas rechazadas y solicitudes de otras especialidades no son elegibles.
- [x] Con el umbral inicial de similitud ≥ 0,30 y al menos 3 términos coincidentes (exactos o tolerantes a erratas), pausar la asignación automática y abrir una revisión para administración; mostrar niveles “coincidencia alta” y “coincidencia posible”. El puntaje es una señal de revisión, no una decisión de equivalencia.
- [x] Mostrar en la bandeja administrativa la pregunta actual y hasta cinco precedentes, incluyendo texto de respuesta, fecha, puntuación y términos coincidentes. Esta vista y sus endpoints son exclusivos de administración; cliente, agente y experto no reciben los candidatos.
- [x] Dar a administración dos salidas explícitas: adaptar la respuesta anterior a la pregunta actual y aprobarla como una respuesta nueva, o descartar la coincidencia y asignar aleatoriamente a un experto elegible.
- [x] Revisar y aprobar/devolver respuestas de expertos desde el detalle de su solicitud; retirar la bandeja de revisión duplicada del menú y conservar feedback como una vista administrativa independiente.
- [x] Al reutilizar, crear una respuesta nueva asociada a la solicitud actual; nunca alterar el precedente. La revisión registra candidato, similitud, decisión, actor, fecha, respuesta derivada y nota administrativa.
- [x] Notificar a administración cuando la solicitud quede en revisión. No avisar ni asignar a un experto hasta que administración descarte la coincidencia; al derivarla, conservar el origen directo/agente y disparar las reglas correspondientes.
- [ ] Antes de reutilizar, advertir y revisar que la respuesta no incluya datos personales, identificadores, adjuntos, hechos únicos del expediente ni asesoría dependiente de documentos del cliente anterior. El administrador debe adaptar y aprobar el contenido para el nuevo caso.
- [ ] Incorporar configuración para activar/desactivar, cambiar umbral y revisar decisiones. Registrar falsos positivos/negativos para calibración; nunca enviar respuesta solo por coincidencia automática.
- [ ] Evaluar en dev precisión y falsos positivos con preguntas reales anonimizadas. La coincidencia léxica tolerante a erratas no detecta bien paráfrasis o sinónimos; IA/embeddings quedan fuera de esta etapa.

### 5.2. Portal inicial para clientes y acceso passwordless

Después de recibir una respuesta aprobada, el cliente puede optar por continuar con la agencia e ingresar al portal. Es opcional: la respuesta y la atención por correo no dependen de abrir una cuenta. En esta primera fase el portal solo lista solicitudes.

- [x] Definir el rol `client` y permiso mínimo `client_requests.read`, sin heredar permisos de agente, experto o administrador. La sesión del portal emite únicamente el rol `client`; no se crea usuario/contraseña permanente.
- [x] Incluir en el correo de respuesta aprobada una invitación para continuar el proceso con la agencia y acceder al portal, sin crear una cuenta automáticamente ni condicionar la entrega de la respuesta.
- [x] El cliente ingresa su correo y recibe allí un código numérico de 6 dígitos; escribe ese código en el portal como clave temporal de acceso. No es un enlace mágico ni una contraseña permanente.
- [x] El código vence en 10 minutos, se guarda como HMAC y se consume una vez. Solicitar otro invalida el anterior; se permiten hasta 5 intentos por código y 4 envíos por correo cada 15 minutos. Las respuestas de solicitud no confirman si el correo existe.
- [ ] Agregar limitación complementaria por IP/dispositivo y protección contra automatización; los límites actuales son por correo y no reemplazan rate limiting/WAF de plataforma.
- [x] Vincular la sesión solo a solicitudes cuyo correo normalizado (trim y minúsculas, sin modificar alias) coincide con el correo verificado mediante el código. Un buzón compartido verá todas las solicitudes registradas con ese mismo correo.
- [ ] Definir un proceso administrativo auditado para corregir correos históricos incorrectos; no permitir que un usuario autenticado fusione o reclame solicitudes de otro correo.
- [x] Listar únicamente referencia, servicio, consulta, fecha y estado. No incluir pregunta, respuestas privadas, adjuntos, teléfono, datos del agente ni acciones de crear, editar, cancelar o pagar.
- [x] Aplicar el filtro del correo autenticado en el backend antes de paginar; no aceptar un email o clienteId arbitrario como alcance de consulta.
- [x] Usar cookie de sesión `HttpOnly`, `Secure` y `SameSite=Lax`, con vigencia de 14 días, logout con revocación y auditoría de código solicitado, ingreso y cierre.
- [ ] Mantener la opción de continuar la gestión por correo; el portal es opcional y la respuesta aprobada sigue disponible aunque el cliente no cree acceso.

**Validación de aceptación:** un correo no registrado obtiene el mismo mensaje que uno registrado; código incorrecto, vencido, usado o con 5 intentos no inicia sesión; emitir otro código invalida el anterior; solo se muestran solicitudes del correo verificado incluso al cambiar parámetros de URL o paginación; cerrar sesión invalida la cookie en servidor.

### 6. Notificaciones y aprobación

- [x] Ampliar las reglas de correo para filtrar por evento, servicio general, tipo de consulta y fuente; las solicitudes con pago requerido quedan bloqueadas hasta que `operations.request_payments.status = 'approved'`.
- [x] Permitir destinatarios por rol, experto asignado, agente de origen, administrador y cliente. Las reglas ya admiten audiencias dinámicas y destinatarios administrativos configurables.
- [x] Resolver los correos de cliente, agente, experto y administración desde sus registros de usuario, sin volver a ingresarlos como destinatarios manuales.
- [x] Reservar “Correos adicionales” para buzones compartidos o de supervisión sin usuario propio en la plataforma.
- [x] Combinar las audiencias de reglas coincidentes con los destinatarios base del evento; las reglas no pueden suprimir el aviso base al cliente ni al experto asignado.
- [x] Asociar cada regla a un tipo de consulta y/o origen; las reglas genéricas del servicio general funcionan como fallback. Para varias consultas se pueden crear reglas separadas.
- [x] Evitar duplicados cuando el mismo correo aparezca por rol, regla y asignación.
- [x] Al crear una solicitud directa desde nuestra página (`direct_web`): aplicar destinatarios base y reglas coincidentes si no requiere pago; si requiere pago, esperar confirmación de Mercado Pago y mientras tanto avisar solo a administración.
- [x] Al crear una solicitud desde enlace de agente: conservar el origen y esperar el pago aprobado antes de notificar a expertos o involucrados.
- [x] Enviar `payment_approved` después de la confirmación real del webhook de Mercado Pago, con protección contra reintentos duplicados.
- [x] En pago aprobado, enviar siempre al cliente la confirmación de pago recibido e indicar que el equipo pronto lo contactará; notificar además a las audiencias y destinatarios configurados que correspondan.
- [x] Antes de confirmar un pago requerido, limitar el aviso de solicitud creada a administración; pagos rechazados o cancelados también avisan solo a administración.
- [x] Si no hay experto activo para el tipo de consulta, conservar la solicitud en la cola sin asignar, registrar el fallo de asignación y avisar a administración.
- [x] Al asignar o reasignar manualmente, notificar al nuevo experto, a administración y al agente solo si la solicitud proviene de su enlace.
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
| Solicitud directa desde nuestra página (`direct_web`) | Confirmación si no requiere pago | — | Solo si no requiere pago | Según regla |
| Solicitud creada desde enlace de agente | Confirmación si no requiere pago | Solo si corresponde | Solo si no requiere pago | Según regla |
| Pago aprobado por Mercado Pago | Según regla | Si es su origen | Sí, si está asignado | Sí |
| Posible pregunta similar | — | Si es el origen, según la regla | No hasta validación | Tarea para validar coincidencia |
| Solicitud derivada a experto tras validación | Según avance | Si es el origen | Nueva asignación | Sí |
| Solicitud asignada o reasignada | Sí | Si es su origen | Sí, solo si es asignado | Sí |
| Información adicional requerida | Sí | Si es su origen | Sí | Sí |
| Respuesta enviada a revisión | — | — | Confirmación | Sí |
| Respuesta aprobada | Respuesta + nota + feedback | Si es su origen | Confirmación opcional | Registro |
| Error o rebote de correo | — | Si es su origen | Si afecta su tarea | Sí |
| Feedback recibido | Confirmación opcional | Si es su origen | Solo feedback autorizado | Sí |
| Feedback con baja calificación | — | Si es su origen, según regla | Solo si admin lo comparte | Alerta |
| Solicitud cerrada | Sí | Si es su origen | Sí | Sí |

#### Bandeja realtime dentro de la aplicación

La campanita del encabezado debe convertirse en una bandeja persistente de notificaciones para usuarios autenticados. Se reutiliza el outbox idempotente de Neon y Cloudflare Queues ya implementado para correo; el realtime acelera la actualización visual, pero nunca será el almacenamiento de referencia.

- [x] Preparar la migración `030_in_app_notifications.sql` para `operations.app_notifications` y tickets realtime de un solo uso. La notificación guarda solo usuario, evento, referencia interna, texto seguro y estado del correo; tiene clave idempotente única.
- [x] Definir y aplicar contenido por rol: admin recibe alertas operativas y de revisión, el experto recibe solo asignaciones y cambios relevantes sin identidad/contacto del cliente, y el agente recibe novedades solo de solicitudes atribuidas a sus enlaces. El cliente se incorporará cuando exista vínculo con el portal autenticado.
- [x] Implementar contenido y destino distintos por rol; las vistas de destino vuelven a validar permisos en servidor y los mensajes no incluyen PII del cliente.
- [x] Separar el estado del email del aviso en la app (`accepted`, `sent`, `delivered`, `opened`, `failed`, `bounced`, `complained`, `pending_retry`). “Aceptado por Resend” no equivale a “entregado”; fallos y reintentos alertan a administración.
- [x] Enlazar la materialización de notificaciones al outbox existente; aplicar idempotencia y limitar los destinatarios a usuarios operativos, no a buzones externos sin usuario.
- [x] Enrutar correo y campanita del experto exclusivamente al usuario indicado por `requests.assigned_expert_id`; la lista de expertos elegibles del tipo de consulta solo participa en la asignación, no en los destinatarios. Si no hay experto asignado, solo se notifica a las otras audiencias aplicables.
- [x] Añadir API autenticada y paginada para listar, contar no leídas y marcar como leídas, restringida al `user_id` de la sesión.
- [x] Añadir Cloudflare Durable Object por usuario y tickets de un solo uso ligados a una sesión activa para abrir el WebSocket; el usuario se deriva del ticket guardado en Neon, no de un parámetro controlado por el navegador.
- [x] Usar WebSocket Hibernation; Neon mantiene la bandeja y la UI recupera eventos por HTTP al reconectar, además de un sondeo de respaldo cada minuto.
- [x] Reutilizar el WebSocket para invalidar/refrescar estados de solicitudes cuando el outbox procesa eventos; refrescar lista/detalle abiertos, bandeja de experto y dashboard, con destinatarios limitados al admin, agente de origen y experto asignado. La señal no lleva PII y la API vuelve a validar permisos; al perder realtime se resincroniza al reconectar y con fallback de 60 s.
- [x] Revalidar en servidor el alcance de cada notificación histórica, el contador y la acción de lectura contra el rol vigente y la asignación/origen actual; evita que un experto vea avisos globales, antiguos de admin o de otras asignaciones.
- [x] Implementar campanita, contador, estado/fecha del correo, lectura, carga de avisos anteriores y apertura de solicitud con autorización del rol.
- [x] Mostrar un aviso emergente accesible al recibir notificaciones nuevas, con enlace al caso y cierre automático/manual; no repetirlo al inicializar, refrescar o reconectar.
- [x] Publicar en dev (`a5a32561-56ab-4357-8718-efb0a09fe566`) y verificar que `/` y `/api/public/features` responden HTTP 200.
- [ ] Validar manualmente el toast con notificaciones autenticadas nuevas para admin, agente y experto.
- [x] Añadir pruebas unitarias para contenido por rol, privacidad del experto, atribución del agente y enrutamiento exclusivo al experto asignado.
- [ ] Completar pruebas integrales de permisos de API, reconexión/WebSocket caído, lectura, idempotencia en Neon y entrega/reintento de Resend en dev.
- [x] Registrar las cuotas gratuitas consultadas de Queues y Durable Objects y habilitar fallback sin WebSocket. **Pendiente:** instrumentar métricas/alertas de consumo y confirmar cuotas en la cuenta antes de producción.
- [x] Aplicar la migración `030_in_app_notifications.sql` en Neon dev y desplegar Worker/Assets con la migración del Durable Object. Verificado el 2026-10-24; producción no se modificó.
- [ ] Completar la prueba integrada autenticada de la campanita y notificaciones con cuentas de admin, agente y experto antes de producción.

**Flujo propuesto:** evento de negocio → outbox idempotente en Neon → Cloudflare Queue → persistencia del estado de email y notificaciones en Neon → señal ligera al Durable Object del usuario → campanita actualizada. Si no hay conexión, la notificación queda guardada y aparece al volver a cargar o reconectar.

### 7. Administración y reportes

- [ ] Crear pantallas para servicios generales, tipos de consulta, precios, expertos por tipo de consulta, enlaces y reglas de notificación.
- [ ] Incluir dentro de Configuración la edición completa del tipo de consulta: nombre, descripción, precio, moneda, servicio general, cobro, expertos asociados y reglas de correo.
- [ ] Actualizar el dashboard: el agente ve solo sus solicitudes; el experto sus asignaciones; el admin el consolidado.
- [ ] Crear reportes por agente, experto, cliente, servicio general, tipo de consulta, fuente, estado y rango de fechas.
- [ ] Reportar volumen, tiempos de asignación, tiempos de respuesta, aprobaciones, rechazos y cierres.
- [ ] Reportar valores cotizados, pagos aprobados, pendientes, reembolsos y total por servicio/especialidad.
- [ ] Reportar satisfacción promedio, distribución de calificaciones, tasa de respuesta y casos con calificación baja.
- [ ] Relacionar feedback con servicio general, tipo de consulta, experto, agente y período respetando la privacidad del cliente.
- [ ] Definir el balance a partir de transacciones auditables, no solo de la suma del precio configurado.
- [ ] Restringir exportaciones y datos personales según el rol.

### 8. Pruebas, migración y despliegue

- [ ] Crear migraciones versionadas para roles, permisos, servicios generales, tipos de consulta, precios, pools de expertos, enlaces, asignaciones, respuestas y adjuntos.
- [ ] Incluir la migración de feedback, tokens de evaluación, alertas y auditoría de lectura/modificación.
- [ ] Probar enlace revocado, enlace vencido, especialidad inactiva, precio cambiado y solicitud sin agente.
- [ ] Probar que una solicitud directa desde nuestra página queda como `direct_web` sin agente y que una solicitud por enlace queda como `agent_link` con el agente correcto.
- [ ] Probar que un agente no puede crear solicitudes ni consultar solicitudes ajenas.
- [ ] Probar que un experto no puede consultar datos personales por listados, detalle, búsqueda, exportación o API manipulada.
- [ ] Probar el flujo completo: enlace → formulario → solicitud → asignación → respuesta → aprobación → correo al cliente → feedback → revisión administrativa.
- [ ] Probar solicitudes con y sin cobro, errores de Resend, reintentos, imágenes inválidas y sesión vencida.
- [ ] Ejecutar migraciones, pruebas y correcciones primero en dev con Neon/R2/Resend dev.
- [ ] Subir cambios únicamente a `dev`; producción se actualiza solo mediante Pull Request aprobado hacia `main`.

### 8.1. Actualización gradual de producción sin afectar la landing

La landing pública existente es un flujo crítico y debe conservar su comportamiento. La nueva llamada a la acción (CTA/botón) de la landing se desplegará apagada y su disponibilidad se controlará con un feature flag de Cloudflare, de modo que publicar código y habilitar la función sean acciones separadas. El flag controla la exposición de la función, pero no reemplaza autorización ni validación en el backend.

**Inspección inicial (2026-10-22):** se verificó la landing productiva en navegador, sin enviar formularios: carga el contenido actual, el botón “Cotiza ahora” abre su formulario y `/solicitud` actualmente sirve la landing existente. La rama `main` (`7ca5191`) no contiene la nueva CTA; `dev` (`ab3b70b`) sí la añade en `src/App.vue` y enruta `/solicitud` a la app pública desde `src/main.js`. Ambos manifiestos Wrangler versionados describen el mismo Worker de producción/dev assets con el nombre correspondiente, por lo que un despliegue de la app actualiza el artefacto de la landing y la aplicación en conjunto. `npm run build` pasó. No se encontraron pruebas E2E generales; solo hay una prueba unitaria de similitud.

**Avance (2026-10-23):** implementada la evaluación fail-closed del flag `landing_new_request_button`: la CTA solo aparece con respuesta explícitamente `true`; sin binding, si el flag falla o está apagado, `/solicitud` vuelve a `/` y los endpoints públicos del formulario responden 404. Las cotizaciones existentes y el endpoint de feedback quedan fuera de esta barrera. Se añadieron pruebas para estos casos; las pruebas y la compilación pasan. No se desplegó.

**Avance (2026-10-23):** en Cloudflare Flagship se crearon dos apps y el flag booleano `landing_new_request_button`, ambos inactivos y con `off` como valor predeterminado. App ID dev: `aabdeecf-cb37-4656-8ef0-d4bcfec436e9`; producción: `dacec36c-be99-416b-b1ac-a27abb404a68`. Se añadieron los bindings `LANDING_FLAGS` a `wrangler.dev.jsonc` y `wrangler.jsonc`, respectivamente. El dry-run de Wrangler resuelve los bindings correctamente en ambos manifiestos. No se ha desplegado ni activado el flag. Falta validar el flag conectado en dev y el comportamiento en Cloudflare antes de publicar código.

**Despliegue dev (2026-10-23):** GitHub Actions #42 quedó bloqueado por facturación. Se desplegó directamente a Cloudflare, desde un checkout aislado del commit `fc7c24f` para excluir cambios locales no relacionados. Worker: `cortes-rodriguez-asesores-dev`; versión `caa43282-3c20-4c8e-abea-820b86a0fd59`. Validaciones en vivo: landing raíz HTTP 200 y CTA nueva oculta; `/api/public/features` devuelve `landingRequestButton: false`; `/solicitud` redirige a `/`; `/api/public/catalog` responde 404. Las 2 pruebas unitarias y el build pasaron. El flag continúa apagado. Producción no se tocó.

- [ ] Completar la comparación de producción con el cambio candidato, incluyendo bindings/variables live de Cloudflare; el diff de `main`/`dev`, rutas SPA y el formulario existente ya fueron inspeccionados.
- [ ] Definir pruebas de aceptación de la landing existente: carga, navegación, recursos, formularios e integraciones, con resultados de referencia antes del despliegue.
- [ ] Aislar los cambios de la aplicación para que no alteren rutas, componentes, estilos globales ni endpoints de la landing existente.
- [x] Crear en Cloudflare Flagship un flag booleano `landing_new_request_button`, con apps separadas para dev y producción, inactivas y con `off` como valor predeterminado.
- [x] Evaluar el flag desde el Worker que sirve la landing y renderizar la nueva CTA solo cuando esté habilitada; mantener intactos los botones y formularios actuales. La evaluación falla cerrada y los endpoints de la función quedan fuera de servicio mientras el flag esté apagado.
- [x] Crear y enlazar el binding `LANDING_FLAGS` con App IDs separados para dev y producción; ambos manifiestos pasaron `wrangler deploy --dry-run` y muestran el binding correcto.
- [x] Comprobar el flag también en el Worker/API para impedir el uso directo de la función cuando esté apagada; el flag de interfaz por sí solo no es una barrera de seguridad.
- [x] En dev, apuntar la CTA directamente a `/solicitud`; la app pide el token de atribución en segundo plano, con la ruta protegida por flag y límite de intentos, sin navegar al endpoint intermedio.
- [ ] Probar en Cloudflare dev ambos estados del flag: el estado apagado ya fue comprobado en vivo; falta validar el estado encendido y el flujo nuevo completo, sin activar producción.
- [x] Desplegar primero el código con el flag apagado en dev desde el commit `fc7c24f`; confirmar landing 200, CTA oculta, redirección `/solicitud` y API nueva 404.
- [ ] Activar el flag en producción solo después de aprobar las pruebas, inicialmente con exposición controlada si la configuración de Flagship lo permite; verificar métricas y errores antes de ampliar.
- [ ] Documentar el procedimiento de kill switch: apagar el flag sin redeplegar y confirmar que la landing vuelve al estado conocido. Mantener preparado el rollback del Worker y no revertir migraciones destructivamente.
- [ ] Acordar una ventana de publicación y monitorear errores, envíos de formularios, navegación y recursos de la landing inmediatamente después del despliegue y de la activación.

## Estados recomendados

Separar el estado operativo del estado de respuesta y del pago:

- `request_status`: `pending`, `assigned`, `in_progress`, `awaiting_information`, `completed`, `cancelled`.
- `response_status`: `none`, `draft`, `pending_admin_review`, `rejected`, `approved`, `sent`.
- `feedback_status`: `not_requested`, `requested`, `received`, `reviewed`, `escalated`.
- `payment_status`: `not_required`, `pending`, `approved`, `rejected`, `refunded`.

## Decisiones pendientes

- [ ] Calibrar en dev el umbral léxico inicial (Jaccard >= 0.30 y al menos 3 términos compartidos); solo genera sugerencias, no respuestas automáticas. La búsqueda actual se limita a texto español normalizado, sin embeddings ni costo de IA.
- [ ] Definir si una respuesta reutilizada requiere aprobación administrativa nueva antes de enviarse (recomendación inicial: sí, validar el contexto y permitir nota de administración).
- [x] Definido: código de 6 dígitos enviado al correo como clave temporal de un solo uso, vigencia 10 minutos, hasta 5 intentos por código, máximo 4 envíos por correo cada 15 minutos y sesión revocable de 14 días.
- [ ] Definir cómo verificar y resolver solicitudes históricas cuando el correo del cliente haya cambiado o se haya escrito incorrectamente.
- [ ] Definir si el balance incluye únicamente valores cobrados o también comisiones de agentes/expertos, costos y reembolsos.
- [ ] Confirmar si la selección aleatoria será completamente aleatoria o si se aplicará una variante balanceada para evitar sobrecargar a un experto.
- [ ] Definir límite de imágenes por solicitud, tamaño máximo y política de conservación.
- [ ] Definir escala de calificación, por ejemplo de 1 a 5, y el umbral que debe generar alerta administrativa.

## Estándar transversal de interfaz

Todos los listados administrativos deben usar el componente común `ListView` y respetar el mismo patrón:

- El contenedor visual del listado (fondo, borde, radio, espaciado y sombra) debe estar definido en `ListView`, no depender de clases scoped del componente padre. Así conserva el mismo aspecto cuando se reutiliza desde cualquier módulo.
- encabezado con título, descripción, contador y botón de alta cuando aplique;
- búsqueda y filtros en una barra consistente;
- tabla/lista con columnas alineadas y estado visible;
- paginación desde el servidor, mostrando página actual y total;
- acciones de fila para ver, editar, activar/desactivar y eliminar según permisos;
- confirmación explícita antes de cualquier eliminación;
- estados homogéneos para carga, vacío, error y guardado.
- En pantallas estrechas, cada fila debe transformarse en una tarjeta para evitar desplazamiento horizontal; esta presentación debe ser parte del componente compartido.

### Seguimiento de consistencia visual

- [x] Corregir el contenedor visual de `ListView` para que sea autocontenido y no dependa de estilos scoped del padre; esto resuelve el panel sin tarjeta visible en “Solicitudes asignadas” del experto, que ya utilizaba el componente compartido.
- [ ] Auditar los listados de los módulos (incluidos experto, administración, usuarios y configuración) para confirmar uso real de `ListView`, estilos coherentes y presentación responsive sin scroll horizontal.
- [ ] Revisar de forma transversal botones, formularios, paneles contextuales, estados de carga/vacío/error y controles de paginación; registrar y resolver discrepancias por módulo.

### Navegación unificada de solicitudes

- [x] Eliminar la entrada de menú duplicada **Solicitudes asignadas** y consolidar el acceso bajo **Solicitudes**.
- [x] Mostrar a administración las pestañas **Todas** y **Asignadas**, con paginación desde el servidor y nombre del experto en la pestaña de asignadas.
- [x] Mantener la bandeja exclusiva del experto dentro de **Solicitudes**, sin exponerle la pestaña administrativa; conservar la autorización y el refresco realtime.
- [x] Restringir el filtro `assignedOnly` en el backend al rol administrador.
- [x] Verificar compilación y pruebas automatizadas; 11 suites aprobadas.
- [x] Publicar en dev (`f3d9559c-bbdd-4dcc-b87c-e58002a05f18`) y verificar `/` y `/api/public/features` con HTTP 200.
- [ ] Validar manualmente el acceso autenticado con cuentas de administrador y experto.

**Estado del arreglo puntual (2026-10-24):** cambio local en `src/shared/components/ListView.vue`; `npm run build` y `git diff --check` pasan. Aún no desplegado ni publicado.

**Actualización funcional (2026-10-24):** la detección de preguntas similares combina términos tolerantes a erratas y secuencia de bigramas, muestra coincidencia alta/posible y siempre requiere validación humana. La revisión de respuestas del experto se concentra en el detalle de la solicitud; se quitó el menú duplicado y se conservó una vista separada de feedback. Validación local: 10 suites y build correctos; publicación pendiente.

La configuración se divide en secciones cortas mediante pestañas o módulos independientes:

1. **Servicios y consultas:** servicios generales, tipos de consulta, precios y expertos.
2. **Enlaces de agentes:** agente propietario, estado, copiar, regenerar y revocar.
3. **Notificaciones:** destinatarios y reglas.
4. **Seguridad:** usuarios, roles y permisos.

Los formularios de alta y edición se abrirán como panel contextual o modal; el listado permanecerá visible y las acciones quedarán asociadas a cada fila.

## 9. Seguridad, antiabuso y formulario público

Esta fase protege el formulario público y consolida la seguridad de la plataforma antes de ampliar los cobros y el uso productivo.

- [x] Validar en frontend y backend nombre, correo, teléfono, WhatsApp, pregunta, campos obligatorios, longitud y caracteres de control.
- [x] Limitar las solicitudes públicas a 5 imágenes, 10 MB por archivo, 25 MB en total y 35 MB por petición.
- [x] Verificar mediante firma binaria que los adjuntos sean realmente PNG, JPG o WEBP, sin confiar únicamente en la extensión o el MIME enviado por el navegador.
- [x] Limpiar los nombres de archivos antes de guardarlos y mantener los adjuntos fuera del acceso público directo.
- [x] Integrar Cloudflare Turnstile en `/solicitud`; el Worker valida el token con Siteverify, comprueba host y acción, y falla de forma cerrada cuando la protección está activada.
- [x] Mostrar el widget en el formulario cuando Turnstile esté habilitado; dejar que el modo administrado de Cloudflare decida si requiere interacción adicional.
- [ ] Crear los widgets Turnstile y configurar `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` de forma independiente en Cloudflare dev y producción.
- [ ] Configurar rate limiting y reglas WAF para creación de solicitudes, consulta de enlaces de agente, feedback y reenvío de correos.
- [ ] Añadir protección contra duplicados y abuso por correo, IP, agente y ventana de tiempo, sin bloquear clientes legítimos.
- [ ] Configurar en Cloudflare los headers `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y protección contra clickjacking.
- [ ] Migrar las sesiones operativas desde `localStorage` a cookies `HttpOnly`, `Secure` y `SameSite`, con expiración, revocación y protección CSRF.
- [ ] Mantener la autorización en backend por rol, fila y campo: agente solo ve sus solicitudes, experto solo sus asignaciones y admin toda la operación.
- [ ] Servir imágenes mediante endpoint autorizado o URLs temporales; registrar acceso, descarga, hash, tamaño y estado del archivo.
- [ ] Crear auditoría para accesos, cambios de permisos, configuración, asignaciones, respuestas, archivos, correos y feedback.
- [ ] Evitar HTML dinámico no sanitizado, URLs externas no verificadas, secretos en el frontend y datos sensibles en parámetros de URL.
- [ ] Ejecutar pruebas de seguridad para CAPTCHA inválido, rate limit, archivos falsos, payloads grandes, caracteres especiales, sesión expirada y permisos insuficientes.
- [ ] Verificar el flujo completo en `dev`: formulario directo, enlace de agente, asignación, respuesta, aprobación, correo y feedback.
- [ ] Publicar únicamente en `dev` hasta completar las pruebas; `main` debe mantenerse protegido mediante Pull Request aprobado.

### Criterios de aceptación de seguridad

- Una petición manual no puede saltarse las validaciones del formulario.
- Un archivo renombrado con extensión de imagen no puede almacenarse si su firma real no es válida.
- Un experto no puede obtener datos personales modificando la URL, parámetros o respuesta del frontend.
- Un agente no puede consultar solicitudes de otro agente ni cambiar el origen de una solicitud.
- Una sesión vencida redirige al login y no permite continuar operando mediante llamadas directas a la API.
- El CAPTCHA y el rate limiting se validan en backend y tienen configuración independiente por entorno.
- No se publican secretos, tokens permanentes ni credenciales en el bundle del frontend.

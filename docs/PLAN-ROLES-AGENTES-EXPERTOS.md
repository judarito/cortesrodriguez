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

- [x] Normalizar texto en español (minúsculas, tildes, puntuación y palabras vacías) y comparar términos con Jaccard. La búsqueda queda acotada al mismo servicio general y tipo de consulta; se revisan hasta 500 respuestas anteriores enviadas.
- [x] Usar solo precedentes con respuesta aprobada y enviada. Borradores, respuestas rechazadas y solicitudes de otras especialidades no son elegibles.
- [x] Con el umbral inicial de Jaccard ≥ 0,30 y al menos 3 términos significativos en común, pausar la asignación automática y abrir una revisión para administración. El umbral es una señal de revisión, no una decisión de equivalencia.
- [x] Mostrar en la bandeja administrativa la pregunta actual y hasta cinco precedentes, incluyendo texto de respuesta, fecha, puntuación y términos coincidentes. Esta vista y sus endpoints son exclusivos de administración; cliente, agente y experto no reciben los candidatos.
- [x] Dar a administración dos salidas explícitas: adaptar la respuesta anterior a la pregunta actual y aprobarla como una respuesta nueva, o descartar la coincidencia y asignar aleatoriamente a un experto elegible.
- [x] Al reutilizar, crear una respuesta nueva asociada a la solicitud actual; nunca alterar el precedente. La revisión registra candidato, similitud, decisión, actor, fecha, respuesta derivada y nota administrativa.
- [x] Notificar a administración cuando la solicitud quede en revisión. No avisar ni asignar a un experto hasta que administración descarte la coincidencia; al derivarla, conservar el origen directo/agente y disparar las reglas correspondientes.
- [ ] Antes de reutilizar, advertir y revisar que la respuesta no incluya datos personales, identificadores, adjuntos, hechos únicos del expediente ni asesoría dependiente de documentos del cliente anterior. El administrador debe adaptar y aprobar el contenido para el nuevo caso.
- [ ] Incorporar configuración para activar/desactivar, cambiar umbral y revisar decisiones. Registrar falsos positivos/negativos para calibración; nunca enviar respuesta solo por coincidencia automática.
- [ ] Evaluar en dev precisión y falsos positivos con preguntas reales anonimizadas. La coincidencia léxica no detecta bien paráfrasis o sinónimos; IA/embeddings quedan fuera de esta etapa.

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

- [x] Ampliar las reglas de correo para filtrar por evento, servicio general, tipo de consulta y fuente. El filtro por estado de pago sigue pendiente.
- [x] Permitir destinatarios por rol, experto asignado, agente de origen, administrador y cliente. Las reglas ya admiten audiencias dinámicas y destinatarios administrativos configurables.
- [x] Asociar cada regla a un tipo de consulta y/o origen; las reglas genéricas del servicio general funcionan como fallback. Para varias consultas se pueden crear reglas separadas.
- [x] Evitar duplicados cuando el mismo correo aparezca por rol, regla y asignación.
- [x] Al crear una solicitud directa desde nuestra página (`direct_web`): notificar al cliente, al experto asignado y a administración; nunca notificar a un agente.
- [x] Al crear una solicitud desde enlace de agente: notificar al cliente, al agente propietario, al experto asignado y a administración.
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
| Solicitud directa desde nuestra página (`direct_web`) | Confirmación | — | Solicitud asignada | Sí |
| Solicitud creada desde enlace de agente | Confirmación | Sí | Solicitud asignada | Sí |
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

- encabezado con título, descripción, contador y botón de alta cuando aplique;
- búsqueda y filtros en una barra consistente;
- tabla/lista con columnas alineadas y estado visible;
- paginación desde el servidor, mostrando página actual y total;
- acciones de fila para ver, editar, activar/desactivar y eliminar según permisos;
- confirmación explícita antes de cualquier eliminación;
- estados homogéneos para carga, vacío, error y guardado.

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

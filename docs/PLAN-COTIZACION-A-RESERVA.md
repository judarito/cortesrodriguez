# Plan: solicitud en estado cotización → reserva pagada

**Estado:** Implementado y validado localmente; validación de entorno Dev pendiente
**Rama:** `dev`
**Modelo:** una sola solicitud en Neon; Turso conserva únicamente contenido editorial.

### Estado de cierre local — 2026-11-19

- Slices A–F implementados en `dev`: persistencia, API Worker, compatibilidad Node,
  formulario de cotización, reserva/pago y panel operativo.
- Slice G revisado localmente: Worker es el runtime operativo, Node responde
  `not_available` para rutas operativas no soportadas, Neon es la fuente única y
  `contact_leads` no participa en el flujo de cotización.
- Slice H validado con pruebas de contratos, adjuntos, idempotencia, notificaciones,
  compatibilidad y flujo E2E simulado.
- Suite local: `npm test` — 214/214; `npm run build` — correcto; `npm run test:e2e` —
  18/18 después de corregir la navegación de la revisión administrativo-experto.
- Cobertura adicional: descarga de adjunto ajeno rechazada sin leer almacenamiento y
  adjuntos de reserva conservan estado `validated` al convertir.
- Pendiente externo: ejecutar la matriz de aceptación sobre Dev con Neon, Resend,
  Mercado Pago sandbox y cuentas de prueba; no se considera validado por los mocks
  locales. No incluye secretos ni despliegue automático.

**Decisión de compatibilidad Node/Worker:** el Worker es el runtime operativo canónico
para cotizaciones, reservas, pagos, asignación, notificaciones y lectura/escritura de
datos operativos. El servidor Node local puede servir la aplicación y las rutas
editoriales para desarrollo, pero no implementa una variante operativa ni mantiene
persistencia alternativa. Si una ruta operativa no está disponible en Node, debe
  responder explícitamente `not_available` y remitir al Worker; no debe crear ni
leer cotizaciones desde otra fuente.

**Fuente única y prohibición operativa:** Neon es la única fuente de verdad para
cotizaciones y su ciclo de vida. `contact_leads` no puede crear, leer, actualizar ni
servir como fallback de cotizaciones operativas. Turso queda limitado a contenido
editorial y no puede actuar como respaldo operativo.

## Objetivo

La cotización crea una fila en `operations.requests` con estado `cotizacion`. Al continuar, el cliente completa la misma solicitud, paga y avanza a los estados operativos existentes. No se crea una tabla adicional ni se guarda la cotización en Turso.

## Alcance

- Mover servicio general, tipo de consulta, producto y pregunta al formulario de cotización.
- Crear y conservar la solicitud desde el inicio en Neon.
- Reutilizar la misma solicitud para reserva, pago, asignación y seguimiento.
- Mantener clasificación operativa, cliente, atribución, seguridad, ES/EN y responsive.
- Permitir múltiples archivos adjuntos, con requisitos y tipos aceptados dependientes del servicio seleccionado.
- Mantener Turso solo para contenido editorial.
- No cambiar precios, catálogo, reglas de asignación ni pasarelas.

## Contrato obligatorio

La fila sigue este ciclo:

```text
cotizacion → reserva/pago → pending → in_progress → closed
                         ↘ cancelled / expired
```

La cotización conserva `service_type`, `consultation_type_id`, `product_type`, `question`, cliente, locale, `source_channel`, `agent_id`, `agent_link_id` y los metadatos de catálogo.

Los archivos adjuntos se manejan como una colección, no como un único archivo. Cada elemento debe conservar al menos `id`, `storage_key`, `original_name`, `mime_type`, `size_bytes`, `category`, `stage` y estado de validación. Las categorías permitidas y los archivos requeridos dependen del servicio seleccionado en el formulario:

- `importacion`: conjunto documental configurado para importación.
- `exportacion`: conjunto documental configurado para exportación.
- `agente_carga`: conjunto documental configurado para operaciones de agente de carga.

La matriz exacta de documentos obligatorios y opcionales debe quedar definida en el catálogo/configuración operativa antes de cerrar la implementación. El navegador solo propone la categoría; el servidor valida servicio, categoría, cantidad, extensión MIME, tamaño, duplicados y permisos. Los archivos se pueden adjuntar en la cotización o en la reserva, pero pertenecen a la misma solicitud Neon y no deben duplicarse al convertirla.

## Decisión: descarga pública con `quoteToken`

El contrato público permite que el cliente que conserva el `quoteToken` liste y descargue los adjuntos **validados** de la solicitud asociada. La autorización se resuelve en el servidor mediante el hash del token y el `request_id`; el endpoint de descarga vuelve a exigir `status = 'validated'` y una clave de almacenamiento bajo el prefijo de esa misma solicitud. El payload público solo contiene identificador, nombre, MIME, tamaño, categoría, etapa y estado: nunca `storage_key`.

Rutas:

- `GET /api/public/quotes/attachments?token=<quoteToken>`: inventario público de adjuntos validados.
- `GET /api/public/quotes/attachments/:attachmentId?token=<quoteToken>`: descarga privada del adjunto validado perteneciente a ese token.

Un token válido no otorga acceso a otra cotización ni a adjuntos `pending`, `rejected` o `deleted`. El contrato no requiere migraciones; las defensas de tipo MIME y del objeto almacenado reutilizan el helper privado de descargas.

La continuación usa un token opaco. El servidor debe:

- Buscar por el hash del token, nunca por un ID confiado del navegador.
- Validar estado, expiración, atribución, cliente y catálogo activo.
- Derivar servicio, consulta, precio y moneda desde Neon.
- Rechazar modificaciones del navegador a clasificación o precio.
- Hacer idempotentes la conversión y el pago.
- Actualizar la misma solicitud, sin crear otra.

### Efectos al crear la cotización

La creación de una solicitud en estado `cotizacion` debe persistir, en la misma transacción de Neon, un evento durable `quote_created` en el outbox. La respuesta HTTP no debe enviar correo ni ejecutar directamente la entrega de notificaciones. Consumidores asíncronos deben leer el outbox y publicar los efectos mediante la cola/event bus existente:

- Un correo interno al equipo encargado de revisar cotizaciones.
- Una notificación interna en la plataforma para los destinatarios autorizados.
- Ninguna notificación de pago aprobado, asignación a experto o solicitud operativa activa.

El correo y la notificación deben ser idempotentes por solicitud y evento. Un fallo de correo no debe deshacer la solicitud ni impedir la notificación interna; ambos efectos deben mostrar estados independientes para permitir reintentos y auditoría. La creación de la solicitud se considera exitosa aunque los consumidores sigan pendientes, siempre que el evento haya quedado durablemente registrado.

## Slices

### Slice 0 — Contrato y esquema de integración

**Responsable:** Codex, secuencial.
**Archivos:** este documento, contrato de payload y pruebas de contrato.

- Confirmar estados actuales y definir `cotizacion`.
- Identificar columnas existentes para clasificación, precio, atribución, pagos e idempotencia.
- Definir token, hash, expiración, revocación y consumo.
- Definir payloads de cotización, continuación y reserva.
- Definir campos obligatorios por etapa y tratamiento de solicitudes antiguas.

**Aceptación:** contrato concreto sin decisiones abiertas para los agentes.

### Slice A — Persistencia Neon

**Responsable:** agente backend-datos.
**Ownership:** `worker/db/migrations/*`, helpers Neon y pruebas de esquema.
**Dependencia:** Slice 0.

- Añadir/adaptar estado `cotizacion` en `operations.requests`.
- Añadir token opaco, hash, expiración, índices y restricciones.
- Mantener integridad con cliente, catálogo, atribución y pagos.
- Soportar la relación de múltiples adjuntos por solicitud, sin guardar binarios en Neon/Turso; conservar únicamente metadatos y claves del almacenamiento existente.
- Mantener estados de adjunto (`pending`, `validated`, `rejected`, `deleted`) y trazabilidad de quién/cuándo lo cargó.
- Mantener claves/efectos idempotentes para el correo y la notificación interna de cotización.
- Cubrir solicitudes existentes sin inventar clasificación ni precio.
- Documentar rollback.

**Aceptación:** una solicitud puede nacer como cotización y convertirse sin duplicarse.

### Slice B — API Worker

**Responsable:** agente backend-api.
**Ownership:** `worker/routes/publicRequests.js`, `worker/index.js`, helpers y tests de rutas.
**Dependencia:** Slice 0; puede usar mocks mientras A termina.

- Crear endpoint de cotización que inserte una solicitud en `cotizacion`.
- Crear endpoint de continuación/reserva que actualice esa misma solicitud.
- Validar servicio, consulta y producto en servidor.
- Aceptar múltiples archivos por solicitud mediante el mecanismo de almacenamiento existente, con límites por servicio y por archivo.
- Validar en servidor que cada categoría de archivo sea compatible con `service_type` y `product_type`, y rechazar adjuntos obligatorios ausentes cuando la etapa lo requiera.
- Evitar que el cliente pueda cambiar la categoría, el servicio o la solicitud asociada usando solo datos del navegador.
- Resolver precio, catálogo y atribución desde Neon.
- Mantener rate limits, Turnstile, permisos, auditoría e idempotencia.
- Persistir `quote_created` en el outbox junto con la solicitud, dentro de la misma transacción.
- Procesar `quote_created` de forma asíncrona mediante los consumidores de correo y notificaciones existentes.
- No llamar a Resend ni al hub realtime directamente desde el handler HTTP de creación.
- Mantener separados los estados de entrega del correo y de la notificación interna.
- Rechazar token inválido, expirado, ajeno, reutilizado o catálogo desactivado.
- Impedir pago o asignación prematuros.

**Aceptación:** API completa y segura para crear y convertir la misma solicitud.
La creación de cotización deja un evento durable y ambos efectos pueden reintentarse sin duplicarse.

### Slice C — Compatibilidad Node local

**Responsable:** agente backend-local.
**Ownership:** `server.js`, adaptadores locales y tests Node.
**Dependencia:** Slice 0 y contrato de B.

- Mantener la decisión: el Worker soporta el flujo operativo; Node solo sirve lo
  editorial/local y responde explícitamente `not_available` para rutas operativas que
  no implemente.
- Eliminar cualquier lectura o escritura operativa mediante `contact_leads`; no usarlo
  como fallback, migración implícita ni fuente de cotizaciones.
- Mantener en Turso solo rutas editoriales.
- Si en el futuro Node soporta una ruta operativa, deberá consumir el mismo contrato y
  Neon, con paridad de validaciones y errores; nunca una segunda fuente de verdad.

**Aceptación:** Node no contradice el modelo Neon, no expone una implementación
operativa divergente y `contact_leads` no participa en el flujo de cotización.

### Slice D — Formulario de cotización

**Responsable:** agente frontend-cotización.
**Ownership:** `src/App.vue`, `src/lib/contentApi.js`, estilos y tests frontend.
**Dependencia:** Slice 0; mocks de B.

- Añadir Importación, Exportación y Agente de carga.
- Añadir consulta dependiente y limpiar consultas incompatibles.
- Mover producto y pregunta desde la solicitud actual.
- Enviar el contrato al endpoint de cotización.
- Conservar locale y atribución de agente.
- Confirmar cotización creada sin afirmar pago o reserva.
- Cubrir estados de carga, error, duplicado y éxito en ES/EN.

**Aceptación:** crea una solicitud `cotizacion` y permite continuar con token seguro.

### Slice E — Formulario de reserva

**Responsable:** agente frontend-reserva.
**Ownership:** `src/operations/PublicRequestApp.vue`, pago relacionado y estilos propios.
**Dependencia:** Slice 0 y contrato de B.

- Leer el token opaco desde el enlace.
- Mostrar `Reserva` como etapa, no como servicio.
- Mostrar clasificación heredada sin permitir cambios no soportados.
- Solicitar solo datos faltantes, adjuntos y pago.
- Mostrar la lista de adjuntos requeridos y opcionales según el servicio heredado; permitir varios archivos, progreso individual, reemplazo/eliminación antes de confirmar y errores por archivo.
- Conservar los adjuntos ya validados al pasar de cotización a reserva y permitir completar los faltantes sin volver a subir los existentes.
- Obtener precio y moneda del servidor.
- Manejar token inválido, vencido, convertido, inexistente y catálogo desactivado.
- Mantener pago e idempotencia, ES/EN y responsive.
- No mostrar ni disparar notificaciones de pago aprobado antes de la conversión y confirmación real del pago.

**Aceptación:** reserva sin repetir clasificación y sobre la misma solicitud.

### Slice F — Panel operativo

**Responsable:** agente frontend-operaciones.
**Ownership:** paneles, labels, filtros y tests de interfaz.
**Dependencia:** Slice 0; puede usar fixtures.

- Mostrar `cotizacion` como estado propio.
- Permitir a usuarios autorizados emitir/copiar enlace seguro.
- Mostrar servicio, consulta, producto, cliente, atribución y vencimiento.
- Mostrar el resumen de adjuntos por categoría, estado de validación, nombre, tamaño y fecha, respetando permisos de descarga.
- Permitir revisar, rechazar o solicitar nuevamente un adjunto sin crear otra solicitud.
- Bloquear acciones no válidas para el estado.
- Mostrar conversión, expiración e incompletitud.
- Mostrar el estado del correo interno y de la notificación de la cotización cuando el rol tenga permiso.
- Permitir reintento administrativo solo mediante los mecanismos idempotentes existentes.
- Añadir ES/EN y estados vacíos/error.

**Aceptación:** administración gestiona el ciclo sin duplicar solicitudes ni exponer tokens.

## Integración y validación

### Slice G — Integración

**Responsable:** Codex.
**Dependencias:** A–F.

- Revisar diffs contra el contrato.
- Resolver nombres, estados y payloads.
- Confirmar que Worker y Node no contradicen el modelo.
- Confirmar que Worker es el runtime operativo canónico y que Node declara explícitamente
  las rutas operativas no soportadas.
- Confirmar que Neon es la única fuente de cotizaciones y que Turso no almacena datos
  operativos.
- Confirmar que `contact_leads` no se usa como fuente ni fallback operativo.
- Confirmar que la reserva actualiza la solicitud original.
- Revisar permisos, atribución, notificaciones y auditoría.
- Confirmar que `quote_created` llega al correo interno y a la bandeja/campanita autorizada.
- Confirmar que fallar Resend no elimina la notificación interna ni cambia el estado de la solicitud.
- Confirmar que un fallo o reintento del consumidor no duplica correo, notificación ni evento.

### Slice H — Pruebas y documentación

**Responsable:** Codex.
**Dependencias:** G.

- Probar token alterado, ajeno, expirado, revocado y reutilizado.
- Probar precio alterado en navegador y catálogo desactivado.
- Probar idempotencia de cotización, reserva y pago.
- Probar que crear una cotización genera un correo interno y una notificación interna una sola vez.
- Probar reintentos, fallo de Resend, reconexión realtime y recuperación del outbox.
- Probar cambio de servicio y limpieza de consulta incompatible.
- Probar múltiples adjuntos por servicio: categorías válidas e inválidas para importación, exportación y agente de carga.
- Probar límites de cantidad/tamaño, MIME no permitido, duplicados, adjuntos obligatorios ausentes, eliminación y reemplazo.
- Probar que los adjuntos validados sobreviven a la conversión y que los faltantes se pueden completar en reserva.
- Probar que un usuario sin permiso no puede leer ni descargar adjuntos de otra solicitud.
- Probar solicitudes antiguas e incompletas.
- Añadir E2E: cotización → enlace → reserva → pago → operación.
- Ejecutar `npm test`, `npm run build` y `npm run test:e2e`.
- Actualizar [docs/QA-FUNCIONAL-MVP.md](QA-FUNCIONAL-MVP.md).

## Paralelización y ownership

Después del Slice 0, A, B, C, D, E y F pueden trabajar en paralelo, cada uno en worktree aislado basado en `dev`.

- No editar archivos fuera del ownership asignado.
- No cambiar el contrato unilateralmente.
- Cada agente entrega resumen, archivos, pruebas, riesgos y pendientes.
- La integración ocurre solo en `dev`.
- No hacer commits/pushes/despliegues a `main` o Producción sin autorización.

## Riesgos y controles

- **Duplicación:** una sola fila en Neon e idempotencia por operación/pago.
- **Manipulación:** servidor como autoridad de precio, clasificación, atribución y estado.
- **Token expuesto:** token opaco, hash, expiración, revocación y sin datos personales.
- **Catálogo cambiado:** no convertir automáticamente; informar y revisar.
- **Solicitudes antiguas:** no inventar clasificación ni precio.
- **Doble backend:** Worker es el runtime operativo canónico; Node declara límites
  explícitos y no crea una segunda implementación o fuente de datos.
- **Fuente divergente:** Neon es la única fuente de cotizaciones; `contact_leads` está
  prohibido para cualquier lectura/escritura operativa.
- **Notificaciones:** una cotización no dispara avisos de pago/asignación hasta conversión válida.
- **Entrega parcial:** correo y notificación interna tienen efectos, estados, reintentos y auditoría independientes.
- **Sincronía accidental:** la creación solo persiste solicitud + outbox; la entrega siempre ocurre en consumidores asíncronos.

## Criterio de cierre

La cotización crea una única solicitud Neon con estado `cotizacion`, genera un correo interno y una notificación interna idempotentes, y el cliente puede convertirla de forma segura en reserva y pago. Se conservan clasificación y atribución; Turso queda solo para contenido editorial; y las transiciones críticas tienen pruebas unitarias y E2E.

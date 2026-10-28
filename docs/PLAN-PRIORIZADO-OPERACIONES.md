# Plan funcional priorizado — Plataforma operativa

**Fecha:** 28 de octubre de 2026
**Rama de referencia:** `dev` (revisión base `947f4b0`; correcciones de conciliación del 28-oct)
**Foco:** completar y validar la funcionalidad de la plataforma operativa en Dev.  
**Producción:** queda para una fase posterior. Este plan no incluye promoción, hardening de infraestructura ni cambios de `main`/Producción.

**Fuera de alcance:** landing pública (`/`), CMS editorial (`/admin`, `/login`), SEO, contenido, imágenes y rendimiento de la landing.

> **Regla de trabajo:** una funcionalidad no se considera terminada por tener código. Debe existir un recorrido verificable en Dev, con permisos correctos, estados consistentes y evidencia reproducible.

---

## 0. Estado de ejecución — 28-oct-2026

| Tarea | Estado | Evidencia |
|---|---|---|
| F-P0-06 — Dashboard sin datos ficticios | **Completado** | Métricas/pipeline inician vacíos; se eliminaron `defaultActivity` y `defaultPriorityRequests`; error con reintento; build correcto |
| F-P1-03 — Ficha de cliente | **Implementado y probado a nivel de contrato** | `GET /api/app/clients/:id` + panel lateral; pruebas PGlite; pendiente smoke E2E con sesión real |
| F-P1-08 — Configuración y copy | **Parcial** | El panel visible (`NotificationConfigPanel`) no menciona Wompi; se corrigió el bloque muerto, pero queda limpieza de código duplicado |
| F-P1-10 — Tests y CI | **Completado** | `npm test` 133/133; workflow ejecuta `npm run check` antes del deploy |
| F-P0-05a / F-P0-05b — Correcciones de conciliación | **Implementadas; pruebas locales aprobadas** | Plantillas cliente ES/EN, ID UUID compartido en UI/API; 8 casos de regresión nuevos; E2E Resend pendiente |
| F-P0-01 a F-P0-05 | Pendientes de validación integral | Requieren cuentas, pagos sandbox y datos reales de Dev |

**Verificación local:** `npm run check` pasa con 141/141 pruebas y build correcto. Las pruebas de conciliación usan transporte Neon simulado: no prueban entrega real en Resend ni el recorrido visual.

---

### 0.1 Revisión del 28-oct y ejecución prioritaria

La revisión sobre `947f4b0` encontró dos bloqueos reproducibles en la conciliación administrativa de correos inciertos. Se priorizan dentro de F-P0-05 antes de la matriz E2E:

| ID | Hallazgo y consecuencia | Corrección ejecutada | Validación y cierre |
|---|---|---|---|
| F-P0-05a | El parser solo reconocía `general-vN` y `expert-vN`; los efectos `client-es-v1` / `client-en-v1` devolvían 409 al conciliar | Reconocer las dos variantes de cliente manteniendo UUID y estructura estrictos | Contratos de API para las cuatro plantillas, claves inválidas y conflicto entre administradores aprobados; falta recorrido real en Dev |
| F-P0-05b | UI y API exigían `re_…` (prefijo de credenciales), bloqueando los UUID de mensajes de Resend con 400 | Validador UUID compartido por UI/API; instrucciones, ejemplo y longitud del campo corregidos | UUID real de ejemplo aceptado y credenciales/IDs inválidos rechazados; falta recorrido visual y conciliación real |

**Garantías verificadas localmente:** conciliar como aceptado no publica en la cola ni envía un correo; conserva la auditoría; si otro destinatario sigue pendiente, no completa el evento ni la solicitud. Se mantiene el requisito de justificación y la protección de acceso administrativo. La confirmación sigue siendo manual: esta corrección no consulta Resend para validar la declaración del administrador.

**Siguiente ejecución:** aplicar los casos de la sección de conciliación del documento `QA-FUNCIONAL-MVP.md` sobre Dev y registrar commit, actor, resultado y evidencia redactada. No se consideran cerrados F-P0-01 a F-P0-05 por el éxito de los tests locales.

**Hallazgos restantes del análisis:** el reporte actual usa estados de solicitudes creadas dentro del rango, por lo que no equivale a un ledger financiero ni al balance de caja (AUD27-07); siguen pendientes las excepciones financieras completas (AUD27-08), cancelación/cierre/reapertura, comentarios y actividad unificada, el módulo Documentos y la matriz E2E de pagos, portal, roles y notificaciones. Sus tareas y criterios del plan se mantienen abiertos; no se incluyen como implementados en esta entrega.

---

## 1. Resumen ejecutivo

La plataforma ya cubre el núcleo del negocio: solicitud pública, clientes, solicitudes, pagos Pro/Bricks, asignación de expertos, respuestas, revisión administrativa, portal de clientes, feedback, reportes, seguridad, catálogo, enlaces de agentes y notificaciones.

El foco ahora es **cerrar el producto funcional**, no preparar producción. Los principales huecos funcionales son:

1. El flujo completo solicitud → pago → asignación → respuesta → aprobación → portal → feedback no tiene una validación E2E única.
2. La matriz funcional de pagos Pro/Bricks sigue incompleta.
3. El portal de clientes no se ha probado con varias solicitudes, sesión vencida, código real y adjuntos.
4. El módulo **Documentos** existe en el menú, pero es un placeholder.
5. La ficha de solicitud no ofrece comentarios internos, historial de actividad unificado ni transiciones manuales de estado.
6. La ficha de cliente ya está implementada; falta validación E2E con sesión real.
7. El dashboard ya no muestra datos ficticios; la “Actividad reciente” aún se deriva de solicitudes recientes, no de un timeline de actividad.
8. La configuración visible está correcta; queda eliminar bloques de código muerto/duplicado.
9. Los casos financieros excepcionales (duplicado, reembolso, contracargo) no tienen flujo funcional completo.
10. La experiencia bilingüe y la validación de roles todavía requieren una pasada funcional.

**Resultado esperado:** un MVP operativo usable de punta a punta por administración, agentes, expertos y clientes, con evidencia de los recorridos principales y de sus excepciones.

**Esfuerzo estimado:** 4 a 6 semanas de un equipo pequeño (2–3 personas), sin contar esperas de proveedores. Producción se planifica después.

---

## 2. Definición del MVP funcional

El MVP funcional se considera completo cuando este recorrido funciona de extremo a extremo:

```text
Cliente abre /solicitud
  → completa y envía la solicitud
  → paga (Pro o Bricks) si aplica
  → la solicitud queda asignada a un experto
  → el experto responde
  → administración revisa y aprueba
  → el cliente recibe la respuesta y accede al portal
  → el cliente consulta su solicitud y deja feedback
```

Y cuando administración puede operar el caso sin tocar la base de datos:

```text
Ver cliente → ver solicitud → asignar experto → verificar pago
→ leer respuesta → aprobar/devolver → consultar historial → cerrar/cancelar
```

### Superficies funcionales incluidas

| Superficie | Ruta | Estado funcional actual |
|---|---|---|
| Solicitud pública | `/solicitud` | Implementada; requiere E2E |
| Enlace de agente | `/solicitud/agente/:token` | Implementado; requiere E2E |
| Retorno de pago | `/solicitud/resultado-pago` | Implementado; requiere E2E |
| Portal de clientes | `/portal-cliente` | Implementado; requiere E2E |
| Feedback | `/feedback` | Implementado; requiere E2E |
| Panel operativo | `/app` | Implementado con huecos |
| Pagos | `/app` → Pagos | Listado y verificación; faltan excepciones |
| Documentos | `/app` → Documentos | **Placeholder** |
| Clientes | `/app` → Clientes | Listado + ficha; pendiente E2E |
| Solicitudes | `/app` → Solicitudes | Listado/detalle; faltan comentarios y estados manuales |
| Reportes | `/app` → Reportes | Implementado |
| Seguridad | `/app` → Usuarios y roles | Implementado |
| Catálogo | `/app` → Servicios y consultas | Implementado |
| Enlaces | `/app` → Enlaces de agentes | Implementado |
| Feedback interno | `/app` → Feedback de clientes | Implementado |
| Preguntas similares | `/app` → Preguntas similares | Implementado |
| Excepciones de notificaciones | `/app` → Excepciones | Implementado |
| Configuración | `/app` → Configuración | Implementado; panel real correcto; queda limpieza de código muerto |

---

## 3. Línea base funcional

| Comprobación | Estado |
|---|---|
| Build | Correcto |
| Suite automatizada | **133/133** |
| Recorrido público completo | Parcialmente validado |
| Matriz Pro/Bricks | Pendiente |
| Portal cliente E2E | Pendiente |
| Matriz de roles/IDOR | Pendiente |
| Cola/DLQ/realtime E2E | Pendiente |
| Documentos | No implementado |
| Comentarios/historial unificado de solicitud | No implementado |
| Ficha de cliente | Implementada; pendiente smoke E2E |
| Dashboard sin datos mock | **Corregido**; falta prueba manual de error |
| Copy de configuración | Panel visible correcto; bloque muerto corregido; limpieza pendiente |

### Hallazgos funcionales concretos

1. **Documentos es un callejón sin salida.** El menú aparece para roles con `documents.read`, pero la vista cae en el placeholder “será desarrollado en la siguiente fase” ([OperationsApp.vue](src/operations/OperationsApp.vue#L108), [OperationsApp.vue](src/operations/OperationsApp.vue#L688)). Existen las tablas `operations.documents` y `operations.activity_log`, pero no hay endpoints ni UI ([001_operations.sql](worker/db/migrations/001_operations.sql#L55)).
2. **La “Actividad reciente” no es un timeline real.** El dashboard ya no usa datos ficticios, pero deriva la actividad de las solicitudes recientes; no muestra eventos con actor, acción y fecha.
3. **La solicitud no tiene comentarios internos ni un historial único.** El detalle devuelve datos, historial de solicitudes del cliente, respuestas y asignaciones ([operationsData.js](worker/routes/operationsData.js#L330)), pero no un timeline de actividad con actor, acción y fecha.
4. **No hay acciones manuales de estado.** El estado avanza por asignación y revisión de respuesta; no hay cancelar, cerrar o reabrir desde el panel.
5. **La ficha de cliente ya existe.** `GET /api/app/clients/:id` y el panel lateral están implementados; falta la validación con sesión y datos reales de Dev.
6. **La configuración visible no menciona Wompi.** El bloque que lo mencionaba era código muerto; el panel real (`NotificationConfigPanel.vue`) describe el flujo correcto. Queda eliminar ese bloque y otros duplicados.
7. **Las excepciones financieras no tienen flujo.** Se muestran estados `duplicate_approved`, `refunded` y `charged_back`, pero no hay una acción administrativa guiada para resolverlos.
8. **La cobertura de i18n es parcial.** Hay traducciones en línea y textos de estado/errores que pueden quedar en español en la vista inglesa.

---

## 4. Prioridades funcionales

| Nivel | Definición | Se cierra cuando |
|---|---|---|
| **F-P0** | Impide considerar el MVP funcional o puede mostrar información falsa. | El recorrido E2E está validado en Dev. |
| **F-P1** | Completa la operación diaria o cubre excepciones importantes. | El equipo puede operar el caso sin base de datos ni soporte manual. |
| **F-P2** | Mejora la experiencia, el mantenimiento o el costo. | Se ejecuta después del MVP. |
| **F-P3** | Producción e infraestructura. | Se retoma en una fase posterior. |

### Orden de trabajo

1. Cerrar el recorrido principal completo.
2. Cerrar pagos y accesos funcionales.
3. Cerrar portal y notificaciones.
4. Completar documentos, comentarios y estados.
5. Cerrar excepciones financieras y reportes.
6. Pulir i18n, accesibilidad y deuda.
7. Producción, después.

---

## 5. Roadmap funcional

| Fase | Duración | Objetivo | Salida |
|---|---|---|---|
| **Fase 1 — Flujo principal** | Semana 1 | Solicitud → pago → asignación → respuesta → portal | Recorrido E2E demostrable |
| **Fase 2 — Dinero y accesos** | Semana 2 | Matriz Pro/Bricks y roles/titularidad | Evidencia funcional completa |
| **Fase 3 — Operación diaria** | Semanas 3–4 | Documentos, comentarios, estados, ficha de cliente | Operación sin SQL manual |
| **Fase 4 — Excepciones** | Semana 5 | Duplicados, reembolsos, cambio de correo, reportes | Casos excepcionales resolubles |
| **Fase 5 — Pulido** | Semana 6 | i18n, accesibilidad, regresión, demo | MVP funcional aceptado |

La promoción a producción no forma parte de este calendario.

---

## 6. Backlog F-P0 — bloqueantes funcionales

### F-P0-01 — Cierre del recorrido E2E principal

**Problema:** las piezas existen, pero no hay una validación única de todo el recorrido. Un fallo entre módulos puede pasar desapercibido.

**Acciones:**

1. Crear una solicitud pública de prueba en Dev.
2. Pagar con Pro o Bricks según el flag.
3. Verificar asignación automática o manual a un experto.
4. Responder como experto.
5. Revisar y aprobar como administración.
6. Verificar correo, campana y estado.
7. Entrar al portal con el correo del cliente.
8. Ver la solicitud, la respuesta aprobada y los adjuntos.
9. Enviar feedback.
10. Repetir el recorrido en español e inglés.

**Criterio de aceptación:**

- El recorrido completo se ejecuta sin intervención de base de datos.
- El cliente solo ve su solicitud y su respuesta aprobada.
- Administración ve el estado y los intentos de pago.
- El experto no ve datos personales del cliente.
- El feedback queda asociado a la solicitud.
- La evidencia incluye referencia, estados y capturas redactadas.

**Esfuerzo:** M. **Dependencias:** datos y cuentas de prueba.

---

### F-P0-02 — Matriz funcional de pagos Pro/Bricks

**Problema:** la lógica de pagos está probada con simuladores, pero no con la matriz externa completa. Un único pago aprobado no valida rechazo, pendiente, timeout, duplicado ni rollback.

**Acciones:**

1. Ejecutar la matriz:

| Caso | Pro | Bricks | Resultado funcional esperado |
|---|---|---|---|
| Aprobado | Sí | Sí | Pago confirmado, solicitud habilitada, correo y campana |
| Rechazado | Sí | Sí | Estado rechazado, portal permite reintentar |
| Pendiente | Sí | Sí | Estado pendiente, se bloquea otro cobro |
| Timeout / error de creación | Sí | Sí | Estado incierto, mensaje de no pagar de nuevo |
| Doble clic / dos pestañas | Sí | Sí | Un solo intento externo |
| Webhook repetido | Sí | Sí | Sin duplicar efectos |
| Firma inválida | Sí | Sí | Rechazo, sin cambio de estado |
| Monto/moneda/referencia alterados | Sí | Sí | Rechazo, sin habilitar atención |
| Pago duplicado | Sí | Sí | `duplicate_approved`, alerta, una sola atención |
| Flag Bricks apagado | Sí | — | Nuevo intento usa Pro |
| Rollback del flag | — | Sí | Intento histórico conserva su modo |

2. Probar el retorno del navegador y el webhook por separado.
3. Probar el portal después de cada estado.
4. Registrar evidencia por caso.

**Criterio de aceptación:**

- Todos los casos tienen resultado consistente entre Mercado Pago, base local y portal.
- Ningún caso deja un cobro sin estado local.
- Un pago incierto no permite un segundo cobro ciego.
- El rollback del flag no altera intentos existentes.

**Esfuerzo:** M–L. **Dependencias:** F-P0-01, credenciales sandbox.

---

### F-P0-03 — Matriz funcional de roles, permisos y titularidad

**Problema:** los controles existen, pero no se ha demostrado E2E que cada rol vea exactamente lo suyo y que un ID manipulado no abra datos ajenos.

**Acciones:**

1. Crear cuentas de admin, agente, experto y cliente.
2. Ejecutar la matriz:

| Escenario | Esperado |
|---|---|
| Agente A consulta solicitud de agente B | Sin acceso |
| Experto A consulta caso de experto B | Sin acceso |
| Experto consulta caso impago | Sin acceso |
| Experto responde caso no asignado | 403 |
| Cliente A consulta solicitud de cliente B | 404 |
| Cliente A descarga adjunto de B | 404 |
| Admin reasigna y audita | Permitido |
| Usuario inactivo inicia sesión | Rechazado |
| Sesión revocada usa API | 401 |
| Permiso retirado en caliente | 403 |
| Agente crea solicitud interna | 403 |
| Usuario sin `payments.read` consulta pagos | 403 |

3. Probar por UI y por API directa.
4. Convertir los casos críticos en pruebas de integración.

**Criterio de aceptación:**

- Ningún ID ajeno devuelve datos.
- Ningún rol amplía su alcance con parámetros.
- La sesión revocada no opera.
- Los casos críticos quedan automatizados.

**Esfuerzo:** M. **Dependencias:** F-P0-01.

---

### F-P0-04 — Portal de clientes E2E

**Problema:** el portal está implementado, pero falta validarlo con varias solicitudes, sesión vigente/vencida, código real y adjuntos.

**Acciones:**

1. Probar cliente con 3 solicitudes de orígenes distintos.
2. Verificar listado, detalle, adjuntos, respuesta aprobada y nota pública.
3. Verificar que no se muestran respuestas pendientes ni notas internas.
4. Probar código expirado, usado, reemplazado y límite de intentos.
5. Probar enlaces desde pago, respuesta y confirmación de solicitud.
6. Confirmar que el portal no crea otra solicitud ni inicia otro pago.
7. Probar ES/EN, móvil y escritorio.

**Criterio de aceptación:**

- El cliente encuentra todas sus solicitudes.
- No ve datos de terceros.
- El código de acceso funciona y expira correctamente.
- La respuesta aprobada se ve; la pendiente no.
- El enlace no duplica el cobro.

**Esfuerzo:** M. **Dependencias:** F-P0-01, F-P0-02.

---

### F-P0-05 — Ciclo funcional de notificaciones

**Estado al 28-oct:** corregidos en código los bloqueos F-P0-05a/F-P0-05b, con regresión local aprobada. La validación integral sigue pendiente.

**Problema:** la cola, DLQ y WebSocket están implementados, pero falta demostrar el ciclo real en Dev.

**Acciones:**

1. Provocar un evento de solicitud creada, pago aprobado y respuesta aprobada.
2. Verificar correo, campana y WebSocket.
3. Simular fallo de Resend y confirmar reintento.
4. Llevar un evento a DLQ y redirigirlo.
5. Verificar que logout/desactivación corta el realtime.
6. Confirmar que no se duplican correos ni avisos.

**Criterio de aceptación:**

- El evento se persiste, publica y consume.
- El fallo se recupera o queda en DLQ con evidencia.
- No hay duplicados.
- La campana y el correo reflejan el mismo evento.

**Esfuerzo:** M–L. **Dependencias:** F-P0-01.

---

### F-P0-06 — Dashboard con datos reales y estados honestos

**Estado: completado (27-oct-2026).** Falta una prueba manual con la API caída.

**Problema original:** el dashboard arrancaba con métricas de ejemplo y, si fallaba la API, mostraba actividad y solicitudes ficticias como si fueran reales.

**Acciones:**

1. Inicializar métricas en cero o esqueleto de carga.
2. Eliminar `defaultActivity` y `defaultPriorityRequests`.
3. En error, mostrar estado vacío/error con opción de reintentar.
4. Verificar que los números coinciden con el listado de solicitudes.
5. Probar con admin, agente y experto.

**Criterio de aceptación:**

- Nunca se muestran datos de ejemplo como si fueran producción.
- Un error de API se ve como error.
- Los contadores coinciden con la base.
- Cada rol ve solo su alcance.

**Esfuerzo:** S. **Dependencias:** ninguna.

---

## 7. Backlog F-P1 — operación diaria y excepciones

### F-P1-01 — Módulo Documentos

**Problema:** el menú existe, pero la vista es un placeholder. Las tablas `documents` y `activity_log` están creadas, aunque el modelo actual referencia `operations.operations`, no `operations.requests`.

**Acciones:**

1. Decidir si los documentos se asocian a solicitud, cliente o ambos.
2. Crear migración compatible con `operations.requests`.
3. Endpoints: listar, subir, descargar, eliminar lógicamente.
4. UI con `ListView`, búsqueda, filtros y estado vacío.
5. Validar MIME, tamaño, firma y permisos.
6. Registrar auditoría de carga/descarga.
7. Asociar documentos a la ficha de solicitud.

**Criterio de aceptación:** un usuario autorizado sube, lista y descarga un documento de su solicitud; otro no puede acceder por ID.

**Esfuerzo:** L. **Dependencias:** decisión de modelo y F-P0-03.

---

### F-P1-02 — Comentarios, timeline y estados manuales de solicitud

**Problema:** el detalle no permite dejar comentarios internos ni ver un timeline único con actor/acción/fecha. Tampoco hay acciones manuales de estado.

**Acciones:**

1. Añadir comentarios internos (solo admin/agente autorizado).
2. Crear timeline con eventos de solicitud, asignación, pago, respuesta y revisión.
3. Añadir transiciones permitidas: cancelar, cerrar, reabrir si aplica.
4. Auditar cada acción.
5. Mostrar el timeline en el detalle.
6. Probar que un agente no ve comentarios de otro agente.

**Criterio de aceptación:** operaciones puede documentar y seguir un caso sin salir del panel.

**Esfuerzo:** L. **Dependencias:** F-P1-01 y F-P0-03.

---

### F-P1-03 — Ficha de cliente

**Estado: implementado y probado a nivel de contrato (27-oct-2026).** Pendiente smoke E2E con sesión, datos y navegador reales.

**Problema original:** el listado de clientes no permitía abrir un cliente ni ver su historial.

**Acciones:**

1. ~~Crear `GET /api/app/clients/:id`.~~ Completado.
2. ~~Mostrar datos, métricas y solicitudes.~~ Completado.
3. ~~Respetar el alcance del agente.~~ Completado con prueba PGlite.
4. ~~Enlazar desde el listado y desde la solicitud.~~ Completado desde el listado.
5. Pendiente: smoke E2E y refresco de la ficha al crear una solicitud nueva.

**Criterio de aceptación:** el cliente se abre desde el listado y muestra solo sus solicitudes. El backend ya lo garantiza; falta verificarlo en Dev con una sesión real.

**Esfuerzo:** M. **Dependencias:** F-P0-03.

---

### F-P1-04 — Excepciones financieras

**Problema:** `duplicate_approved`, `refunded` y `charged_back` se muestran, pero no hay flujo para resolverlos.

**Acciones:**

1. Definir política de reembolso.
2. Añadir acción administrativa auditada.
3. No reactivar atención por un segundo pago.
4. Generar alerta y tarea de revisión.
5. Probar evento tardío y webhook repetido.

**Criterio de aceptación:** todo pago duplicado queda visible, alertado y resoluble; una sola atención por solicitud.

**Esfuerzo:** M. **Dependencias:** F-P0-02.

---

### F-P1-05 — Cambio verificado de correo del cliente

**Problema:** un correo mal escrito bloquea el portal y la entrega de respuestas.

**Acciones:**

1. Definir verificación (código al correo nuevo y anterior o revisión administrativa).
2. Auditar el cambio.
3. Revocar sesiones del portal.
4. Probar que un tercero no puede cambiar el correo.

**Criterio de aceptación:** cambio trazable y verificado, sin acceso cruzado.

**Esfuerzo:** M. **Dependencias:** F-P0-04.

---

### F-P1-06 — Reportes y control financiero

**Problema:** los reportes usan filas actuales, no un ledger; reembolsos y contracargos no son conciliación bancaria.

**Acciones:**

1. Definir qué significa “balance”.
2. Separar cotizado, cobrado, reembolsado y contracargo.
3. Añadir conciliación con Mercado Pago.
4. Proteger exportaciones y neutralizar fórmulas.
5. Probar con datos de Dev.

**Criterio de aceptación:** cifras reproducibles; el reporte no promete conciliación que no existe.

**Esfuerzo:** M–L. **Dependencias:** F-P1-04.

---

### F-P1-07 — Cobertura funcional bilingüe

**Problema:** hay traducciones en línea y textos que pueden quedar en español en la vista inglesa.

**Acciones:**

1. Inventariar textos de módulos operativos, portal y solicitud.
2. Centralizar recursos ES/EN.
3. Cubrir errores, estados, filtros, paginación, modales y validaciones.
4. Probar los recorridos principales en ambos idiomas.

**Criterio de aceptación:** no quedan textos funcionales sin traducir en las rutas operativas.

**Esfuerzo:** M.

---

### F-P1-08 — Copy y configuración funcional

**Estado: parcial (27-oct-2026).** El panel visible (`NotificationConfigPanel.vue`) ya describe el flujo correcto y no menciona Wompi. El bloque muerto que sí lo mencionaba fue corregido, pero sigue existiendo código duplicado/inaccesible en `OperationsApp.vue`.

**Problema original:** se creía que la configuración visible mencionaba Wompi; en realidad era un bloque de código muerto.

**Acciones:**

1. ~~Corregir el texto del bloque que mencionaba Wompi.~~ Completado.
2. Revisar valor del servicio, destinatarios y reglas en el panel real.
3. Eliminar secciones muertas y duplicadas de `OperationsApp.vue`.
4. Verificar que guardar configuración afecta al flujo real.

**Criterio de aceptación:** la configuración visible describe el proveedor y el comportamiento reales, y no quedan bloques inaccesibles que confundan el mantenimiento.

**Esfuerzo:** S (queda la limpieza).

---

### F-P1-09 — Accesibilidad y responsive funcional

**Problema:** hay formularios, tablas y modales densos; falta una revisión funcional de teclado, foco y móvil.

**Acciones:**

1. Revisar formularios, modales, tablas y paginación.
2. Probar teclado, foco, lectores y contraste.
3. Probar móvil en solicitud, portal y panel.
4. Corregir truncamientos y controles inaccesibles.

**Criterio de aceptación:** los recorridos principales se completan con teclado y en móvil.

**Esfuerzo:** M.

---

### F-P1-10 — Regresión funcional y CI

**Estado: completado (27-oct-2026).**

**Problema original:** no había script de pruebas ni CI que ejecutara la suite antes de desplegar Dev.

**Acciones:**

1. ~~Añadir `npm test` y `npm run check`.~~ Completado.
2. ~~Ejecutar tests/build en el workflow.~~ Completado.
3. Añadir pruebas de los recorridos críticos restantes.
4. ~~Documentar la matriz de evidencia.~~ Completado en [QA-FUNCIONAL-MVP.md](./QA-FUNCIONAL-MVP.md).

**Criterio de aceptación:** un cambio roto no llega a Dev; la suite cubre los flujos críticos. La compuerta ya existe y pasa con 133/133 pruebas.

**Esfuerzo:** S–M.

---

## 8. Backlog F-P2 — después del MVP

| ID | Tarea | Resultado | Esfuerzo |
|---|---|---|---|
| F-P2-01 | Módulo de tareas internas | Tareas asociadas a solicitud con responsable y vencimiento | L |
| F-P2-02 | Modularizar frontend operativo | Componentes por dominio, cliente API compartido | L |
| F-P2-03 | Dependencias y tooling | Menos vulnerabilidades, lint/formato | M |
| F-P2-04 | Retención de datos | Política para eventos, versiones y adjuntos | M |
| F-P2-05 | Rendimiento operativo | Menos consultas y polling; medir Neon/DO | M |
| F-P2-06 | Exportaciones seguras | Descargas autorizadas y CSV sin fórmulas | M |
| F-P2-07 | Documentación funcional | Una fuente de verdad por módulo | S–M |
| F-P2-08 | Búsqueda avanzada | Índices y filtros combinados en solicitudes/clientes | M |

---

## 9. Producción: fase posterior

No se ejecuta en este plan. Cuando se retome, debe partir de un release candidate funcionalmente cerrado y agregar, como mínimo:

- Compuerta de CI con tests/build.
- Paridad de secretos, bindings, migraciones, colas, R2 y Durable Object.
- Turnstile obligatorio en producción.
- Matriz E2E de accesos reproducida en el entorno destino.
- Cabeceras de seguridad, CORS restringido y evaluación de sesiones en cookies.
- MFA para administradores.
- Alertas, dashboards, runbooks y respaldos/restauración.
- Ensayo de rollback y go/no-go.

**Regla:** producción no se abre hasta que el MVP funcional esté aceptado y estas compuertas tengan evidencia. Ese trabajo se planifica aparte.

---

## 10. Estrategia de pruebas funcionales

### 10.1 Matriz mínima

| Flujo | Casos |
|---|---|
| Solicitud pública | Directa, agente, validaciones, adjuntos, Turnstile, duplicado |
| Pago | Pro/Bricks, aprobado, rechazado, pendiente, timeout, duplicado, rollback |
| Asignación | Automática, manual, reasignación, sin experto |
| Experto | Bandeja, detalle, adjunto, respuesta, caso impago |
| Revisión | Aprobar, devolver, nota pública/interna, concurrencia |
| Portal | Código, sesión, varias solicitudes, adjuntos, respuesta, pago |
| Notificaciones | Correo, campana, realtime, fallo, DLQ, redrive |
| Documentos | Subir, listar, descargar, borrar, acceso ajeno |
| Reportes | Filtros, totales, exportación, permisos |
| Seguridad | Roles, sesión revocada, IDOR, usuario inactivo |

### 10.2 Evidencia

Cada caso debe registrar:

```text
ID:
Fecha:
Entorno:
Commit:
Caso:
Precondiciones:
Pasos:
Resultado esperado:
Resultado observado:
Estado: PASS / FAIL / BLOCKED
Evidencia: captura o log redactado
Defecto:
Responsable:
```

### 10.3 Reglas

- No usar datos personales reales.
- No incluir tokens, cookies ni secretos.
- Un caso bloqueado no cuenta como aprobado.
- Repetir la matriz sobre el commit que se va a demostrar.
- Probar por UI y por API cuando el caso sea de permisos.

---

## 11. Primeros 10 días hábiles

| Día | Trabajo | Salida |
|---|---|---|
| 1 | Quitar datos mock del dashboard; preparar cuentas y datos de prueba | Dashboard honesto + set de prueba |
| 2 | Recorrido E2E principal | Evidencia del happy path |
| 3 | Matriz Pro | Evidencia Pro |
| 4 | Matriz Bricks y correcciones | Evidencia Bricks |
| 5 | Matriz de roles/IDOR | Hallazgos priorizados |
| 6 | Portal E2E | Evidencia del portal |
| 7 | Notificaciones: correo, campana, cola y DLQ | Evidencia de entrega |
| 8 | Diseño funcional de Documentos y timeline | Contrato y migración |
| 9 | Implementación inicial de Documentos | Subida/listado/descarga |
| 10 | Regresión y demo funcional | Demo + backlog actualizado |

---

## 12. Decisiones abiertas

1. ¿Los documentos se asocian a solicitud, cliente o ambos?
2. ¿Los comentarios son solo internos o también visibles al cliente?
3. ¿Qué transiciones manuales de estado se permiten y con qué rol?
4. ¿La ficha de cliente incluye pagos y actividad o solo solicitudes?
5. ¿Se implementa tareas internas en el MVP o después?
6. ¿Qué alcance tiene el cambio de correo del cliente?
7. ¿Qué reportes son obligatorios para el MVP?
8. ¿Se prioriza i18n completo antes o después de Documentos?
9. ¿Qué casos de pago se consideran obligatorios para aceptar el MVP?
10. ¿Cuándo se retoma la fase de producción?

---

## 13. Definición de terminado funcional

Una tarea funcional se considera terminada cuando:

- El recorrido se puede ejecutar en Dev sin SQL manual.
- Respeta roles, permisos y titularidad.
- Tiene estados consistentes y mensajes claros.
- Tiene evidencia de los casos principales y de error.
- Está traducida en ES/EN si el usuario final la ve.
- Tiene prueba automatizada o caso de regresión documentado.
- Actualiza la documentación del módulo.
- No deja datos mock, copy obsoleto ni placeholders visibles.

El MVP funcional se acepta cuando el recorrido principal y sus excepciones críticas están demostrados, y cuando administración, agente, experto y cliente pueden operar sin asistencia técnica. Producción se evalúa después, con su propio plan.

# Plan funcional priorizado — Plataforma operativa

**Fecha:** 28 de octubre de 2026
**Rama de referencia:** `dev` (`ba1280f`; actividad de solicitudes, excepciones financieras y cambio de correo)
**Foco:** completar y validar la funcionalidad de la plataforma operativa en Dev.  
**Producción:** queda para una fase posterior. Este plan no incluye promoción, hardening de infraestructura ni cambios de `main`/Producción.

**Fuera de alcance:** landing pública (`/`), CMS editorial (`/admin`, `/login`), SEO, contenido, imágenes y rendimiento de la landing.

> **Regla de trabajo:** una funcionalidad no se considera terminada por tener código. Debe existir un recorrido verificable en Dev, con permisos correctos, estados consistentes y evidencia reproducible.

---

## 0. Estado de ejecución — 28-oct-2026

| Tarea | Estado | Evidencia |
|---|---|---|
| F-P0-01 — Base E2E de navegador | **Parcial; 10/10 pruebas locales** | Playwright desktop y móvil; solicitud pública, portal, retorno Pro aprobado/incierto y respuesta de experto con aprobación administrativa. APIs simuladas; no valida el Worker, base de datos ni proveedores reales |
| F-P0-06 — Dashboard sin datos ficticios | **Completado** | Métricas/pipeline inician vacíos; se eliminaron `defaultActivity` y `defaultPriorityRequests`; error con reintento; build correcto |
| F-P1-03 — Ficha de cliente | **Implementado y probado a nivel de contrato** | `GET /api/app/clients/:id` + panel lateral; pruebas PGlite; pendiente smoke E2E con sesión real |
| F-P1-02 — Actividad de solicitud | **Desplegado en Dev; smoke funcional pendiente** | Migración 045 aplicada; timeline, notas internas, asignaciones y transiciones auditadas |
| F-P1-04 — Excepciones financieras | **Desplegado en Dev; smoke funcional pendiente** | Migración 046 aplicada; seguimiento auditable, sin ejecución de reembolsos ni cambios de estado del proveedor |
| F-P1-05 — Cambio de correo cliente | **Desplegado en Dev; smoke funcional pendiente** | Migración 047 aplicada; verificación en correo nuevo, auditoría y revocación de sesiones |
| F-P1-08 — Configuración y copy | **Parcial** | El panel visible (`NotificationConfigPanel`) no menciona Wompi; se corrigió el bloque muerto, pero queda limpieza de código duplicado |
| F-P1-10 — Tests y CI | **Completado** | `npm test` 141/141; workflow ejecuta `npm run check` antes del deploy |
| F-P0-05a / F-P0-05b — Correcciones de conciliación | **Implementadas; pruebas locales aprobadas** | Plantillas cliente ES/EN, ID UUID compartido en UI/API; 8 casos de regresión nuevos; E2E Resend pendiente |
| F-P0-01 a F-P0-05 | Pendientes de validación integral | La base E2E ya cubre cinco escenarios de navegador con mocks, incluida la revisión admin; faltan el recorrido integrado, feedback, notificaciones y pruebas Worker/backend/sandbox en Dev |

**Verificación local (28-oct-2026):** `npm run check` pasa con 141/141 pruebas y build correcto; `npm run test:e2e` pasa 10/10 en escritorio y móvil. Las rutas API de los E2E están simuladas: no prueban Worker, Neon, Mercado Pago, Resend ni Cloudflare.

---

### 0.1 Revisión del 28-oct y ejecución prioritaria

La revisión sobre `947f4b0` encontró dos bloqueos reproducibles en la conciliación administrativa de correos inciertos. Se priorizan dentro de F-P0-05 antes de la matriz E2E:

| ID | Hallazgo y consecuencia | Corrección ejecutada | Validación y cierre |
|---|---|---|---|
| F-P0-05a | El parser solo reconocía `general-vN` y `expert-vN`; los efectos `client-es-v1` / `client-en-v1` devolvían 409 al conciliar | Reconocer las dos variantes de cliente manteniendo UUID y estructura estrictos | Contratos de API para las cuatro plantillas, claves inválidas y conflicto entre administradores aprobados; falta recorrido real en Dev |
| F-P0-05b | UI y API exigían `re_…` (prefijo de credenciales), bloqueando los UUID de mensajes de Resend con 400 | Validador UUID compartido por UI/API; instrucciones, ejemplo y longitud del campo corregidos | UUID real de ejemplo aceptado y credenciales/IDs inválidos rechazados; falta recorrido visual y conciliación real |

**Garantías verificadas localmente:** conciliar como aceptado no publica en la cola ni envía un correo; conserva la auditoría; si otro destinatario sigue pendiente, no completa el evento ni la solicitud. Se mantiene el requisito de justificación y la protección de acceso administrativo. La confirmación sigue siendo manual: esta corrección no consulta Resend para validar la declaración del administrador.

**Siguiente ejecución:** aplicar los casos de la sección de conciliación del documento `QA-FUNCIONAL-MVP.md` sobre Dev y registrar commit, actor, resultado y evidencia redactada. No se consideran cerrados F-P0-01 a F-P0-05 por el éxito de los tests locales.

**Actualización de esta ejecución:** las migraciones 045–047 se aplicaron en Neon Dev y el commit `ba1280f` se desplegó como Worker `4f1eb1b4-3633-4805-958c-bc439bffa354`. `/`, `/solicitud`, `/portal-cliente` y `/app` respondieron HTTP 200. Falta el recorrido manual con roles reales y validar Resend para marcar los tres puntos verificados. El registro de excepciones no ejecuta reembolsos ni cambia el estado que sincroniza Mercado Pago. Siguen pendientes el módulo Documentos, el ledger/conciliación bancaria y la matriz E2E ampliada.

---

## 1. Resumen ejecutivo

La plataforma ya cubre el núcleo del negocio: solicitud pública, clientes, solicitudes, pagos Pro/Bricks, asignación de expertos, respuestas, revisión administrativa, portal de clientes, feedback, reportes, seguridad, catálogo, enlaces de agentes y notificaciones.

El foco ahora es **cerrar el producto funcional**, no preparar producción. Los principales huecos funcionales son:

1. El flujo completo solicitud → pago → asignación → respuesta → aprobación → portal → feedback aún no tiene una validación E2E única. Ya se cubren por separado solicitud, portal y retorno Pro con APIs simuladas.
2. La matriz funcional de pagos Pro/Bricks sigue incompleta.
3. El portal de clientes no se ha probado con varias solicitudes, sesión vencida, código real y adjuntos.
4. El módulo **Documentos** existe en el menú, pero es un placeholder.
5. **Validar en Dev:** comentarios internos, timeline y transiciones auditadas de solicitud (F-P1-02 desplegado; migración 045 aplicada).
6. La ficha de cliente ya está implementada; falta validación E2E con sesión real.
7. El dashboard ya no muestra datos ficticios; la “Actividad reciente” aún se deriva de solicitudes recientes, no del timeline de solicitud.
8. La configuración visible está correcta; queda eliminar bloques de código muerto/duplicado.
9. **Validar en Dev:** registro administrativo auditable de duplicados, reembolsos y contracargos (F-P1-04 desplegado; migración 046 aplicada). No inicia un reembolso ni modifica estados del proveedor.
10. **Validar en Dev:** cambio de correo con código enviado al nuevo correo, auditoría, traslado de solicitudes y revocación de sesiones (F-P1-05 desplegado; migración 047 aplicada).
11. La experiencia bilingüe y la validación de roles todavía requieren una pasada funcional.

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
| Pagos | `/app` → Pagos | Listado, verificación y seguimiento de excepciones; validación Dev pendiente |
| Documentos | `/app` → Documentos | **Placeholder** |
| Clientes | `/app` → Clientes | Listado + ficha; pendiente E2E |
| Solicitudes | `/app` → Solicitudes | Listado/detalle con timeline, notas internas y transiciones auditadas; validación Dev pendiente |
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
| Suite automatizada | **141/141** |
| Playwright local (desktop + mobile) | **10/10**; cinco escenarios con APIs simuladas |
| Recorrido público completo | Parcialmente validado; falta backend, pago real sandbox, portal y feedback integrados |
| Matriz Pro/Bricks | Pendiente |
| Portal cliente E2E | Parcial; acceso por código simulado, listado y detalle probados en desktop/móvil |
| Matriz de roles/IDOR | Pendiente |
| Cola/DLQ/realtime E2E | Pendiente |
| Documentos | No implementado |
| Comentarios/historial unificado de solicitud | Implementado localmente; validación Dev pendiente |
| Ficha de cliente | Implementada; pendiente smoke E2E |
| Dashboard sin datos mock | **Corregido**; falta prueba manual de error |
| Copy de configuración | Panel visible correcto; bloque muerto corregido; limpieza pendiente |

### Hallazgos funcionales concretos

1. **Documentos es un callejón sin salida.** El menú aparece para roles con `documents.read`, pero la vista cae en el placeholder “será desarrollado en la siguiente fase” ([OperationsApp.vue](src/operations/OperationsApp.vue#L108), [OperationsApp.vue](src/operations/OperationsApp.vue#L688)). Existen las tablas `operations.documents` y `operations.activity_log`, pero no hay endpoints ni UI ([001_operations.sql](worker/db/migrations/001_operations.sql#L55)).
2. **La “Actividad reciente” no es un timeline real.** El dashboard ya no usa datos ficticios, pero deriva la actividad de las solicitudes recientes; no muestra eventos con actor, acción y fecha.
3. **Resuelto en código local; pendiente Dev.** La solicitud ahora tiene timeline con actor, acción, asignaciones, pagos, respuestas y transiciones, además de comentarios internos.
4. **No hay acciones manuales de estado.** El estado avanza por asignación y revisión de respuesta; no hay cancelar, cerrar o reabrir desde el panel.
5. **La ficha de cliente ya existe.** `GET /api/app/clients/:id` y el panel lateral están implementados; falta la validación con sesión y datos reales de Dev.
6. **La configuración visible no menciona Wompi.** El bloque que lo mencionaba era código muerto; el panel real (`NotificationConfigPanel.vue`) describe el flujo correcto. Queda eliminar ese bloque y otros duplicados.
7. **Resuelto en código local; pendiente Dev.** El panel de pagos registra el seguimiento y la auditoría de duplicados, reembolsos y contracargos. El reembolso sigue siendo una operación externa en Mercado Pago.
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

**Estado: base parcial (28-oct-2026).** Playwright corre en escritorio y móvil. Hay specs para solicitud pública, acceso por código y detalle del portal, retorno Pro aprobado/incierto y respuesta de experto seguida de aprobación administrativa. Las APIs están interceptadas, así que la suite prueba la interfaz y sus contratos de solicitud, pero no ejecuta el Worker ni verifica persistencia. Falta el flujo integrado de extremo a extremo con pago, notificaciones y feedback, además de autorización por API; el smoke sandbox de Dev permanece separado.

**Problema:** las piezas existen, pero no hay una validación automatizada única de todo el recorrido. Un fallo entre módulos puede pasar desapercibido.

**Acciones:**

1. ~~Configurar Playwright con Chromium y dos perfiles: `local-mocked` para PR/CI y `dev-sandbox` manual o workflow protegido.~~ Base `local-mocked` instalada; proyectos Chromium desktop/móvil y workflow independiente `.github/workflows/e2e-dev.yml`, sin secretos. Smoke `dev-sandbox` pendiente.
2. Crear fixtures únicos por ejecución (correo `e2e+<run>@...`, cliente, solicitud, experto y agente) y limpiarlos por API administrativa de test o expiración; jamás reutilizar usuarios/datos reales.
3. Parcial: los specs simulan contratos HTTP del frontend con respuestas deterministas; falta probar Worker/backend local y eventos de Mercado Pago/Resend con adaptadores simulados.
4. En `dev-sandbox`, usar cuentas y tarjetas sandbox; cualquier pago que altere proveedor o envíe correo se ejecuta explícitamente fuera de CI con reporte redactado.
5. Crear una solicitud pública de prueba en Dev/local.
6. Pagar con Pro o Bricks según el escenario y verificar estado persistido desde API, no solo el retorno visual.
7. Verificar asignación automática o manual a un experto.
8. Responder como experto.
9. Revisar y aprobar como administración.
10. Verificar correo, campana y estado.
11. Solicitar código de acceso y leer el correo del buzón de prueba; en CI usar bandeja simulada.
12. Entrar al portal con el código y comprobar varias solicitudes propias y exclusión de las ajenas.
13. Ver la solicitud, la respuesta aprobada y los adjuntos.
14. Enviar feedback.
15. Repetir el recorrido en español e inglés y un viewport móvil.

**Criterio de aceptación:**

- El recorrido completo se ejecuta sin intervención de base de datos.
- El cliente solo ve su solicitud y su respuesta aprobada.
- Administración ve el estado y los intentos de pago.
- El experto no ve datos personales del cliente.
- El feedback queda asociado a la solicitud.
- La evidencia incluye referencia, estados y capturas redactadas.

**Criterio técnico adicional:** los asserts cubren UI y contrato API; estados de pago, asignación y respuesta se verifican contra API autorizada. Los tests deben crear datos aislados y no depender de referencias fijas, tiempos arbitrarios ni estado persistente de otra prueba. Guardar trace/video solo al fallar, con datos redactados. La suite local corre en CI; la suite contra Dev queda manual/protegida y nunca bloquea/despliega Producción automáticamente.

**Esfuerzo:** M–L. **Dependencias:** datos y cuentas de prueba, buzón de prueba y autorización/configuración de credenciales sandbox para smoke Dev.

---

### Estrategia E2E y orden de ejecución — F-P0-01 a F-P0-05

| Nivel | Qué cubre | Proveedores | Ejecución | Criterio |
|---|---|---|---|---|
| E2E local en navegador | Solicitud pública, portal, retorno Pro, respuesta de experto y aprobación admin; el recorrido integrado con feedback sigue pendiente | APIs simuladas con `page.route`; sin Worker ni DB | Cada PR, sin secretos | Rápida y repetible; verifica UI y contratos HTTP observados por el navegador |
| Pruebas backend existentes | Reglas de API, persistencia simulada y lógica de negocio cubierta por pruebas Node | Transporte/mocks locales según el caso | `npm run check` | No sustituye E2E de Worker con base aislada |
| E2E de seguridad | IDs ajenos, permisos, sesión vencida, adjuntos, rol inactivo | API y UI local | Pendiente; agregar críticos a CI | Sin fuga ni acción fuera del permiso |
| Smoke Dev sandbox | Checkout real sandbox Pro y Bricks, webhook, código de portal y correo de prueba | Cuentas sandbox segregadas | Manual/dispatch, al desplegar a Dev | Caso trazable y sin datos/pagos reales |
| Recuperación Dev | Reintentos, correo incierto, DLQ, conciliación y no duplicación | Fallos controlados | Bajo demanda, con operador | Auditoría y estados coherentes |

**Fases para proceder:**

1. ~~Instalar Playwright como dependencia de desarrollo y fijar Chromium en CI; mantener `npm run check` como verificación rápida.~~ Completado en el workflow E2E independiente.
2. ~~Añadir configuración, servidor local reproducible y mocks HTTP sintéticos sin bypass en producción.~~ Completado para UI; falta levantar el Worker y una base aislada para validar integración.
3. Automatizar los flujos de agente, experto y revisión administrativa, con rechazo de permisos por rol; guardar traces al fallar.
4. Ampliar la matriz de pagos Pro/Bricks y estados aprobado/rechazado/pendiente/incertidumbre; integrar flujo con portal y feedback.
5. Levantar Worker y almacenamiento aislado en local para validar autorización y persistencia de extremo a extremo.
6. Habilitar workflow manual de smoke Dev con secretos de entorno Dev protegidos y concurrencia serial; nunca correr cargos reales.
7. Registrar evidencias y defectos en `QA-FUNCIONAL-MVP.md`; un smoke externo pendiente no se marca como aprobado por el E2E simulado.

**Puerta de calidad:** todos los E2E locales pasan en el commit candidato; no quedan defectos S1/S2 abiertos; smoke sandbox queda aprobado o bloqueado con causa y responsable. Ninguna prueba lee/escribe Producción.

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
| Pago por PSE con redirección a Checkout Pro | Pro / Checkout Pro | Bricks / tarjeta | Cliente elige PSE/otros, backend crea o recupera preferencia y redirige; pago se confirma por backend/webhook |
| Pago con tarjeta integrada | Bricks | Pro / Checkout Pro | Conserva formulario integrado y procesa con su ruta actual |
| Cambio de método en la misma solicitud | Pro → Bricks y Bricks → Pro | Ambas direcciones | Rechazar nuevo intento por método alterno tras reservar el primero |
| Dos pestañas inician métodos distintos | Pro y Bricks simultáneos | Ambas direcciones | Una sola reserva atómica gana |
| Pago pendiente o incierto | Intenta método alterno | Intenta método alterno | Bloquear hasta conciliar con Mercado Pago |
| Pago rechazado/cancelado confirmado | Reintento | Reintento | Permitir solo el método originalmente elegido |

2. Ofrecer antes del primer intento: **Tarjeta en esta página (Bricks)** o **PSE y otros medios (Checkout Pro)**; mostrar solo los métodos disponibles para la cuenta/país.
3. Para Checkout Pro, crear o recuperar la preferencia en el backend y redirigir al `init_point`; nunca crear preferencia desde el navegador.
4. Reservar atómicamente el método de la solicitud. La otra opción se deshabilita y el backend rechaza inicios por método alterno, incluso desde otra pestaña.
5. Configurar `back_urls` para aprobado/pendiente/fallo y notificación del proveedor. Al regresar, verificar con backend/webhook; los parámetros de retorno no acreditan el pago.
6. Verificar que ambos métodos preservan referencia, monto COP, cotización/TRM e idempotencia.
7. Probar el retorno del navegador y webhook por separado, y consultar portal tras cada estado.
8. Registrar evidencia por caso.

**Criterio de aceptación:**

- Todos los casos tienen resultado consistente entre Mercado Pago, base local y portal.
- Ningún caso deja un cobro sin estado local.
- Un pago incierto no permite un segundo cobro ciego.
- El rollback del flag no altera intentos existentes.
- La interfaz ofrece tarjeta integrada por Bricks y PSE/otros medios mediante Checkout Pro; confirmar disponibilidad en cuenta/sandbox Mercado Pago Colombia.
- Checkout Pro usa preferencia del backend y retorno/webhook; el retorno de navegador nunca confirma pago por sí solo.
- La solicitud queda vinculada al método del primer intento reservado. El backend rechaza cualquier inicio por método alterno; ocultar/deshabilitar esa opción en UI solo mejora la experiencia.
- La reserva del método es atómica para impedir carreras entre pestañas, doble clic o solicitudes concurrentes.
- Con pago `pending`, `in_process` o `uncertain`, no se inicia otro intento hasta conciliar el existente.
- Tras rechazo/cancelación terminal confirmada, se permite reintentar únicamente con el método ya reservado. El rollback del flag no cambia el método.

**Decisión funcional:** método inmutable por solicitud desde el primer intento reservado. No se libera por tiempo; una eventual liberación administrativa requiere verificar que no existe pago aceptado/en curso y dejar auditoría.

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

**Estado al 30-oct:** el cliente ya refresca solicitudes por eventos realtime y al reconectar, sin polling periódico. El panel conserva pestaña y scroll al recibir una actualización. Los bloqueos F-P0-05a/F-P0-05b están corregidos en código; la validación integral del ciclo cola/campana/correo en Dev sigue pendiente.

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

**Estado al 28-oct-2026:** desplegado en Dev (commit `ba1280f`; Worker `4f1eb1b4-3633-4805-958c-bc439bffa354`) con migración 045 aplicada. `operationsRequestActivity.js` valida el alcance de admin, agente y experto asignado; el timeline reúne creación, asignaciones, estados, notas, pagos y respuestas. El detalle permite agregar notas y cancelar/cerrar/reabrir (reapertura solo admin). Falta smoke con usuarios reales.

**Problema original (resuelto en código local):** faltaban comentarios internos, timeline único con actor/acción/fecha y acciones manuales de estado. Falta validar el flujo en Dev.

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

**Estado al 28-oct-2026:** desplegado en Dev con migración 046 aplicada. El panel Pagos lista casos, muestra el historial y permite registrar solicitud/confirmación de reembolso, conservar el pago válido y gestionar contracargos. Las acciones son idempotentes y no editan `request_payments.status`; tampoco llaman a Mercado Pago para efectuar el reembolso. Falta smoke de las acciones en Dev.

**Problema original (resuelto en código local):** `duplicate_approved`, `refunded` y `charged_back` se mostraban sin flujo administrativo. Falta validar el seguimiento en Dev.

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

**Estado al 28-oct-2026:** desplegado en Dev con migración 047 aplicada. El cliente autenticado solicita un código al correo nuevo; tras verificarlo, el backend actualiza la identidad y solicitudes asociadas, escribe auditoría y revoca las sesiones activas. Falta comprobar entrega Resend y recuperación de acceso.

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

**Avance (28-oct-2026): parcial.** Se centralizaron recursos compartidos ES/EN y textos principales del panel operativo. E2E verifica los recorridos de solicitud pública y portal de cliente en ambos idiomas, en escritorio y móvil. Quedan textos inline en otras vistas y no se ha completado el inventario de todas las rutas, estados, modales y validaciones.

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

**Avance (30-oct-2026): parcial.** Se añadieron nombres accesibles a los controles de idioma, etiquetas/roles de navegación y carga, y comprobaciones E2E de foco por teclado y desbordamiento horizontal en los recorridos públicos principales. El detalle de solicitud ahora separa Resumen, Pago, Experto, Respuestas, Actividad e Historial; se corrigió el tamaño del radio de selección de respuesta. Falta la revisión integral de teclado, lectores de pantalla y contraste en formularios, tablas, modales y vistas operativas.

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

**Criterio de aceptación:** un cambio roto no llega a Dev; la compuerta unitaria/build pasa con 141/141 pruebas. La suite E2E corre aparte; todavía no cubre todos los flujos críticos ni es una compuerta del despliegue.

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

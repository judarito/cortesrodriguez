# QA funcional — MVP plataforma operativa

**Fecha de inicio:** 27 de octubre de 2026  
**Última actualización:** 28 de octubre de 2026
**Commit de referencia:** `ba1280f`
**Worker Dev:** `4f1eb1b4-3633-4805-958c-bc439bffa354`
**Entorno:** Dev  
**Objetivo:** registrar la ejecución de los recorridos funcionales del [plan priorizado](./PLAN-PRIORIZADO-OPERACIONES.md) y dejar evidencia reproducible.

> No usar datos personales reales, tarjetas reales ni secretos en las evidencias.

---

## 1. Preparación

| Elemento | Valor |
|---|---|
| Commit / versión | |
| Worker Dev | |
| Base de datos | Neon Dev |
| Navegador | |
| Sistema / dispositivo | |
| Correo de prueba autorizado | |
| Cuenta admin | |
| Cuenta agente | |
| Cuenta experto | |
| Cuenta cliente | |
| Fecha de ejecución | |
| Responsable | |

### Reglas

- Un caso solo cuenta como `PASS` con evidencia y resultado observado.
- Un caso `BLOCKED` no cuenta como aprobado.
- Los permisos se prueban por UI y por API directa.
- Los pagos se prueban con sandbox y sobre el commit que se está validando.
- No se pegan tokens, cookies, enlaces firmados ni datos de tarjeta.

**Publicación Dev (28-oct-2026):** commit `ba1280f`, Worker `4f1eb1b4-3633-4805-958c-bc439bffa354`; migraciones operativas 045, 046 y 047 aplicadas en Neon Dev. Comprobación HTTP básica: `/`, `/solicitud`, `/portal-cliente` y `/app` respondieron `200`. Esto confirma disponibilidad de las páginas, no sustituye los casos de aceptación funcional de este documento.

---

## 2. Matriz de recorrido principal — F-P0-01

| ID | Caso | Esperado | Resultado | Evidencia | Defecto |
|---|---|---|---|---|---|
| E2E-01 | Solicitud pública directa | Solicitud creada con referencia | | | |
| E2E-02 | Solicitud desde enlace de agente | Atribución correcta al agente | | | |
| E2E-03 | Pago aprobado | Pago confirmado y solicitud habilitada | | | |
| E2E-04 | Asignación a experto | Experto asignado y visible | | | |
| E2E-05 | Respuesta del experto | Respuesta pendiente de revisión | | | |
| E2E-06 | Aprobación administrativa | Respuesta enviada al cliente | | | |
| E2E-07 | Acceso al portal | Cliente ve su solicitud y respuesta | | | |
| E2E-08 | Feedback | Feedback asociado a la solicitud | | | |
| E2E-09 | Recorrido en inglés | Textos y correos coherentes | | | |
| E2E-10 | Recorrido en móvil | Sin bloqueos de navegación | | | |

---

## 3. Matriz de pagos — F-P0-02

| ID | Caso | Pro | Bricks | Esperado | Resultado | Evidencia |
|---|---|---|---|---|---|---|
| PAY-01 | Aprobado | | | Estado `approved`, correo y campana | | |
| PAY-02 | Rechazado | | | Estado `rejected`, portal permite reintento | | |
| PAY-03 | Pendiente | | | Estado `pending`, bloqueo de nuevo cobro | | |
| PAY-04 | Timeout / error | | | Estado incierto, mensaje de no pagar de nuevo | | |
| PAY-05 | Doble clic | | | Un solo intento externo | | |
| PAY-06 | Dos pestañas | | | Un solo intento externo | | |
| PAY-07 | Webhook repetido | | | Sin duplicar efectos | | |
| PAY-08 | Firma inválida | | | Rechazo 401 | | |
| PAY-09 | Monto alterado | | | Sin habilitar atención | | |
| PAY-10 | Moneda alterada | | | Sin habilitar atención | | |
| PAY-11 | Referencia alterada | | | Sin habilitar atención | | |
| PAY-12 | Pago duplicado | | | `duplicate_approved`, alerta | | |
| PAY-13 | Flag Bricks apagado | | | Nuevo intento Pro | | |
| PAY-14 | Rollback de flag | | | Intento histórico conserva modo | | |
| PAY-15 | Retorno manipulado | | | No confirma pago | | |

---

## 4. Matriz de roles y titularidad — F-P0-03

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| ACL-01 | Agente A consulta solicitud de B | Sin acceso | | |
| ACL-02 | Experto A consulta caso de B | Sin acceso | | |
| ACL-03 | Experto consulta caso impago | Sin acceso | | |
| ACL-04 | Experto responde caso no asignado | 403 | | |
| ACL-05 | Cliente A consulta solicitud de B | 404 | | |
| ACL-06 | Cliente A descarga adjunto de B | 404 | | |
| ACL-07 | Admin reasigna y audita | Permitido | | |
| ACL-08 | Usuario inactivo inicia sesión | Rechazado | | |
| ACL-09 | Sesión revocada usa API | 401 | | |
| ACL-10 | Permiso retirado en caliente | 403 | | |
| ACL-11 | Agente crea solicitud interna | 403 | | |
| ACL-12 | Usuario sin `payments.read` | 403 | | |
| ACL-13 | ID de pago manipulado | Sin acceso | | |
| ACL-14 | ID de notificación manipulado | Sin acceso | | |

---

## 5. Matriz del portal — F-P0-04

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| PORT-01 | Cliente con 3 solicitudes | Ve las 3 | | |
| PORT-02 | Solicitud de otro correo | No aparece | | |
| PORT-03 | Código vigente | Inicia sesión | | |
| PORT-04 | Código expirado | Rechazo | | |
| PORT-05 | Código usado | Rechazo | | |
| PORT-06 | Límite de intentos | Bloqueo controlado | | |
| PORT-07 | Sesión vigente | No pide código | | |
| PORT-08 | Sesión vencida | Pide código | | |
| PORT-09 | Detalle y adjuntos | Solo datos propios | | |
| PORT-10 | Respuesta aprobada | Visible | | |
| PORT-11 | Respuesta pendiente | No visible | | |
| PORT-12 | Nota interna | No visible | | |
| PORT-13 | Enlace desde correo | Llega al portal sin duplicar cobro | | |
| PORT-14 | ES/EN y móvil | Sin bloqueos | | |

---

## 6. Matriz de notificaciones — F-P0-05

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| NOT-01 | Solicitud creada | Evento persistido y publicado | | |
| NOT-02 | Pago aprobado | Correo y campana | | |
| NOT-03 | Respuesta aprobada | Correo al cliente | | |
| NOT-04 | Fallo de Resend | Reintento | | |
| NOT-05 | Evento a DLQ | Visible y redirigible | | |
| NOT-06 | Redrive | Procesa sin duplicar | | |
| NOT-07 | Logout | Corta realtime | | |
| NOT-08 | Usuario desactivado | Corta realtime | | |
| NOT-09 | WebSocket caído | Polling de respaldo | | |
| NOT-10 | Evento repetido | Sin duplicado | | |

---

## 6.1 Dashboard honesto — F-P0-06

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| DASH-01 | Carga inicial | Muestra “Cargando dashboard…”, no métricas ficticias | | |
| DASH-02 | API correcta | Métricas y pipeline coinciden con solicitudes | | |
| DASH-03 | API caída | Muestra error y botón “Reintentar” | | |
| DASH-04 | Sin solicitudes | Ceros y estados vacíos, sin datos de ejemplo | | |
| DASH-05 | Admin/agente/experto | Cada rol ve solo su alcance | | |

---

## 6.2 Ficha de cliente — F-P1-03

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| CLI-01 | Admin abre cliente | Ve datos, métricas y solicitudes | | |
| CLI-02 | Agente abre cliente propio | Solo ve solicitudes de su alcance | | |
| CLI-03 | Agente abre cliente ajeno | 404 “Cliente no encontrado.” | | |
| CLI-04 | Cliente sin solicitudes | Estado vacío correcto | | |
| CLI-05 | Abrir solicitud desde ficha | Cierra ficha y abre detalle | | |
| CLI-06 | Error de red | Muestra error con reintentar/cerrar | | |

---

## 7. Matriz de documentos — F-P1-01

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| DOC-01 | Subir documento | Se guarda y lista | | |
| DOC-02 | Descargar documento propio | Permitido | | |
| DOC-03 | Descargar documento ajeno | 404/403 | | |
| DOC-04 | Tipo no permitido | Rechazo | | |
| DOC-05 | Tamaño excedido | Rechazo | | |
| DOC-06 | Borrado lógico | Deja de listarse | | |
| DOC-07 | Auditoría | Registra actor y acción | | |

### 7.2 Comentarios, timeline y estados — F-P1-02

**Estado:** desplegado en Dev; migración `045_request_activity.sql` aplicada. Smoke funcional pendiente.

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| ACT-01 | Admin agrega comentario interno | Aparece en timeline con autor/fecha; no aparece en portal cliente | PENDIENTE | |
| ACT-02 | Agente abre solicitud propia | Ve las notas internas y actividad de su alcance | PENDIENTE | |
| ACT-03 | Agente/expert abre solicitud ajena/no asignada | API responde 404 sin devolver eventos ni comentarios | PENDIENTE | |
| ACT-04 | Admin cancela, cierra y reabre | Se exige motivo y se registra cada transición; reapertura solo admin | PENDIENTE | |
| ACT-05 | Reenvío con misma clave idempotente | No duplica comentario ni transición | PENDIENTE | |

### 7.3 Excepciones de pagos — F-P1-04

**Estado:** desplegado en Dev; migración `046_payment_exception_resolution.sql` aplicada. Smoke funcional pendiente. El panel registra la gestión y auditoría; el reembolso se tramita fuera de esta pantalla y el estado de Mercado Pago no se altera manualmente.

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| PAY-EX-01 | Pago duplicado | Caso visible; registrar pedido de reembolso y luego referencia de confirmación | PENDIENTE | |
| PAY-EX-02 | Reembolso confirmado por proveedor | Registrar referencia y cerrar caso sin reescribir estado de pago | PENDIENTE | |
| PAY-EX-03 | Contracargo | Reconocer, registrar disputa/cierre y conservar el historial | PENDIENTE | |
| PAY-EX-04 | Usuario que no es admin | API lista y acciones responden 403 | PENDIENTE | |
| PAY-EX-05 | Reintento idempotente | Reutilizar clave y contenido devuelve acción existente; contenido distinto devuelve 409 | PENDIENTE | |

### 7.4 Cambio verificado de correo — F-P1-05

**Estado:** desplegado en Dev; migración `047_client_email_change.sql` aplicada. Probar entrega Resend y sesiones.

| ID | Caso | Esperado | Resultado | Evidencia |
|---|---|---|---|---|
| EMAIL-01 | Cliente autenticado solicita cambio | Código llega solo al correo nuevo; límite de envíos activo | PENDIENTE | |
| EMAIL-02 | Código correcto vigente | Actualiza identidad y solicitudes asociadas, audita y revoca sesiones | PENDIENTE | |
| EMAIL-03 | Código inválido/vencido o destino ya usado | No cambia datos | PENDIENTE | |
| EMAIL-04 | Usuario sin sesión | No puede solicitar ni confirmar el cambio | PENDIENTE | |
| EMAIL-05 | Inicio de sesión tras el cambio | Cliente accede con el nuevo correo y ve su historial; sesiones viejas rechazadas | PENDIENTE | |

---

## 8. Defectos encontrados

| ID | Caso | Descripción | Severidad | Estado | Responsable |
|---|---|---|---|---|---|
| | | | | | |

### Severidades

- **S1:** bloquea el flujo o expone datos/dinero.
- **S2:** funcionalidad incorrecta con mitigación.
- **S3:** defecto visual o de copy.
- **S4:** mejora.

---

## 9. Cierre de la ejecución

| Criterio | Estado |
|---|---|
| F-P0-01 recorrido principal | |
| F-P0-02 pagos | |
| F-P0-03 roles/titularidad | |
| F-P0-04 portal | |
| F-P0-05 notificaciones | |
| F-P0-06 dashboard | |
| Defectos S1/S2 cerrados o aceptados | |
| Evidencia adjunta | |
| Aprobado por | |
| Fecha | |


## Conciliación de correos inciertos — regresión del 28-oct-2026

**Automatización local:** `node --test tests/operationsNotificationOps.test.js` (10 casos; 8 nuevos). `npm run check`: 141/141 y build correcto. API con transporte Neon simulado; sin acceso a Resend real.

**Preparación en Dev:** cuentas de prueba, sesión de administrador y efectos inciertos controlados; usar el ID UUID del mensaje efectivamente aceptado en Resend para el mismo destinatario/evento. No usar credenciales como ID, ni forzar un reenvío de un correo aceptado. Registrar commit, estado previo/posterior y evidencia sin secretos. Los casos siguientes están **PENDIENTES**, no ejecutados por las pruebas locales:

| Caso | Pasos y resultado esperado | Estado |
|---|---|---|
| Plantilla cliente ES | Abrir Excepciones; conciliar efecto `client-es-v1` con UUID confirmado y justificación; responde 200 y deja auditoría | PENDIENTE |
| Plantilla cliente EN | Repetir con `client-en-v1`; no devuelve 409 por la plantilla | PENDIENTE |
| General y experto | Repetir con `general-v1` y `expert-v1`; ambas variantes siguen funcionando | PENDIENTE |
| Interfaz ES/EN | Revisar instrucciones UUID, pegado del ID, justificación y confirmación; botón habilitado con valores válidos, bloqueado con `re_…` | PENDIENTE |
| API inválida | Enviar ID inválido/credencial ficticia directamente; 400 y ningún cambio persistido | PENDIENTE |
| Destinatarios pendientes | Conciliar un destinatario con otro sin aceptar; evento incompleto; completar el último y comprobar estado final | PENDIENTE |
| Ausencia de duplicados | Comprobar que conciliar no envía otro correo ni publica en la cola; reintento de conciliación ya resuelta devuelve 409 | PENDIENTE |
| Permisos | Sesión de experto/agente no puede conciliar por UI ni API (403) | PENDIENTE |

No confundir aceptación con apertura/lectura ni con entrega final. La resolución manual exige verificar previamente en Resend el mensaje y su destinatario.


## 11. Estrategia automatizada E2E — implementación inicial

**Estado al 28-oct-2026:** Playwright está configurado con Chromium desktop y emulación Pixel 7. `npm run test:e2e` ejecutó **10/10** casos localmente. `.github/workflows/e2e-dev.yml` ejecuta la suite para PR hacia `dev` y cambios de los archivos de aplicación/E2E en `dev`; no usa secretos. La suite actual levanta Vite y simula APIs en el navegador: no ejecuta el Worker ni una base aislada y no sustituye el smoke sandbox de Dev.

La fixture compartida `tests/e2e/fixtures.js` bloquea por defecto las solicitudes del contexto del navegador (incluidas ventanas emergentes) que no sean al origen Vite local; Playwright también bloquea service workers. La configuración no reutiliza un servidor preexistente en el puerto de pruebas.

### Perfil local/CI sin secretos

- La base actual sirve la SPA con Vite y usa `page.route` para simular las APIs necesarias; no hay Worker ni base de datos en estos E2E.
- El siguiente paso es levantar el Worker contra almacenamiento aislado y simuladores de proveedor, manteniendo las rutas reales para verificar autorización, persistencia y lógica de negocio.
- Nunca se llama a Mercado Pago, Resend ni otros servicios externos desde los specs locales.
- Cada prueba usa datos propios; evitar carreras y borrado compartido. Conservar screenshot/trace solo ante fallo y redactar PII.

### Recorridos que se automatizarán

| Orden | Flujo | Verificación principal | Estado |
|---|---|---|---|
| 1 | Cliente crea solicitud, paga simulado, entra al portal, consulta su caso y envía feedback | UI más API; solicitud y estados enlazados, sin duplicidad | Parcial: solicitud pública, retorno Pro y portal probados por separado; feedback y flujo integrado pendientes |
| 2 | Agente comparte enlace; cliente crea solicitud | atribución al agente, agente sin alta interna | Pendiente |
| 3 | Experto responde; admin revisa/aprueba; cliente consulta | experto solo asignados y sin datos personales; cliente ve solo aprobada | Parcial: UI de respuesta y aprobación probada con API simulada; faltan autorización real, persistencia y portal integrado |
| 4 | Pago rechazado, pendiente e incierto; cliente reintenta | estado verificado en API; incierto no crea segundo cargo | Parcial: aprobado y verificación incierta en UI con APIs simuladas; rechazo, pendiente, reintento y persistencia pendientes |
| 5 | IDs ajenos, sesión vencida, rol inactivo y adjunto de otro cliente | 401/403/404 correctos por API y UI, sin datos filtrados | Pendiente |
| 6 | Correo incierto/DLQ, conciliación/reintento | evento idempotente, auditoría y sin envío duplicado | Pendiente |
| 7 | ES/EN, móvil y escritorio | controles navegables y mensajes traducidos | Parcial: todos los specs pasan en escritorio/móvil; el retorno incierto prueba ES/EN; falta idioma para el resto de rutas |

### Casos ejecutados en local — 28-oct-2026

| Spec | Resultado por proyecto | Alcance real |
|---|---:|---|
| `tests/e2e/public-request.spec.js` | 2/2 | Solicitud pública, email obligatorio, teléfonos opcionales, referencia, enlace al portal y ningún pago para un servicio gratuito |
| `tests/e2e/client-portal.spec.js` | 2/2 | Solicitud de código simulado, ingreso, listado de solicitud propia y detalle con respuesta aprobada |
| `tests/e2e/payment-return.spec.js` | 4/4 | Checkout Pro preparado con respuesta simulada; retorno aprobado; pago incierto conserva referencia y recomienda no volver a pagar; cambio ES/EN |
| `tests/e2e/expert-admin-review.spec.js` | 2/2 | Experto responde y envía a revisión; administración abre el detalle y aprueba la respuesta desde la UI |
| **Total** | **10/10** | Dos perfiles: Chromium desktop y Pixel 7. No acredita la persistencia ni una llamada real a proveedores. |

La prueba del retorno encontró y permitió corregir dos defectos funcionales en `PaymentReturnApp.vue`: faltaba importar `localeTag`, lo que detenía la verificación al montar; además, el aviso de pago incierto se guardaba como texto y quedaba en el idioma anterior al cambiar ES/EN. El flujo experto/admin encontró otro error en la plantilla del detalle de solicitud: intentaba invocar `agentLabel` sobre el objeto de detalle en vez de usar la función del componente. La apertura de detalle y aprobación ahora pasan en los dos perfiles E2E.

### Smoke separado contra Dev sandbox

Se ejecuta bajo demanda y secuencialmente con cuentas sandbox aisladas: pago Pro aprobado, pago Bricks aprobado, retorno/webhook, correo/código de acceso y portal. Registrar commit, IDs de prueba redactados y estados; no incluir secretos, cookies, códigos de acceso ni datos bancarios. Para casos que requieran un correo/cargo externo se requiere entorno sandbox y operador responsable; ninguna prueba usa producción.

**Criterio para declarar E2E listo:** casos 1, 3, 4 y 5 pasan en CI local; trace disponible en fallo; smoke sandbox se informa separado. Los escenarios no ejecutados o bloqueados permanecen como tales.

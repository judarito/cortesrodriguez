# QA funcional — MVP plataforma operativa

**Fecha de inicio:** 27 de octubre de 2026  
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

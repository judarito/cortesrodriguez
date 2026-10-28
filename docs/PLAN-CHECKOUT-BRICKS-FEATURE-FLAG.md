# Plan: Checkout Bricks en paralelo con Checkout Pro

Agregar Mercado Pago Checkout Bricks como alternativa seleccionable por feature flag, conservando Checkout Pro como flujo predeterminado y fallback. El alcance inicial es Dev. La landing, la creación de solicitudes, la confirmación autoritativa por webhook y las notificaciones existentes deben seguir funcionando sin cambios de comportamiento cuando el flag esté apagado.


## Estado vigente de las correcciones

Código publicado en `dev`: `8a92fc5` (incluye `edb8e50`); Worker Dev desplegado en versión `4a225a1b-aefd-470a-ad9a-086d4574f5a3`. **120/120 pruebas locales aprobadas**, build correcto y smoke checks `/solicitud` 200 y `/api/public/features` 200 con `checkoutMode: "bricks"`. Falta validar pagos nuevos en sandbox y la presentación visual de los resultados.

| Bloque | Estado | Validación que falta |
|---|---|---|
| AUD27-01 | Implementado; probado localmente con PostgreSQL embebido | Cancelación/recuperación y concurrencia en servicios dev |
| AUD27-02 | Implementado; asociación por ID persistido y metadata con rechazo de ambigüedad | Pagos Pro sandbox nuevos/históricos y propagación de metadata |
| AUD27-03 | Implementado; cambio seguro a Pro e invalidación de Bricks nunca enviados | Rollback del flag remoto y pestañas abiertas |
| AUD27-04 | Completado en alcance local; tres fallos anteriores corregidos | Mantener suite verde; la validación externa pertenece a AUD27-06 |
| AUD27-10 | CTA «Consultar mis solicitudes» desplegado junto al resultado/error del Brick | Validar estados, ES/EN, responsive y acceso al portal/sesión/código |

**Pendiente inmediato:** ejecutar la matriz externa sobre el Worker Dev ya desplegado y verificar AUD27-10. El único pago sandbox aprobado documentado ocurrió antes de `edb8e50`; no valida las correcciones más recientes. El smoke HTTP no sustituye la validación de pagos.

**Ajustes de presentación desplegados en Dev (2026-10-27):** se quitó del resumen superior de la solicitud Bricks el bloque repetido de precio USD, TRM/fecha, total COP y explicación. La referencia permanece allí; el desglose completo y el aviso se muestran una sola vez junto al checkout. También se añadió «Consultar mis solicitudes» junto al resultado o error del Brick para aprobado, pendiente, rechazado/cancelado y error incierto. Worker Dev `4a225a1b-aefd-470a-ad9a-086d4574f5a3`; `/solicitud` respondió 200 y el endpoint de flags informó `checkoutMode: "bricks"`. Falta verificar visualmente móvil/escritorio y ES/EN, además del portal y la sesión.

El estado consolidado y los próximos pasos están en [19.14 del plan principal](./PLAN-COLAS-IDEMPOTENCIA-SEGURIDAD.md#1914-próximas-acciones-y-cierre-de-las-tareas).

## Alcance

### Incluye

- Un flag independiente para el método de checkout, desactivado por defecto y controlado en el servidor con la configuración Cloudflare ya existente.
- Checkout Bricks en la solicitud pública y en cualquier otro punto de la app que permita iniciar o reintentar un pago.
- Registro del método elegido por intento para que apagar el flag no cambie el tratamiento de pagos ya iniciados.
- Reutilizar el modelo de pagos, la idempotencia, el webhook, la conciliación y los eventos/notificaciones actuales.
- Idioma de Brick derivado de la preferencia `locale` disponible (`es`/`en`), respetando las limitaciones del idioma que Mercado Pago controla en sus propias pantallas.
- Mostrar en cada etapa el precio del servicio en USD, la TRM y fecha fijadas para el intento, el total exacto en COP y que Mercado Pago/la entidad financiera procesan el cobro en COP.
- Credenciales Dev exclusivas para Bricks: `MP_BRICKS_PUBLIC_KEY` y `MP_BRICKS_ACCESS_TOKEN`. Checkout Pro continúa usando `MP_ACCESS_TOKEN`; no se reutilizan ni se intercambian credenciales entre integraciones.
- Despliegue y validación exclusivamente en Dev.

### Fuera de alcance

- Retirar Checkout Pro, cambiar proveedor o reescribir el flujo completo de pagos.
- Cambiar precios, TRM, reglas de aprobación, asignación de expertos o políticas de correo.
- Guardar números de tarjeta, CVV u otros datos sensibles de pago en la app.
- Activar el flag o desplegar en Producción, modificar `main` o cambiar la landing fuera del punto estrictamente necesario para iniciar el pago.

## Contratos que deben acordarse antes de dividir el trabajo

1. El flag será de servidor, independiente del flag de la landing y con valor inicial `false`. La interfaz puede recibir el modo efectivo desde una respuesta pública de configuración, pero nunca decidirlo ni habilitarlo por parámetros del navegador.
2. Checkout Pro conserva su endpoint y respuesta actuales. Bricks tendrá endpoints explícitos para crear/intentar un pago; evitar cambiar silenciosamente la semántica de `/api/public/payments/preference`.
3. Cada intento persistirá `checkout_mode` (`pro` o `bricks`) junto con su referencia/idempotencia. La selección nueva solo afecta intentos nuevos.
4. El navegador nunca confirma por sí solo un pago. El estado final sigue dependiendo de consulta verificada a Mercado Pago y de la ruta común de conciliación/webhook.
5. El backend verificará solicitud, titularidad, intento, importe COP, moneda, referencia y estado antes de procesar o registrar un pago. No persistirá datos de tarjeta.
6. Cualquier agente que necesite editar un archivo asignado a otro debe acordar el cambio mediante el contrato y dejar que el integrador lo aplique.
7. El Worker solo ofrecerá Bricks si el flag está activo **y** están configuradas las dos credenciales específicas. La ausencia de credenciales deja Pro activo y Bricks inaccesible, sin fallback de token.

## Ejecución paralela

El integrador principal fija los contratos anteriores y asigna rutas/archivos antes de iniciar agentes. Cada agente trabaja en un checkout aislado o en un conjunto de archivos sin solapamiento; los resultados se integran en orden y se resuelven conflictos antes de validar.

| Agente | Trabajo independiente | Límites y entrega |
|---|---|---|
| A — Flag y configuración | Revisar `LANDING_FLAGS`/Flagship, definir el flag de checkout en Worker Dev y exponer el modo efectivo sin aceptar control del cliente. | No tocar las rutas de pago ni componentes de formulario. Entregar contrato, default cerrado y prueba de flag apagado/encendido. |
| B — API Bricks | Implementar creación/procesamiento seguro de pagos Bricks y adaptar la conciliación compartida solo mediante interfaces acordadas. | No modificar Checkout Pro ni la UI. Entregar rutas, esquema de petición/respuesta y casos idempotentes. |
| C — UI de checkout | Integrar SDK/Brick en la solicitud pública, mostrar Pro o Bricks según configuración efectiva, mantener idioma y estados accesibles. | No llamar directamente a Mercado Pago con secretos ni alterar la lógica del servidor. Mantener intacto el render del flujo Pro cuando el flag está apagado. |
| D — Persistencia y revisión de seguridad | Revisar migración mínima para `checkout_mode`, trazabilidad y compatibilidad de intentos existentes; revisar validaciones, exposición de datos e idempotencia. | No cambiar la máquina de estados de pago ni crear un segundo modelo. Coordinar el SQL con B antes de implementarlo. |
| Integrador — Portal, compatibilidad y cierre | Conectar los contratos, adaptar los puntos de reintento/portal que existan, resolver conflictos, validar y documentar el procedimiento de rollout/rollback. | No iniciar despliegue hasta que ambas rutas pasen los criterios de aceptación y el usuario habilite la prueba Dev. |

## Pasos

- [x] Inventariar y fijar los contratos exactos de endpoints, intento de pago, migración y flag; registrar archivos propietarios para evitar edición concurrente.
- [x] Asignar en paralelo los frentes A–D y exigir entregas revisables: diff, decisiones, comandos ejecutados y pendientes; no integrar cambios incompatibles automáticamente.
- [x] Implementar el flag server-side, con default apagado y una vía de rollback inmediata que no dependa de un nuevo despliegue.
- [x] Implementar API Bricks y su persistencia mínima, manteniendo Checkout Pro y sus respuestas actuales sin regresiones.
- [x] Implementar UI de Bricks en la solicitud pública y portal cliente; respetar `locale` y mostrar errores, procesamiento y confirmación pendiente.
- [x] Unificar ambos métodos en el mismo registro, conciliador y eventos existentes; conservar idempotencia ante doble clic, repetición de petición y reenvío de webhook.
- [x] Crear la aplicación sandbox Mercado Pago `CortesRodriguezBricksDev` (MCO, Checkout Bricks) y guardar sus credenciales de prueba como `MP_BRICKS_PUBLIC_KEY` y `MP_BRICKS_ACCESS_TOKEN` en Cloudflare Dev; conservar `MP_ACCESS_TOKEN` de Pro sin cambios.
- [x] Integrar, revisar permisos y datos sensibles, y ejecutar pruebas automatizadas de contrato, migración, flag e idempotencia. Hubo tres fallos en la ejecución histórica; fueron corregidos por `edb8e50`. Resultado posterior de suite completa: 119/119. La validación externa sigue pendiente.
- [x] Añadir prueba de integración local de la preferencia Checkout Pro; valida de punta a punta el payload enviado y la preferencia guardada con proveedores simulados. Suite completa actual: 120/120; pagos sandbox siguen pendientes.
- [x] Aplicar `043_checkout_bricks_attempts.sql` en Neon Dev.
- [ ] En Dev con flag apagado, completar un pago de prueba por Pro y comprobar retorno, webhook, estado, correo/notificaciones y reintento.
- [x] En Dev con flag encendido, completar un pago Bricks aprobado y verificar conciliación y notificación; conservar el desglose USD→COP durante el formulario y el resultado.
- [ ] Completar en Dev los casos Bricks rechazado, pendiente y duplicado, el pago Pro de regresión y la comprobación de intentos en curso tras apagar el flag.
- [x] Implementar y desplegar AUD27-10: mostrar «Consultar mis solicitudes» junto al resultado o error de Bricks, incluidos errores con resultado incierto.
- [ ] Validar AUD27-10 en Dev: aprobado, pendiente, rechazado/cancelado y error; ES/EN, móvil/escritorio, sesión vigente/vencida y autenticación con código. El enlace debe abrir `/portal-cliente` sin crear otra solicitud ni iniciar otro pago.
- [x] Actualizar la documentación operativa. El flag permanece habilitado en Dev según la configuración actual.

## Aceptación y rollback

- Con el flag apagado, el cliente ve y utiliza Checkout Pro como hoy; no requiere migrar ni modificar intentos históricos.
- Con el flag encendido, solicitudes nuevas usan Bricks; el servidor valida el pago y el webhook/conciliación actual determina el resultado final.
- Un pago aprobado no se revierte si falla un correo; los efectos existentes se reintentan según sus reglas idempotentes.
- Repetir la operación no duplica pagos, solicitudes, asignaciones, notificaciones ni correos.
- Los intentos `pro` en curso siguen su flujo original aunque el flag se apague; apagar el flag vuelve a Checkout Pro para nuevos intentos.
- Ante cualquier diferencia de monto, moneda, referencia, titularidad o resultado del proveedor, el sistema no marca el pago como aprobado y deja diagnóstico sin secretos.
- El retorno del navegador nunca muestra éxito como confirmación definitiva si el backend aún no verificó el pago.
- Si falla un criterio, apagar el flag en Dev y comprobar que nuevos intentos vuelven a Pro; investigar los intentos Bricks existentes con su método persistido y conciliarlos sin reenviarlos como Pro.

## Riesgos y decisiones

- Confirmar en la configuración real de Flagship/Cloudflare que el flag puede consultarse por el Worker Dev y apagarse sin despliegue; no asumir que el flag de landing sirve para este fin.
- El Brick y sus métodos disponibles, requisitos de cuenta y moneda deben verificarse con la app sandbox de Dev antes de dar por listo el flujo.
- La interfaz puede localizarse, pero las pantallas alojadas/administradas por Mercado Pago pueden usar idioma determinado por Mercado Pago; no prometer que todos los pasos del proveedor respeten el idioma de la landing.
- No ejecutar producción ni cambiar `main`; no leer, mostrar, registrar en logs ni copiar tokens de Mercado Pago.

## Estado de ejecución — 2026-10-27

- Implementación integrada; migración 043 aplicada a Neon Dev.
- App Mercado Pago sandbox `CortesRodriguezBricksDev` creada (ID `6480858097598716`); credenciales de prueba dedicadas ya instaladas en Cloudflare Dev. Nunca se reutiliza el token de Checkout Pro.
- Pruebas específicas después de asegurar fallback si faltan credenciales: 36/36 aprobadas tras añadir cobertura para las acciones de rate limit de Bricks. `npm run build` pasó. Suite completa previa: 99/102; 3 fallos en `notificationQueue.test.js` (2) y `publicRequestRateLimits.test.js` (1), fuera del flujo Bricks.
- Desplegado directamente en Worker Dev `cortes-rodriguez-asesores-dev`, versión `9b108993-dea6-4744-8f77-731d12943698`. Smoke checks: `/` 200, `/solicitud` 200 y `/api/public/features` 200 con `checkoutMode: "pro"`.
- Flag `payment_checkout_bricks_enabled` creado y habilitado en Flagship Dev. Smoke checks: `/solicitud` 200 y `/api/public/features` 200 con `checkoutMode: "bricks"`.
- La primera preparación de pago falló porque Neon Dev rechazaba `payment_bricks_intent` en `public_request_rate_limits_action_check`; no se creó intento ni hubo cobro. Migración `044_bricks_rate_limit_actions.sql` aplicada y restricción verificada. Reintento posterior respondió HTTP 200 y creó un intento Bricks `pending` para la solicitud guardada; aún no hay ID de pago ni cobro.
- Se completó un pago sandbox Bricks aprobado. La solicitud mantiene su estado de atención independiente (`pending`), el intento está `approved` y el evento `payment_approved` quedó `sent`; el estado de pago no depende del correo.
- El formulario Bricks y el portal ahora muestran precio USD, TRM/fecha, total COP y aviso de que el cobro se procesa en COP; los mismos datos guardados viajan con cada intento y permanecen visibles durante el resultado.
- Despliegue directo actualizado en Worker Dev `cortes-rodriguez-asesores-dev`, versión `c901c198-7bb0-4406-984a-0f654fdc9618`. Build correcto; smoke check `/solicitud` HTTP 200 y `/api/public/features` HTTP 200 con `checkoutMode: "bricks"`.
- Pendientes: pago Checkout Pro de regresión, y casos Bricks rechazado, pendiente, duplicado y rollback del flag. No usar tarjetas reales; no se modifica `main` ni Producción.


## Revisión posterior y condiciones pendientes de cierre — 27-oct-2026

La revisión del commit `35d1c8286cad4ce9db85a7355425694918f020a5` se consolidó en [sección 19 del plan principal](./PLAN-COLAS-IDEMPOTENCIA-SEGURIDAD.md#19-revisión-del-27-de-octubre-de-2026-y-plan-de-cierre-para-producción). Esa sección detalla evidencia, responsables por asignar, tareas, aceptación, pruebas externas y condiciones de promoción. Los checks históricos de implementación de este documento no significan que el flujo esté listo para producción.

**Resultado de la revisión:** build correcto; suite completa 104 pruebas, 101 aprobadas y 3 fallidas. Las cifras 99/102 y 36/36 anteriores describen ejecuciones previas/específicas; no sustituyen este resultado de suite completa. El pago sandbox aprobado documentado arriba no se repitió durante esta revisión.

| Referencia del plan principal | Pendiente de esta integración | Condición de cierre |
|---|---|---|
| AUD27-01 / P0 | Al procesar Bricks se valida intento/correo pero no se vuelve a comprobar solicitud cancelada/cerrada ni pago canónico antes del primer envío. | Coordinar atómicamente reserva de cobro, vigencia y cancelación. No llamar al proveedor si cancelación ganó; recuperar y conciliar si el cobro ya estaba en vuelo. |
| AUD27-02 / P0 | Pro con múltiples intentos puede quedar sin asociación al recibir un pago sin preference_id/metadata, incluso si el ID externo ya se conoce. | Resolver por vínculo persistido consistente o identificador de intento soportado; mantener ambigüedad visible sin seleccionar el más reciente a ciegas. |
| AUD27-03 / P1 | Con Bricks apagado, el portal puede bloquear un nuevo Pro después de un Bricks rechazado, porque decide por el último modo antes que por su estado terminal. | Rechazado conciliado permite nuevo Pro; pendiente/incierto conserva recuperación Bricks. Intento no enviado requiere invalidación segura antes de cambiar de método. |
| AUD27-04 / validación P0 | Dos fallas de pruebas de notificación y una de ruta de origen desactualizada. | Actualizar contratos y expectativas manteniendo privacidad/idempotencia; suite completa sin fallas y build correcto. |
| AUD27-06 / validación P0 | Faltan escenarios reales de rechazo, pendiente, incertidumbre, duplicados, regresión Pro y rollback. | Ejecutar matriz del plan principal, con correo real autorizado, recursos dev y pagos sandbox; registrar evidencia por caso. |

### Acciones pendientes complementarias

- [ ] Cerrar AUD27-01 antes de habilitar Bricks en producción; agregar pruebas de cancelación previa y concurrente, solicitud ya pagada y pestaña antigua.
- [ ] Cerrar AUD27-02 antes de promover Pro y validar separación de credenciales/métodos al asociar pagos.
- [ ] Cerrar AUD27-03 mediante backend y UI; comprobar apagar/encender flag sin modificar intentos históricos ni duplicar cobros.
- [x] Corregir las tres pruebas descritas en AUD27-04 sin eliminarlas, desactivarlas ni debilitar sus aserciones; añadir regresiones y aprobar suite completa 119/119.
- [ ] Ejecutar casos Bricks aprobado/rechazado/pendiente, doble clic, timeout/409, recarga y recuperación, y Pro aprobado/rechazado/pendiente/retorno/reintento.
- [ ] Verificar recepción/autenticación de webhooks para las aplicaciones configuradas, eventos repetidos/antiguos y reembolsos/contracargos; no guardar valores de secretos en evidencia.
- [ ] Probar separación de nota pública/interna, correos del cliente con «Consultar mis solicitudes», seguimiento desde sesión vigente/vencida y lista de varias solicitudes.
- [x] Mostrar USD/TRM/fecha/COP antes de confirmar y mantener el desglose durante el resultado, en ambos idiomas. Falta repetir la aceptación visual durante pagos de la matriz AUD27-06; el importe final de tarjeta en otra moneda puede depender de la entidad financiera.
- [x] Quitar la repetición del desglose USD/TRM/COP en el resumen superior de Bricks; conservar la referencia allí y mostrar el precio/conversión/aviso una sola vez junto al checkout. Desplegado en Dev; verificar la composición en ambos idiomas y tamaños de pantalla.
- [ ] Resolver la divergencia de acceso directo/origen según AUD27-05 sin confundir token de atribución con autorización para cobrar.
- [ ] Completar reportes/control financiero, resolución de excepciones y preparación operativa según AUD27-07/08/09 antes de declarar cerrada la entrega del alcance acordado.

**Salida/rollback:** apagar Bricks no significa que se pueda crear Pro para cualquier solicitud. Primero deben conciliarse pagos enviados o inciertos. La condición de salida es el conjunto de pruebas y correcciones del método que se habilite; producción y `main` permanecen fuera de esta actualización documental.

### Despliegue posterior a la actualización del repo (2026-10-27)

- Se sincronizó el repo local con los seis commits nuevos de `origin/dev`, hasta `be678cd`; se conservaron los cambios de Wrangler `4.154.0` localmente.
- Se desplegó esa versión del código directamente al Worker Dev `cortes-rodriguez-asesores-dev`, versión `939a11e2-1c3e-41b2-a9e2-2eac2aeff4b7`.
- `/solicitud` y `/api/public/features` respondieron HTTP 200; la respuesta del flag confirmó `checkoutMode: "bricks"`.
- No se tocó Producción ni `main`. Las pruebas externas de pago permanecen pendientes.

### AUD27-10 — Regreso visible al portal después de Bricks

El formulario público conserva un enlace secundario al portal y la vista de retorno de Pro también ofrece esa ruta. Aun así, el cliente reporta que al finalizar Bricks no encuentra cómo consultar sus solicitudes; el resultado inline de Bricks debe ofrecer una salida clara.

- [ ] Mostrar un botón visible «Consultar mis solicitudes» / “View my requests” en los resultados aprobado, pendiente/en proceso, rechazado/cancelado e incierto.
- [ ] Mantenerlo visible en español/inglés y en móvil; si el cliente no tiene sesión, abrir el portal para autenticarse mediante correo y código.
- [ ] No usar la referencia de seguimiento como autorización ni confiar en el resultado que informa el navegador sin validación backend.
- [ ] Comprobar que ir al portal no reenvía el formulario ni inicia otro pago y que el cliente puede localizar la solicitud tras autenticarse.

La prioridad y el orden del resto de tareas están consolidados en [la sección 19.15 del plan principal](./PLAN-COLAS-IDEMPOTENCIA-SEGURIDAD.md#1915-prioridad-vigente-y-nuevo-pendiente-de-navegación--27-oct-2026).

## Implementación de correcciones AUD27-01 a AUD27-04

Commit de código `edb8e50`. Se implementaron reserva atómica de envío Bricks, autorización ligada al cliente/solicitud, recuperación sin reenviar cargos inciertos, asociación de Pro por ID persistido/metadata y rollback a Pro con invalidación de intentos Bricks nunca enviados. Los enviados permanecen sujetos a conciliación. Se corrigieron las tres pruebas fallidas anteriores.

Ver [detalle y pendientes de validación en 19.13 del plan principal](./PLAN-COLAS-IDEMPOTENCIA-SEGURIDAD.md#1913-implementación-de-aud27-01-a-aud27-04). Suite local completa: **119/119**, build y revisión de whitespace correctos. Se añadió PGlite solo como dependencia de desarrollo para probar las sentencias SQL con PostgreSQL embebido; no es una nueva base ni servicio de la aplicación.

Este resultado no es evidencia de despliegue ni de pagos sandbox ejecutados con la corrección. Continúan pendientes la propagación de metadata de Pro, los casos externos de rechazo/pendiente/timeout, el rollback real del flag y la concurrencia Neon/Cloudflare. No se modificó producción ni se cambiaron secretos, migraciones o flags remotos.

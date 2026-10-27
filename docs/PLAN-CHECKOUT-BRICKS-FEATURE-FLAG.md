# Plan: Checkout Bricks en paralelo con Checkout Pro

Agregar Mercado Pago Checkout Bricks como alternativa seleccionable por feature flag, conservando Checkout Pro como flujo predeterminado y fallback. El alcance inicial es Dev. La landing, la creación de solicitudes, la confirmación autoritativa por webhook y las notificaciones existentes deben seguir funcionando sin cambios de comportamiento cuando el flag esté apagado.

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
- [x] Integrar, revisar permisos y datos sensibles, y ejecutar pruebas automatizadas de contrato, migración, flag e idempotencia. La suite completa tiene 3 fallos preexistentes en `notificationQueue.test.js` (2) y `publicRequestRateLimits.test.js` (1); las pruebas específicas de Bricks/pagos/flag/portal pasan.
- [x] Aplicar `043_checkout_bricks_attempts.sql` en Neon Dev.
- [ ] En Dev con flag apagado, completar un pago de prueba por Pro y comprobar retorno, webhook, estado, correo/notificaciones y reintento.
- [x] En Dev con flag encendido, completar un pago Bricks aprobado y verificar conciliación y notificación; conservar el desglose USD→COP durante el formulario y el resultado.
- [ ] Completar en Dev los casos Bricks rechazado, pendiente y duplicado, el pago Pro de regresión y la comprobación de intentos en curso tras apagar el flag.
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

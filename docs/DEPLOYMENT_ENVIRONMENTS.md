# Flujo de entornos

## Producción

- Rama: `main`
- Worker: `cortes-rodriguez-asesores`
- Base actual: Turso producción
- Despliegue: únicamente mediante Pull Request aprobado y mergeado a `main`

## Desarrollo

- Rama: `dev`
- Worker: `cortes-rodriguez-asesores-dev`
- Base: Turso desarrollo para la landing
- Base operativa: Neon desarrollo para la plataforma operativa
- Configuración: `wrangler.dev.jsonc`

## Protección requerida en GitHub

En `main` se debe activar:

- Require a pull request before merging.
- Require at least one approval.
- Dismiss stale approvals after new commits.
- Require status checks to pass.
- Restrict direct pushes, incluido el administrador si el equipo lo permite.

## Variables del Worker dev

Configurar como secretos independientes del entorno de producción:

```bash
npx wrangler secret put TURSO_URL --config wrangler.dev.jsonc
npx wrangler secret put TURSO_AUTH_TOKEN --config wrangler.dev.jsonc
npx wrangler secret put ADMIN_EMAIL --config wrangler.dev.jsonc
npx wrangler secret put ADMIN_PASSWORD --config wrangler.dev.jsonc
npx wrangler secret put JWT_SECRET --config wrangler.dev.jsonc
npx wrangler secret put RESEND_API_KEY --config wrangler.dev.jsonc
npx wrangler secret put NEON_DATABASE_URL --config wrangler.dev.jsonc
npx wrangler secret put MP_ACCESS_TOKEN --config wrangler.dev.jsonc
npx wrangler secret put MP_WEBHOOK_SECRET --config wrangler.dev.jsonc
npx wrangler secret put TURNSTILE_SITE_KEY --config wrangler.dev.jsonc
npx wrangler secret put TURNSTILE_SECRET_KEY --config wrangler.dev.jsonc
```

Para Turnstile en Dev, crea un widget independiente desde **Cloudflare Dashboard → Turnstile → Add widget manually**. Usa modo **Managed**, nombre `CRA formulario público - Dev` y hostname `cortes-rodriguez-asesores-dev.juan-d-ricardo-t.workers.dev` (sin `https://` ni rutas). Copia el Sitekey y el Secret key y cárgalos con los dos comandos anteriores; no los pegues en el repositorio ni en el chat. La app muestra/verifica el desafío cuando ambas variables están configuradas. Crea otro widget y claves independientes para producción cuando se vaya a habilitar allí.

La landing conserva Turso; la plataforma operativa usa Neon. Mercado Pago permanece en sandbox en dev y debe usar una app/token de producción independiente antes de publicar.

## Integración Mercado Pago en dev

- App Checkout Pro sandbox: `cortesrodriguez-dev-test`.
- Worker: `cortes-rodriguez-asesores-dev`.
- URL dev: `https://cortes-rodriguez-asesores-dev.juan-d-ricardo-t.workers.dev`.
- Preferencias: `POST /api/public/payments/preference`.
- Webhook: `POST /api/public/payments/webhook`.
- Retornos: `/solicitud?payment=success`, `/solicitud?payment=pending` y `/solicitud?payment=failure`.
- No guardar tokens en el repositorio ni documentar su valor; usar `wrangler secret`.
- `MP_WEBHOOK_SECRET` debe contener la firma secreta configurada para el webhook sandbox; no es el Access Token.

### Refuerzo del flujo de pagos (2026-10-24)

- El backend crea checkout solo si la solicitud tiene `payment_required = true`; las solicitudes sin cobro terminan sin redirección a Mercado Pago.
- Antes de salir al checkout, el cliente ve USD, TRM con fecha y total COP, y debe confirmar que desea continuar.
- Cada intento tiene una clave de idempotencia y una fila propia. Los reintentos HTTP reutilizan la misma preferencia y los intentos posteriores no chocan por referencia única.
- El webhook exige y verifica `x-signature` con HMAC-SHA256. Antes de aprobar, comprueba referencia externa, preferencia, COP y monto exacto contra el intento persistido.
- La creación de solicitudes usa una clave UUID de idempotencia; la base de datos conserva hashes de la clave y del contenido para no guardar credenciales del navegador ni duplicar solicitudes.
- Los eventos de webhook relevantes se escriben como logs estructurados sin datos del cliente, referencias, tokens ni contenido de pago.
- Los adjuntos se validan por estructura/firma y dimensiones máximas, además de MIME declarado y límites de tamaño.
- La migración `022_payment_retries_and_webhook_validation.sql` elimina la unicidad por solicitud y agrega los datos de reintento.
- La migración `023_public_request_idempotency.sql` agrega idempotencia del formulario público.
- Pendiente para cerrar este refuerzo: cargar secretos Turnstile/Mercado Pago en Cloudflare dev, aplicar migraciones 022 y 023 en Neon dev, desplegar y ejecutar pruebas sandbox; crear una automatización/alerta en Cloudflare Issues para errores del Worker y filtrar Workers Logs por eventos `payment_webhook_*` de severidad `warning`.

## Regla de notificaciones pagadas

Las solicitudes que requieren pago se crean antes de cobrar para conservar su referencia, pero no notifican a expertos en ese momento. El webhook consulta el pago en Mercado Pago y, únicamente al pasar a `approved`, registra `payment_approved` y envía la notificación. Los reintentos del webhook son seguros y los envíos manuales también quedan bloqueados mientras el pago no esté aprobado.

Despliegue dev validado el 24 de octubre de 2026:

- Versión Cloudflare: `84bf5345-6f6c-4a8f-858f-85825443bb43`.
- `npm run build` pasó correctamente.

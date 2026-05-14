# Cortes Rodriguez Asesores

Landing page Vue configurable desde un panel administrador con persistencia en Turso/libSQL y API en Cloudflare Worker.

## Configuración

1. Para desarrollo local con Wrangler, copia `.dev.vars.example` a `.dev.vars`.
2. Para scripts Node locales, copia `.env.example` a `.env`.
3. Crea o usa una base de datos Turso.
4. Obtén las credenciales:

```bash
turso db show --url <nombre-base>
turso db tokens create <nombre-base>
```

5. Completa `.dev.vars`:

```bash
TURSO_URL=libsql://tu-base.turso.io
TURSO_AUTH_TOKEN=tu-token-de-turso
ADMIN_EMAIL=admin@cortesrodriguezasesores.com
ADMIN_PASSWORD=una-clave-segura
JWT_SECRET=un-secreto-largo-para-firmar-jwt
CONTENT_CACHE_TTL_SECONDS=300
```

Para desplegar, guarda los secretos en Cloudflare:

```bash
npx wrangler secret put TURSO_URL
npx wrangler secret put TURSO_AUTH_TOKEN
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
```

Opcionalmente puedes configurar el TTL del caché como variable:

```bash
npx wrangler secret put CONTENT_CACHE_TTL_SECONDS
```

Si usas los scripts Node locales, completa `.env`:

```bash
TURSO_DATABASE_URL=libsql://tu-base.turso.io
TURSO_AUTH_TOKEN=tu-token-de-turso
ADMIN_EMAIL=admin@cortesrodriguezasesores.com
ADMIN_PASSWORD=una-clave-segura
JWT_SECRET=un-secreto-largo-para-firmar-jwt
CONTENT_CACHE_TTL_SECONDS=300
PORT=5173
```

Si no defines Turso, el servidor usa `file:local.db` para desarrollo local.

## Comandos

```bash
npm install
npm run db:migrate
npm run db:init
npm run db:seed:bilingual
npm run dev
npm run build
npm run preview
npm run deploy
```

## Rutas

- Landing: `/`
- Administrador: `/admin`
- API pública: `/api/content`
- Login admin: `POST /api/admin/login`
- API admin: `PUT /api/admin/content`

El panel admin usa login con correo y contraseña. El Worker emite un JWT firmado con `JWT_SECRET` y exige `Authorization: Bearer <token>` para guardar cambios.

## Contenido bilingüe

El contenido se guarda en un JSON con esta estructura:

```json
{
  "version": 2,
  "defaultLocale": "es",
  "locales": {
    "es": {},
    "en": {}
  }
}
```

El panel `/admin` está en español, pero permite editar los datos de la landing en español e inglés.

## Caché

`GET /api/content` se cachea en Cloudflare Worker con `caches.default`.

- Se evita consultar Turso en cada F5 mientras el caché esté vigente.
- El TTL se controla con `CONTENT_CACHE_TTL_SECONDS`, por defecto `300`.
- Cada guardado desde el admin borra el caché para que la landing lea el contenido nuevo.

En el servidor Node local de respaldo se usa el mismo TTL, pero en memoria.

Cloudflare recomienda usar `@libsql/client/web` para conectar Workers con Turso.

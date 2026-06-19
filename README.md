# Cortes Rodriguez Asesores

Sitio web Vue configurable desde un panel administrador con persistencia en Turso/libSQL y API en Cloudflare Worker.

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
CONTENT_CACHE_TTL_SECONDS=0
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
CONTENT_CACHE_TTL_SECONDS=0
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

- Sitio web: `/`
- Administrador: `/admin`
- API pública: `/api/content`
- Login admin: `POST /api/admin/login`
- API admin: `PUT /api/admin/content`

El panel admin usa login con correo y contraseña. El Worker emite un JWT firmado con `JWT_SECRET` y exige `Authorization: Bearer <token>` para guardar cambios.

## Sección Nosotros (Equipo)

La sección "Nosotros" se implementó como un carrusel interactivo y responsivo:
- **Vista de Escritorio**: Muestra hasta 2 tarjetas de miembros del equipo simultáneamente en una grilla de columnas. Si el equipo tiene 2 o menos miembros, las flechas y puntos de navegación se ocultan por CSS ya que todos los miembros están visibles.
- **Vista de Móvil**: Muestra solo 1 miembro por slide, adaptándose en una sola columna y manteniendo habilitada la navegación táctil y los controles (flechas/dots) para permitir visualizar al resto del equipo.
- **Gestión de Imágenes**: Las fotos de los miembros se suben de forma optimizada y comprimida directamente desde el panel de administración.

## Optimización de SEO

El sitio web cuenta con las siguientes mejoras y buenas prácticas implementadas para SEO:
1. **Metadatos Enriquecidos (Open Graph & Twitter Cards)**: Definidos en `index.html` para generar previsualizaciones atractivas de la marca y logo al compartir el enlace en WhatsApp, LinkedIn, Facebook, Slack y Twitter.
2. **Datos Estructurados (Schema.org)**: Incluye marcado en formato JSON-LD en `index.html` para proveer a los motores de búsqueda información semántica detallada sobre la organización, logotipo, medios de contacto e idiomas admitidos.
3. **Indexación y Mapa del Sitio**:
   - `public/robots.txt`: Controla el rastreo de buscadores, autorizando la indexación del sitio público y protegiendo el acceso a `/admin` y `/api/`.
   - `public/sitemap.xml`: Define las URLs principales con internacionalización explícita (`hreflang="es"` y `hreflang="en"`) para Google.
4. **Reactividad de Metadatos**: Un watcher en Vue en `App.vue` actualiza dinámicamente el título del navegador (`document.title`) y la meta descripción en el DOM según el idioma seleccionado de forma instantánea.

## Caché y Mecanismo Bypass

`GET /api/content` puede cachearse en Cloudflare Worker con `caches.default`.

- Para priorizar consistencia, el caché viene desactivado por defecto.
- Si decides activarlo, el TTL se controla con `CONTENT_CACHE_TTL_SECONDS`.
- Cada guardado desde el admin borra el caché para que el sitio web lea el contenido nuevo.
- **Bypass de Caché**: El backend (tanto en Cloudflare Workers como en el servidor Node.js de respaldo) soporta la interpretación de las cabeceras `cache-control: no-cache` y `pragma: no-cache`. Si se reciben estas cabeceras en el request, el backend ignora la caché por completo y devuelve los datos recién leídos desde la base de datos de Turso, garantizando consistencia inmediata tras las acciones de edición en el administrador.

En el servidor Node local de respaldo se usa el mismo criterio, pero en memoria.

## Integridad de contenido y Migración Automática

- **Normalización en Caliente**: Al levantar el sitio o consultar `/api/content`, el backend procesa el contenido almacenado con la función `normalizeContent` (en `src/contentDefaults.js`). Si detecta que faltan campos (como el nuevo equipo) o que el menú necesita expandirse a 8 elementos para separar Testimonios, inicializa los valores faltantes de manera segura sin destruir la información personalizada del cliente y los guarda de vuelta en la base de datos.
- **Control de Concurrencia**: El guardado del contenido usa control de concurrencia optimista: si otra sesión publicó cambios antes, el guardado se rechaza con conflicto para evitar sobrescrituras silenciosas.
- **Auditoría**: Cada cambio exitoso se registra en `content_change_audit` con actor, fecha, revisión anterior y nueva.
- **Semillero Seguro**: Los scripts `npm run db:init` y `npm run db:seed:bilingual` ya no sobrescriben contenido existente a menos que se usen con `--force`.

Cloudflare recomienda usar `@libsql/client/web` para conectar Workers con Turso.

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

El panel `/admin` está en español, pero permite editar los datos del sitio web en español e inglés.

## Caché

`GET /api/content` puede cachearse en Cloudflare Worker con `caches.default`.

- Para priorizar consistencia, el caché viene desactivado por defecto.
- Si decides activarlo, el TTL se controla con `CONTENT_CACHE_TTL_SECONDS`.
- Cada guardado desde el admin borra el caché para que el sitio web lea el contenido nuevo.

En el servidor Node local de respaldo se usa el mismo criterio, pero en memoria.

## Integridad de contenido

- El guardado del contenido usa control de concurrencia optimista: si otra sesión publicó cambios antes, el guardado se rechaza con conflicto para evitar sobrescrituras silenciosas.
- Cada cambio exitoso se registra en `content_change_audit` con actor, fecha, revisión anterior y nueva.
- Los scripts `npm run db:init` y `npm run db:seed:bilingual` ya no sobrescriben contenido existente a menos que se usen con `--force`.

Cloudflare recomienda usar `@libsql/client/web` para conectar Workers con Turso.

# Contexto de la app

## Resumen

`cortes-rodriguez-asesores` es una SPA en Vue 3 con Vite. El frontend público, el login y el panel administrativo viven principalmente en `src/App.vue`.

La app tiene dos implementaciones de backend con la misma API:

- `server.js`: entorno local con Node + Express.
- `worker/index.js`: despliegue en Cloudflare Workers.

Ambos usan libSQL/Turso para persistencia y comparten la misma estructura funcional.

## Frontend

- Stack: Vue 3, Vite, `lucide-vue-next`.
- Entrada: `src/main.js`.
- Componente principal: `src/App.vue`.
- Estilos globales: `src/styles.css`.
- Contenido editable por defecto: `src/contentDefaults.js`.
- Cliente API del frontend: `src/lib/contentApi.js`.

### Rutas resueltas en frontend

- `/`: sitio público.
- `/login`: acceso administrativo.
- `/admin`: panel administrativo.

No se usa `vue-router`; la vista se decide con `window.location.pathname`.

## Persistencia

Tablas actuales:

- `site_content`: JSON del contenido editable del sitio.
- `contact_leads`: solicitudes de cotización enviadas desde el sitio.
- `testimonial_submissions`: testimonios enviados por usuarios y pendientes de revisión.

Migraciones:

- `migrations/001_create_site_content.sql`
- `migrations/002_create_contact_leads.sql`
- `migrations/003_create_testimonial_submissions.sql`

En local puede usarse `file:local.db`. En producción se espera Turso/libSQL.

## API principal

### Pública

- `GET /api/content`: entrega el contenido del sitio y los testimonios aprobados.
- `POST /api/quote-requests`: guarda una solicitud de cotización y notifica por correo.
- `POST /api/testimonials`: guarda un testimonio en estado `pending` y notifica por correo.

### Administrativa

- `POST /api/admin/login`
- `PUT /api/admin/content`
- `POST /api/admin/images`
- `GET /api/admin/leads`
- `GET /api/admin/leads/:id`
- `GET /api/admin/testimonials`
- `GET /api/admin/testimonials/:id`
- `PUT /api/admin/testimonials/:id/review`

## Flujo de contenido

El contenido principal del sitio se edita desde `/admin` y se guarda como JSON en `site_content`.

El endpoint `GET /api/content` no solo devuelve ese JSON normalizado:

- también adjunta `approvedTestimonials`
- estos testimonios aprobados salen de `testimonial_submissions`
- no se mezclan dentro del JSON del CMS

Esto permite separar:

- contenido editorial manual
- testimonios enviados por usuarios y revisados por admin

## Sección “Nuestra fundación”

La antigua sección de clientes se reutilizó como carrusel de fundación.

Sigue usando la clave `clients` en el contenido para minimizar cambios internos, pero ahora cada elemento tiene forma:

```json
{
  "name": "Título",
  "image": "/images/archivo.webp",
  "alt": "Texto alternativo",
  "text": "Descripción breve"
}
```

## Flujo de testimonios

### Sitio público

La sección de testimonios ahora tiene:

- carrusel de testimonios visibles
- formulario público para enviar nuevos testimonios

Campos recolectados:

- nombre
- cargo o relación
- empresa u organización
- correo
- teléfono
- testimonio
- idioma

### Moderación

Todo testimonio nuevo entra como:

- `review_status = pending`

Desde el admin se puede:

- aprobar (`approved`)
- rechazar (`rejected`)
- guardar notas internas de revisión

Si se aprueba:

- queda disponible en `GET /api/content`
- se muestra en el sitio público junto a los testimonios editoriales

## Correo

Se usa Resend para notificaciones.

Variables esperadas:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Correos actuales:

- solicitud de cotización
- testimonio pendiente de revisión

Ambos se envían al correo de contacto configurado en el contenido del sitio para el idioma correspondiente.

## Imágenes

Las imágenes se optimizan en cliente antes de subirlas:

- formato: `webp`
- tamaño máximo optimizado: `480 KB`

Destino:

- local: carpeta `local-r2/images`
- producción: bucket R2 `GALLERY_IMAGES`

## Despliegue

- build frontend: `npm run build`
- local Node: `npm run dev:node`
- local Worker: `npm run dev`
- deploy Cloudflare: `npm run deploy`

## Observaciones técnicas

- `src/App.vue` concentra mucha lógica y sería buen candidato a modularización.
- `server.js` y `worker/index.js` mantienen lógica muy similar y podrían extraerse helpers compartidos a futuro.
- La clave `clients` ahora representa la sección de fundación por compatibilidad con el modelo actual.

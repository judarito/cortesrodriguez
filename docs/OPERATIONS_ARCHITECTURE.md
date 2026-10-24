# Plataforma operativa

La plataforma operativa vive en el mismo repositorio y despliegue que la landing, pero mantiene separados su frontend, API, dominio y base de datos.

## Frontend

- `src/landing/`: sitio público y administración editorial existente.
- `src/operations/`: panel interno para clientes, operaciones, documentos, tareas y reportes.
- `src/shared/`: componentes, autenticación, cliente API y utilidades compartidas.
- `src/shared/components/ListView.vue`: componente común de listados con encabezado, barra de herramientas, tabla, paginación y estados de carga/vacío. Su contenedor visual debe ser autocontenido (no depender de estilos scoped del padre); en móvil presenta filas como tarjetas para evitar scroll horizontal.

## Backend

- `worker/routes/`: endpoints agrupados por dominio.
- `worker/db/`: conexión PostgreSQL/Neon, consultas y migraciones.
- `worker/db/migrations/`: cambios versionados del esquema operativo.

## Rutas previstas

- `/`: landing pública.
- `/admin`: administración del contenido público.
- `/app`: plataforma operativa autenticada.
- `/api/app/*`: API de la plataforma operativa.

## Base de datos

La operación usará PostgreSQL en Neon. Se recomienda separar las tablas editoriales existentes de las tablas operativas mediante el esquema `operations`.

```text
public.site_content
public.contact_leads
public.testimonial_submissions

operations.users
operations.companies
operations.contacts
operations.operations
operations.documents
operations.tasks
operations.activity_log
```

Esta estructura es inicial y no cambia todavía la aplicación en producción.

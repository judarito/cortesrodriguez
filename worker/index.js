import { createClient } from '@libsql/client/web'
import { defaultContent, normalizeContent } from '../src/contentDefaults.js'

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
}

const contentCachePath = '/api/content-cache/landing'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) })
    }

    try {
      if (url.pathname === '/api/content' && request.method === 'GET') {
        return getCachedLandingContent(request, env)
      }

      if (url.pathname === '/api/admin/login' && request.method === 'POST') {
        if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.JWT_SECRET) {
          throw new Error('Faltan ADMIN_EMAIL, ADMIN_PASSWORD o JWT_SECRET.')
        }

        const { email, password } = await request.json()

        if (email !== env.ADMIN_EMAIL || password !== env.ADMIN_PASSWORD) {
          return json({ error: 'Credenciales inválidas.' }, request, 401)
        }

        return json({ token: await signJwt(env, { sub: email, role: 'admin' }) }, request)
      }

      if (url.pathname === '/api/admin/content' && request.method === 'PUT') {
        await requireJwt(request, env)

        await ensureSchema(env)
        const body = normalizeContent(await request.json())
        await saveLandingContent(env, body)
        await invalidateLandingContentCache(request, env)
        return json({ ok: true, cacheInvalidated: true }, request, 200, {
          'x-content-cache-invalidated': 'true',
        })
      }

      if (url.pathname === '/api/quote-requests' && request.method === 'POST') {
        await ensureSchema(env)
        return submitQuoteRequest(request, env)
      }

      if (url.pathname === '/api/testimonials' && request.method === 'POST') {
        await ensureSchema(env)
        return submitTestimonial(request, env)
      }

      if (url.pathname === '/api/admin/leads' && request.method === 'GET') {
        await requireJwt(request, env)
        await ensureSchema(env)
        return getAdminLeads(request, env)
      }

      if (url.pathname.startsWith('/api/admin/leads/') && request.method === 'GET') {
        await requireJwt(request, env)
        await ensureSchema(env)
        return getAdminLeadDetail(request, env)
      }

      if (url.pathname === '/api/admin/testimonials' && request.method === 'GET') {
        await requireJwt(request, env)
        await ensureSchema(env)
        return getAdminTestimonials(request, env)
      }

      if (url.pathname.startsWith('/api/admin/testimonials/') && url.pathname.endsWith('/review') && request.method === 'PUT') {
        await requireJwt(request, env)
        await ensureSchema(env)
        return reviewAdminTestimonial(request, env)
      }

      if (url.pathname.startsWith('/api/admin/testimonials/') && request.method === 'GET') {
        await requireJwt(request, env)
        await ensureSchema(env)
        return getAdminTestimonialDetail(request, env)
      }

      if (url.pathname === '/api/admin/images' && request.method === 'POST') {
        await requireJwt(request, env)
        return uploadImage(request, env)
      }

      if (url.pathname.startsWith('/images/') && request.method === 'GET') {
        return getImage(request, env)
      }

      return env.ASSETS.fetch(request)
    } catch (error) {
      console.error(error)
      return json({ error: error.message || 'Error interno.' }, request, error.status || 500)
    }
  },
}

async function getCachedLandingContent(request, env) {
  const cache = caches.default
  const cacheRequest = getContentCacheRequest(request)
  const cachedResponse = await cache.match(cacheRequest)

  if (cachedResponse) {
    return withCors(cachedResponse, request, 'HIT')
  }

  await ensureSchema(env)
  const content = await getLandingContent(env)
  const response = json({
    ...content,
    approvedTestimonials: await getApprovedTestimonials(env),
  }, request, 200, {
    'cache-control': `public, max-age=${getContentCacheTtl(env)}`,
    'x-content-cache': 'MISS',
  })

  await cache.put(cacheRequest, response.clone())
  return response
}

async function invalidateLandingContentCache(request) {
  await caches.default.delete(getContentCacheRequest(request))
}

function getContentCacheRequest(request) {
  const url = new URL(request.url)
  url.pathname = contentCachePath
  url.search = ''
  return new Request(url.toString(), { method: 'GET' })
}

function getContentCacheTtl(env) {
  const ttl = Number(env.CONTENT_CACHE_TTL_SECONDS || 300)
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 300
}

function getClient(env) {
  const url = env.TURSO_URL || env.TURSO_DATABASE_URL
  const authToken = env.TURSO_AUTH_TOKEN

  if (!url || !authToken) {
    throw new Error('Faltan TURSO_URL/TURSO_DATABASE_URL o TURSO_AUTH_TOKEN.')
  }

  return createClient({ url, authToken })
}

async function ensureSchema(env) {
  const client = getClient(env)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS contact_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      locale TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      email_status TEXT NOT NULL DEFAULT 'pending',
      email_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS testimonial_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      locale TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending',
      review_notes TEXT,
      published_at TEXT,
      email_status TEXT NOT NULL DEFAULT 'pending',
      email_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function getLandingContent(env) {
  const result = await getClient(env).execute({
    sql: 'SELECT value FROM site_content WHERE key = ?',
    args: ['landing'],
  })

  if (!result.rows.length) {
    await saveLandingContent(env, defaultContent)
    return defaultContent
  }

  const storedContent = JSON.parse(String(result.rows[0].value))
  const content = normalizeContent(storedContent)
  if (content.version !== storedContent.version) {
    await saveLandingContent(env, content)
  }
  return content
}

async function saveLandingContent(env, content) {
  await getClient(env).execute({
    sql: `
      INSERT INTO site_content (key, value, updated_at)
      VALUES ('landing', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [JSON.stringify(content)],
  })
}

async function getApprovedTestimonials(env) {
  const result = await getClient(env).execute({
    sql: `
      SELECT id, locale, full_name, role, company, message, published_at, created_at
      FROM testimonial_submissions
      WHERE review_status = 'approved'
      ORDER BY datetime(COALESCE(published_at, created_at)) DESC, id DESC
    `,
  })

  return result.rows.reduce((accumulator, row) => {
    const locale = String(row.locale) === 'en' ? 'en' : 'es'
    accumulator[locale].push(serializeApprovedTestimonial(row))
    return accumulator
  }, { es: [], en: [] })
}

async function submitQuoteRequest(request, env) {
  const input = validateLeadPayload(await request.json())
  const content = await getLandingContent(env)
  const localeContent = content.locales?.[input.locale] || content.locales?.[content.defaultLocale] || content.locales?.es || defaultContent.locales.es
  const recipientEmail = localeContent.contact?.email || defaultContent.locales.es.contact.email

  const insertResult = await getClient(env).execute({
    sql: `
      INSERT INTO contact_leads (
        locale,
        full_name,
        email,
        phone,
        message,
        recipient_email,
        email_status,
        email_error
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)
    `,
    args: [input.locale, input.fullName, input.email, input.phone, input.message, recipientEmail],
  })

  const leadId = Number(insertResult.lastInsertRowid)

  try {
    await sendLeadEmail(env, {
      id: leadId,
      locale: input.locale,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      message: input.message,
      recipientEmail,
      createdAt: new Date().toISOString(),
    })

    await updateLeadEmailStatus(env, leadId, 'sent', null)
    return json({ ok: true, leadId, emailSent: true }, request, 201)
  } catch (error) {
    await updateLeadEmailStatus(env, leadId, 'failed', error.message || 'No se pudo enviar el correo.')
    return json({
      ok: true,
      leadId,
      emailSent: false,
      warning: input.locale === 'en'
        ? 'Your request was saved, but the email notification could not be sent.'
        : 'Tu solicitud fue guardada, pero no se pudo enviar la notificación por correo.',
    }, request, 201)
  }
}

async function submitTestimonial(request, env) {
  const input = validateTestimonialPayload(await request.json())
  const content = await getLandingContent(env)
  const localeContent = content.locales?.[input.locale] || content.locales?.[content.defaultLocale] || content.locales?.es || defaultContent.locales.es
  const recipientEmail = localeContent.contact?.email || defaultContent.locales.es.contact.email

  const insertResult = await getClient(env).execute({
    sql: `
      INSERT INTO testimonial_submissions (
        locale,
        full_name,
        role,
        company,
        email,
        phone,
        message,
        recipient_email,
        review_status,
        review_notes,
        published_at,
        email_status,
        email_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 'pending', NULL)
    `,
    args: [input.locale, input.fullName, input.role, input.company, input.email, input.phone, input.message, recipientEmail],
  })

  const testimonialId = Number(insertResult.lastInsertRowid)

  try {
    await sendTestimonialEmail(env, {
      id: testimonialId,
      locale: input.locale,
      fullName: input.fullName,
      role: input.role,
      company: input.company,
      email: input.email,
      phone: input.phone,
      message: input.message,
      recipientEmail,
      createdAt: new Date().toISOString(),
      reviewStatus: 'pending',
    })

    await updateTestimonialEmailStatus(env, testimonialId, 'sent', null)
    return json({ ok: true, testimonialId, emailSent: true }, request, 201)
  } catch (error) {
    await updateTestimonialEmailStatus(env, testimonialId, 'failed', error.message || 'No se pudo enviar el correo.')
    return json({
      ok: true,
      testimonialId,
      emailSent: false,
      warning: input.locale === 'en'
        ? 'Your testimonial was saved, but the email notification could not be sent.'
        : 'Tu testimonio fue guardado, pero no se pudo enviar la notificación por correo.',
    }, request, 201)
  }
}

async function getAdminLeads(request, env) {
  const url = new URL(request.url)
  const page = clampPositiveInteger(url.searchParams.get('page'), 1)
  const pageSize = clampPositiveInteger(url.searchParams.get('pageSize'), 10, 50)
  const offset = (page - 1) * pageSize
  const client = getClient(env)

  const [countResult, leadsResult] = await Promise.all([
    client.execute('SELECT COUNT(*) AS total FROM contact_leads'),
    client.execute({
      sql: `
        SELECT id, locale, full_name, email, phone, recipient_email, email_status, created_at, message
        FROM contact_leads
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      args: [pageSize, offset],
    }),
  ])

  const total = toNumber(countResult.rows[0]?.total)
  return json({
    items: leadsResult.rows.map((row) => serializeLeadSummary(row)),
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  }, request)
}

async function getAdminLeadDetail(request, env) {
  const url = new URL(request.url)
  const leadId = Number(url.pathname.split('/').pop())
  if (!Number.isInteger(leadId) || leadId <= 0) throw new HttpError('Solicitud inválida.', 400)

  const result = await getClient(env).execute({
    sql: `
      SELECT id, locale, full_name, email, phone, message, recipient_email, email_status, email_error, created_at
      FROM contact_leads
      WHERE id = ?
      LIMIT 1
    `,
    args: [leadId],
  })

  if (!result.rows.length) throw new HttpError('Solicitud no encontrada.', 404)
  return json({ item: serializeLeadDetail(result.rows[0]) }, request)
}

async function getAdminTestimonials(request, env) {
  const url = new URL(request.url)
  const page = clampPositiveInteger(url.searchParams.get('page'), 1)
  const pageSize = clampPositiveInteger(url.searchParams.get('pageSize'), 10, 50)
  const offset = (page - 1) * pageSize
  const client = getClient(env)

  const [countResult, testimonialsResult] = await Promise.all([
    client.execute('SELECT COUNT(*) AS total FROM testimonial_submissions'),
    client.execute({
      sql: `
        SELECT id, locale, full_name, role, company, email, phone, recipient_email, review_status, email_status, created_at, message
        FROM testimonial_submissions
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      args: [pageSize, offset],
    }),
  ])

  const total = toNumber(countResult.rows[0]?.total)
  return json({
    items: testimonialsResult.rows.map((row) => serializeTestimonialSummary(row)),
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  }, request)
}

async function getAdminTestimonialDetail(request, env) {
  const url = new URL(request.url)
  const testimonialId = Number(url.pathname.split('/').pop())
  if (!Number.isInteger(testimonialId) || testimonialId <= 0) throw new HttpError('Testimonio inválido.', 400)

  const result = await getClient(env).execute({
    sql: `
      SELECT id, locale, full_name, role, company, email, phone, message, recipient_email, review_status, review_notes, published_at, email_status, email_error, created_at
      FROM testimonial_submissions
      WHERE id = ?
      LIMIT 1
    `,
    args: [testimonialId],
  })

  if (!result.rows.length) throw new HttpError('Testimonio no encontrado.', 404)
  return json({ item: serializeTestimonialDetail(result.rows[0]) }, request)
}

async function reviewAdminTestimonial(request, env) {
  const url = new URL(request.url)
  const testimonialId = Number(url.pathname.split('/').slice(-2, -1)[0])
  if (!Number.isInteger(testimonialId) || testimonialId <= 0) throw new HttpError('Testimonio inválido.', 400)

  const body = await request.json()
  const reviewStatus = body?.reviewStatus === 'approved' ? 'approved' : body?.reviewStatus === 'rejected' ? 'rejected' : ''
  if (!reviewStatus) throw new HttpError('Estado de revisión inválido.', 400)

  const reviewNotes = normalizeText(body?.reviewNotes)
  const publishedAt = reviewStatus === 'approved' ? new Date().toISOString() : null

  await getClient(env).execute({
    sql: `
      UPDATE testimonial_submissions
      SET review_status = ?, review_notes = ?, published_at = ?
      WHERE id = ?
    `,
    args: [reviewStatus, reviewNotes || null, publishedAt, testimonialId],
  })

  const result = await getClient(env).execute({
    sql: `
      SELECT id, locale, full_name, role, company, email, phone, message, recipient_email, review_status, review_notes, published_at, email_status, email_error, created_at
      FROM testimonial_submissions
      WHERE id = ?
      LIMIT 1
    `,
    args: [testimonialId],
  })

  if (!result.rows.length) throw new HttpError('Testimonio no encontrado.', 404)
  return json({ ok: true, item: serializeTestimonialDetail(result.rows[0]) }, request)
}

function validateLeadPayload(payload) {
  const locale = payload?.locale === 'en' ? 'en' : 'es'
  const fullName = normalizeText(payload?.fullName)
  const email = normalizeText(payload?.email).toLowerCase()
  const phone = normalizeText(payload?.phone)
  const message = normalizeText(payload?.message)

  if (!fullName) throw new HttpError(locale === 'en' ? 'Name is required.' : 'El nombre es obligatorio.', 400)
  if (!isValidEmail(email)) throw new HttpError(locale === 'en' ? 'Enter a valid email.' : 'Ingresa un correo válido.', 400)
  if (!phone) throw new HttpError(locale === 'en' ? 'Phone is required.' : 'El teléfono es obligatorio.', 400)
  if (!message) throw new HttpError(locale === 'en' ? 'Message is required.' : 'El mensaje es obligatorio.', 400)

  return { locale, fullName, email, phone, message }
}

function validateTestimonialPayload(payload) {
  const locale = payload?.locale === 'en' ? 'en' : 'es'
  const fullName = normalizeText(payload?.fullName)
  const role = normalizeText(payload?.role)
  const company = normalizeText(payload?.company)
  const email = normalizeText(payload?.email).toLowerCase()
  const phone = normalizeText(payload?.phone)
  const message = normalizeText(payload?.message)

  if (!fullName) throw new HttpError(locale === 'en' ? 'Name is required.' : 'El nombre es obligatorio.', 400)
  if (!role) throw new HttpError(locale === 'en' ? 'Role is required.' : 'El cargo es obligatorio.', 400)
  if (!isValidEmail(email)) throw new HttpError(locale === 'en' ? 'Enter a valid email.' : 'Ingresa un correo válido.', 400)
  if (!message) throw new HttpError(locale === 'en' ? 'Testimonial is required.' : 'El testimonio es obligatorio.', 400)

  return { locale, fullName, role, company, email, phone, message }
}

async function sendLeadEmail(env, lead) {
  if (!env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY.')
  if (!env.RESEND_FROM_EMAIL) throw new Error('Falta RESEND_FROM_EMAIL.')

  const subject = lead.locale === 'en'
    ? `New quote request from ${lead.fullName}`
    : `Nueva solicitud de cotización de ${lead.fullName}`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [lead.recipientEmail],
      reply_to: lead.email,
      subject,
      text: formatLeadEmailText(lead),
      html: formatLeadEmailHtml(lead),
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.message || 'Resend no aceptó el envío.')
  }
}

async function sendTestimonialEmail(env, testimonial) {
  if (!env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY.')
  if (!env.RESEND_FROM_EMAIL) throw new Error('Falta RESEND_FROM_EMAIL.')

  const subject = testimonial.locale === 'en'
    ? `New testimonial pending review from ${testimonial.fullName}`
    : `Nuevo testimonio pendiente de revisión de ${testimonial.fullName}`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [testimonial.recipientEmail],
      reply_to: testimonial.email,
      subject,
      text: formatTestimonialEmailText(testimonial),
      html: formatTestimonialEmailHtml(testimonial),
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.message || 'Resend no aceptó el envío.')
  }
}

function formatLeadEmailText(lead) {
  const labels = lead.locale === 'en'
    ? {
        title: 'New quote request',
        name: 'Name',
        email: 'Email',
        phone: 'Phone',
        message: 'Message',
        locale: 'Language',
        createdAt: 'Created at',
      }
    : {
        title: 'Nueva solicitud de cotización',
        name: 'Nombre',
        email: 'Correo',
        phone: 'Teléfono',
        message: 'Mensaje',
        locale: 'Idioma',
        createdAt: 'Fecha',
      }

  return [
    labels.title,
    `${labels.name}: ${lead.fullName}`,
    `${labels.email}: ${lead.email}`,
    `${labels.phone}: ${lead.phone}`,
    `${labels.locale}: ${lead.locale.toUpperCase()}`,
    `${labels.createdAt}: ${lead.createdAt}`,
    '',
    `${labels.message}:`,
    lead.message,
  ].join('\n')
}

function formatLeadEmailHtml(lead) {
  const labels = lead.locale === 'en'
    ? {
        title: 'New quote request',
        name: 'Name',
        email: 'Email',
        phone: 'Phone',
        message: 'Message',
        locale: 'Language',
        createdAt: 'Created at',
      }
    : {
        title: 'Nueva solicitud de cotización',
        name: 'Nombre',
        email: 'Correo',
        phone: 'Teléfono',
        message: 'Mensaje',
        locale: 'Idioma',
        createdAt: 'Fecha',
      }

  return `
    <div style="margin:0;padding:32px 16px;background:#f4f7fb;font-family:Arial,sans-serif;color:#102544;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden;box-shadow:0 18px 48px rgba(16,37,68,0.08);">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#0a2a57,#123d79);color:#ffffff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:0.82;">Cortes Rodriguez Asesores</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">${escapeHtml(labels.title)}</h1>
        </div>
        <div style="padding:28px 32px;">
          <div style="display:grid;gap:14px;">
            ${renderEmailRow(labels.name, lead.fullName)}
            ${renderEmailRow(labels.email, lead.email)}
            ${renderEmailRow(labels.phone, lead.phone)}
            ${renderEmailRow(labels.locale, lead.locale.toUpperCase())}
            ${renderEmailRow(labels.createdAt, lead.createdAt)}
          </div>
          <div style="margin-top:24px;padding:20px 22px;background:#f7f9fc;border:1px solid #e3eaf3;border-radius:14px;">
            <div style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#5b6d85;">${escapeHtml(labels.message)}</div>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#102544;">${escapeHtml(lead.message).replace(/\n/g, '<br />')}</p>
          </div>
        </div>
      </div>
    </div>
  `
}

function formatTestimonialEmailText(testimonial) {
  const labels = testimonial.locale === 'en'
    ? {
        title: 'New testimonial pending review',
        name: 'Name',
        role: 'Role',
        company: 'Company',
        email: 'Email',
        phone: 'Phone',
        testimonial: 'Testimonial',
        locale: 'Language',
        createdAt: 'Created at',
      }
    : {
        title: 'Nuevo testimonio pendiente de revisión',
        name: 'Nombre',
        role: 'Cargo',
        company: 'Empresa',
        email: 'Correo',
        phone: 'Teléfono',
        testimonial: 'Testimonio',
        locale: 'Idioma',
        createdAt: 'Fecha',
      }

  return [
    labels.title,
    `${labels.name}: ${testimonial.fullName}`,
    `${labels.role}: ${testimonial.role}`,
    `${labels.company}: ${testimonial.company || '-'}`,
    `${labels.email}: ${testimonial.email}`,
    `${labels.phone}: ${testimonial.phone || '-'}`,
    `${labels.locale}: ${testimonial.locale.toUpperCase()}`,
    `${labels.createdAt}: ${testimonial.createdAt}`,
    '',
    `${labels.testimonial}:`,
    testimonial.message,
  ].join('\n')
}

function formatTestimonialEmailHtml(testimonial) {
  const labels = testimonial.locale === 'en'
    ? {
        title: 'New testimonial pending review',
        name: 'Name',
        role: 'Role',
        company: 'Company',
        email: 'Email',
        phone: 'Phone',
        testimonial: 'Testimonial',
        locale: 'Language',
        createdAt: 'Created at',
      }
    : {
        title: 'Nuevo testimonio pendiente de revisión',
        name: 'Nombre',
        role: 'Cargo',
        company: 'Empresa',
        email: 'Correo',
        phone: 'Teléfono',
        testimonial: 'Testimonio',
        locale: 'Idioma',
        createdAt: 'Fecha',
      }

  return `
    <div style="margin:0;padding:32px 16px;background:#f4f7fb;font-family:Arial,sans-serif;color:#102544;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden;box-shadow:0 18px 48px rgba(16,37,68,0.08);">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#7a1217,#ed1c24);color:#ffffff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:0.82;">Cortes Rodriguez Asesores</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">${escapeHtml(labels.title)}</h1>
        </div>
        <div style="padding:28px 32px;">
          <div style="display:grid;gap:14px;">
            ${renderEmailRow(labels.name, testimonial.fullName)}
            ${renderEmailRow(labels.role, testimonial.role)}
            ${renderEmailRow(labels.company, testimonial.company || '-')}
            ${renderEmailRow(labels.email, testimonial.email)}
            ${renderEmailRow(labels.phone, testimonial.phone || '-')}
            ${renderEmailRow(labels.locale, testimonial.locale.toUpperCase())}
            ${renderEmailRow(labels.createdAt, testimonial.createdAt)}
          </div>
          <div style="margin-top:24px;padding:20px 22px;background:#fff6f6;border:1px solid #f2d8da;border-radius:14px;">
            <div style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8c4a50;">${escapeHtml(labels.testimonial)}</div>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#102544;">${escapeHtml(testimonial.message).replace(/\n/g, '<br />')}</p>
          </div>
        </div>
      </div>
    </div>
  `
}

function renderEmailRow(label, value) {
  return `
    <div style="display:grid;gap:4px;padding-bottom:14px;border-bottom:1px solid #edf2f7;">
      <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6a7b91;">${escapeHtml(label)}</div>
      <div style="font-size:16px;line-height:1.5;color:#102544;">${escapeHtml(value)}</div>
    </div>
  `
}

async function updateLeadEmailStatus(env, leadId, status, errorMessage) {
  await getClient(env).execute({
    sql: 'UPDATE contact_leads SET email_status = ?, email_error = ? WHERE id = ?',
    args: [status, errorMessage, leadId],
  })
}

async function updateTestimonialEmailStatus(env, testimonialId, status, errorMessage) {
  await getClient(env).execute({
    sql: 'UPDATE testimonial_submissions SET email_status = ?, email_error = ? WHERE id = ?',
    args: [status, errorMessage, testimonialId],
  })
}

function serializeLeadSummary(row) {
  return {
    id: toNumber(row.id),
    locale: String(row.locale),
    fullName: String(row.full_name),
    email: String(row.email),
    phone: String(row.phone),
    recipientEmail: String(row.recipient_email),
    emailStatus: String(row.email_status),
    createdAt: String(row.created_at),
    messagePreview: truncateText(String(row.message), 140),
  }
}

function serializeLeadDetail(row) {
  return {
    id: toNumber(row.id),
    locale: String(row.locale),
    fullName: String(row.full_name),
    email: String(row.email),
    phone: String(row.phone),
    message: String(row.message),
    recipientEmail: String(row.recipient_email),
    emailStatus: String(row.email_status),
    emailError: row.email_error ? String(row.email_error) : '',
    createdAt: String(row.created_at),
  }
}

function serializeTestimonialSummary(row) {
  return {
    id: toNumber(row.id),
    locale: String(row.locale),
    fullName: String(row.full_name),
    role: String(row.role),
    company: String(row.company || ''),
    email: String(row.email),
    phone: String(row.phone || ''),
    recipientEmail: String(row.recipient_email),
    reviewStatus: String(row.review_status),
    emailStatus: String(row.email_status),
    createdAt: String(row.created_at),
    messagePreview: truncateText(String(row.message), 140),
  }
}

function serializeTestimonialDetail(row) {
  return {
    id: toNumber(row.id),
    locale: String(row.locale),
    fullName: String(row.full_name),
    role: String(row.role),
    company: String(row.company || ''),
    email: String(row.email),
    phone: String(row.phone || ''),
    message: String(row.message),
    recipientEmail: String(row.recipient_email),
    reviewStatus: String(row.review_status),
    reviewNotes: row.review_notes ? String(row.review_notes) : '',
    publishedAt: row.published_at ? String(row.published_at) : '',
    emailStatus: String(row.email_status),
    emailError: row.email_error ? String(row.email_error) : '',
    createdAt: String(row.created_at),
  }
}

function serializeApprovedTestimonial(row) {
  const company = String(row.company || '').trim()
  const role = String(row.role || '').trim()
  return {
    id: toNumber(row.id),
    name: String(row.full_name),
    role: company ? `${role} · ${company}` : role,
    text: String(row.message),
    createdAt: String(row.created_at),
    publishedAt: row.published_at ? String(row.published_at) : '',
  }
}

function clampPositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function toNumber(value) {
  return typeof value === 'number' ? value : Number(value || 0)
}

function truncateText(value, maxLength) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function uploadImage(request, env) {
  if (!env.GALLERY_IMAGES) throw new Error('Falta configurar el bucket R2 GALLERY_IMAGES.')

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.startsWith('image/webp')) throw new HttpError('Solo se aceptan imágenes WebP optimizadas.', 400)

  const bytes = await request.arrayBuffer()
  if (!bytes.byteLength) throw new HttpError('La imagen está vacía.', 400)
  if (bytes.byteLength > 480 * 1024) throw new HttpError('La imagen optimizada supera el tamaño permitido.', 400)

  const key = `gallery/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.webp`
  await env.GALLERY_IMAGES.put(key, bytes, {
    httpMetadata: {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      originalName: request.headers.get('x-file-name') || 'imagen.webp',
    },
  })

  return json({ key, url: `/images/${key}` }, request)
}

async function getImage(request, env) {
  if (!env.GALLERY_IMAGES) throw new Error('Falta configurar el bucket R2 GALLERY_IMAGES.')

  const url = new URL(request.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/images\//, ''))
  const object = await env.GALLERY_IMAGES.get(key)
  if (!object) return new Response('Imagen no encontrada.', { status: 404, headers: corsHeaders(request) })

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', headers.get('cache-control') || 'public, max-age=31536000, immutable')
  Object.entries(corsHeaders(request)).forEach(([name, value]) => headers.set(name, value))

  return new Response(object.body, { headers })
}

async function signJwt(env, payload) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const claims = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 8,
  }
  const data = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`
  const signature = await hmac(env, data)
  return `${data}.${signature}`
}

async function requireJwt(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError('Sesión requerida.', 401)

  const [encodedHeader, encodedPayload, signature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !signature) throw new HttpError('Sesión inválida.', 401)

  const data = `${encodedHeader}.${encodedPayload}`
  const expectedSignature = await hmac(env, data)
  if (signature !== expectedSignature) throw new HttpError('Sesión inválida.', 401)

  const payload = JSON.parse(base64UrlDecode(encodedPayload))
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new HttpError('Sesión vencida.', 401)
  if (payload.role !== 'admin') throw new HttpError('Sesión sin permisos.', 403)

  return payload
}

async function hmac(env, data) {
  if (!env.JWT_SECRET) throw new Error('Falta JWT_SECRET.')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return base64UrlEncodeBytes(new Uint8Array(signature))
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value))
}

function base64UrlEncodeBytes(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return atob(base64)
}

class HttpError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function json(payload, request, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...jsonHeaders,
      ...corsHeaders(request),
      ...extraHeaders,
    },
  })
}

function withCors(response, request, cacheStatus) {
  const headers = new Headers(response.headers)
  Object.entries(corsHeaders(request)).forEach(([key, value]) => headers.set(key, value))
  headers.set('x-content-cache', cacheStatus)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function corsHeaders(request) {
  const origin = request.headers.get('origin')

  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-file-name',
  }
}

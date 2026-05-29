import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import 'dotenv/config'
import { db, ensureSchema } from './db.js'
import { defaultContent, normalizeContent } from './src/contentDefaults.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 5173)
const adminEmail = process.env.ADMIN_EMAIL || 'admin@local.dev'
const adminPassword = process.env.ADMIN_PASSWORD || 'admin-dev-password'
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret'
const contentCacheTtlMs = Number(process.env.CONTENT_CACHE_TTL_SECONDS || 300) * 1000
let contentCache = null

const app = express()
const localImageDir = path.join(__dirname, 'local-r2', 'images')

app.post('/api/admin/images', express.raw({ type: 'image/webp', limit: '480kb' }), requireAdmin, async (req, res) => {
  try {
    if (!req.body?.length) {
      res.status(400).json({ error: 'La imagen está vacía.' })
      return
    }

    const key = `gallery/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.webp`
    const filePath = path.join(localImageDir, key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, req.body)
    res.json({ key, url: `/images/${key}` })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudo subir la imagen.' })
  }
})

app.use('/images', express.static(localImageDir, {
  immutable: true,
  maxAge: '1y',
}))

app.use(express.json({ limit: '10mb' }))

await ensureSchema()

async function getLandingContent() {
  if (contentCache && contentCache.expiresAt > Date.now()) {
    return contentCache.value
  }

  const result = await db.execute({
    sql: 'SELECT value FROM site_content WHERE key = ?',
    args: ['landing'],
  })

  if (!result.rows.length) {
    await saveLandingContent(defaultContent)
    contentCache = { value: defaultContent, expiresAt: Date.now() + contentCacheTtlMs }
    return defaultContent
  }

  const storedContent = JSON.parse(String(result.rows[0].value))
  const content = normalizeContent(storedContent)
  if (content.version !== storedContent.version) await saveLandingContent(content)
  contentCache = { value: content, expiresAt: Date.now() + contentCacheTtlMs }
  return content
}

async function saveLandingContent(content) {
  await db.execute({
    sql: `
      INSERT INTO site_content (key, value, updated_at)
      VALUES ('landing', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [JSON.stringify(content)],
  })
  contentCache = null
}

async function saveLead(lead) {
  const result = await db.execute({
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
    args: [lead.locale, lead.fullName, lead.email, lead.phone, lead.message, lead.recipientEmail],
  })

  return Number(result.lastInsertRowid)
}

async function updateLeadEmailStatus(leadId, status, errorMessage) {
  await db.execute({
    sql: 'UPDATE contact_leads SET email_status = ?, email_error = ? WHERE id = ?',
    args: [status, errorMessage, leadId],
  })
}

async function saveTestimonialSubmission(testimonial) {
  const result = await db.execute({
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
    args: [
      testimonial.locale,
      testimonial.fullName,
      testimonial.role,
      testimonial.company,
      testimonial.email,
      testimonial.phone,
      testimonial.message,
      testimonial.recipientEmail,
    ],
  })

  return Number(result.lastInsertRowid)
}

async function updateTestimonialEmailStatus(testimonialId, status, errorMessage) {
  await db.execute({
    sql: 'UPDATE testimonial_submissions SET email_status = ?, email_error = ? WHERE id = ?',
    args: [status, errorMessage, testimonialId],
  })
}

async function getApprovedTestimonials() {
  const result = await db.execute({
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

function requireAdmin(req, res, next) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token || !verifyJwt(token)) {
    res.status(401).json({ error: 'Sesión inválida.' })
    return
  }

  next()
}

app.get('/api/content', async (_req, res) => {
  try {
    const landingContent = await getLandingContent()
    res.set('Cache-Control', `public, max-age=${Math.floor(contentCacheTtlMs / 1000)}`)
    res.json({
      ...landingContent,
      approvedTestimonials: await getApprovedTestimonials(),
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudo cargar el contenido.' })
  }
})

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body

  if (email !== adminEmail || password !== adminPassword) {
    res.status(401).json({ error: 'Credenciales inválidas.' })
    return
  }

  res.json({ token: signJwt({ sub: email, role: 'admin' }) })
})

app.put('/api/admin/content', requireAdmin, async (req, res) => {
  try {
    await saveLandingContent(normalizeContent(req.body))
    res.set('x-content-cache-invalidated', 'true')
    res.json({ ok: true, cacheInvalidated: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudo guardar el contenido.' })
  }
})

app.post('/api/quote-requests', async (req, res) => {
  try {
    const input = validateLeadPayload(req.body)
    const content = await getLandingContent()
    const localeContent = content.locales?.[input.locale] || content.locales?.[content.defaultLocale] || content.locales?.es || defaultContent.locales.es
    const recipientEmail = localeContent.contact?.email || defaultContent.locales.es.contact.email
    const leadId = await saveLead({ ...input, recipientEmail })
    const lead = {
      id: leadId,
      ...input,
      recipientEmail,
      createdAt: new Date().toISOString(),
    }

    try {
      await sendLeadEmail(lead)
      await updateLeadEmailStatus(leadId, 'sent', null)
      res.status(201).json({ ok: true, leadId, emailSent: true })
    } catch (error) {
      await updateLeadEmailStatus(leadId, 'failed', error.message || 'No se pudo enviar el correo.')
      res.status(201).json({
        ok: true,
        leadId,
        emailSent: false,
        warning: input.locale === 'en'
          ? 'Your request was saved, but the email notification could not be sent.'
          : 'Tu solicitud fue guardada, pero no se pudo enviar la notificación por correo.',
      })
    }
  } catch (error) {
    console.error(error)
    res.status(error.status || 500).json({ error: error.message || 'No se pudo enviar la solicitud.' })
  }
})

app.post('/api/testimonials', async (req, res) => {
  try {
    const input = validateTestimonialPayload(req.body)
    const content = await getLandingContent()
    const localeContent = content.locales?.[input.locale] || content.locales?.[content.defaultLocale] || content.locales?.es || defaultContent.locales.es
    const recipientEmail = localeContent.contact?.email || defaultContent.locales.es.contact.email
    const testimonialId = await saveTestimonialSubmission({ ...input, recipientEmail })
    const testimonial = {
      id: testimonialId,
      ...input,
      recipientEmail,
      createdAt: new Date().toISOString(),
      reviewStatus: 'pending',
    }

    try {
      await sendTestimonialEmail(testimonial)
      await updateTestimonialEmailStatus(testimonialId, 'sent', null)
      res.status(201).json({ ok: true, testimonialId, emailSent: true })
    } catch (error) {
      await updateTestimonialEmailStatus(testimonialId, 'failed', error.message || 'No se pudo enviar el correo.')
      res.status(201).json({
        ok: true,
        testimonialId,
        emailSent: false,
        warning: input.locale === 'en'
          ? 'Your testimonial was saved, but the email notification could not be sent.'
          : 'Tu testimonio fue guardado, pero no se pudo enviar la notificación por correo.',
      })
    }
  } catch (error) {
    console.error(error)
    res.status(error.status || 500).json({ error: error.message || 'No se pudo enviar el testimonio.' })
  }
})

app.get('/api/admin/leads', requireAdmin, async (req, res) => {
  try {
    const page = clampPositiveInteger(req.query.page, 1)
    const pageSize = clampPositiveInteger(req.query.pageSize, 10, 50)
    const offset = (page - 1) * pageSize

    const [countResult, leadsResult] = await Promise.all([
      db.execute('SELECT COUNT(*) AS total FROM contact_leads'),
      db.execute({
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
    res.json({
      items: leadsResult.rows.map((row) => serializeLeadSummary(row)),
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudieron cargar las solicitudes.' })
  }
})

app.get('/api/admin/testimonials', requireAdmin, async (req, res) => {
  try {
    const page = clampPositiveInteger(req.query.page, 1)
    const pageSize = clampPositiveInteger(req.query.pageSize, 10, 50)
    const offset = (page - 1) * pageSize

    const [countResult, testimonialsResult] = await Promise.all([
      db.execute('SELECT COUNT(*) AS total FROM testimonial_submissions'),
      db.execute({
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
    res.json({
      items: testimonialsResult.rows.map((row) => serializeTestimonialSummary(row)),
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudieron cargar los testimonios.' })
  }
})

app.get('/api/admin/leads/:id', requireAdmin, async (req, res) => {
  try {
    const leadId = Number(req.params.id)
    if (!Number.isInteger(leadId) || leadId <= 0) {
      res.status(400).json({ error: 'Solicitud inválida.' })
      return
    }

    const result = await db.execute({
      sql: `
        SELECT id, locale, full_name, email, phone, message, recipient_email, email_status, email_error, created_at
        FROM contact_leads
        WHERE id = ?
        LIMIT 1
      `,
      args: [leadId],
    })

    if (!result.rows.length) {
      res.status(404).json({ error: 'Solicitud no encontrada.' })
      return
    }

    res.json({ item: serializeLeadDetail(result.rows[0]) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudo cargar el detalle.' })
  }
})

app.get('/api/admin/testimonials/:id', requireAdmin, async (req, res) => {
  try {
    const testimonialId = Number(req.params.id)
    if (!Number.isInteger(testimonialId) || testimonialId <= 0) {
      res.status(400).json({ error: 'Testimonio inválido.' })
      return
    }

    const result = await db.execute({
      sql: `
        SELECT id, locale, full_name, role, company, email, phone, message, recipient_email, review_status, review_notes, published_at, email_status, email_error, created_at
        FROM testimonial_submissions
        WHERE id = ?
        LIMIT 1
      `,
      args: [testimonialId],
    })

    if (!result.rows.length) {
      res.status(404).json({ error: 'Testimonio no encontrado.' })
      return
    }

    res.json({ item: serializeTestimonialDetail(result.rows[0]) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudo cargar el detalle del testimonio.' })
  }
})

app.put('/api/admin/testimonials/:id/review', requireAdmin, async (req, res) => {
  try {
    const testimonialId = Number(req.params.id)
    if (!Number.isInteger(testimonialId) || testimonialId <= 0) {
      res.status(400).json({ error: 'Testimonio inválido.' })
      return
    }

    const reviewStatus = req.body?.reviewStatus === 'approved' ? 'approved' : req.body?.reviewStatus === 'rejected' ? 'rejected' : ''
    if (!reviewStatus) {
      res.status(400).json({ error: 'Estado de revisión inválido.' })
      return
    }

    const reviewNotes = normalizeText(req.body?.reviewNotes)
    const publishedAt = reviewStatus === 'approved' ? new Date().toISOString() : null

    await db.execute({
      sql: `
        UPDATE testimonial_submissions
        SET review_status = ?, review_notes = ?, published_at = ?
        WHERE id = ?
      `,
      args: [reviewStatus, reviewNotes || null, publishedAt, testimonialId],
    })

    const result = await db.execute({
      sql: `
        SELECT id, locale, full_name, role, company, email, phone, message, recipient_email, review_status, review_notes, published_at, email_status, email_error, created_at
        FROM testimonial_submissions
        WHERE id = ?
        LIMIT 1
      `,
      args: [testimonialId],
    })

    if (!result.rows.length) {
      res.status(404).json({ error: 'Testimonio no encontrado.' })
      return
    }

    res.json({ ok: true, item: serializeTestimonialDetail(result.rows[0]) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'No se pudo actualizar la revisión del testimonio.' })
  }
})

function signJwt(payload) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const claims = { ...payload, iat: now, exp: now + 60 * 60 * 8 }
  const data = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`
  return `${data}.${hmac(data)}`
}

function verifyJwt(token) {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) return false
  const expected = hmac(`${header}.${payload}`)
  if (signature !== expected) return false
  const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString('utf8'))
  return claims.role === 'admin' && claims.exp >= Math.floor(Date.now() / 1000)
}

function hmac(data) {
  return crypto.createHmac('sha256', jwtSecret).update(data).digest('base64url')
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
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

async function sendLeadEmail(lead) {
  if (!process.env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY.')
  if (!process.env.RESEND_FROM_EMAIL) throw new Error('Falta RESEND_FROM_EMAIL.')

  const subject = lead.locale === 'en'
    ? `New quote request from ${lead.fullName}`
    : `Nueva solicitud de cotización de ${lead.fullName}`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
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

async function sendTestimonialEmail(testimonial) {
  if (!process.env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY.')
  if (!process.env.RESEND_FROM_EMAIL) throw new Error('Falta RESEND_FROM_EMAIL.')

  const subject = testimonial.locale === 'en'
    ? `New testimonial pending review from ${testimonial.fullName}`
    : `Nuevo testimonio pendiente de revisión de ${testimonial.fullName}`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
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

class HttpError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'dist')))
  app.use((_req, res) => {
    res.sendFile(path.join(__dirname, 'dist/index.html'))
  })
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor listo en http://localhost:${port}`)
  console.log(`Admin: http://localhost:${port}/admin`)
})

import nodemailer, { type Transporter } from "nodemailer"

type MailProvider = "ethereal" | "smtp"

interface MailConfig {
  provider: MailProvider
  from: string
  smtp?: {
    host: string
    port: number
    user: string
    pass: string
  }
}

let transporter: Transporter | null = null
let resolvedFrom = ""

async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter

  const cfg = loadConfig()
  resolvedFrom = cfg.from

  if (cfg.provider === "smtp") {
    if (!cfg.smtp) throw new Error("SMTP provider requires SMTP_* env vars")
    transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.port === 465,
      auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
    })
    return transporter
  }

  try {
    const account = await nodemailer.createTestAccount()
    transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    })
    console.info(`[email] Ethereal account created: ${account.user}`)
    return transporter
  } catch (err) {
    console.warn(`[email] Ethereal unavailable, falling back to JSON transport:`, err)
    transporter = nodemailer.createTransport({ jsonTransport: true })
    return transporter
  }
}

function loadConfig(): MailConfig {
  const provider = (process.env.MAIL_PROVIDER ?? "ethereal") as MailProvider
  const from = process.env.SMTP_FROM ?? "Feedback Tool <no-reply@localhost>"
  if (provider === "smtp") {
    return {
      provider,
      from,
      smtp: {
        host: process.env.SMTP_HOST ?? "",
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER ?? "",
        pass: process.env.SMTP_PASS ?? "",
      },
    }
  }
  return { provider: "ethereal", from }
}

export interface SendMailOpts {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendMail(opts: SendMailOpts): Promise<void> {
  const t = await getTransporter()
  const info = await t.sendMail({
    from: resolvedFrom,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? stripHtml(opts.html),
  })

  const preview = nodemailer.getTestMessageUrl(info)
  if (preview) {
    console.info(`[email] preview: ${preview}`)
  } else if ("message" in info && typeof info.message === "string") {
    console.info(`[email] jsonTransport captured:\n${info.message}`)
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

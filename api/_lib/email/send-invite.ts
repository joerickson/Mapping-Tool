// Resend wrapper for the user-invite email. Reads:
//   RESEND_API_KEY   — Resend API key (required to actually send)
//   INVITE_FROM_EMAIL — verified Resend "from" address (required)
//   APP_URL or VITE_APP_URL — base URL for the accept link
//
// If RESEND_API_KEY isn't set we no-op and return { sent: false } so
// the admin UI can fall back to "copy invite link" UX in dev.
import { Resend } from 'resend'

interface SendInviteArgs {
  toEmail: string
  inviteToken: string
  invitedByEmail?: string | null
  role: 'admin' | 'member'
  expiresAt: Date
}

interface SendResult {
  sent: boolean
  message_id?: string
  error?: string
  link: string
}

export async function sendInviteEmail(args: SendInviteArgs): Promise<SendResult> {
  const baseUrl =
    process.env.APP_URL ??
    process.env.VITE_APP_URL ??
    'https://localhost:3000'
  const link = `${baseUrl.replace(/\/$/, '')}/invite/${encodeURIComponent(args.inviteToken)}`

  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.INVITE_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL
  if (!apiKey) {
    return { sent: false, error: 'RESEND_API_KEY not set; copy the link manually', link }
  }
  if (!fromEmail) {
    return { sent: false, error: 'INVITE_FROM_EMAIL not set; copy the link manually', link }
  }

  try {
    const resend = new Resend(apiKey)
    const result = await resend.emails.send({
      from: fromEmail,
      to: args.toEmail,
      subject: 'You have been invited to PortfolioIQ',
      html: buildHtml({
        link,
        invitedByEmail: args.invitedByEmail ?? null,
        role: args.role,
        expiresAt: args.expiresAt,
      }),
      text: buildText({
        link,
        invitedByEmail: args.invitedByEmail ?? null,
        role: args.role,
        expiresAt: args.expiresAt,
      }),
    })
    if (result.error) {
      return { sent: false, error: result.error.message, link }
    }
    return { sent: true, message_id: result.data?.id, link }
  } catch (err: any) {
    return { sent: false, error: err?.message ?? String(err), link }
  }
}

function buildHtml(args: {
  link: string
  invitedByEmail: string | null
  role: 'admin' | 'member'
  expiresAt: Date
}): string {
  const inviter = args.invitedByEmail
    ? `<strong>${escape(args.invitedByEmail)}</strong>`
    : 'Someone'
  const roleLabel = args.role === 'admin' ? 'Admin' : 'Member'
  const expires = args.expiresAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return `
<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
    <h2 style="margin: 0 0 12px 0;">You've been invited to PortfolioIQ</h2>
    <p>${inviter} invited you to join PortfolioIQ as <strong>${roleLabel}</strong>.</p>
    <p style="margin: 24px 0;">
      <a href="${args.link}"
         style="display: inline-block; background: #0ea5e9; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none;">
        Accept invite
      </a>
    </p>
    <p style="font-size: 12px; color: #64748b;">
      Or paste this link into your browser:<br/>
      <span style="word-break: break-all;">${args.link}</span>
    </p>
    <p style="font-size: 12px; color: #64748b; margin-top: 16px;">
      This invite expires on ${escape(expires)}. If you weren't expecting this, you can ignore the message.
    </p>
  </body>
</html>`
}

function buildText(args: {
  link: string
  invitedByEmail: string | null
  role: 'admin' | 'member'
  expiresAt: Date
}): string {
  const inviter = args.invitedByEmail ?? 'Someone'
  const roleLabel = args.role === 'admin' ? 'Admin' : 'Member'
  return `${inviter} invited you to PortfolioIQ as ${roleLabel}.

Accept the invite: ${args.link}

Expires: ${args.expiresAt.toISOString()}`
}

function escape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

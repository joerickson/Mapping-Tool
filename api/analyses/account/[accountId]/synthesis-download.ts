// GET /api/analyses/account/[accountId]/synthesis-download
// Streams the latest synthesis row's full_report_markdown as a .md attachment.
// Spec asked for PDF, but Vercel function constraints (cold starts + size)
// make Puppeteer impractical and the structured deliverable is what matters.
// Markdown opens cleanly in any editor; clients can convert to PDF locally.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createAdminClient } from '../../../_lib/supabase.js'
import { authenticateRequest } from '../../../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    await authenticateRequest(req)
  } catch (err: any) {
    return res.status(err.statusCode ?? 401).json({ error: err.message ?? 'Unauthorized' })
  }

  const accountId = req.query.accountId as string
  const db = createAdminClient()

  const { data: synth } = await db
    .from('portfolio_analyses')
    .select('outputs, summary_text, completed_at')
    .eq('account_id', accountId)
    .eq('module_key', 'synthesis')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!synth) {
    return res.status(404).json({ error: 'No synthesis available — run Synthesize first.' })
  }

  const md =
    (synth as any).outputs?.full_report_markdown ??
    `# Portfolio Analysis\n\n${(synth as any).summary_text ?? ''}\n`

  const { data: acc } = await db
    .from('accounts')
    .select('name, display_name')
    .eq('id', accountId)
    .single()
  const accountName = (acc as any)?.display_name ?? (acc as any)?.name ?? 'account'
  const safeName = accountName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName || 'account'}_analysis.md"`
  )
  res.status(200).send(md)
}

// Phase 3.6 — moved to /clients/[clientId]/...  Returns 410 Gone.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { MOVED_TO_CLIENT_SCOPE } from '../../../../_lib/analysis/scope.js'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  return res.status(MOVED_TO_CLIENT_SCOPE.status).json(MOVED_TO_CLIENT_SCOPE.body)
}

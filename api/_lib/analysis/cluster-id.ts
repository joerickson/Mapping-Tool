// Phase 4.1 — stable cluster ID for overnight cluster overrides.
//
// The same set of property IDs always hashes to the same id. If a
// property gets added or removed from the cluster, the id shifts and
// any saved override is treated as stale. Used by the overnight
// calculator and the cluster-override API.
import crypto from 'crypto'

export function computeClusterId(propertyIds: string[]): string {
  const sorted = [...propertyIds].sort()
  return crypto.createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 12)
}

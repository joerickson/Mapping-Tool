import { TARGET_COLUMNS, REQUIRED_COLUMNS, type TargetColumn } from '../../lib/constants'
import type { ColumnMapping } from '../../types'

interface ColumnMapperProps {
  sourceColumns: string[]
  mapping: Partial<ColumnMapping>
  onChange: (mapping: Partial<ColumnMapping>) => void
}

const LABELS: Record<TargetColumn, string> = {
  address_line1: 'Address Line 1 *',
  address_line2: 'Address Line 2',
  city: 'City *',
  state: 'State / Province *',
  postal_code: 'Postal Code *',
  country: 'Country',
  location_code: 'Location Code',
  display_name: 'Display Name',
  suite_or_floor: 'Suite / Floor',
  serviceable_sqft: 'Serviceable Sq Ft',
}

export default function ColumnMapper({ sourceColumns, mapping, onChange }: ColumnMapperProps) {
  const update = (target: TargetColumn, source: string) => {
    onChange({ ...mapping, [target]: source || undefined })
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Map your source columns to the required fields. Fields marked * are required.</p>
      <div className="grid grid-cols-2 gap-3">
        {TARGET_COLUMNS.map((target) => (
          <div key={target} className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">{LABELS[target]}</label>
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={mapping[target] ?? ''}
              onChange={(e) => update(target, e.target.value)}
            >
              <option value="">— skip —</option>
              {sourceColumns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

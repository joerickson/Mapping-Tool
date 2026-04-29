import { ReactNode } from 'react'
import { clsx } from 'clsx'
import Button from '../ui/Button'

export type AnalysisStatus = 'idle' | 'running' | 'completed' | 'failed'

interface AnalysisCardProps {
  title: string
  description: string
  status: AnalysisStatus
  completedAt?: string | null
  errorMessage?: string | null
  summary?: string | null
  onRun: () => void
  running?: boolean
  children?: ReactNode // expanded content (charts/tables) — visible only when completed
}

export default function AnalysisCard({
  title,
  description,
  status,
  completedAt,
  errorMessage,
  summary,
  onRun,
  running,
  children,
}: AnalysisCardProps) {
  const statusBadge = (() => {
    switch (status) {
      case 'idle':
        return <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">Not run</span>
      case 'running':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 inline-flex items-center gap-1.5">
            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Running
          </span>
        )
      case 'completed':
        return <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">Completed</span>
      case 'failed':
        return <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Failed</span>
    }
  })()

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-5 py-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            {statusBadge}
          </div>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
          {completedAt && (
            <p className="text-xs text-gray-400 mt-1">
              Last run: {new Date(completedAt).toLocaleString()}
            </p>
          )}
        </div>
        <Button
          variant={status === 'completed' ? 'secondary' : 'primary'}
          size="sm"
          onClick={onRun}
          loading={running}
          disabled={running}
        >
          {status === 'completed' ? 'Re-run' : 'Run analysis'}
        </Button>
      </div>

      {summary && (
        <div className={clsx('px-5 py-3 border-t bg-gray-50 text-sm text-gray-700')}>{summary}</div>
      )}

      {errorMessage && (
        <div className="px-5 py-3 border-t bg-red-50 text-sm text-red-700">
          <strong>Error:</strong> {errorMessage}
        </div>
      )}

      {children && status === 'completed' && (
        <div className="border-t px-5 py-4">{children}</div>
      )}
    </div>
  )
}

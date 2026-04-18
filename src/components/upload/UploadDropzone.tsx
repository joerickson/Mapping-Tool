import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { clsx } from 'clsx'

interface UploadDropzoneProps {
  onFile: (file: File) => void
  loading?: boolean
}

export default function UploadDropzone({ onFile, loading }: UploadDropzoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) onFile(accepted[0])
    },
    [onFile]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    disabled: loading,
  })

  return (
    <div
      {...getRootProps()}
      className={clsx(
        'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors',
        isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50',
        loading && 'opacity-50 cursor-not-allowed'
      )}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-3">
        <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        {isDragActive ? (
          <p className="text-blue-600 font-medium">Drop your file here</p>
        ) : (
          <>
            <p className="text-gray-600 font-medium">
              Drag & drop a CSV or XLSX file, or{' '}
              <span className="text-blue-600">browse</span>
            </p>
            <p className="text-sm text-gray-400">Supports .csv, .xlsx, .xls</p>
          </>
        )}
      </div>
    </div>
  )
}

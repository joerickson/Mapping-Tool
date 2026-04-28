import { Link, useLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { useClient } from '../../context/ClientContext'

const links = [
  { to: '/map', label: 'Map' },
  { to: '/upload', label: 'Upload' },
  { to: '/accounts', label: 'Accounts' },
]

export default function Navbar() {
  const { pathname } = useLocation()
  const { clients, selectedClientId, selectedClient, setSelectedClientId } = useClient()
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const activeClients = clients.filter((c) => c.status !== 'churned')
  const displayLabel = selectedClient
    ? selectedClient.display_name ?? selectedClient.name
    : 'All Clients'

  const clientColor = selectedClient?.brand_color ?? null

  return (
    <>
      <nav className="h-14 bg-white border-b flex items-center px-4 gap-6 shrink-0 z-30 relative">
        <Link to="/map" className="flex items-center gap-2 font-bold text-blue-700 text-lg shrink-0">
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
          RBM Geo
        </Link>
        <div className="flex gap-1">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={clsx(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                pathname.startsWith(l.to)
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Client context switcher */}
        <div className="relative ml-2" ref={dropdownRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
              selectedClient
                ? 'border-transparent text-white'
                : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
            )}
            style={selectedClient && clientColor ? { backgroundColor: clientColor } : undefined}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span className="max-w-[160px] truncate">{displayLabel}</span>
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {open && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
              <button
                onClick={() => { setSelectedClientId(null); setOpen(false) }}
                className={clsx(
                  'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2',
                  !selectedClientId && 'font-semibold text-blue-700 bg-blue-50'
                )}
              >
                <span className="w-3 h-3 rounded-full bg-gray-300 shrink-0" />
                All Clients
              </button>
              {activeClients.length > 0 && <div className="border-t my-1" />}
              {activeClients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedClientId(c.id); setOpen(false) }}
                  className={clsx(
                    'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2',
                    selectedClientId === c.id && 'font-semibold text-blue-700 bg-blue-50'
                  )}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: c.brand_color ?? hashColor(c.id) }}
                  />
                  <span className="truncate">{c.display_name ?? c.name}</span>
                </button>
              ))}
              <div className="border-t my-1" />
              <Link
                to="/accounts/new"
                onClick={() => setOpen(false)}
                className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-gray-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Account
              </Link>
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/admin/dangerous"
            className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-100 transition-colors"
          >
            Admin
          </Link>
          <Link
            to="/logout"
            className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Sign out
          </Link>
        </div>
      </nav>

      {/* Active client context bar */}
      {selectedClient && (
        <div
          className="h-1 shrink-0"
          style={{ backgroundColor: clientColor ?? hashColor(selectedClient.id) }}
        />
      )}
    </>
  )
}

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
    hash |= 0
  }
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 65%, 50%)`
}

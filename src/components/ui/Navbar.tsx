import { Link, useLocation } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'
import { clsx } from 'clsx'

const links = [
  { to: '/map', label: 'Map' },
  { to: '/upload', label: 'Upload' },
]

export default function Navbar() {
  const { pathname } = useLocation()

  return (
    <nav className="h-14 bg-white border-b flex items-center px-4 gap-6 shrink-0">
      <Link to="/map" className="flex items-center gap-2 font-bold text-blue-700 text-lg">
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
      <div className="ml-auto">
        <UserButton afterSignOutUrl="/sign-in" />
      </div>
    </nav>
  )
}

import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Navbar from '../../components/ui/Navbar'
import Button from '../../components/ui/Button'
import type { Account } from '../../types'

export default function NewAccountClientPage() {
  const { id } = useParams<{ id: string }>()
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [account, setAccount] = useState<Account | null>(null)
  const [loadingAccount, setLoadingAccount] = useState(true)
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadAccount() {
      try {
        const token = await getToken()
        const res = await fetch(`/api/v1/accounts/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) { setLoadingAccount(false); return }
        const data: Account = await res.json()
        if (data.account_type === 'self_managed') {
          navigate(`/accounts/${id}`, { replace: true })
          return
        }
        setAccount(data)
      } catch { /* ignore */ } finally {
        setLoadingAccount(false)
      }
    }
    if (id) loadAccount()
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/v1/accounts/${id}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          display_name: displayName.trim() || null,
          contact_name: contactName.trim() || null,
          contact_email: contactEmail.trim() || null,
          contact_phone: contactPhone.trim() || null,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Failed to create client')
      }
      const client = await res.json()
      navigate(`/clients/${client.id}/setup`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client')
    } finally {
      setSaving(false)
    }
  }

  if (loadingAccount) return (
    <div className="flex flex-col h-full bg-gray-50"><Navbar />
      <div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 mb-6 text-sm">
            <Link to="/accounts" className="text-gray-400 hover:text-gray-600">Accounts</Link>
            <span className="text-gray-300">›</span>
            <Link to={`/accounts/${id}`} className="text-gray-400 hover:text-gray-600">{account?.display_name ?? account?.name ?? id}</Link>
            <span className="text-gray-300">›</span>
            <h1 className="text-2xl font-bold text-gray-900">New Client</h1>
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <fieldset>
              <legend className="text-sm font-semibold text-gray-700 mb-3">Contact</legend>
              <div className="grid grid-cols-1 gap-3">
                <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </fieldset>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={() => navigate(`/accounts/${id}`)}>Cancel</Button>
              <Button type="submit" loading={saving}>Create Client</Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

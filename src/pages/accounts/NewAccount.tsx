import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AppShell from '../../components/layout/AppShell'
import Button from '../../components/ui/Button'

type AccountType = 'self_managed' | 'property_manager'
type Step = 'type' | 'details'

export default function NewAccountPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('type')
  const [accountType, setAccountType] = useState<AccountType>('self_managed')
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [status, setStatus] = useState('active')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          display_name: displayName.trim() || null,
          account_type: accountType,
          status,
          primary_contact_name: contactName.trim() || null,
          primary_contact_email: contactEmail.trim() || null,
          primary_contact_phone: contactPhone.trim() || null,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Failed to create account')
      }
      const account = await res.json()
      if (accountType === 'self_managed' && account.auto_client_id) {
        navigate(`/clients/${account.auto_client_id}/setup`)
      } else {
        navigate(`/accounts/${account.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell breadcrumb={[{ label: 'Accounts', to: '/accounts' }, { label: 'New' }]}>
      <div className="mx-auto max-w-2xl px-6 py-10">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/accounts" className="text-gray-400 hover:text-gray-600 text-sm">← Accounts</Link>
            <h1 className="text-2xl font-bold text-gray-900">New Account</h1>
          </div>

          {/* Step indicator */}
          <div className="flex gap-4 mb-8">
            {(['type', 'details'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${step === s ? 'bg-blue-600 text-white' : i < ['type', 'details'].indexOf(step) ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {i + 1}
                </div>
                <span className={`text-sm ${step === s ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
                  {s === 'type' ? 'Account Type' : 'Details'}
                </span>
                {i < 1 && <span className="text-gray-300 mx-1">›</span>}
              </div>
            ))}
          </div>

          {step === 'type' ? (
            <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
              <p className="text-sm text-gray-600 mb-4">How does this account operate?</p>
              <div className="grid grid-cols-1 gap-4">
                <label className={`relative flex gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors ${accountType === 'self_managed' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name="accountType"
                    value="self_managed"
                    checked={accountType === 'self_managed'}
                    onChange={() => setAccountType('self_managed')}
                    className="mt-1 shrink-0"
                  />
                  <div>
                    <p className="font-semibold text-gray-900">Self-Managed</p>
                    <p className="text-sm text-gray-500 mt-1">
                      This account owns and operates their own properties. (Examples: a bank servicing its own branches, a retail chain cleaning its own stores.)
                    </p>
                  </div>
                </label>
                <label className={`relative flex gap-4 p-4 rounded-xl border-2 cursor-pointer transition-colors ${accountType === 'property_manager' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="radio"
                    name="accountType"
                    value="property_manager"
                    checked={accountType === 'property_manager'}
                    onChange={() => setAccountType('property_manager')}
                    className="mt-1 shrink-0"
                  />
                  <div>
                    <p className="font-semibold text-gray-900">Property Manager</p>
                    <p className="text-sm text-gray-500 mt-1">
                      This account manages properties on behalf of other clients. (Examples: facility management firms managing portfolios for multiple end-clients.)
                    </p>
                  </div>
                </label>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={() => setStep('details')}>Continue →</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
              )}

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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-gray-700 mb-3">Primary Contact</legend>
                <div className="grid grid-cols-1 gap-3">
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Contact name"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="Email"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="Phone"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </fieldset>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="secondary" type="button" onClick={() => setStep('type')}>← Back</Button>
                <Button type="submit" loading={saving}>Create Account</Button>
              </div>
            </form>
          )}
      </div>
    </AppShell>
  )
}

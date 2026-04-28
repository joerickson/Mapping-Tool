import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import type { Account, Client } from '../types'

const ACCOUNT_KEY = 'selectedAccountId'
const CLIENT_KEY = 'selectedClientId'

interface AccountContextValue {
  accounts: Account[]
  clients: Client[]
  selectedAccountId: string | null
  selectedAccount: Account | null
  selectedClientId: string | null
  selectedClient: Client | null
  setSelectedAccountId: (id: string | null) => void
  setSelectedClientId: (id: string | null) => void
  reloadAccounts: () => Promise<void>
  reloadClients: () => Promise<void>
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  clients: [],
  selectedAccountId: null,
  selectedAccount: null,
  selectedClientId: null,
  selectedClient: null,
  setSelectedAccountId: () => {},
  setSelectedClientId: () => {},
  reloadAccounts: async () => {},
  reloadClients: async () => {},
})

export function AccountProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [clients, setClients] = useState<Client[]>([])

  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(() => {
    const stored = localStorage.getItem(ACCOUNT_KEY)
    return stored && stored !== 'all' ? stored : null
  })

  const [selectedClientId, setSelectedClientIdState] = useState<string | null>(() => {
    const stored = localStorage.getItem(CLIENT_KEY)
    return stored && stored !== 'all' ? stored : null
  })

  const reloadAccounts = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/accounts?status=active', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setAccounts(await res.json())
    } catch { /* ignore */ }
  }, [getToken])

  const reloadClients = useCallback(async () => {
    try {
      const token = await getToken()
      const params = new URLSearchParams({ status: 'active' })
      if (selectedAccountId) params.set('account_id', selectedAccountId)
      const res = await fetch(`/api/v1/clients?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: Client[] = await res.json()
        setClients(data)
        if (selectedClientId && !data.find((c) => c.id === selectedClientId)) {
          setSelectedClientIdState(null)
          localStorage.setItem(CLIENT_KEY, 'all')
        }
      }
    } catch { /* ignore */ }
  }, [getToken, selectedAccountId, selectedClientId])

  useEffect(() => { reloadAccounts() }, [])
  useEffect(() => { reloadClients() }, [selectedAccountId])

  const setSelectedAccountId = useCallback((id: string | null) => {
    setSelectedAccountIdState(id)
    setSelectedClientIdState(null)
    localStorage.setItem(ACCOUNT_KEY, id ?? 'all')
    localStorage.setItem(CLIENT_KEY, 'all')
  }, [])

  const setSelectedClientId = useCallback((id: string | null) => {
    setSelectedClientIdState(id)
    localStorage.setItem(CLIENT_KEY, id ?? 'all')
  }, [])

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null
  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? null

  return (
    <AccountContext.Provider value={{
      accounts, clients,
      selectedAccountId, selectedAccount,
      selectedClientId, selectedClient,
      setSelectedAccountId, setSelectedClientId,
      reloadAccounts, reloadClients,
    }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  return useContext(AccountContext)
}

// Backward-compatible shim: existing code that imports useClient still works.
// New code should prefer useAccount() from AccountContext.
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import type { Client } from '../types'

const STORAGE_KEY = 'selectedClientId'

interface ClientContextValue {
  clients: Client[]
  selectedClientId: string | null
  selectedClient: Client | null
  setSelectedClientId: (id: string | null) => void
  reloadClients: () => Promise<void>
}

const ClientContext = createContext<ClientContextValue>({
  clients: [],
  selectedClientId: null,
  selectedClient: null,
  setSelectedClientId: () => {},
  reloadClients: async () => {},
})

export function ClientProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientIdState] = useState<string | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored && stored !== 'all' ? stored : null
  })

  const reloadClients = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await fetch('/api/v1/clients', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: Client[] = await res.json()
        setClients(data)
        if (selectedClientId) {
          const found = data.find((c) => c.id === selectedClientId)
          if (!found || found.status === 'churned') {
            setSelectedClientIdState(null)
            localStorage.setItem(STORAGE_KEY, 'all')
          }
        }
      }
    } catch { /* ignore */ }
  }, [getToken, selectedClientId])

  useEffect(() => { reloadClients() }, [])

  const setSelectedClientId = useCallback((id: string | null) => {
    setSelectedClientIdState(id)
    localStorage.setItem(STORAGE_KEY, id ?? 'all')
  }, [])

  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? null

  return (
    <ClientContext.Provider value={{ clients, selectedClientId, selectedClient, setSelectedClientId, reloadClients }}>
      {children}
    </ClientContext.Provider>
  )
}

export function useClient() {
  return useContext(ClientContext)
}

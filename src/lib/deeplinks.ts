type App = 'crm' | 'bid_manager'
type Resource = 'account' | 'bid' | 'property' | 'service_location'

const BASE_URLS: Record<App, string> = {
  crm: import.meta.env.VITE_RBM_CRM_BASE_URL ?? '',
  bid_manager: import.meta.env.VITE_RBM_BID_MANAGER_BASE_URL ?? '',
}

const PATH_TEMPLATES: Record<App, Partial<Record<Resource, (id: string) => string>>> = {
  crm: {
    account: (id) => `/accounts/${id}`,
    service_location: (id) => `/service-locations/${id}`,
  },
  bid_manager: {
    bid: (id) => `/bids/${id}`,
    property: (id) => `/prospects/${id}`,
  },
}

export function buildDeepLink(app: App, resource: Resource, id: string): string {
  const base = BASE_URLS[app]
  const pathFn = PATH_TEMPLATES[app]?.[resource]
  if (!base || !pathFn) return '#'
  return base + pathFn(id)
}

export type ColumnMapping = {
  address_line1: string
  address_line2?: string
  city: string
  state: string
  postal_code: string
  location_code?: string
  display_name?: string
  suite_or_floor?: string
  serviceable_sqft?: string
}

export type EnrichmentStatus =
  | 'pending'
  | 'geocoded'
  | 'places_enriched'
  | 'parcel_enriched'
  | 'enriched'
  | 'failed'

export type ServiceLocationStatus = 'active' | 'paused' | 'terminated' | 'prospect'

export interface Property {
  property_id: string
  address_line1: string
  address_line2?: string | null
  city: string
  state: string
  postal_code: string
  address_hash: string
  latitude?: number | null
  longitude?: number | null
  geocode_source?: string | null
  geocode_confidence?: string | null
  geocoded_at?: string | null
  google_place_id?: string | null
  place_name?: string | null
  place_types?: string[] | null
  place_website?: string | null
  place_phone?: string | null
  parcel_id?: string | null
  parcel_polygon?: GeoJSONPolygon | null
  building_sqft?: number | null
  lot_sqft?: number | null
  year_built?: number | null
  zoning_code?: string | null
  land_use_code?: string | null
  owner_name?: string | null
  owner_mailing_address?: string | null
  rbm_category?: string | null
  rbm_subcategory?: string | null
  rbm_category_confidence?: number | null
  rbm_category_source?: string | null
  enrichment_status: EnrichmentStatus
  enrichment_errors?: Record<string, unknown> | null
  last_enriched_at?: string | null
  created_at: string
  updated_at: string
}

export interface ServiceLocation {
  service_location_id: string
  property_id: string
  client_id?: string | null
  location_code?: string | null
  display_name?: string | null
  suite_or_floor?: string | null
  serviceable_sqft?: number | null
  status: ServiceLocationStatus
  winteam_job_number?: string | null
  portfolio_ids?: string[] | null
  created_at: string
  updated_at: string
  property?: Property
}

export interface Portfolio {
  portfolio_id: string
  name: string
  description?: string | null
  share_token?: string | null
  share_expires_at?: string | null
  share_financials_enabled?: boolean
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface UploadBatch {
  upload_batch_id: string
  filename: string
  row_count: number
  raw_data: Record<string, unknown>[]
  column_mapping: ColumnMapping
  client_id?: string | null
  portfolio_id?: string | null
  uploaded_by?: string | null
  created_at: string
}

export interface EnrichmentJob {
  enrichment_job_id: string
  upload_batch_id?: string | null
  property_ids: string[]
  status: 'queued' | 'running' | 'completed' | 'failed'
  total_properties: number
  processed_properties: number
  api_calls?: Record<string, number> | null
  estimated_cost_usd?: number | null
  started_at?: string | null
  completed_at?: string | null
  created_at: string
}

export interface RbmCategory {
  code: string
  label: string
  parent_code?: string | null
  color?: string | null
}

export interface PropertyChange {
  change_id: string
  property_id: string
  field_name: string
  old_value?: string | null
  new_value?: string | null
  changed_by?: string | null
  changed_at: string
}

export interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

export interface MapFilter {
  clients: string[]
  categories: string[]
  cityState: string
  statuses: ServiceLocationStatus[]
  portfolios: string[]
}

export interface PropertyWithLocations extends Property {
  service_locations: ServiceLocation[]
}

export interface ParcelRecord {
  id: string
  regrid_ll_uuid?: string | null
  parcel_number?: string | null
  county_fips: string
  state: string
  county_name?: string | null
  geometry?: Record<string, unknown> | null
  centroid_lat?: number | null
  centroid_lng?: number | null
  building_sqft?: number | null
  lot_sqft?: number | null
  year_built?: number | null
  zoning_code?: string | null
  land_use_code?: string | null
  land_use_standardized?: string | null
  owner_name?: string | null
  owner_mailing_address?: string | null
  source_refresh_date?: string | null
  imported_at: string
}

export type ParcelImportStatus = 'pending' | 'importing' | 'completed' | 'failed'

export interface ParcelCountyImport {
  id: string
  county_fips: string
  county_name: string
  state: string
  source_format?: string | null
  source_filename?: string | null
  source_refresh_date?: string | null
  parcel_count?: number | null
  status: ParcelImportStatus
  error_log?: Record<string, unknown>[] | null
  imported_by?: string | null
  started_at?: string | null
  completed_at?: string | null
  created_at: string
}

export interface ParcelApiFallback {
  id: string
  property_id?: string | null
  county_fips?: string | null
  county_name?: string | null
  state?: string | null
  api_response?: Record<string, unknown> | null
  api_cost_usd?: number | null
  called_at: string
}

export interface ParcelFallbackSummary {
  county_fips: string
  county_name: string | null
  state: string | null
  total_calls: number
  total_cost_usd: number
  first_fallback: string
  last_fallback: string
}

export interface ParcelCoverageCounty {
  county_fips: string
  county_name: string
  state: string
  parcel_count: number
  source_refresh_date: string | null
  last_imported: string
}

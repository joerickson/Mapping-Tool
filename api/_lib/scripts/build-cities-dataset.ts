// Refreshes api/_lib/data/us_cities.json from a public-domain source.
// Usage: tsx api/_lib/scripts/build-cities-dataset.ts
//
// Defaults to a public mirror of US cities ≥36K population. To use a different
// source (e.g. the SimpleMaps premium CSV with all incorporated places),
// override SOURCE_URL via env var:
//   SOURCE_URL=https://example.com/cities.json tsx api/_lib/scripts/build-cities-dataset.ts
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE_URL =
  process.env.SOURCE_URL ??
  'https://gist.githubusercontent.com/Miserlou/c5cd8364bf9b2420bb29/raw/2bf258763cdddd704f8ffd3ea9a3e81d25e2c6f6/cities.json'

const STATE_TO_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
}

interface OutputCity {
  city: string
  state: string
  state_id: string
  lat: number
  lng: number
  population: number
}

async function main() {
  const resp = await fetch(SOURCE_URL)
  if (!resp.ok) throw new Error(`Source HTTP ${resp.status}`)
  const raw: any[] = await resp.json()

  const cities: OutputCity[] = []
  for (const c of raw) {
    const stateFull = c.state ?? c.State ?? null
    const abbr = stateFull ? STATE_TO_ABBR[stateFull] : null
    if (!abbr) continue
    const pop = Number(c.population ?? c.pop ?? 0)
    if (!Number.isFinite(pop) || pop <= 0) continue
    cities.push({
      city: String(c.city ?? c.City ?? ''),
      state: stateFull,
      state_id: abbr,
      lat: Number(c.latitude ?? c.lat),
      lng: Number(c.longitude ?? c.lng ?? c.lon),
      population: Math.round(pop),
    })
  }
  cities.sort((a, b) => b.population - a.population)

  const out = {
    cities,
    source: SOURCE_URL,
    generated_at: new Date().toISOString(),
    city_count: cities.length,
    min_population_in_dataset:
      cities.length > 0 ? cities[cities.length - 1].population : 0,
  }

  const outPath = resolve(process.cwd(), 'api/_lib/data/us_cities.json')
  writeFileSync(outPath, JSON.stringify(out))
  console.log(
    `Wrote ${cities.length} cities to ${outPath} (min pop ${out.min_population_in_dataset})`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

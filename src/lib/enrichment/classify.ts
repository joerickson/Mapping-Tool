import Anthropic from '@anthropic-ai/sdk'
import type { RbmCategory } from '../../types'

const MODEL = 'claude-sonnet-4-20250514'

export interface ClassificationResult {
  rbm_category: string
  rbm_subcategory?: string
  confidence: number
  reasoning: string
}

export async function classifyProperty(
  property: {
    address_line1: string
    city: string
    state: string
    place_name?: string | null
    place_types?: string[] | null
    zoning_code?: string | null
    land_use_code?: string | null
    building_sqft?: number | null
    year_built?: number | null
  },
  categories: RbmCategory[],
  apiKey: string
): Promise<ClassificationResult | null> {
  const client = new Anthropic({ apiKey })

  const categoryCodes = categories.map((c) => `${c.code}: ${c.label}`).join('\n')

  const prompt = `You are classifying a commercial property for a janitorial services company.

Property details:
- Address: ${property.address_line1}, ${property.city}, ${property.state}
- Business name: ${property.place_name ?? 'unknown'}
- Google place types: ${property.place_types?.join(', ') ?? 'unknown'}
- Zoning code: ${property.zoning_code ?? 'unknown'}
- Land use code: ${property.land_use_code ?? 'unknown'}
- Building size: ${property.building_sqft ? `${property.building_sqft} sq ft` : 'unknown'}
- Year built: ${property.year_built ?? 'unknown'}

Available RBM category codes:
${categoryCodes}

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"rbm_category":"<code>","rbm_subcategory":"<subcategory or null>","confidence":<0.0-1.0>,"reasoning":"<brief 1-sentence reasoning>"}`

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const parsed = JSON.parse(text.trim())

    // Validate category code is in allowed list
    const validCodes = categories.map((c) => c.code)
    if (!validCodes.includes(parsed.rbm_category)) {
      parsed.rbm_category = validCodes[0] ?? 'unknown'
    }

    return {
      rbm_category: parsed.rbm_category,
      rbm_subcategory: parsed.rbm_subcategory ?? undefined,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence))),
      reasoning: parsed.reasoning ?? '',
    }
  } catch {
    return null
  }
}

import type { University } from '../services/api'
import type { SearchableOption } from '../components/SearchableSelect'

/** Extra search terms (former names, common abbreviations) keyed by university slug. */
const SEARCH_ALIASES: Record<string, string> = {
  atu: 'GMIT Letterkenny LYIT IT Sligo Mayo',
  galway: 'NUIG NUI Galway',
  maynooth: 'NUI Maynooth',
  mtu: 'CIT Cork IT Tralee Kerry',
  setu: 'WIT Waterford IT Carlow',
  tud: 'DIT Blanchardstown Tallaght',
  tus: 'LIT Limerick IT Athlone AIT Shannon midlands midwest',
  trinity: 'TCD',
  ulster: 'UU Jordanstown Coleraine Magee Belfast',
}

/** Options for the searchable university picker (signup / join). */
export function universitySelectOptions(universities: University[]): SearchableOption[] {
  return universities.map((u) => ({
    value: u.id,
    label: u.short_name ? `${u.name} (${u.short_name})` : u.name,
    keywords: [u.short_name, u.slug, SEARCH_ALIASES[u.slug] || ''].filter(Boolean).join(' '),
  }))
}

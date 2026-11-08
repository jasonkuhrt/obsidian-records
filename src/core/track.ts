import type { LatLon } from './geo.ts'
import { normalizeSource } from './source.ts'

/** A track's lines: one per GPX track segment or route. */
export type Track = readonly (readonly LatLon[])[]

/** The most points a parsed track keeps; a 7 MB GPX file holds about 60,000. */
export const maxTrackPoints = 4000

const tag = /<(trkseg|rte)\b[^>]*>|<(?:trkpt|rtept)\b([^>]*)>/g
const attribute = (attributes: string, name: string): number | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(attributes)
  const number = match?.[1] === undefined ? Number.NaN : Number(match[1])
  return Number.isFinite(number) ? number : null
}

/**
 * Keeps every `step`th point of a line, and always its last, so the line
 * still ends where it ended.
 */
const thin = (line: readonly LatLon[], step: number): LatLon[] => {
  if (step <= 1) return [...line]
  const kept = line.filter((_, index) => index % step === 0)
  const last = line.at(-1)
  if (last !== undefined && kept.at(-1) !== last) kept.push(last)
  return kept
}

/**
 * The lines of a GPX file's track segments and routes. Waypoints are not part
 * of a track. A file with more than `limit` points keeps an evenly spaced
 * share of them. Read with a scan rather than an XML parser, which a 7 MB file
 * would hold in memory as a document.
 */
export const parseGpx = (text: string, limit = maxTrackPoints): Track => {
  const lines: LatLon[][] = []
  let current: LatLon[] | null = null
  for (const match of text.matchAll(tag)) {
    if (match[1] !== undefined) {
      current = []
      lines.push(current)
      continue
    }
    const lat = attribute(match[2] ?? '', 'lat')
    const lon = attribute(match[2] ?? '', 'lon')
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    if (current === null) {
      current = []
      lines.push(current)
    }
    current.push([lat, lon])
  }
  const drawn = lines.filter((line) => line.length > 1)
  const total = drawn.reduce((sum, line) => sum + line.length, 0)
  const step = Math.ceil(total / limit)
  return drawn.map((line) => thin(line, step))
}

/**
 * The vault path of a record's track. A path starting with `/` starts at the
 * vault root; any other starts at `root`, else at the folder of the record's
 * file. `..` steps up a folder.
 */
export const trackPath = (
  value: unknown,
  root: string | null,
  recordFile: string,
): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const text = value.trim()
  const base = text.startsWith('/')
    ? ''
    : root === null
      ? recordFile.split('/').slice(0, -1).join('/')
      : normalizeSource(root)
  const steps: string[] = []
  for (const step of `${base}/${text}`.split('/')) {
    if (step === '' || step === '.') continue
    if (step === '..') steps.pop()
    else steps.push(step)
  }
  return steps.length === 0 ? null : steps.join('/')
}

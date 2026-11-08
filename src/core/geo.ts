import type { Coordinates } from './config.ts'
import { getAt, isGeometry } from './path.ts'

export type LatLon = readonly [lat: number, lon: number]

const asNumber = (value: unknown): number | null => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : null
}

const valid = (lat: number | null, lon: number | null): LatLon | null =>
  lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null

/** A record's position, or `null` when it has none or it is out of range. */
export const pointOf = (data: unknown, coordinates: Coordinates): LatLon | null => {
  if (coordinates.kind === 'pair')
    return valid(asNumber(getAt(data, coordinates.lat)), asNumber(getAt(data, coordinates.lon)))
  const value = getAt(data, coordinates.path)
  const parts = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
  return parts.length === 2 ? valid(asNumber(parts[0]), asNumber(parts[1])) : null
}

export type Geometry = {
  readonly type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString'
  readonly coordinates: unknown
}

const drawable: ReadonlySet<string> = new Set<Geometry['type']>([
  'Polygon',
  'MultiPolygon',
  'LineString',
  'MultiLineString',
])

const isDrawable = (value: unknown): value is Geometry =>
  isGeometry(value) && drawable.has(value.type)

/** A record's boundary when it is a GeoJSON geometry a map can outline. */
export const geometryOf = (data: unknown, path: readonly string[]): Geometry | null => {
  const value = getAt(data, path)
  return isDrawable(value) ? value : null
}

/** The text a `colorBy` value is matched and labelled by; empty for a record without one. */
export const categoryOf = (data: unknown, path: readonly string[]): string => {
  const value = getAt(data, path)
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

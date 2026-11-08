import { isGeometry, isPlainObject, type Path } from './path.ts'
import type { DataRecord } from './source.ts'

/** One piece of a rendered value. A list renders as its parts separated by commas. */
export interface Part {
  readonly text: string
  readonly href?: string
  readonly tone?: 'yes' | 'no' | 'muted'
}

const url = /^https?:\/\/\S+$/i

export const urlLabel = (href: string): string =>
  href
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')

const formatNumber = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 6, useGrouping: false })

const geometryLabel = (geometry: { type: string; coordinates: unknown }): string =>
  geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)
    ? `MultiPolygon, ${geometry.coordinates.length} parts`
    : geometry.type

/** A value as one line of plain text: group headings, map tooltips, card titles. */
export const formatText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(formatText).filter(Boolean).join(', ')
  if (isGeometry(value)) return geometryLabel(value)
  if (isPlainObject(value))
    return Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => `${key}: ${formatText(item)}`)
      .join('; ')
  return ''
}

/** A value as parts for a table cell or card field: links stay links, booleans read Yes or No. */
export const valueParts = (value: unknown): Part[] => {
  if (value === null || value === undefined) return []
  if (typeof value === 'boolean')
    return [value ? { text: 'Yes', tone: 'yes' } : { text: 'No', tone: 'no' }]
  if (typeof value === 'string')
    return url.test(value)
      ? [{ text: urlLabel(value), href: value }]
      : value === ''
        ? []
        : [{ text: value }]
  if (Array.isArray(value)) return value.flatMap(valueParts)
  if (isGeometry(value)) return [{ text: geometryLabel(value), tone: 'muted' }]
  const text = formatText(value)
  return text === '' ? [] : [{ text }]
}

/**
 * The fields a view shows when its `order` is empty: every record's top-level
 * fields in first-seen order, leaving out geometry and `_`-prefixed tags.
 */
export const fieldsOf = (records: readonly DataRecord[]): Path[] => {
  const seen = new Set<string>()
  for (const record of records)
    for (const [key, value] of Object.entries(record.data))
      if (!key.startsWith('_') && !isGeometry(value)) seen.add(key)
  return [...seen].map((key) => [key])
}

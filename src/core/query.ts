import { getAt, type Path } from './path.ts'
import type { DataRecord } from './source.ts'

export type Scalar = string | number | boolean | null

export type Direction = 'ASC' | 'DESC'

export interface SortKey {
  readonly path: Path
  readonly direction: Direction
}

/** Each condition keeps a record whose value at `path` is one of `values`. */
export interface WhereCondition {
  readonly path: Path
  readonly values: readonly Scalar[]
}

export type Where = readonly WhereCondition[]

const isMissing = (value: unknown): value is null | undefined =>
  value === null || value === undefined

/**
 * A list value matches when any of its items does, so `where: { sources: osm }`
 * keeps the records whose `sources` include `osm`.
 */
const matchesCondition = (value: unknown, condition: WhereCondition): boolean => {
  if (Array.isArray(value)) return value.some((item) => matchesCondition(item, condition))
  if (isMissing(value)) return condition.values.includes(null)
  return condition.values.some((expected) => expected === value)
}

export const matchesWhere = (record: DataRecord, where: Where): boolean =>
  where.every((condition) => matchesCondition(getAt(record.data, condition.path), condition))

export const searchTerms = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '')

/** Every term must appear in some field. */
export const matchesSearch = (record: DataRecord, terms: readonly string[]): boolean =>
  terms.every((term) => record.text.includes(term))

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const typeRank = (value: unknown): number => {
  if (typeof value === 'boolean') return 0
  if (typeof value === 'number') return 1
  if (typeof value === 'string') return 2
  if (Array.isArray(value)) return 3
  return 4
}

const asText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map(asText).join(', ')
      : JSON.stringify(value)

/** Orders two present values: booleans, then numbers, then text, then lists, then objects. */
export const compareValues = (a: unknown, b: unknown): number => {
  const rank = typeRank(a) - typeRank(b)
  if (rank !== 0) return rank
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return collator.compare(asText(a), asText(b))
}

/** Compares in `direction`, with missing values last either way. */
const compareDirected = (a: unknown, b: unknown, direction: Direction): number => {
  const aMissing = isMissing(a)
  const bMissing = isMissing(b)
  if (aMissing || bMissing) return Number(aMissing) - Number(bMissing)
  const order = compareValues(a, b)
  return direction === 'ASC' ? order : -order
}

/** A stable sort: records equal on every key keep their source order. */
export const sortRecords = (
  records: readonly DataRecord[],
  keys: readonly SortKey[],
): DataRecord[] => {
  if (keys.length === 0) return [...records]
  return records.toSorted((a, b) => {
    for (const key of keys) {
      const order = compareDirected(getAt(a.data, key.path), getAt(b.data, key.path), key.direction)
      if (order !== 0) return order
    }
    return 0
  })
}

export interface Group {
  /** The value every record in the group has at the group path; `undefined` for the records without one. */
  readonly value: unknown
  readonly records: readonly DataRecord[]
}

const groupKey = (value: unknown): string =>
  isMissing(value)
    ? '\u0000missing'
    : typeof value === 'string'
      ? `s:${value}`
      : `j:${JSON.stringify(value)}`

/**
 * Splits already sorted records into groups by the value at `by.path`, keeping
 * their order inside each group. Groups are ordered by value in `by.direction`,
 * and the group without a value comes last.
 */
export const groupRecords = (records: readonly DataRecord[], by: SortKey): Group[] => {
  const groups = new Map<string, { value: unknown; records: DataRecord[] }>()
  for (const record of records) {
    const raw = getAt(record.data, by.path)
    const value = isMissing(raw) ? undefined : raw
    const key = groupKey(value)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { value, records: [record] })
    else group.records.push(record)
  }
  return [...groups.values()].toSorted((a, b) => compareDirected(a.value, b.value, by.direction))
}

export interface Query {
  readonly where: Where
  readonly search: string
  readonly sort: readonly SortKey[]
}

/** The rows a view shows: those matching `where` and the search, in sort order. */
export const runQuery = (records: readonly DataRecord[], query: Query): DataRecord[] => {
  const terms = searchTerms(query.search)
  return sortRecords(
    records.filter((record) => matchesWhere(record, query.where) && matchesSearch(record, terms)),
    query.sort,
  )
}

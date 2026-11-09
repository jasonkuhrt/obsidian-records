import { getAt, type Path } from './path.ts'
import type { DataRecord } from './source.ts'

export type Scalar = string | number | boolean | null

export type Direction = 'ASC' | 'DESC'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export interface SortKey {
  readonly path: Path
  readonly direction: Direction
}

/**
 * One test a value must pass. A plain value or list in `where` is `is`; an
 * object such as `{ min: 4.5 }` or `{ contains: Ski }` names the others.
 */
export type Test =
  /** The value is one of `values`; `null` stands for a missing value. */
  | { readonly kind: 'is'; readonly values: readonly Scalar[] }
  /** The value is none of `values`. */
  | { readonly kind: 'not'; readonly values: readonly Scalar[] }
  /** The text contains one of `texts`, ignoring case. */
  | { readonly kind: 'contains'; readonly texts: readonly string[] }
  /** The value is at least `value`: numbers by number, text by text. */
  | { readonly kind: 'min'; readonly value: number | string }
  /** The value is at most `value`. */
  | { readonly kind: 'max'; readonly value: number | string }
  /** The value is there (`true`) or missing (`false`); empty text and lists count as missing. */
  | { readonly kind: 'present'; readonly value: boolean }

/** Keeps a record whose value at `path` passes `test`. */
export interface WhereCondition {
  readonly path: Path
  readonly test: Test
}

export type Where = readonly WhereCondition[]

const isMissing = (value: unknown): value is null | undefined =>
  value === null || value === undefined

const isEmpty = (value: unknown): boolean =>
  isMissing(value) || value === '' || (Array.isArray(value) && value.length === 0)

const isOneOf = (value: unknown, values: readonly Scalar[]): boolean => {
  if (Array.isArray(value)) return value.some((item) => isOneOf(item, values))
  if (isMissing(value)) return values.includes(null)
  return values.some((expected) => expected === value)
}

const contains = (value: unknown, texts: readonly string[]): boolean => {
  if (Array.isArray(value)) return value.some((item) => contains(item, texts))
  if (typeof value !== 'string') return false
  const lower = value.toLowerCase()
  return texts.some((text) => lower.includes(text.toLowerCase()))
}

/** Numbers compare with numbers and text with text; anything else never passes. */
const bound = (
  value: unknown,
  limit: number | string,
  keep: (order: number) => boolean,
): boolean => {
  if (Array.isArray(value)) return value.some((item) => bound(item, limit, keep))
  if (typeof value === 'number' && typeof limit === 'number') return keep(value - limit)
  if (typeof value === 'string' && typeof limit === 'string')
    return keep(collator.compare(value, limit))
  return false
}

/** A list value passes `is`, `contains`, `min` and `max` when one of its items does. */
const passes = (value: unknown, test: Test): boolean => {
  if (test.kind === 'is') return isOneOf(value, test.values)
  if (test.kind === 'not') return !isOneOf(value, test.values)
  if (test.kind === 'contains') return contains(value, test.texts)
  if (test.kind === 'min') return bound(value, test.value, (order) => order >= 0)
  if (test.kind === 'max') return bound(value, test.value, (order) => order <= 0)
  return isEmpty(value) !== test.value
}

export const matchesWhere = (record: DataRecord, where: Where): boolean =>
  where.every((condition) => passes(getAt(record.data, condition.path), condition.test))

/**
 * The records that name the page a view sits on: one of `fields` holds one of
 * `values`, the values the view's `match` formula gave for that page.
 */
export interface PageMatch {
  readonly fields: readonly Path[]
  readonly values: readonly string[]
}

/** No match keeps every record; a match with no values or no fields keeps none. */
export const matchesPage = (record: DataRecord, match: PageMatch | null): boolean =>
  match === null ||
  (match.values.length > 0 &&
    match.fields.some((path) => isOneOf(getAt(record.data, path), match.values)))

export const searchTerms = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '')

/** Every term must appear in some field. */
export const matchesSearch = (record: DataRecord, terms: readonly string[]): boolean =>
  terms.every((term) => record.text.includes(term))

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
  /** The page the view sits on, when its `match` names one. */
  readonly page?: PageMatch | null
  readonly search: string
  readonly sort: readonly SortKey[]
}

/** The rows a view shows: those matching `where`, the page and the search, in sort order. */
export const runQuery = (records: readonly DataRecord[], query: Query): DataRecord[] => {
  const terms = searchTerms(query.search)
  const page = query.page ?? null
  return sortRecords(
    records.filter(
      (record) =>
        matchesWhere(record, query.where) &&
        matchesPage(record, page) &&
        matchesSearch(record, terms),
    ),
    query.sort,
  )
}

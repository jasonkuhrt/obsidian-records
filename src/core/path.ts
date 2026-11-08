/**
 * A field path into a record: `name`, or a nested one such as
 * `wildernessCamping.status`. An integer step indexes into a list.
 */
export type Path = readonly string[]

export const parsePath = (text: string): Path =>
  text
    .trim()
    .split('.')
    .filter((step) => step !== '')

/**
 * The field a Bases property id names. Bases keeps a view's `order`, `sort`
 * and `groupBy` as property ids, `note.<field>`, so `note.name` is the field
 * `name` and `note.note.status` the field `note.status`.
 */
export const parsePropertyId = (id: string): Path => parsePath(id.trim().replace(/^note\./, ''))

export const formatPath = (path: Path): string => path.join('.')

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const getAt = (value: unknown, path: Path): unknown => {
  let current = value
  for (const step of path) {
    if (Array.isArray(current) && /^\d+$/.test(step)) current = current[Number(step)]
    else if (isPlainObject(current)) current = current[step]
    else return undefined
  }
  return current
}

/**
 * A GeoJSON geometry such as a park boundary. Search, cells and detail summarize
 * it instead of spelling out its coordinates.
 */
export const isGeometry = (value: unknown): value is { type: string; coordinates: unknown } =>
  isPlainObject(value) && typeof value['type'] === 'string' && Array.isArray(value['coordinates'])

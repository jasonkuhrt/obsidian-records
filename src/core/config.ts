import { isPlainObject, parsePath, type Path } from './path.ts'
import type { Direction, Scalar, SortKey, Where } from './query.ts'

/** Reads one key of a view's entry in the `.base` file, as `BasesViewConfig.get` does. */
export type ConfigGet = (key: string) => unknown

export interface ListConfig {
  readonly source: string | null
  /** The columns, or for cards the fields; empty means the records' own top-level fields. */
  readonly order: readonly Path[]
  readonly sort: readonly SortKey[]
  readonly groupBy: SortKey | null
  readonly where: Where
  readonly title: Path
}

export type Coordinates =
  | { readonly kind: 'pair'; readonly lat: Path; readonly lon: Path }
  /** One field holding `[lat, lon]` or the text `"lat, lon"`. */
  | { readonly kind: 'single'; readonly path: Path }

export interface MapLayerConfig {
  readonly name: string
  readonly source: string | null
  readonly where: Where
  readonly title: Path
  readonly coordinates: Coordinates | null
  readonly boundary: Path | null
  readonly colorBy: Path | null
  /** Pin colors by the `colorBy` value, written as text (`true`, `permitted`). */
  readonly colors: Readonly<Record<string, string>>
  readonly color: string | null
}

export interface MapConfig {
  readonly layers: readonly MapLayerConfig[]
  readonly tiles: string | null
  /** Where the map opens; without it, the map frames every pin. */
  readonly center: readonly [lat: number, lon: number] | null
  readonly zoom: number | null
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const asPaths = (value: unknown): Path[] => {
  if (typeof value === 'string') return [parsePath(value)].filter((path) => path.length > 0)
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => asPaths(item))
}

const asPath = (value: unknown): Path | null => asPaths(value)[0] ?? null

const asDirection = (value: unknown): Direction =>
  typeof value === 'string' && value.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'

const asSortKey = (value: unknown): SortKey | null => {
  if (typeof value === 'string') {
    const path = asPath(value)
    return path === null ? null : { path, direction: 'ASC' }
  }
  if (!isPlainObject(value)) return null
  const path = asPath(value['property'])
  return path === null ? null : { path, direction: asDirection(value['direction']) }
}

/** Bases' own shape, `[{ property, direction }]`; a bare field name sorts ascending. */
export const parseSort = (value: unknown): SortKey[] => {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return items.map(asSortKey).filter((key): key is SortKey => key !== null)
}

/** Bases' own shape, `{ property, direction }`, or a bare field name. */
export const parseGroupBy = (value: unknown): SortKey | null => asSortKey(value)

const isScalar = (value: unknown): value is Scalar =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value)

/** `{ <path>: <value> | [<value>, …] }`: every path must hold one of its values. */
export const parseWhere = (value: unknown): Where => {
  if (!isPlainObject(value)) return []
  return Object.entries(value).flatMap(([key, expected]) => {
    const path = parsePath(key)
    const values = (Array.isArray(expected) ? expected : [expected]).filter(isScalar)
    return path.length === 0 || values.length === 0 ? [] : [{ path, values }]
  })
}

export const parseCoordinates = (value: unknown): Coordinates | null => {
  const paths = asPaths(value)
  const [lat, lon] = paths
  if (Array.isArray(value) && lat !== undefined && lon !== undefined)
    return { kind: 'pair', lat, lon }
  if (lat !== undefined && !Array.isArray(value)) return { kind: 'single', path: lat }
  return null
}

const parseColors = (value: unknown): Record<string, string> => {
  if (!isPlainObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, color]) => {
      const text = asString(color)
      return text === null ? [] : [[key, text]]
    }),
  )
}

const defaultTitle: Path = ['name']

export const parseListConfig = (get: ConfigGet): ListConfig => ({
  source: asString(get('source')),
  order: asPaths(get('order')),
  sort: parseSort(get('sort')),
  groupBy: parseGroupBy(get('groupBy')),
  where: parseWhere(get('where')),
  title: asPath(get('title')) ?? defaultTitle,
})

const parseLayer = (get: ConfigGet, fallbackName: string): MapLayerConfig => {
  const source = asString(get('source'))
  return {
    name: asString(get('name')) ?? source?.split('/').filter(Boolean).at(-1) ?? fallbackName,
    source,
    where: parseWhere(get('where')),
    title: asPath(get('title')) ?? defaultTitle,
    coordinates: parseCoordinates(get('coordinates')),
    boundary: asPath(get('boundary')),
    colorBy: asPath(get('colorBy')),
    colors: parseColors(get('colors')),
    color: asString(get('color')),
  }
}

/**
 * A map view is one layer written on the view itself, or several under
 * `layers`, each with the same keys plus a `name`.
 */
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const parseCenter = (value: unknown): readonly [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null
  const lat = asNumber(value[0])
  const lon = asNumber(value[1])
  return lat === null || lon === null ? null : [lat, lon]
}

export const parseMapConfig = (get: ConfigGet): MapConfig => {
  const layers = get('layers')
  const view = {
    tiles: asString(get('tiles')),
    center: parseCenter(get('center')),
    zoom: asNumber(get('zoom')),
  }
  if (Array.isArray(layers))
    return {
      ...view,
      layers: layers
        .filter(isPlainObject)
        .map((layer, index) => parseLayer((key) => layer[key], `Layer ${index + 1}`)),
    }
  // A single layer is the view itself, so the legend shows the view's name.
  return { ...view, layers: [parseLayer(get, 'Records')] }
}

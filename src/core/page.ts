/**
 * What Bases gives back for a formula: a `Value` from Obsidian's API. Only the
 * methods read here are named, so this file runs without Obsidian.
 */
interface ValueLike {
  toString(): string
  isTruthy(): boolean
}

interface ListValueLike extends ValueLike {
  length(): number
  get(index: number): unknown
}

const isValue = (value: unknown): value is ValueLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'isTruthy') === 'function' &&
  typeof Reflect.get(value, 'toString') === 'function'

const isListValue = (value: unknown): value is ListValueLike =>
  isValue(value) &&
  typeof Reflect.get(value, 'length') === 'function' &&
  typeof Reflect.get(value, 'get') === 'function'

/**
 * The page values a `match` formula gave, as text: a list gives each of its
 * items, and a value that isn't truthy (no value, empty text) gives none.
 */
export const pageValues = (value: unknown): string[] => {
  if (isListValue(value))
    return Array.from({ length: value.length() }, (_, index) => pageValues(value.get(index))).flat()
  if (isValue(value)) return value.isTruthy() ? [value.toString()] : []
  return []
}

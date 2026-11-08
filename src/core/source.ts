import { isGeometry, isPlainObject } from './path.ts'

/**
 * The part of Obsidian's `DataAdapter` a source is read through. It reaches
 * dot folders such as `.odyssey/`, which the vault index never sees.
 */
export interface SourceFs {
  stat(path: string): Promise<{ type: 'file' | 'folder' } | null>
  list(path: string): Promise<{ files: string[]; folders: string[] }>
  read(path: string): Promise<string>
}

export type ParseYaml = (text: string) => unknown

export interface DataRecord {
  /** The file's vault path, plus `#<index>` for an item of a file that holds a list. */
  readonly id: string
  readonly file: string
  readonly data: Readonly<Record<string, unknown>>
  /** Every scalar value, lowercased, one per line: what search matches against. */
  readonly text: string
}

export interface SourceProblem {
  readonly file: string
  readonly message: string
}

export interface LoadedSource {
  readonly source: string
  readonly records: readonly DataRecord[]
  readonly problems: readonly SourceProblem[]
}

const dataFile = /\.(json|ya?ml)$/i

/** How many files a source reads at once. */
export const readConcurrency = 128

/** A vault path as written in a view, without `./`, a leading slash or a trailing one. */
export const normalizeSource = (source: string): string =>
  source
    .trim()
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

const scalarLines = (value: unknown, lines: string[]): void => {
  if (value === null || value === undefined) return
  if (typeof value === 'string') lines.push(value.toLowerCase())
  else if (typeof value === 'number' || typeof value === 'boolean') lines.push(String(value))
  else if (Array.isArray(value)) for (const item of value) scalarLines(item, lines)
  else if (isPlainObject(value) && !isGeometry(value))
    for (const item of Object.values(value)) scalarLines(item, lines)
}

export const searchText = (data: unknown): string => {
  const lines: string[] = []
  scalarLines(data, lines)
  return lines.join('\n')
}

const parse = (file: string, text: string, parseYaml: ParseYaml): unknown =>
  /\.json$/i.test(file) ? JSON.parse(text) : parseYaml(text)

/**
 * A file holds one record (an object) or a list of records. Anything else is a
 * problem the view reports instead of a row.
 */
const recordsOf = (
  file: string,
  value: unknown,
): { records: DataRecord[]; problems: SourceProblem[] } => {
  const make = (id: string, data: Record<string, unknown>): DataRecord => ({
    id,
    file,
    data,
    text: searchText(data),
  })
  if (isPlainObject(value)) return { records: [make(file, value)], problems: [] }
  if (Array.isArray(value)) {
    const records: DataRecord[] = []
    const problems: SourceProblem[] = []
    value.forEach((item, index) => {
      if (isPlainObject(item)) records.push(make(`${file}#${index}`, item))
      else problems.push({ file, message: `item ${index} is not an object` })
    })
    return { records, problems }
  }
  return {
    records: [],
    problems: [{ file, message: 'holds neither a record nor a list of records' }],
  }
}

const mapLimit = async <A, B>(
  items: readonly A[],
  limit: number,
  run: (item: A) => Promise<B>,
): Promise<B[]> => {
  const results: B[] = Array.from({ length: items.length })
  // The workers share one iterator, so each item is taken exactly once.
  const queue = items.entries()
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue)
      // oxlint-disable-next-line no-await-in-loop -- a worker reads one file at a time
      results[index] = await run(item)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The data files a source names, in name order; a problem when it can't be found or read. */
const filesOf = async (fs: SourceFs, source: string): Promise<string[] | SourceProblem> => {
  try {
    const stat = await fs.stat(source)
    if (stat === null) return { file: source, message: 'not found' }
    if (stat.type === 'file') return [source]
    return (await fs.list(source)).files
      .filter((file) => dataFile.test(file))
      .toSorted((a, b) => a.localeCompare(b))
  } catch (error) {
    return { file: source, message: errorMessage(error) }
  }
}

/**
 * Read a view's `source`: a folder of `.json`, `.yaml` or `.yml` files, one
 * record each, or one such file. Files load in name order, so rows have a
 * stable order before any sort. Whatever can't be read is a problem the view
 * reports; loading never fails.
 */
export const loadSource = async (
  fs: SourceFs,
  parseYaml: ParseYaml,
  rawSource: string,
): Promise<LoadedSource> => {
  const source = normalizeSource(rawSource)
  const files = await filesOf(fs, source)
  if (!Array.isArray(files)) return { source, records: [], problems: [files] }
  const loaded = await mapLimit(files, readConcurrency, async (file) => {
    try {
      return recordsOf(file, parse(file, await fs.read(file), parseYaml))
    } catch (error) {
      return { records: [], problems: [{ file, message: errorMessage(error) }] }
    }
  })
  return {
    source,
    records: loaded.flatMap((result) => result.records),
    problems: loaded.flatMap((result) => result.problems),
  }
}

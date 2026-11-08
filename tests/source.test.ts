import { describe, expect, test } from 'bun:test'
import { parse as parseYaml } from 'yaml'
import {
  loadSource,
  normalizeSource,
  readConcurrency,
  searchText,
  type SourceFs,
} from '../src/core/source.ts'

/** A vault held in memory: file paths to their text. Folders are implied by the paths. */
const memoryFs = (files: Record<string, string>): SourceFs => {
  const isFolder = (path: string) => Object.keys(files).some((file) => file.startsWith(`${path}/`))
  return {
    stat: async (path) =>
      path in files ? { type: 'file' } : isFolder(path) ? { type: 'folder' } : null,
    list: async (path) => ({
      files: Object.keys(files).filter(
        (file) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/'),
      ),
      folders: [],
    }),
    read: async (path) => {
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      return text
    },
  }
}

describe('loadSource', () => {
  test('a folder gives one record per JSON or YAML file, in name order', async () => {
    const fs = memoryFs({
      '.data/parks/b.json': '{"name":"Banff"}',
      '.data/parks/a.yaml': 'name: Assiniboine\nlat: 50.9',
      '.data/parks/c.yml': 'name: Cypress',
      '.data/parks/notes.md': '# not a record',
      '.data/parks/nested/d.json': '{"name":"Deep"}',
    })
    const loaded = await loadSource(fs, parseYaml, '.data/parks')
    expect(loaded.records.map((record) => record.data['name'])).toEqual([
      'Assiniboine',
      'Banff',
      'Cypress',
    ])
    expect(loaded.records[0]?.data['lat']).toBe(50.9)
    expect(loaded.records[0]?.id).toBe('.data/parks/a.yaml')
    expect(loaded.problems).toEqual([])
  })

  test('a file holding a list gives one record per item, each with its own id', async () => {
    const fs = memoryFs({ 'places.yaml': '- name: One\n- name: Two\n- 3\n' })
    const loaded = await loadSource(fs, parseYaml, 'places.yaml')
    expect(loaded.records.map((record) => [record.id, record.data['name']])).toEqual([
      ['places.yaml#0', 'One'],
      ['places.yaml#1', 'Two'],
    ])
    expect(loaded.problems).toEqual([{ file: 'places.yaml', message: 'item 2 is not an object' }])
  })

  test('a file holding one record gives that record', async () => {
    const loaded = await loadSource(
      memoryFs({ 'one.json': '{"name":"Solo"}' }),
      parseYaml,
      'one.json',
    )
    expect(loaded.records.map((record) => record.data['name'])).toEqual(['Solo'])
  })

  test('a broken file is a problem, and its siblings still load', async () => {
    const fs = memoryFs({
      'set/good.json': '{"name":"Good"}',
      'set/bad.json': '{"name":',
      'set/scalar.json': '42',
    })
    const loaded = await loadSource(fs, parseYaml, 'set')
    expect(loaded.records.map((record) => record.data['name'])).toEqual(['Good'])
    expect(loaded.problems.map((problem) => problem.file).toSorted()).toEqual([
      'set/bad.json',
      'set/scalar.json',
    ])
  })

  test('a missing source is a problem, not an error', async () => {
    const loaded = await loadSource(memoryFs({}), parseYaml, 'nowhere')
    expect(loaded.records).toEqual([])
    expect(loaded.problems).toEqual([{ file: 'nowhere', message: 'not found' }])
  })

  test('a source path is read the same with ./, a leading slash or a trailing one', async () => {
    const fs = memoryFs({ 'set/a.json': '{"name":"A"}' })
    const loaded = await Promise.all(
      ['./set', '/set/', 'set/'].map((written) => loadSource(fs, parseYaml, written)),
    )
    expect(loaded.map((source) => source.records.length)).toEqual([1, 1, 1])
    expect(normalizeSource(' ./.odyssey/park/records/ ')).toBe('.odyssey/park/records')
  })

  test('reads many files with a bounded number in flight', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [
        `big/${String(index).padStart(3, '0')}.json`,
        `{"n":${index}}`,
      ]),
    )
    let inFlight = 0
    let peak = 0
    const base = memoryFs(files)
    const fs: SourceFs = {
      ...base,
      read: async (path) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await Bun.sleep(0)
        inFlight--
        return base.read(path)
      },
    }
    const loaded = await loadSource(fs, parseYaml, 'big')
    expect(loaded.records.map((record) => record.data['n'])).toEqual(
      Array.from({ length: 500 }, (_, index) => index),
    )
    expect(peak).toBe(readConcurrency)
  })
})

describe('searchText', () => {
  test('holds every scalar, lowercased, and leaves geometry out', () => {
    const text = searchText({
      name: 'Banff',
      nested: { status: 'Permitted', open: true },
      tags: ['A', 2],
      boundary: { type: 'Polygon', coordinates: [[[1, 2]]] },
    })
    expect(text.split('\n')).toEqual(['banff', 'permitted', 'true', 'a', '2'])
  })
})

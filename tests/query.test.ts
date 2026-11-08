import { describe, expect, test } from 'bun:test'
import { parseWhere } from '../src/core/config.ts'
import { getAt, parsePath } from '../src/core/path.ts'
import {
  groupRecords,
  matchesSearch,
  matchesWhere,
  runQuery,
  searchTerms,
  sortRecords,
} from '../src/core/query.ts'
import { searchText, type DataRecord } from '../src/core/source.ts'

const record = (id: string, data: Record<string, unknown>): DataRecord => ({
  id,
  file: id,
  data,
  text: searchText(data),
})

const names = (records: readonly DataRecord[]) => records.map((item) => item.data['name'])

const parks = [
  record('a', { name: 'Assiniboine', area: 39, wild: { status: 'permitted' }, sources: ['bc'] }),
  record('b', {
    name: 'banff',
    area: 6641,
    wild: { status: 'unknown' },
    sources: ['cpcad', 'osm'],
  }),
  record('c', { name: 'Cypress', area: null, wild: { status: 'permitted' }, sources: [] }),
  record('d', { name: 'Park 10', area: 39, wild: {}, sources: ['osm'] }),
  record('e', { name: 'Park 9', wild: { status: 'not-permitted' }, sources: ['bc'] }),
]

describe('paths', () => {
  test('a nested path reaches into objects and indexes lists', () => {
    const data = { wild: { status: 'permitted' }, sources: ['bc', 'osm'] }
    expect(getAt(data, parsePath('wild.status'))).toBe('permitted')
    expect(getAt(data, parsePath('sources.1'))).toBe('osm')
    expect(getAt(data, parsePath('wild.status.deeper'))).toBeUndefined()
    expect(getAt(data, parsePath('missing.status'))).toBeUndefined()
  })

  test('a Bases property id reads as the field it names', () => {
    expect(parsePath('note.wild.status')).toEqual(['wild', 'status'])
  })
})

describe('where', () => {
  test('keeps records whose value at a nested path is one of the listed values', () => {
    const where = parseWhere({ 'wild.status': ['permitted', 'unknown'] })
    expect(names(parks.filter((item) => matchesWhere(item, where)))).toEqual([
      'Assiniboine',
      'banff',
      'Cypress',
    ])
  })

  test('a list value matches when one of its items does', () => {
    const where = parseWhere({ sources: 'osm' })
    expect(names(parks.filter((item) => matchesWhere(item, where)))).toEqual(['banff', 'Park 10'])
  })

  test('null matches a missing value, and conditions all apply', () => {
    expect(names(parks.filter((item) => matchesWhere(item, parseWhere({ area: null }))))).toEqual([
      'Cypress',
      'Park 9',
    ])
    const both = parseWhere({ area: 39, 'wild.status': 'permitted' })
    expect(names(parks.filter((item) => matchesWhere(item, both)))).toEqual(['Assiniboine'])
  })

  test('booleans match by value, not by text', () => {
    const camps = [
      record('x', { name: 'Back', back: true }),
      record('y', { name: 'Front', back: false }),
    ]
    expect(names(camps.filter((item) => matchesWhere(item, parseWhere({ back: false }))))).toEqual([
      'Front',
    ])
    expect(
      names(camps.filter((item) => matchesWhere(item, parseWhere({ back: 'false' })))),
    ).toEqual([])
  })
})

describe('where operators', () => {
  const trips = [
    record('1', {
      name: 'Ski Tour',
      activity: 'Alpine Ski',
      stars: 5,
      date: '2019-08-03',
      gpx: 'a.gpx',
    }),
    record('2', {
      name: 'Scramble',
      activity: 'Scramble',
      stars: 4,
      date: '2020-07-12',
      gpx: null,
    }),
    record('3', { name: 'Walk', activity: 'Hike', stars: 2.5, date: '2021-08-30', gpx: '' }),
    record('4', { name: 'Unknown', tiers: [{ price: 3 }, { price: 9 }] }),
  ]
  const kept = (where: unknown) =>
    names(trips.filter((item) => matchesWhere(item, parseWhere(where))))

  test('min and max keep numbers within the bound, inclusive, and drop missing values', () => {
    expect(kept({ stars: { min: 4 } })).toEqual(['Ski Tour', 'Scramble'])
    expect(kept({ stars: { max: 4 } })).toEqual(['Scramble', 'Walk'])
    expect(kept({ stars: { min: 3, max: 4.5 } })).toEqual(['Scramble'])
  })

  test('min and max compare text with text, so dates written YYYY-MM-DD bound by date', () => {
    expect(kept({ date: { min: '2020-01-01' } })).toEqual(['Scramble', 'Walk'])
    expect(kept({ stars: { min: '3' } })).toEqual([])
  })

  test('contains matches part of the text, ignoring case, and a list means any of them', () => {
    expect(kept({ activity: { contains: 'ski' } })).toEqual(['Ski Tour'])
    expect(kept({ activity: { contains: ['SKI', 'hike'] } })).toEqual(['Ski Tour', 'Walk'])
    expect(kept({ date: { contains: '-08-' } })).toEqual(['Ski Tour', 'Walk'])
  })

  test('not keeps every record whose value is none of the listed ones, missing included', () => {
    expect(kept({ activity: { not: ['Scramble', 'Hike'] } })).toEqual(['Ski Tour', 'Unknown'])
    expect(kept({ activity: { not: null } })).toEqual(['Ski Tour', 'Scramble', 'Walk'])
  })

  test('present tells a value from a missing one, empty text counting as missing', () => {
    expect(kept({ gpx: { present: true } })).toEqual(['Ski Tour'])
    expect(kept({ gpx: { present: false } })).toEqual(['Scramble', 'Walk', 'Unknown'])
    expect(kept({ 'tiers.1': { present: true } })).toEqual(['Unknown'])
  })

  test('is is the plain form, and unknown operators or empty operands add no test', () => {
    expect(parseWhere({ activity: { is: 'Hike' } })).toEqual(parseWhere({ activity: 'Hike' }))
    expect(parseWhere({ activity: { near: 'Hike', contains: [] }, stars: { min: 'x' } })).toEqual([
      { path: ['stars'], test: { kind: 'min', value: 'x' } },
    ])
  })
})

describe('search', () => {
  test('every term must appear in some field, ignoring case', () => {
    const terms = searchTerms('  BANFF  osm ')
    expect(terms).toEqual(['banff', 'osm'])
    expect(names(parks.filter((item) => matchesSearch(item, terms)))).toEqual(['banff'])
  })

  test('matches inside nested fields and part of a word', () => {
    expect(names(parks.filter((item) => matchesSearch(item, searchTerms('not-perm'))))).toEqual([
      'Park 9',
    ])
  })

  test('an empty search keeps everything', () => {
    expect(parks.filter((item) => matchesSearch(item, searchTerms('   ')))).toHaveLength(5)
  })
})

describe('sort', () => {
  test('text sorts ignoring case and with numbers in natural order', () => {
    const sorted = sortRecords(parks, [{ path: ['name'], direction: 'ASC' }])
    expect(names(sorted)).toEqual(['Assiniboine', 'banff', 'Cypress', 'Park 9', 'Park 10'])
  })

  test('missing values come last in both directions', () => {
    expect(names(sortRecords(parks, [{ path: ['area'], direction: 'ASC' }]))).toEqual([
      'Assiniboine',
      'Park 10',
      'banff',
      'Cypress',
      'Park 9',
    ])
    expect(names(sortRecords(parks, [{ path: ['area'], direction: 'DESC' }]))).toEqual([
      'banff',
      'Assiniboine',
      'Park 10',
      'Cypress',
      'Park 9',
    ])
  })

  test('later keys break ties, and full ties keep source order', () => {
    const sorted = sortRecords(parks, [
      { path: ['area'], direction: 'ASC' },
      { path: ['name'], direction: 'DESC' },
    ])
    expect(names(sorted).slice(0, 2)).toEqual(['Park 10', 'Assiniboine'])
    const ties = sortRecords(parks, [{ path: ['wild', 'status'], direction: 'ASC' }])
    expect(names(ties)).toEqual(['Park 9', 'Assiniboine', 'Cypress', 'banff', 'Park 10'])
  })

  test('numbers compare as numbers and booleans false before true', () => {
    const items = [
      record('1', { name: 'ten', n: 10, b: true }),
      record('2', { name: 'nine', n: 9, b: false }),
    ]
    expect(names(sortRecords(items, [{ path: ['n'], direction: 'ASC' }]))).toEqual(['nine', 'ten'])
    expect(names(sortRecords(items, [{ path: ['b'], direction: 'DESC' }]))).toEqual(['ten', 'nine'])
  })

  test('sorting leaves the input as it was', () => {
    const before = names(parks)
    sortRecords(parks, [{ path: ['name'], direction: 'DESC' }])
    expect(names(parks)).toEqual(before)
  })
})

describe('group', () => {
  test('groups keep the sort inside them, order by value, and put the missing group last', () => {
    const sorted = sortRecords(parks, [{ path: ['name'], direction: 'ASC' }])
    const groups = groupRecords(sorted, { path: ['wild', 'status'], direction: 'ASC' })
    expect(groups.map((group) => [group.value, names(group.records)])).toEqual([
      ['not-permitted', ['Park 9']],
      ['permitted', ['Assiniboine', 'Cypress']],
      ['unknown', ['banff']],
      [undefined, ['Park 10']],
    ])
    const descending = groupRecords(sorted, { path: ['wild', 'status'], direction: 'DESC' })
    expect(descending.map((group) => group.value)).toEqual([
      'unknown',
      'permitted',
      'not-permitted',
      undefined,
    ])
  })
})

describe('runQuery', () => {
  test('filters by where and search, then sorts', () => {
    const rows = runQuery(parks, {
      where: parseWhere({ sources: ['bc', 'osm'] }),
      search: 'park',
      sort: [{ path: ['name'], direction: 'DESC' }],
    })
    expect(names(rows)).toEqual(['Park 10', 'Park 9'])
  })
})

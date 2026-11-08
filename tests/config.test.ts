import { describe, expect, test } from 'bun:test'
import { parse as parseYaml } from 'yaml'
import { parseListConfig, parseMapConfig } from '../src/core/config.ts'
import { geometryOf, pointOf } from '../src/core/geo.ts'

/** A view's entry in a `.base` file, read the way `BasesViewConfig.get` reads it. */
const view = (yaml: string) => {
  const parsed: unknown = parseYaml(yaml)
  const entry = parsed !== null && typeof parsed === 'object' ? parsed : {}
  return (key: string): unknown => (entry as Record<string, unknown>)[key]
}

describe('list views', () => {
  test('read the keys of the approved Hiking design', () => {
    const settings = parseListConfig(
      view(`
type: records
name: Campgrounds
source: .odyssey/campground/records
order: [name, backcountry, wildernessCamping.status]
sort: [{ property: name, direction: DESC }]
groupBy: { property: jurisdiction, direction: ASC }
where: { backcountry: true, reservation: [reservation, both] }
`),
    )
    expect(settings).toEqual({
      source: '.odyssey/campground/records',
      order: [['name'], ['backcountry'], ['wildernessCamping', 'status']],
      sort: [{ path: ['name'], direction: 'DESC' }],
      groupBy: { path: ['jurisdiction'], direction: 'ASC' },
      where: [
        { path: ['backcountry'], values: [true] },
        { path: ['reservation'], values: ['reservation', 'both'] },
      ],
      title: ['name'],
    })
  })

  test('accept what Bases writes back and fill in defaults', () => {
    const settings = parseListConfig(
      view(`
source: data
sort: [{ property: note.name, direction: ASC }, fee]
groupBy: note.park
title: label
`),
    )
    expect(settings.sort).toEqual([
      { path: ['name'], direction: 'ASC' },
      { path: ['fee'], direction: 'ASC' },
    ])
    expect(settings.groupBy).toEqual({ path: ['park'], direction: 'ASC' })
    expect(settings.order).toEqual([])
    expect(settings.where).toEqual([])
    expect(settings.title).toEqual(['label'])
  })

  test('a view without a source says so with null', () => {
    expect(parseListConfig(view('name: Empty')).source).toBeNull()
  })
})

describe('map views', () => {
  test('a view with its own source is one layer named after the view', () => {
    const settings = parseMapConfig(
      view(`
name: Campgrounds map
source: .odyssey/campground/records
coordinates: [lat, lon]
colorBy: backcountry
colors: { true: purple, false: green }
`),
    )
    expect(settings.tiles).toBeNull()
    expect(settings.layers).toEqual([
      {
        name: 'Campgrounds map',
        source: '.odyssey/campground/records',
        where: [],
        title: ['name'],
        coordinates: { kind: 'pair', lat: ['lat'], lon: ['lon'] },
        boundary: null,
        colorBy: ['backcountry'],
        colors: { true: 'purple', false: 'green' },
        color: null,
      },
    ])
  })

  test('layers each carry their own source, filter and style', () => {
    const settings = parseMapConfig(
      view(`
name: Map
tiles: https://tile.example/{z}/{x}/{y}.png
layers:
  - name: Parks
    source: .odyssey/park/records
    coordinates: [lat, lon]
    boundary: boundary
    where: { wildernessCamping.status: permitted }
    color: black
  - source: places.yaml
    coordinates: latlon
`),
    )
    expect(settings.tiles).toBe('https://tile.example/{z}/{x}/{y}.png')
    expect(settings.layers.map((layer) => [layer.name, layer.boundary, layer.color])).toEqual([
      ['Parks', ['boundary'], 'black'],
      ['places.yaml', null, null],
    ])
    expect(settings.layers[0]?.where).toEqual([
      { path: ['wildernessCamping', 'status'], values: ['permitted'] },
    ])
    expect(settings.layers[1]?.coordinates).toEqual({ kind: 'single', path: ['latlon'] })
  })

  test('open at a center and zoom when given, and ignore malformed ones', () => {
    const given = parseMapConfig(view('source: data\ncenter: [51.18, -115.57]\nzoom: 8'))
    expect([given.center, given.zoom]).toEqual([[51.18, -115.57], 8])
    const malformed = parseMapConfig(view('source: data\ncenter: [51.18]\nzoom: near'))
    expect([malformed.center, malformed.zoom]).toEqual([null, null])
  })
})

describe('positions', () => {
  test('come from two fields, one [lat, lon] field or one "lat, lon" text', () => {
    expect(
      pointOf({ lat: 51.2, lon: -115.5 }, { kind: 'pair', lat: ['lat'], lon: ['lon'] }),
    ).toEqual([51.2, -115.5])
    expect(pointOf({ at: [51.2, -115.5] }, { kind: 'single', path: ['at'] })).toEqual([
      51.2, -115.5,
    ])
    expect(pointOf({ latlon: '51.2, -115.5' }, { kind: 'single', path: ['latlon'] })).toEqual([
      51.2, -115.5,
    ])
  })

  test('are absent when missing, not numbers, or out of range', () => {
    const pair = { kind: 'pair', lat: ['lat'], lon: ['lon'] } as const
    expect(pointOf({ lat: null, lon: -115 }, pair)).toBeNull()
    expect(pointOf({ lat: 'north', lon: -115 }, pair)).toBeNull()
    expect(pointOf({ lat: 91, lon: -115 }, pair)).toBeNull()
    expect(pointOf({ lat: '', lon: -115 }, pair)).toBeNull()
  })

  test('a boundary is a GeoJSON geometry a map can outline', () => {
    const polygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    }
    expect(geometryOf({ boundary: polygon }, ['boundary'])).toEqual(polygon)
    expect(geometryOf({ boundary: null }, ['boundary'])).toBeNull()
    expect(
      geometryOf({ boundary: { type: 'Point', coordinates: [0, 0] } }, ['boundary']),
    ).toBeNull()
  })
})

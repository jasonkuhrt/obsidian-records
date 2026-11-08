import { describe, expect, test } from 'bun:test'
import { parseGpx, trackPath } from '../src/core/track.ts'

const gpx = (body: string) => `<?xml version="1.0"?><gpx version="1.1" creator="test">${body}</gpx>`

describe('GPX tracks', () => {
  test('each track segment and route is one line, waypoints left out', () => {
    const track = parseGpx(
      gpx(`
<wpt lat="50" lon="-115"><name>Camp</name></wpt>
<trk><name>Day 1</name>
  <trkseg>
    <trkpt lat="51.1" lon="-115.1"><ele>1400</ele></trkpt>
    <trkpt lon="-115.2" lat='51.2'/>
  </trkseg>
  <trkseg><trkpt lat="51.3" lon="-115.3"></trkpt><trkpt lat="51.4" lon="-115.4"></trkpt></trkseg>
</trk>
<rte><rtept lat="52" lon="-116"/><rtept lat="52.1" lon="-116.1"/></rte>`),
    )
    expect(track).toEqual([
      [
        [51.1, -115.1],
        [51.2, -115.2],
      ],
      [
        [51.3, -115.3],
        [51.4, -115.4],
      ],
      [
        [52, -116],
        [52.1, -116.1],
      ],
    ])
  })

  test('points outside any segment still draw, and a single point or a bad one does not', () => {
    const track = parseGpx(
      gpx(`<trkpt lat="1" lon="2"/><trkpt lat="north" lon="2"/><trkpt lat="91" lon="2"/><trkpt lat="3" lon="4"/>
<trkseg><trkpt lat="5" lon="6"/></trkseg>`),
    )
    expect(track).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
    ])
  })

  test('a long track keeps an evenly spaced share of its points and its last one', () => {
    const points = Array.from(
      { length: 1001 },
      (_, index) => `<trkpt lat="${index / 100}" lon="0"/>`,
    )
    const [line = []] = parseGpx(gpx(`<trkseg>${points.join('')}</trkseg>`), 100)
    expect(line.length).toBeLessThanOrEqual(101)
    expect(line[0]).toEqual([0, 0])
    expect(line.at(-1)).toEqual([10, 0])
  })

  test('a file with no track is no lines', () => {
    expect(parseGpx('not a gpx file')).toEqual([])
  })
})

describe('track paths', () => {
  test('start at the root when given, else at the record file’s folder', () => {
    expect(trackPath('sources/a/gpx/x.gpx', '.odyssey/trip/', '.odyssey/trip/records/x.json')).toBe(
      '.odyssey/trip/sources/a/gpx/x.gpx',
    )
    expect(trackPath('../gpx/x.gpx', null, 'data/trips/records/x.json')).toBe(
      'data/trips/gpx/x.gpx',
    )
    expect(trackPath('./x.gpx', null, 'x.json')).toBe('x.gpx')
  })

  test('a leading slash starts at the vault root, and no path is null', () => {
    expect(trackPath('/tracks/x.gpx', '.odyssey/trip', 'r/x.json')).toBe('tracks/x.gpx')
    expect(trackPath(null, null, 'r/x.json')).toBeNull()
    expect(trackPath('  ', null, 'r/x.json')).toBeNull()
  })
})

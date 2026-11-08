import { describe, expect, test } from 'bun:test'
import { createLoader } from '../src/core/loader.ts'

describe('createLoader', () => {
  test('loads of one key while its load is in flight share that load', async () => {
    let loads = 0
    const load = createLoader(async (key) => {
      loads++
      await Bun.sleep(1)
      return { key }
    }, 10)
    const [first, second] = await Promise.all([load('a.gpx'), load('a.gpx')])
    expect(loads).toBe(1)
    expect(first).toBe(second)
  })

  test('keeps the most recently used results, up to its capacity', async () => {
    const loaded: string[] = []
    const load = createLoader(async (key) => {
      loaded.push(key)
      return key
    }, 2)
    for (const key of ['a', 'b', 'a', 'c', 'a', 'b'])
      // oxlint-disable-next-line no-await-in-loop -- the order of loads is what is tested
      await load(key)
    expect(loaded).toEqual(['a', 'b', 'c', 'b'])
  })

  test('a failed load fails every caller waiting on it and is tried again next time', async () => {
    let loads = 0
    const load = createLoader(async (key) => {
      loads++
      await Bun.sleep(1)
      if (loads === 1) throw new Error(`EACCES: ${key}`)
      return key
    }, 10)
    const waiting = await Promise.allSettled([load('a'), load('a')])
    expect(waiting.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(await load('a')).toBe('a')
    expect(loads).toBe(2)
  })
})

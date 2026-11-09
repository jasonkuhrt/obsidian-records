import { describe, expect, test } from 'bun:test'
import { pageValues } from '../src/core/page.ts'

/** Stand-ins for Obsidian's `Value` classes, with the methods `pageValues` reads. */
const text = (value: string) => ({ toString: () => value, isTruthy: () => value !== '' })
const none = { toString: () => 'null', isTruthy: () => false }
const list = (items: readonly unknown[]) => ({
  toString: () => items.map(String).join(', '),
  isTruthy: () => items.length > 0,
  length: () => items.length,
  get: (index: number) => items[index],
})

describe('page values', () => {
  test('a text value gives itself', () => {
    expect(pageValues(text('roman'))).toEqual(['roman'])
  })

  test('a list gives each item, skipping the empty ones', () => {
    expect(pageValues(list([text('Revenu Québec'), none, text('revenu-quebec')]))).toEqual([
      'Revenu Québec',
      'revenu-quebec',
    ])
  })

  test('no value, empty text and anything that is not a Value give nothing', () => {
    expect(pageValues(none)).toEqual([])
    expect(pageValues(text(''))).toEqual([])
    expect(pageValues(undefined)).toEqual([])
    expect(pageValues('roman')).toEqual([])
  })
})

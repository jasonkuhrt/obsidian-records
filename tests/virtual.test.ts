import { describe, expect, test } from 'bun:test'
import { scopeCss } from '../scripts/scope-css.ts'
import { layout, totalHeight, visibleRange } from '../src/core/virtual.ts'

describe('visibleRange', () => {
  const rows = layout(Array.from({ length: 1700 }, () => 30))

  test('covers the viewport plus the overscan', () => {
    expect(totalHeight(rows)).toBe(51_000)
    expect(visibleRange(rows, 0, 600, 0)).toEqual({ start: 0, end: 20 })
    expect(visibleRange(rows, 3000, 600, 5)).toEqual({ start: 95, end: 125 })
  })

  test('clamps at the end of the list', () => {
    expect(visibleRange(rows, 50_900, 600, 5)).toEqual({ start: 1691, end: 1700 })
  })

  test('handles items of different heights and an empty list', () => {
    const mixed = layout([34, 30, 30, 34, 30])
    expect(visibleRange(mixed, 40, 30, 0)).toEqual({ start: 1, end: 3 })
    expect(visibleRange(layout([]), 0, 600, 5)).toEqual({ start: 0, end: 0 })
  })
})

describe('scopeCss', () => {
  test('prefixes each selector, inside media blocks too', () => {
    const css = '/* c */ .a, .b > svg { x: 1 }\n@media print { .c { y: 2 } }'
    expect(scopeCss(css, '.s')).toBe(
      '.s .a,\n.s .b > svg { x: 1 }\n@media print {\n.s .c { y: 2 }\n}\n',
    )
  })
})

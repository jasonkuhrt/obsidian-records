import { describe, expect, test } from 'bun:test'
import { fieldsOf } from '../src/core/format.ts'
import { searchText, type DataRecord } from '../src/core/source.ts'

const record = (id: string, data: Record<string, unknown>): DataRecord => ({
  id,
  file: id,
  data,
  text: searchText(data),
})

describe('inferred fields', () => {
  test('come from every record, so a field first seen in a late one still gets a column', () => {
    const records = Array.from({ length: 300 }, (_, index) =>
      record(String(index), index === 299 ? { name: 'Last', late: 1 } : { name: 'Early' }),
    )
    expect(fieldsOf(records)).toEqual([['name'], ['late']])
  })

  test('leave out geometry and _-prefixed tags', () => {
    const boundary = { type: 'Polygon', coordinates: [] }
    expect(fieldsOf([record('a', { _tag: 'x', name: 'A', boundary })])).toEqual([['name']])
  })
})

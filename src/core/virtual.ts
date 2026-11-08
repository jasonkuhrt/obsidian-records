/**
 * Item positions for a list that draws only what is on screen. Each item has
 * a known height, so positions are prefix sums and the visible range is two
 * binary searches.
 */
export interface Layout {
  /** `offsets[i]` is the top of item `i`; the last entry is the total height. */
  readonly offsets: Float64Array
}

export const layout = (heights: readonly number[]): Layout => {
  const offsets = new Float64Array(heights.length + 1)
  for (let index = 0; index < heights.length; index++)
    offsets[index + 1] = (offsets[index] ?? 0) + (heights[index] ?? 0)
  return { offsets }
}

export const totalHeight = ({ offsets }: Layout): number => offsets[offsets.length - 1] ?? 0

/** The index of the item that contains `y`, clamped to the list. */
const indexAt = ({ offsets }: Layout, y: number): number => {
  let low = 0
  let high = offsets.length - 2
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((offsets[middle] ?? 0) <= y) low = middle
    else high = middle - 1
  }
  return Math.max(0, low)
}

/** The half-open range of items `[start, end)` within the viewport, plus `overscan` either side. */
export const visibleRange = (
  list: Layout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { start: number; end: number } => {
  const count = list.offsets.length - 1
  if (count <= 0) return { start: 0, end: 0 }
  const first = indexAt(list, scrollTop)
  const last = indexAt(list, scrollTop + Math.max(0, viewportHeight - 1))
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) }
}

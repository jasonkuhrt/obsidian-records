import { layout, totalHeight, visibleRange, type Layout } from '../core/virtual.ts'

/**
 * A scrolling list that keeps only the items on screen in the DOM, so a view
 * of a few thousand records scrolls as smoothly as one of a dozen.
 */
export class VirtualList {
  private list: Layout = layout([])
  private renderItem: (index: number) => HTMLElement = () => createDiv()
  private drawn = { start: -1, end: -1 }
  private frame = 0
  private readonly resizeObserver: ResizeObserver

  constructor(
    readonly scrollEl: HTMLElement,
    readonly canvasEl: HTMLElement,
    private readonly overscan = 8,
  ) {
    scrollEl.addEventListener(
      'scroll',
      () => {
        this.schedule()
      },
      { passive: true },
    )
    this.resizeObserver = new ResizeObserver(() => {
      this.schedule()
    })
    this.resizeObserver.observe(scrollEl)
  }

  /** Replaces every item. `heights[i]` is item `i`'s height in pixels. */
  setItems(heights: readonly number[], renderItem: (index: number) => HTMLElement): void {
    this.list = layout(heights)
    this.renderItem = renderItem
    this.canvasEl.style.height = `${totalHeight(this.list)}px`
    this.drawn = { start: -1, end: -1 }
    this.draw()
  }

  scrollToTop(): void {
    this.scrollEl.scrollTop = 0
  }

  destroy(): void {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
  }

  private schedule(): void {
    if (this.frame !== 0) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  private draw(): void {
    const top = this.scrollEl.scrollTop - this.canvasEl.offsetTop
    const range = visibleRange(
      this.list,
      Math.max(0, top),
      this.scrollEl.clientHeight,
      this.overscan,
    )
    if (range.start === this.drawn.start && range.end === this.drawn.end) return
    this.drawn = range
    const fragment = document.createDocumentFragment()
    for (let index = range.start; index < range.end; index++) {
      const el = this.renderItem(index)
      const offset = this.list.offsets[index] ?? 0
      el.style.top = `${offset}px`
      el.style.height = `${(this.list.offsets[index + 1] ?? offset) - offset}px`
      fragment.append(el)
    }
    this.canvasEl.replaceChildren(fragment)
  }
}

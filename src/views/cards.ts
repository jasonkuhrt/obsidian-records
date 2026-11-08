import type { QueryController } from 'obsidian'
import type { ListConfig } from '../core/config.ts'
import { formatPath, getAt, type Path } from '../core/path.ts'
import type { Group } from '../core/query.ts'
import type { DataRecord } from '../core/source.ts'
import type { RecordsHost } from './base.ts'
import { titleOf } from './base.ts'
import { ListView } from './list.ts'
import { renderValue } from './render.ts'
import { VirtualList } from './virtual-list.ts'

export const cardsViewType = 'records-cards'

const minCardWidth = 240
const gap = 12
const groupHeight = 38
const cardPadding = 12
const titleHeight = 26
const fieldHeight = 22

type Item =
  | { readonly kind: 'group'; readonly group: Group }
  | { readonly kind: 'cards'; readonly records: readonly DataRecord[] }

export class CardsView extends ListView {
  override type = cardsViewType
  private readonly scrollEl: HTMLElement
  private readonly canvasEl: HTMLElement
  private readonly virtual: VirtualList
  private readonly resize: ResizeObserver
  private columns = 0

  constructor(controller: QueryController, containerEl: HTMLElement, host: RecordsHost) {
    super(controller, containerEl, host)
    this.body.addClass('records-cards')
    this.scrollEl = this.body.createDiv({ cls: 'records-scroll' })
    this.canvasEl = this.scrollEl.createDiv({ cls: 'records-canvas' })
    this.virtual = new VirtualList(this.scrollEl, this.canvasEl, 2)
    this.list = this.virtual
    // A new width can change how many cards fit in a row.
    this.resize = new ResizeObserver(() => {
      if (this.ready && this.columnsFor() !== this.columns) this.render()
    })
    this.resize.observe(this.scrollEl)
  }

  override onunload(): void {
    this.resize.disconnect()
    super.onunload()
  }

  private columnsFor(): number {
    const width = this.scrollEl.clientWidth - gap
    return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)))
  }

  protected override render(): void {
    if (this.noteConfig()) this.virtual.scrollToTop()
    const settings = this.settings()
    const titlePath = formatPath(settings.title)
    const fields = this.fields(settings).filter((path) => formatPath(path) !== titlePath)
    const { groups, shown, total } = this.groups(settings)
    this.setCount(shown, total)
    this.columns = this.columnsFor()
    const cardHeight = cardPadding * 2 + titleHeight + fields.length * fieldHeight
    const labels = fields.map((path) => this.label(path))

    const items: Item[] = []
    for (const group of groups) {
      if (settings.groupBy !== null) items.push({ kind: 'group', group })
      for (let index = 0; index < group.records.length; index += this.columns)
        items.push({ kind: 'cards', records: group.records.slice(index, index + this.columns) })
    }
    this.virtual.setItems(
      items.map((item) => (item.kind === 'group' ? groupHeight : cardHeight + gap)),
      (index) => {
        const item = items[index]
        if (item === undefined) return createDiv()
        if (item.kind === 'group')
          return createDiv({ cls: 'records-group', text: this.groupLabel(item.group, settings) })
        const row = createDiv({ cls: 'records-card-row' })
        row.style.gridTemplateColumns = `repeat(${this.columns}, minmax(0, 1fr))`
        for (const record of item.records) this.renderCard(row, record, fields, labels, settings)
        return row
      },
    )
  }

  private renderCard(
    row: HTMLElement,
    record: DataRecord,
    fields: readonly Path[],
    labels: readonly string[],
    settings: ListConfig,
  ): void {
    const card = row.createDiv({ cls: 'records-card' })
    card.createDiv({ cls: 'records-card-title', text: titleOf(record, settings.title) })
    fields.forEach((path, index) => {
      const field = card.createDiv({ cls: 'records-card-field' })
      field.createSpan({ cls: 'records-card-label', text: labels[index] ?? formatPath(path) })
      renderValue(field.createSpan({ cls: 'records-card-value' }), getAt(record.data, path))
    })
    card.addEventListener('click', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('a') !== null) return
      this.showDetail(record, titleOf(record, settings.title), settings.body)
    })
  }
}

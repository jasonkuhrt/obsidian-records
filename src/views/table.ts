import type { QueryController } from 'obsidian'
import type { ListConfig } from '../core/config.ts'
import { formatText } from '../core/format.ts'
import { formatPath, getAt, type Path } from '../core/path.ts'
import type { Group, SortKey } from '../core/query.ts'
import type { DataRecord } from '../core/source.ts'
import type { RecordsHost } from './base.ts'
import { titleOf } from './base.ts'
import { ListView } from './list.ts'
import { renderValue } from './render.ts'
import { VirtualList } from './virtual-list.ts'

export const tableViewType = 'records'

const rowHeight = 30
const groupHeight = 34

type Item =
  | { readonly kind: 'group'; readonly group: Group }
  | { readonly kind: 'row'; readonly record: DataRecord }

/** A column's width from its heading and the longest of its first few hundred values. */
const columnWidth = (label: string, path: Path, records: readonly DataRecord[]): number => {
  let longest = label.length + 2
  for (const record of records.slice(0, 400))
    longest = Math.max(longest, formatText(getAt(record.data, path)).length)
  return Math.round(Math.min(360, Math.max(72, longest * 7.2 + 24)))
}

const samePath = (a: Path, b: Path): boolean => formatPath(a) === formatPath(b)

export class TableView extends ListView {
  override type = tableViewType
  private readonly scrollEl: HTMLElement
  private readonly headerEl: HTMLElement
  private readonly canvasEl: HTMLElement
  private readonly virtual: VirtualList

  constructor(controller: QueryController, containerEl: HTMLElement, host: RecordsHost) {
    super(controller, containerEl, host)
    this.body.addClass('records-table')
    this.scrollEl = this.body.createDiv({ cls: 'records-scroll' })
    this.headerEl = this.scrollEl.createDiv({ cls: 'records-table-header' })
    this.canvasEl = this.scrollEl.createDiv({ cls: 'records-canvas' })
    this.virtual = new VirtualList(this.scrollEl, this.canvasEl)
    this.list = this.virtual
  }

  protected override draw(): void {
    if (this.noteConfig()) this.virtual.scrollToTop()
    const settings = this.settings()
    const fields = this.fields(settings)
    const { groups, shown, total } = this.groups(settings)
    this.setCount(shown, total)

    const sample = this.recordsOf(settings.source)
    const labels = fields.map((path) => this.label(path))
    const widths = fields.map((path, index) => columnWidth(labels[index] ?? '', path, sample))
    const template = widths.map((width) => `${width}px`).join(' ')
    const width = `${widths.reduce((sum, item) => sum + item, 0)}px`
    this.headerEl.style.width = width
    this.canvasEl.style.width = width
    this.renderHeader(fields, labels, template, settings)

    const items: Item[] = []
    for (const group of groups) {
      if (settings.groupBy !== null) items.push({ kind: 'group', group })
      for (const record of group.records) items.push({ kind: 'row', record })
    }
    this.virtual.setItems(
      items.map((item) => (item.kind === 'group' ? groupHeight : rowHeight)),
      (index) => {
        const item = items[index]
        if (item === undefined) return createDiv()
        if (item.kind === 'group')
          return createDiv({ cls: 'records-group', text: this.groupLabel(item.group, settings) })
        return this.renderRow(item.record, fields, template, settings)
      },
    )
  }

  private renderHeader(
    fields: readonly Path[],
    labels: readonly string[],
    template: string,
    settings: ListConfig,
  ): void {
    const sort = this.effectiveSort(settings)
    const first = sort[0]
    this.headerEl.empty()
    this.headerEl.style.gridTemplateColumns = template
    fields.forEach((path, index) => {
      const active = first !== undefined && samePath(first.path, path)
      const cell = this.headerEl.createDiv({
        cls: 'records-th',
        text: labels[index] ?? formatPath(path),
      })
      cell.setAttr('title', formatPath(path))
      if (active)
        cell.createSpan({ cls: 'records-sort', text: first.direction === 'ASC' ? ' ▲' : ' ▼' })
      cell.addEventListener('click', () => {
        const next: SortKey =
          active && first.direction === 'ASC'
            ? { path, direction: 'DESC' }
            : { path, direction: 'ASC' }
        this.sortOverride = [next]
        this.render()
        this.virtual.scrollToTop()
      })
    })
  }

  private renderRow(
    record: DataRecord,
    fields: readonly Path[],
    template: string,
    settings: ListConfig,
  ): HTMLElement {
    const row = createDiv({ cls: 'records-row' })
    row.style.gridTemplateColumns = template
    for (const path of fields)
      renderValue(row.createDiv({ cls: 'records-td' }), getAt(record.data, path))
    row.addEventListener('click', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('a') !== null) return
      this.showDetail(record, titleOf(record, settings.title), settings.body)
    })
    return row
  }
}

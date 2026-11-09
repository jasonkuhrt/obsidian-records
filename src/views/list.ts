import { parseListConfig, type ListConfig } from '../core/config.ts'
import { fieldsOf, formatText } from '../core/format.ts'
import { pageValues } from '../core/page.ts'
import type { Path } from '../core/path.ts'
import { groupRecords, runQuery, type Group, type PageMatch, type SortKey } from '../core/query.ts'
import { RecordsView } from './base.ts'
import type { VirtualList } from './virtual-list.ts'

/**
 * The table and cards views: one source, filtered by `where` and the search,
 * sorted by `sort` (or a clicked column), optionally grouped, drawn virtually.
 */
export abstract class ListView extends RecordsView {
  protected list: VirtualList | null = null
  protected sortOverride: readonly SortKey[] | null = null
  private renderedConfig = ''

  protected settings(): ListConfig {
    return parseListConfig((key) => this.setting(key))
  }

  protected override sourcePaths(): string[] {
    const { source } = this.settings()
    return source === null ? [] : [source]
  }

  /**
   * The page this view keeps records for, when its `match` names one. Bases
   * evaluates the formula against the note the view is embedded in, or, in the
   * sidebar, the open note; opened on its own, against the `.base` file.
   */
  protected pageMatch(settings: ListConfig): PageMatch | null {
    if (settings.match === null) return null
    return {
      fields: settings.matchFields,
      values: pageValues(this.config.getEvaluatedFormula(this, 'match')),
    }
  }

  /** Includes the page's values, so a sidebar view redraws when another note opens. */
  protected override configKey(): string {
    const settings = this.settings()
    return JSON.stringify({ ...settings, page: this.pageMatch(settings) })
  }

  protected override labelled(): readonly Path[] {
    return this.fields(this.settings())
  }

  protected effectiveSort(settings: ListConfig): readonly SortKey[] {
    return this.sortOverride ?? settings.sort
  }

  /** The fields shown: `order`, else the records' own top-level fields. */
  protected fields(settings: ListConfig): Path[] {
    return settings.order.length > 0
      ? [...settings.order]
      : fieldsOf(this.recordsOf(settings.source))
  }

  /** The groups to draw: one unnamed group when the view has no `groupBy`. */
  protected groups(settings: ListConfig): { groups: Group[]; shown: number; total: number } {
    const records = this.recordsOf(settings.source)
    const page = this.pageMatch(settings)
    const rows = runQuery(records, {
      where: settings.where,
      page,
      search: this.search,
      sort: this.effectiveSort(settings),
    })
    const groups =
      settings.groupBy === null
        ? [{ value: undefined, records: rows }]
        : groupRecords(rows, settings.groupBy)
    const whereCount =
      settings.where.length === 0 && page === null
        ? records.length
        : runQuery(records, { where: settings.where, page, search: '', sort: [] }).length
    return { groups, shown: rows.length, total: whereCount }
  }

  protected groupLabel(group: Group, settings: ListConfig): string {
    const name = settings.groupBy === null ? '' : formatText(group.value)
    return `${name === '' ? 'None' : name} · ${group.records.length.toLocaleString()}`
  }

  /** Resets a clicked sort when the view's own config changes. */
  protected noteConfig(): boolean {
    const key = this.configKey()
    const changed = key !== this.renderedConfig
    if (changed) this.sortOverride = null
    this.renderedConfig = key
    return changed
  }

  override onunload(): void {
    this.list?.destroy()
    super.onunload()
  }
}

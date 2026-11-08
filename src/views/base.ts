import {
  BasesView,
  Component,
  debounce,
  FileSystemAdapter,
  MarkdownRenderer,
  parseYaml,
  setIcon,
  type App,
  type Debouncer,
  type QueryController,
} from 'obsidian'
import { viewSetting } from '../core/config.ts'
import { formatText } from '../core/format.ts'
import { formatPath, getAt, type Path } from '../core/path.ts'
import {
  loadSource,
  normalizeSource,
  type DataRecord,
  type LoadedSource,
  type SourceFs,
} from '../core/source.ts'
import { renderFields } from './render.ts'

export interface RecordsHost {
  readonly app: App
  readonly views: Set<RecordsView>
}

const decoder = new TextDecoder()

/**
 * Reads through the vault adapter. On desktop a file's text comes from
 * `FileSystemAdapter.readLocalFile`, which skips the adapter's queue: 1,690
 * files read in about 25 ms that way and 200 to 400 ms through `read`.
 */
const sourceFs = (app: App): SourceFs => {
  const adapter = app.vault.adapter
  return {
    stat: async (path) => {
      const stat = await adapter.stat(path)
      return stat === null ? null : { type: stat.type }
    },
    list: (path) => adapter.list(path),
    read:
      adapter instanceof FileSystemAdapter
        ? async (path) =>
            decoder.decode(await FileSystemAdapter.readLocalFile(adapter.getFullPath(path)))
        : (path) => adapter.read(path),
  }
}

/** A record's title: the value at the view's `title` path, else its file name. */
export const titleOf = (record: DataRecord, title: Path): string => {
  const text = formatText(getAt(record.data, title))
  return text === '' ? (record.file.split('/').at(-1) ?? record.id) : text
}

/**
 * What every Records view shares: it reads its sources itself (Bases hands a
 * view only vault notes), offers search and a refresh button, and shows a
 * record's fields in a side panel. Dot folders send no file events, so a view
 * reloads when it opens and when asked, never on its own.
 */
export abstract class RecordsView extends BasesView {
  protected readonly host: RecordsHost
  protected readonly root: HTMLElement
  protected readonly body: HTMLElement
  protected search = ''
  /** True once the sources have loaded at least once. */
  protected ready = false
  protected sources = new Map<string, LoadedSource>()
  private readonly countEl: HTMLElement
  private readonly problemsEl: HTMLElement
  private readonly detailEl: HTMLElement
  private started = false
  /** True once the view has unloaded: nothing draws after that. */
  private disposed = false
  private readonly onSearch: Debouncer<[], void>
  private drawSnapshot = ''
  private sourcesSnapshot = ''
  private loadToken = 0
  /** Owns what the detail's Markdown rendered, so closing the detail releases it. */
  private detailContent: Component | null = null
  /** The record the open detail panel shows, so a reload can redraw it. */
  private openDetail: {
    id: string
    titleFor: (record: DataRecord) => string
    body: Path | null
  } | null = null

  constructor(controller: QueryController, containerEl: HTMLElement, host: RecordsHost) {
    super(controller)
    this.host = host
    this.root = containerEl.createDiv({ cls: 'records-view' })
    const toolbar = this.root.createDiv({ cls: 'records-toolbar' })
    const searchEl = toolbar.createEl('input', {
      cls: 'records-search',
      attr: { type: 'search', placeholder: 'Search records', spellcheck: 'false' },
    })
    this.onSearch = debounce(() => {
      this.search = searchEl.value
      this.render()
    }, 120)
    searchEl.addEventListener('input', () => {
      this.onSearch()
    })
    this.countEl = toolbar.createSpan({ cls: 'records-count' })
    const refresh = toolbar.createEl('button', {
      cls: 'clickable-icon records-refresh',
      attr: { 'aria-label': 'Reload records from their files' },
    })
    setIcon(refresh, 'refresh-cw')
    refresh.addEventListener('click', () => void this.reload())
    this.problemsEl = this.root.createDiv({ cls: 'records-problems' })
    this.body = this.root.createDiv({ cls: 'records-body' })
    this.detailEl = this.root.createDiv({ cls: 'records-detail' })
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.detailEl.hasClass('is-open')) this.hideDetail()
    })
  }

  /** One key of this view's entry in the `.base` file. */
  protected setting(key: string): unknown {
    return viewSetting(this.config, key)
  }

  /**
   * A field's heading: its `displayName` in the Base's `properties`, else its
   * path. Bases keys a property the way the file writes it, and a record field
   * no note has stays bare (`officialUrl`), so the bare id is tried second.
   */
  protected label(path: Path): string {
    const id = formatPath(path)
    const named = this.config.getDisplayName(`note.${id}`)
    if (named !== id) return named
    // getDisplayName is typed for prefixed ids only; a method's parameter is
    // checked bivariantly, so this view of the config takes any text.
    const config: { getDisplayName(rawId: string): string } = this.config
    return config.getDisplayName(id)
  }

  /** The vault paths this view reads. */
  protected abstract sourcePaths(): string[]

  /** Draws the records. Runs through `render`, after a load, a search and a config change. */
  protected abstract draw(): void

  /** A text that changes whenever the view's config does. */
  protected abstract configKey(): string

  /** The fields whose headings the view shows, so a heading renamed in the Base redraws it. */
  protected abstract labelled(): readonly Path[]

  override onload(): void {
    this.start()
  }

  override onunload(): void {
    this.disposed = true
    this.onSearch.cancel()
    this.host.views.delete(this)
    this.loadToken++
    this.root.remove()
  }

  override onDataUpdated(): void {
    if (!this.started) {
      this.start()
      return
    }
    const drawKey = this.drawKey()
    if (drawKey === this.drawSnapshot) return
    this.drawSnapshot = drawKey
    if (this.sourcesKey() === this.sourcesSnapshot) this.render()
    else void this.reload()
  }

  /** A text that changes whenever what the view draws from its config does: its keys and headings. */
  private drawKey(): string {
    return JSON.stringify([this.configKey(), this.labelled().map((path) => this.label(path))])
  }

  private start(): void {
    if (this.started) return
    this.started = true
    this.host.views.add(this)
    void this.reload()
  }

  private sourcesKey(): string {
    return JSON.stringify([...new Set(this.sourcePaths().map(normalizeSource))])
  }

  async reload(): Promise<void> {
    const token = ++this.loadToken
    const paths = [...new Set(this.sourcePaths().map(normalizeSource))]
    this.countEl.setText('Loading…')
    const started = performance.now()
    const loaded = await Promise.all(
      paths.map((path) => loadSource(sourceFs(this.host.app), parseYaml, path)),
    )
    if (token !== this.loadToken || this.disposed) return
    this.sources = new Map(loaded.map((source) => [source.source, source]))
    this.ready = true
    this.sourcesSnapshot = JSON.stringify(paths)
    this.drawSnapshot = this.drawKey()
    this.root.dataset['loadMs'] = String(Math.round(performance.now() - started))
    this.renderProblems(loaded)
    this.render()
    this.refreshDetail()
  }

  /** After a reload, an open detail panel shows its record's new values, or closes when the record is gone. */
  private refreshDetail(): void {
    const open = this.openDetail
    if (open === null || !this.detailEl.hasClass('is-open')) return
    const record = [...this.sources.values()]
      .flatMap((source) => source.records)
      .find((r) => r.id === open.id)
    if (record === undefined) this.hideDetail()
    else this.showDetail(record, open.titleFor, open.body)
  }

  /** A vault file's text, dot folders included; `null` when it can't be read. */
  protected async readText(path: string): Promise<string | null> {
    try {
      return await sourceFs(this.host.app).read(path)
    } catch {
      return null
    }
  }

  /** The records of one source, empty until it loads. */
  protected recordsOf(source: string | null): readonly DataRecord[] {
    return source === null ? [] : (this.sources.get(normalizeSource(source))?.records ?? [])
  }

  protected setCount(shown: number, total: number): void {
    this.root.dataset['shown'] = String(shown)
    this.root.dataset['total'] = String(total)
    this.countEl.setText(
      shown === total
        ? `${total.toLocaleString()} records`
        : `${shown.toLocaleString()} of ${total.toLocaleString()} records`,
    )
  }

  /** Draws the records, timed, unless the view has unloaded. */
  protected render(): void {
    if (this.disposed) return
    const started = performance.now()
    this.draw()
    this.root.dataset['renderMs'] = String(Math.round(performance.now() - started))
  }

  private renderProblems(loaded: readonly LoadedSource[]): void {
    this.problemsEl.empty()
    const problems = loaded.flatMap((source) => source.problems)
    const missing = this.sourcePaths().length === 0
    this.problemsEl.toggleClass('is-visible', missing || problems.length > 0)
    if (missing)
      this.problemsEl.createDiv({ text: 'Set this view’s source to a folder or file of records.' })
    for (const problem of problems.slice(0, 5))
      this.problemsEl.createDiv({ text: `${problem.file}: ${problem.message}` })
    if (problems.length > 5) this.problemsEl.createDiv({ text: `…and ${problems.length - 5} more` })
  }

  /**
   * Opens the side panel with a header of `title` and `subtitle` and returns
   * the element below it, emptied, for the caller to fill.
   */
  protected openPanel(title: string, subtitle: string): HTMLElement {
    this.openDetail = null
    this.releaseDetail()
    const detail = this.detailEl
    detail.empty()
    detail.removeClass('has-markdown')
    detail.addClass('is-open')
    const header = detail.createDiv({ cls: 'records-detail-header' })
    header.createDiv({ cls: 'records-detail-title', text: title })
    const close = header.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Close' },
    })
    setIcon(close, 'x')
    close.addEventListener('click', () => {
      this.hideDetail()
    })
    detail.createDiv({ cls: 'records-detail-file', text: subtitle })
    return detail
  }

  /**
   * Shows every field of `record` in the side panel. The field at `body`, when
   * it holds text, is rendered as Markdown below the others, its links
   * resolving from the record's file.
   */
  protected showDetail(
    record: DataRecord,
    titleFor: (record: DataRecord) => string,
    body: Path | null = null,
  ): void {
    const detail = this.openPanel(titleFor(record), record.id)
    this.openDetail = { id: record.id, titleFor, body }
    renderFields(detail.createDiv({ cls: 'records-detail-body' }), record.data, body)
    const markdown = body === null ? undefined : getAt(record.data, body)
    if (typeof markdown !== 'string' || markdown.trim() === '') return
    detail.addClass('has-markdown')
    const content = new Component()
    this.detailContent = this.addChild(content)
    const el = detail.createDiv({ cls: 'records-detail-markdown markdown-rendered' })
    void MarkdownRenderer.render(this.host.app, markdown, el, record.file, content)
  }

  protected hideDetail(): void {
    this.openDetail = null
    this.releaseDetail()
    this.detailEl.removeClass('is-open')
    this.detailEl.empty()
  }

  private releaseDetail(): void {
    if (this.detailContent === null) return
    this.removeChild(this.detailContent)
    this.detailContent = null
  }
}

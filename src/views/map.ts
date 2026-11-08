import * as L from 'leaflet'
import type { QueryController } from 'obsidian'
import Supercluster from 'supercluster'
import { parseMapConfig, type MapConfig, type MapLayerConfig } from '../core/config.ts'
import { categoryOf, geometryOf, pointOf } from '../core/geo.ts'
import { matchesSearch, matchesWhere, searchTerms } from '../core/query.ts'
import type { DataRecord } from '../core/source.ts'
import { titleOf, type RecordsHost } from './base.ts'
import { RecordsView } from './base.ts'

export const mapViewType = 'records-map'

const defaultTiles =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
const defaultAttribution = 'Tiles © Esri'

/** Obsidian's theme colors, used in order when a layer or category names none. */
const palette = ['blue', 'green', 'purple', 'orange', 'red', 'cyan', 'pink', 'yellow']

/**
 * The theme's value of one palette color. Canvas paths need a resolved color,
 * not a `var(…)`. A color written in the view is a CSS color and is used as
 * written, so `green` there means green.
 */
const themeColor = (index: number): string => {
  const name = palette[index % palette.length] ?? 'blue'
  const themed = getComputedStyle(document.body).getPropertyValue(`--color-${name}`).trim()
  return themed === '' ? name : themed
}

interface Pin {
  readonly record: DataRecord
  readonly layer: MapLayerConfig
  readonly color: string
  readonly lat: number
  readonly lon: number
}

interface Category {
  readonly key: string
  readonly color: string
  count: number
}

interface LayerSummary {
  readonly layer: MapLayerConfig
  readonly index: number
  readonly color: string
  readonly categories: Category[]
  matching: number
  unplaced: number
}

/** A `colorBy` value as the legend shows it: booleans read Yes and No. */
const categoryLabel = (key: string): string =>
  key === 'true' ? 'Yes' : key === 'false' ? 'No' : key === '' ? 'None' : key

const hiddenKey = (layer: number, category?: string): string =>
  category === undefined ? `${layer}` : `${layer}:${category}`

/**
 * Pins from each record's coordinates, clustered when zoomed out, with a
 * record's boundary outlined when it has one. A legend toggles layers and
 * their `colorBy` categories; a click on a pin or outline shows the record.
 */
export class MapView extends RecordsView {
  override type = mapViewType
  private readonly mapEl: HTMLElement
  private readonly legendEl: HTMLElement
  private readonly resize: ResizeObserver
  private map: L.Map | null = null
  private tiles: L.TileLayer | null = null
  private tilesUrl = ''
  private readonly markers = L.layerGroup()
  private readonly outlines = L.layerGroup()
  private readonly outlineCache = new Map<string, L.Layer>()
  private readonly renderer = L.canvas({ padding: 0.3 })
  private index: Supercluster<{ pin: number }> | null = null
  private pins: Pin[] = []
  private readonly hidden = new Set<string>()
  private fitted = false

  constructor(controller: QueryController, containerEl: HTMLElement, host: RecordsHost) {
    super(controller, containerEl, host)
    this.root.addClass('is-map')
    this.body.addClass('records-map')
    this.mapEl = this.body.createDiv({ cls: 'records-map-canvas' })
    this.legendEl = this.body.createDiv({ cls: 'records-legend' })
    this.resize = new ResizeObserver(() => {
      this.map?.invalidateSize()
      this.fitOnce()
    })
    this.resize.observe(this.mapEl)
  }

  private settings(): MapConfig {
    return parseMapConfig((key) => this.setting(key))
  }

  protected override sourcePaths(): string[] {
    return this.settings().layers.flatMap((layer) => (layer.source === null ? [] : [layer.source]))
  }

  protected override configKey(): string {
    return JSON.stringify(this.settings())
  }

  override onunload(): void {
    this.resize.disconnect()
    this.map?.remove()
    this.map = null
    super.onunload()
  }

  private ensureMap(settings: MapConfig): L.Map {
    const map =
      this.map ??
      L.map(this.mapEl, { zoomControl: true, worldCopyJump: true, preferCanvas: true }).setView(
        settings.center === null ? [51, -116] : [...settings.center],
        settings.zoom ?? 6,
      )
    if (this.map === null) {
      this.map = map
      this.markers.addTo(map)
      this.outlines.addTo(map)
      map.on('moveend', () => {
        this.drawPins()
      })
    }
    const url = settings.tiles ?? defaultTiles
    if (url !== this.tilesUrl) {
      this.tiles?.remove()
      this.tiles = L.tileLayer(url, {
        maxZoom: 19,
        attribution: settings.tiles === null ? defaultAttribution : '',
      }).addTo(map)
      this.tilesUrl = url
    }
    return map
  }

  protected override render(): void {
    const settings = this.settings()
    const map = this.ensureMap(settings)
    const terms = searchTerms(this.search)
    const summaries: LayerSummary[] = []
    const pins: Pin[] = []
    const outlines = new Map<string, { record: DataRecord; layer: MapLayerConfig; color: string }>()
    let total = 0
    let shown = 0

    settings.layers.forEach((layer, index) => {
      const layerColor = layer.color ?? themeColor(index)
      const summary: LayerSummary = {
        layer,
        index,
        color: layerColor,
        categories: [],
        matching: 0,
        unplaced: 0,
      }
      summaries.push(summary)
      const records = this.recordsOf(layer.source).filter((record) =>
        matchesWhere(record, layer.where),
      )
      total += records.length
      const matching = records.filter((record) => matchesSearch(record, terms))
      summary.matching = matching.length

      const categories = new Map<string, Category>()
      if (layer.colorBy !== null) {
        const colorBy = layer.colorBy
        const keys = [
          ...new Set(records.map((record) => categoryOf(record.data, colorBy))),
        ].toSorted()
        keys.forEach((key, position) => {
          const color = layer.colors[key] ?? themeColor(index + position)
          categories.set(key, { key, color, count: 0 })
        })
        summary.categories.push(...categories.values())
      }

      if (this.hidden.has(hiddenKey(index))) return
      for (const record of matching) {
        const category =
          layer.colorBy === null
            ? undefined
            : categories.get(categoryOf(record.data, layer.colorBy))
        if (category !== undefined) category.count++
        if (category !== undefined && this.hidden.has(hiddenKey(index, category.key))) continue
        shown++
        const color = category?.color ?? layerColor
        const point = layer.coordinates === null ? null : pointOf(record.data, layer.coordinates)
        if (point === null) summary.unplaced++
        else pins.push({ record, layer, color, lat: point[0], lon: point[1] })
        if (layer.boundary !== null && geometryOf(record.data, layer.boundary) !== null)
          outlines.set(`${index}|${record.id}|${color}`, { record, layer, color })
      }
    })

    this.setCount(shown, total)
    this.pins = pins
    this.index = new Supercluster<{ pin: number }>({
      // Leaflet's tiles are 256 px, so this makes `radius` screen pixels.
      extent: 256,
      radius: 56,
      maxZoom: 16,
    }).load(
      pins.map((pin, position) => ({
        type: 'Feature' as const,
        properties: { pin: position },
        geometry: { type: 'Point' as const, coordinates: [pin.lon, pin.lat] },
      })),
    )
    this.drawOutlines(outlines)
    this.renderLegend(summaries)
    map.invalidateSize()
    this.fitOnce(settings)
    this.drawPins()
  }

  /**
   * Opens at the view's `center` and `zoom`, else frames every pin, the first
   * time the map has both pins and a size.
   */
  private fitOnce(settings = this.settings()): void {
    const map = this.map
    if (this.fitted || map === null || this.pins.length === 0 || this.mapEl.clientHeight === 0)
      return
    this.fitted = true
    if (settings.center !== null) {
      map.setView([...settings.center], settings.zoom ?? 8)
      return
    }
    map.fitBounds(L.latLngBounds(this.pins.map((pin) => L.latLng(pin.lat, pin.lon))), {
      padding: [24, 24],
    })
  }

  private drawPins(): void {
    const map = this.map
    const index = this.index
    if (map === null || index === null) return
    this.markers.clearLayers()
    const bounds = map.getBounds().pad(0.25)
    const bbox: [number, number, number, number] = [
      Math.max(-180, bounds.getWest()),
      Math.max(-85, bounds.getSouth()),
      Math.min(180, bounds.getEast()),
      Math.min(85, bounds.getNorth()),
    ]
    for (const feature of index.getClusters(bbox, Math.round(map.getZoom()))) {
      const [lon = 0, lat = 0] = feature.geometry.coordinates
      const properties = feature.properties as Partial<Supercluster.ClusterProperties> & {
        pin?: number
      }
      if (properties.cluster === true && properties.cluster_id !== undefined) {
        const count = properties.point_count ?? 0
        const size = count < 10 ? 28 : count < 100 ? 34 : count < 1000 ? 40 : 46
        const clusterId = properties.cluster_id
        L.marker([lat, lon], {
          icon: L.divIcon({
            className: 'records-cluster',
            html: `<span>${properties.point_count_abbreviated ?? count}</span>`,
            iconSize: [size, size],
          }),
        })
          .on('click', () =>
            map.setView([lat, lon], Math.min(19, index.getClusterExpansionZoom(clusterId))),
          )
          .addTo(this.markers)
        continue
      }
      const pin = properties.pin === undefined ? undefined : this.pins[properties.pin]
      if (pin === undefined) continue
      const title = titleOf(pin.record, pin.layer.title)
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({ className: 'records-pin', iconSize: [14, 14], html: '' }),
        title,
      })
      marker.on('add', () => {
        const el = marker.getElement()
        if (el !== undefined) el.style.backgroundColor = pin.color
      })
      marker
        .on('click', () => {
          this.showDetail(pin.record, title)
        })
        .addTo(this.markers)
    }
  }

  private drawOutlines(
    wanted: Map<string, { record: DataRecord; layer: MapLayerConfig; color: string }>,
  ): void {
    for (const [key, layer] of this.outlineCache)
      if (!wanted.has(key)) {
        this.outlines.removeLayer(layer)
        this.outlineCache.delete(key)
      }
    for (const [key, { record, layer, color }] of wanted) {
      if (this.outlineCache.has(key) || layer.boundary === null) continue
      const geometry = geometryOf(record.data, layer.boundary)
      if (geometry === null) continue
      const outline = L.geoJSON(geometry, {
        style: { color, weight: 1.5, opacity: 0.9, fillOpacity: 0.12, renderer: this.renderer },
      })
      outline.on('click', () => {
        this.showDetail(record, titleOf(record, layer.title))
      })
      this.outlineCache.set(key, outline)
      this.outlines.addLayer(outline)
    }
  }

  private renderLegend(summaries: readonly LayerSummary[]): void {
    this.legendEl.empty()
    for (const summary of summaries) {
      const layerHidden = this.hidden.has(hiddenKey(summary.index))
      const row = this.legendRow(
        this.legendEl,
        summary.layer.name,
        summary.categories.length === 0 ? summary.color : null,
        summary.matching,
        !layerHidden,
        () => {
          this.toggle(hiddenKey(summary.index))
        },
      )
      row.addClass('records-legend-layer')
      if (layerHidden) continue
      if (summary.layer.colorBy !== null)
        this.legendEl.createDiv({
          cls: 'records-legend-note',
          text: `by ${this.label(summary.layer.colorBy)}`,
        })
      for (const category of summary.categories)
        this.legendRow(
          this.legendEl,
          categoryLabel(category.key),
          category.color,
          category.count,
          !this.hidden.has(hiddenKey(summary.index, category.key)),
          () => {
            this.toggle(hiddenKey(summary.index, category.key))
          },
        ).addClass('records-legend-category')
      if (summary.unplaced > 0)
        this.legendEl.createDiv({
          cls: 'records-legend-note',
          text: `${summary.unplaced.toLocaleString()} without coordinates`,
        })
    }
  }

  private legendRow(
    parent: HTMLElement,
    label: string,
    color: string | null,
    count: number,
    checked: boolean,
    onToggle: () => void,
  ): HTMLElement {
    const row = parent.createEl('label', { cls: 'records-legend-row' })
    const box = row.createEl('input', { attr: { type: 'checkbox' } })
    box.checked = checked
    box.addEventListener('change', onToggle)
    if (color !== null) row.createSpan({ cls: 'records-swatch' }).style.backgroundColor = color
    row.createSpan({ cls: 'records-legend-label', text: label })
    row.createSpan({ cls: 'records-legend-count', text: count.toLocaleString() })
    return row
  }

  private toggle(key: string): void {
    if (this.hidden.has(key)) this.hidden.delete(key)
    else this.hidden.add(key)
    this.render()
  }
}

import * as L from 'leaflet'
import type { QueryController } from 'obsidian'
import Supercluster from 'supercluster'
import { parseMapConfig, type MapConfig, type MapLayerConfig } from '../core/config.ts'
import { categoryOf, geometryOf, pointOf, type Geometry } from '../core/geo.ts'
import { createLoader } from '../core/loader.ts'
import { getAt, type Path } from '../core/path.ts'
import { matchesSearch, matchesWhere, searchTerms } from '../core/query.ts'
import type { DataRecord } from '../core/source.ts'
import { parseGpx, trackPath, type Track } from '../core/track.ts'
import { titleOf, type RecordsHost } from './base.ts'
import { RecordsView } from './base.ts'

export const mapViewType = 'records-map'

const defaultTiles =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
const defaultAttribution = 'Tiles © Esri'

/**
 * The deepest zoom pins cluster at. Pins at one position stay a cluster at
 * every zoom, and clicking it lists them, since no zoom can split them.
 */
const clusterMaxZoom = 19

/** The most tracks drawn for the records in view when zoomed in; the nearest to the center win. */
const maxZoomTracks = 40

/** How many parsed tracks a map keeps, so panning back draws them without reading again. */
const trackCacheSize = 300

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
  /** The layer's index and the record's id: one pin's identity across renders. */
  readonly key: string
  readonly record: DataRecord
  readonly layer: MapLayerConfig
  readonly color: string
  readonly lat: number
  readonly lon: number
  /** The vault path of the record's GPX track, when its layer names a `track` field. */
  readonly track: string | null
}

/** A record whose boundary the map outlines, in the color of its pin. */
interface Outlined {
  readonly record: DataRecord
  readonly layer: MapLayerConfig
  readonly color: string
  readonly geometry: Geometry
}

/**
 * An outline on the map. `of` is replaced on every render, so a click shows
 * the record as the view now reads it, titled by the view's current config.
 */
interface DrawnOutline {
  readonly layer: L.Layer
  of: Outlined
}

/** A pin's track on the map. `pin` is replaced on every draw, as an outline's `of` is. */
interface DrawnTrack {
  readonly line: L.Polyline
  pin: Pin
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
 * A record's GPX track is read only when it is needed: when its pin is
 * clicked, or, once the user has moved or zoomed the map, when it is zoomed
 * in to `trackZoom` with the pin in view. Opening the map reads no track.
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
  private readonly drawnOutlines = new Map<string, DrawnOutline>()
  private readonly tracks = L.layerGroup()
  private readonly drawnTracks = new Map<string, DrawnTrack>()
  /** A track by its vault path, read and parsed once; `null` when its file can't be read. */
  private readonly loadTrack = createLoader(async (path): Promise<Track | null> => {
    const started = performance.now()
    const text = await this.readText(path)
    const track = text === null ? null : parseGpx(text)
    this.root.dataset['trackMs'] = String(Math.round(performance.now() - started))
    return track
  }, trackCacheSize)
  private readonly renderer = L.canvas({ padding: 0.3 })
  private index: Supercluster<{ pin: number }> | null = null
  private pins: Pin[] = []
  private readonly hidden = new Set<string>()
  private fitted = false
  private trackZoom = 12
  /** The pin whose record the detail shows; its track is drawn at any zoom. */
  private selected: string | null = null
  /** True until the selected track is drawn: the map then moves to show it. */
  private revealSelected = false
  private trackToken = 0
  /** True while the view moves the map itself: opening it, fitting its size, revealing a track. */
  private quiet = false
  /** True once the user has moved or zoomed the map; only then are the tracks in view drawn. */
  private moved = false

  constructor(controller: QueryController, containerEl: HTMLElement, host: RecordsHost) {
    super(controller, containerEl, host)
    this.root.addClass('is-map')
    this.body.addClass('records-map')
    this.mapEl = this.body.createDiv({ cls: 'records-map-canvas' })
    this.legendEl = this.body.createDiv({ cls: 'records-legend' })
    this.resize = new ResizeObserver(() => {
      this.fitSize()
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

  protected override labelled(): readonly Path[] {
    return this.settings().layers.flatMap((layer) =>
      layer.colorBy === null ? [] : [layer.colorBy],
    )
  }

  override onunload(): void {
    this.trackToken++
    this.resize.disconnect()
    this.map?.remove()
    this.map = null
    super.onunload()
  }

  private ensureMap(settings: MapConfig): L.Map {
    const map =
      this.map ??
      L.map(this.mapEl, {
        zoomControl: true,
        worldCopyJump: true,
        preferCanvas: true,
        // The view's ResizeObserver fits the map to its element; Leaflet's own
        // window listener would end a move the user never made.
        trackResize: false,
      }).setView(settings.center === null ? [51, -116] : [...settings.center], settings.zoom ?? 6)
    if (this.map === null) {
      this.map = map
      this.outlines.addTo(map)
      this.tracks.addTo(map)
      this.markers.addTo(map)
      map.on('moveend', () => {
        if (!this.quiet) this.moved = true
        this.drawPins()
        void this.drawTracks()
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

  protected override draw(): void {
    const settings = this.settings()
    this.ensureMap(settings)
    const terms = searchTerms(this.search)
    const summaries: LayerSummary[] = []
    const pins: Pin[] = []
    const outlines = new Map<string, Outlined>()
    let total = 0
    let shown = 0

    this.trackZoom = settings.trackZoom
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
        const track =
          layer.track === null
            ? null
            : trackPath(getAt(record.data, layer.track), layer.trackRoot, record.file)
        if (point === null) summary.unplaced++
        else
          pins.push({
            key: `${index}|${record.id}`,
            record,
            layer,
            color,
            lat: point[0],
            lon: point[1],
            track,
          })
        const geometry = layer.boundary === null ? null : geometryOf(record.data, layer.boundary)
        if (geometry !== null)
          outlines.set(`${index}|${record.id}|${color}`, { record, layer, color, geometry })
      }
    })

    this.setCount(shown, total)
    this.pins = pins
    this.index = new Supercluster<{ pin: number }>({
      // Leaflet's tiles are 256 px, so this makes `radius` screen pixels.
      extent: 256,
      radius: 56,
      maxZoom: clusterMaxZoom,
    }).load(
      pins.map((pin, position) => ({
        type: 'Feature' as const,
        properties: { pin: position },
        geometry: { type: 'Point' as const, coordinates: [pin.lon, pin.lat] },
      })),
    )
    this.drawOutlines(outlines)
    this.renderLegend(summaries)
    this.fitSize()
    this.fitOnce(settings)
    this.drawPins()
    void this.drawTracks()
  }

  /**
   * Runs a move the view makes itself, unanimated so that it ends before this
   * returns, so the map doesn't take it for the user's.
   */
  private moveQuietly(move: (map: L.Map) => void): void {
    const map = this.map
    if (map === null) return
    this.quiet = true
    try {
      move(map)
    } finally {
      this.quiet = false
    }
  }

  /** Fits the map to its element's size, which Leaflet doesn't watch. */
  private fitSize(): void {
    this.moveQuietly((map) => map.invalidateSize({ animate: false }))
  }

  /**
   * Opens at the view's `center` and `zoom`, else frames every pin, the first
   * time the map has both pins and a size.
   */
  private fitOnce(settings = this.settings()): void {
    if (this.fitted || this.map === null || this.pins.length === 0 || this.mapEl.clientHeight === 0)
      return
    this.fitted = true
    const center = settings.center
    this.moveQuietly((map) => {
      if (center !== null) map.setView([...center], settings.zoom ?? 8, { animate: false })
      else
        map.fitBounds(L.latLngBounds(this.pins.map((pin) => L.latLng(pin.lat, pin.lon))), {
          padding: [24, 24],
          animate: false,
        })
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
          .on('click', () => {
            const zoom = index.getClusterExpansionZoom(clusterId)
            if (zoom <= clusterMaxZoom) map.setView([lat, lon], zoom)
            else this.showCluster(index, clusterId)
          })
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
          this.select(pin)
        })
        .addTo(this.markers)
    }
  }

  /**
   * Outlines the wanted boundaries, keeping those already drawn from the same
   * geometry. A reload reads every record anew, and a changed `boundary`
   * names another field, so either draws the outline again.
   */
  private drawOutlines(wanted: ReadonlyMap<string, Outlined>): void {
    for (const [key, drawn] of this.drawnOutlines)
      if (wanted.get(key)?.geometry !== drawn.of.geometry) {
        this.outlines.removeLayer(drawn.layer)
        this.drawnOutlines.delete(key)
      }
    for (const [key, of] of wanted) {
      const drawn = this.drawnOutlines.get(key)
      if (drawn !== undefined) {
        drawn.of = of
        continue
      }
      const layer = L.geoJSON(of.geometry, {
        style: {
          color: of.color,
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0.12,
          renderer: this.renderer,
        },
      })
      const entry: DrawnOutline = { layer, of }
      layer.on('click', () => {
        const { record, layer: config } = entry.of
        this.showDetail(record, titleOf(record, config.title), config.body)
      })
      this.drawnOutlines.set(key, entry)
      this.outlines.addLayer(layer)
    }
  }

  /**
   * Lists the records of a cluster whose pins share one position, such as
   * trips placed at their area's center; clicking one shows it.
   */
  private showCluster(index: Supercluster<{ pin: number }>, clusterId: number): void {
    const pins = index
      .getLeaves(clusterId, Infinity)
      .flatMap((leaf) => {
        const pin = this.pins[leaf.properties.pin]
        return pin === undefined ? [] : [pin]
      })
      .map((pin) => ({ pin, title: titleOf(pin.record, pin.layer.title) }))
      .toSorted((a, b) => a.title.localeCompare(b.title))
    const panel = this.openPanel(
      `${pins.length.toLocaleString()} records here`,
      'They share one position on the map.',
    )
    const list = panel.createDiv({ cls: 'records-cluster-list' })
    for (const { pin, title } of pins) {
      const row = list.createDiv({ cls: 'records-cluster-item' })
      row.createSpan({ cls: 'records-swatch' }).style.backgroundColor = pin.color
      row.createSpan({ text: title })
      const category =
        pin.layer.colorBy === null ? '' : categoryOf(pin.record.data, pin.layer.colorBy)
      if (category !== '') row.createSpan({ cls: 'records-cluster-category', text: category })
      row.addEventListener('click', () => {
        this.select(pin)
      })
    }
  }

  /** Shows a pin's record and draws its track. */
  private select(pin: Pin): void {
    this.showDetail(pin.record, titleOf(pin.record, pin.layer.title), pin.layer.body)
    this.selected = pin.key
    this.revealSelected = true
    void this.drawTracks()
  }

  protected override hideDetail(): void {
    super.hideDetail()
    if (this.selected === null) return
    this.selected = null
    void this.drawTracks()
  }

  /**
   * Draws the tracks wanted now and removes the rest: the selected pin's, and
   * when zoomed in to `trackZoom`, those of the pins in view. Each GPX file is
   * read and parsed the first time it is wanted, never before.
   */
  private async drawTracks(): Promise<void> {
    const map = this.map
    if (map === null) return
    const token = ++this.trackToken
    const wanted = new Map<string, Pin>()
    const selected = this.pins.find((pin) => pin.key === this.selected)
    if (selected?.track !== undefined && selected.track !== null) wanted.set(selected.key, selected)
    if (this.moved && map.getZoom() >= this.trackZoom) {
      const bounds = map.getBounds()
      const center = map.getCenter()
      const distance = (pin: Pin): number =>
        (pin.lat - center.lat) ** 2 + (pin.lon - center.lng) ** 2
      const inView = this.pins
        .filter((pin) => pin.track !== null && bounds.contains([pin.lat, pin.lon]))
        .toSorted((a, b) => distance(a) - distance(b))
        .slice(0, maxZoomTracks)
      for (const pin of inView) wanted.set(pin.key, pin)
    }
    // A line stays only while its pin is wanted and names the same track: a
    // reload can give a record another track path.
    for (const [key, drawn] of this.drawnTracks)
      if (wanted.get(key)?.track !== drawn.pin.track) {
        this.tracks.removeLayer(drawn.line)
        this.drawnTracks.delete(key)
      }
    for (const [key, pin] of wanted) {
      const style = this.trackStyle(pin)
      const drawn = this.drawnTracks.get(key)
      if (drawn !== undefined) {
        drawn.pin = pin
        drawn.line.setStyle(style)
        if (key === this.selected) this.reveal(drawn.line)
        continue
      }
      if (pin.track === null) continue
      // oxlint-disable-next-line no-await-in-loop -- one file at a time keeps the map responsive and cancellable
      const track = await this.loadTrack(pin.track)
      if (token !== this.trackToken) return
      if (track === null || track.length === 0) continue
      const line = L.polyline(
        track.map((points) => points.map(([lat, lon]) => L.latLng(lat, lon))),
        { ...style, renderer: this.renderer, interactive: true },
      )
      const entry: DrawnTrack = { line, pin }
      line.on('click', () => {
        this.select(entry.pin)
      })
      this.drawnTracks.set(key, entry)
      this.tracks.addLayer(line)
      if (key === this.selected) this.reveal(line)
    }
    this.root.dataset['tracks'] = String(this.drawnTracks.size)
  }

  /**
   * Brings the selected track to the front and, the first time it is drawn,
   * moves the map to it when it lies outside the view: a pin can sit at its
   * area's center, kilometres from the route. The detail panel covers the
   * map's right side, so the track is framed left of it.
   */
  private reveal(line: L.Polyline): void {
    line.bringToFront()
    const map = this.map
    if (!this.revealSelected || map === null) return
    this.revealSelected = false
    const bounds = line.getBounds()
    if (map.getBounds().contains(bounds)) return
    const width = map.getContainer().clientWidth
    this.moveQuietly((quietMap) =>
      quietMap.fitBounds(bounds, {
        paddingTopLeft: [24, 24],
        paddingBottomRight: [Math.min(664, Math.round(width / 2)), 24],
        maxZoom: 15,
        animate: false,
      }),
    )
  }

  private trackStyle(pin: Pin): L.PathOptions {
    const selected = pin.key === this.selected
    return { color: pin.color, weight: selected ? 5 : 3, opacity: selected ? 1 : 0.75 }
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
      if (summary.layer.track !== null)
        this.legendEl.createDiv({
          cls: 'records-legend-note',
          text: 'Tracks: click a pin, or zoom in',
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

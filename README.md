# Records

An Obsidian plugin that shows records kept in JSON or YAML files as views in a
`.base` file: a table, cards and a map. The data stays in its files; nothing is
copied into notes.

```yaml
# Hiking.base
views:
  - type: records
    name: Campgrounds
    source: .odyssey/campground/records
    order: [name, backcountry, reservation, fee]
    sort: [{ property: name, direction: ASC }]
  - type: records-map
    name: Campgrounds map
    source: .odyssey/campground/records
    coordinates: [lat, lon]
```

## Sources

A view's `source` is a vault path to either:

- a folder of `.json`, `.yaml` or `.yml` files, one record each; or
- one such file holding a list of records.

Dot folders such as `.odyssey/` work. Obsidian doesn't watch them, so a view
reads its source when it opens. The refresh button in the view, or the command
**Records: Reload records in open views**, reads it again.

## Table and cards

`type: records` is a table and `type: records-cards` shows the same rows as
cards.

| Key       | Meaning                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| `source`  | The folder or file of records.                                                                  |
| `order`   | The fields shown, in order. A nested field is a path: `wildernessCamping.status`.               |
| `sort`    | The default sort, as in Bases. Clicking a column heading sorts by it; a second click reverses.  |
| `groupBy` | `{ property, direction }`, as in Bases.                                                         |
| `where`   | Which records the view keeps; see below.                                                        |
| `title`   | The field that names a record in cards and in its detail panel. Defaults to `name`.             |
| `body`    | A field of Markdown text, such as a trip report, rendered below the other fields in the detail. |

The search box matches every field of a record; each word must appear
somewhere. Clicking a row or card shows all of the record's fields, and the
`body` field as Obsidian renders Markdown, its links resolving from the
record's file. Headings take their names from the Base's `properties`, as
Bases columns do.

## Where

`where` maps a field path to what its value must be. Every entry must hold.

```yaml
where:
  person: vern-dewit # equals
  area: [Jasper National Park, Yoho] # one of
  enjoyment: { min: 4.5 } # at least
  approachKm: { max: 10 } # at most
  title: { contains: [Ski, Snow] } # text containing, ignoring case; a list means any
  difficulty: { not: technical } # none of
  assets.gpx: { present: true } # has a value; false means missing
```

A value that is a list passes when one of its items does, so
`sources: osm` keeps the records whose `sources` include `osm`. `null` stands
for a missing value: `status: [operational, null]`. `min` and `max` compare
numbers with numbers and text with text, so `date: { min: "2020-01-01" }`
bounds dates written `YYYY-MM-DD`. An index is a path step:
`tiers.1: { present: true }` keeps the records with a second tier.

## Map

`type: records-map` puts a pin at each record's coordinates, clusters pins when
zoomed out, and outlines a record's boundary when it has one. Clicking a pin or
an outline shows the record. Clicking a cluster zooms in until it splits; a
cluster whose pins share one position, which no zoom splits, lists its records
instead. The legend toggles layers and their categories.

| Key           | Meaning                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| `source`      | The folder or file of records.                                                           |
| `coordinates` | `[lat, lon]` for two fields, or one field holding `[lat, lon]` or the text `"lat, lon"`. |
| `boundary`    | A field holding a GeoJSON Polygon, MultiPolygon or line to outline.                      |
| `colorBy`     | A field whose values color the pins, one legend entry each.                              |
| `colors`      | `{ <value>: <css color> }` for `colorBy` values; others take theme colors.               |
| `color`       | The pin color when there is no `colorBy`.                                                |
| `where`       | As in the table.                                                                         |
| `title`       | As in the table.                                                                         |
| `body`        | As in the table.                                                                         |
| `track`       | A field holding the path of a record's GPX track.                                        |
| `trackRoot`   | The vault folder relative track paths start from. Without it, the record file's folder.  |
| `layers`      | Several of the above, each with a `name`, in place of the keys on the view itself.       |
| `center`      | `[lat, lon]` where the map opens. Without it, the map frames every pin.                  |
| `zoom`        | The zoom it opens at, with `center`.                                                     |
| `trackZoom`   | The zoom from which the tracks of the records in view are drawn. Defaults to 12.         |
| `tiles`       | A tile URL template. Defaults to Esri World Topo.                                        |

A track is read only when it is wanted: when its pin is clicked, which draws
it at any zoom and moves the map to it if it lies outside the view, or when the map is zoomed in to `trackZoom` with the pin in
view, which draws the tracks of the 40 pins nearest the center. Nothing reads
a track when the map opens. Parsed tracks are kept for the life of the view,
so panning back draws them again without reading.

```yaml
- type: records-map
  name: Trips
  source: .odyssey/trip/records
  coordinates: [lat, lon]
  title: title
  body: summary
  track: assets.gpx # "sources/vern-dewit/gpx/2017-07-22.gpx"
  trackRoot: .odyssey/trip
```

## A Base of records only

Bases still runs its own query over the vault's notes for every view. A Base
whose views are all Records views can say it selects no notes:

```yaml
filters: 'false'
```

## Development

```sh
bun install
bun run check          # format, lint, types, tests, build
bun run obsidian-dev   # build, link build/ into ~/me/.obsidian/plugins/records, rebuild on change
```

`OBSIDIAN_VAULT_PATH` points `obsidian-dev` at another vault. The plugin uses
only Obsidian's API (no Node modules), so it can run on mobile.

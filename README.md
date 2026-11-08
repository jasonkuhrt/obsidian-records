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

| Key       | Meaning                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------- |
| `source`  | The folder or file of records.                                                                 |
| `order`   | The fields shown, in order. A nested field is a path: `wildernessCamping.status`.              |
| `sort`    | The default sort, as in Bases. Clicking a column heading sorts by it; a second click reverses. |
| `groupBy` | `{ property, direction }`, as in Bases.                                                        |
| `where`   | `{ <path>: <value> }` or `{ <path>: [<value>, …] }`. Every path must hold one of its values.   |
| `title`   | The field that names a record in cards and in its detail panel. Defaults to `name`.            |

The search box matches every field of a record; each word must appear
somewhere. Clicking a row or card shows all of the record's fields. Headings
take their names from the Base's `properties`, as Bases columns do.

## Map

`type: records-map` puts a pin at each record's coordinates, clusters pins when
zoomed out, and outlines a record's boundary when it has one. Clicking a pin or
an outline shows the record. The legend toggles layers and their categories.

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
| `layers`      | Several of the above, each with a `name`, in place of the keys on the view itself.       |
| `center`      | `[lat, lon]` where the map opens. Without it, the map frames every pin.                  |
| `zoom`        | The zoom it opens at, with `center`.                                                     |
| `tiles`       | A tile URL template. Defaults to Esri World Topo.                                        |

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

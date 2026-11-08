import { Notice, Plugin, type BasesAllOptions } from 'obsidian'
import type { RecordsView } from './views/base.ts'
import { CardsView, cardsViewType } from './views/cards.ts'
import { MapView, mapViewType } from './views/map.ts'
import { TableView, tableViewType } from './views/table.ts'

const sourceOption: BasesAllOptions = {
  type: 'text',
  key: 'source',
  displayName: 'Source',
  placeholder: 'Folder or file of records, e.g. data/places',
}

/**
 * Records shows records kept in JSON or YAML files as views in a `.base` file:
 * a table, cards and a map. A view's `source` names the folder or file, and
 * the rest of its settings live in the `.base` file (see the README).
 */
export default class RecordsPlugin extends Plugin {
  readonly views = new Set<RecordsView>()

  override onload(): void {
    const registered = [
      this.registerBasesView(tableViewType, {
        name: 'Records table',
        icon: 'table',
        factory: (controller, containerEl) => new TableView(controller, containerEl, this),
        options: () => [sourceOption],
      }),
      this.registerBasesView(cardsViewType, {
        name: 'Records cards',
        icon: 'layout-grid',
        factory: (controller, containerEl) => new CardsView(controller, containerEl, this),
        options: () => [sourceOption],
      }),
      this.registerBasesView(mapViewType, {
        name: 'Records map',
        icon: 'map',
        factory: (controller, containerEl) => new MapView(controller, containerEl, this),
        options: () => [
          sourceOption,
          {
            type: 'text',
            key: 'tiles',
            displayName: 'Tile URL',
            placeholder: 'https://…/{z}/{x}/{y}.png',
          },
        ],
      }),
    ]
    if (registered.includes(false))
      // oxlint-disable-next-line no-new -- a Notice shows itself when constructed
      new Notice('Records needs the Bases core plugin turned on.')

    this.addCommand({
      id: 'reload',
      name: 'Reload records in open views',
      callback: async () => {
        await Promise.all([...this.views].map((view) => view.reload()))
      },
    })
  }
}

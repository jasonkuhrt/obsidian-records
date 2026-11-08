import { formatText, valueParts, type Part } from '../core/format.ts'
import { isGeometry, isPlainObject } from '../core/path.ts'

/** Appends a value's parts to `el`, separated by commas. */
export const renderParts = (el: HTMLElement, parts: readonly Part[]): void => {
  parts.forEach((part, index) => {
    if (index > 0) el.appendText(', ')
    if (part.href !== undefined) {
      const link = el.createEl('a', { text: part.text, href: part.href, cls: 'external-link' })
      link.setAttr('target', '_blank')
      link.setAttr('rel', 'noopener')
      link.setAttr('title', part.href)
    } else if (part.tone !== undefined)
      el.createSpan({ text: part.text, cls: `records-tone-${part.tone}` })
    else el.appendText(part.text)
  })
}

export const renderValue = (el: HTMLElement, value: unknown): void => {
  renderParts(el, valueParts(value))
}

const isScalarList = (value: readonly unknown[]): boolean =>
  value.every((item) => item === null || typeof item !== 'object')

/** Every field of a record, nested objects and lists of objects expanded under their key. */
export const renderFields = (el: HTMLElement, data: Readonly<Record<string, unknown>>): void => {
  const list = el.createEl('dl', { cls: 'records-fields' })
  for (const [key, value] of Object.entries(data)) {
    list.createEl('dt', { text: key })
    const cell = list.createEl('dd')
    if (isPlainObject(value) && !isGeometry(value)) renderFields(cell, value)
    else if (Array.isArray(value) && !isScalarList(value))
      value.forEach((item, index) => {
        if (isPlainObject(item) && !isGeometry(item)) {
          cell.createDiv({ cls: 'records-fields-index', text: `${index + 1}` })
          renderFields(cell, item)
        } else cell.createDiv({ text: formatText(item) })
      })
    else if (valueParts(value).length === 0)
      cell.createSpan({ text: '—', cls: 'records-tone-muted' })
    else renderValue(cell, value)
  }
}

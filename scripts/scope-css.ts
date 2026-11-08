/**
 * Prefixes every selector in a plain stylesheet with `scope`, recursing into
 * `@media` and `@supports` blocks. Enough for Leaflet's stylesheet, which has
 * no nesting, `@import` or `@font-face`.
 */
export const scopeCss = (css: string, scope: string): string => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let out = ''
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('{', index)
    if (open === -1) break
    const prelude = source.slice(index, open).trim()
    let depth = 1
    let close = open + 1
    for (; close < source.length && depth > 0; close++) {
      if (source[close] === '{') depth++
      else if (source[close] === '}') depth--
    }
    const block = source.slice(open + 1, close - 1)
    if (prelude.startsWith('@media') || prelude.startsWith('@supports'))
      out += `${prelude} {\n${scopeCss(block, scope)}}\n`
    else if (prelude.startsWith('@')) out += `${prelude} {${block}}\n`
    else {
      const selectors = prelude
        .split(',')
        .map((selector) => `${scope} ${selector.trim()}`)
        .join(',\n')
      out += `${selectors} {${block}}\n`
    }
    index = close
  }
  return out
}

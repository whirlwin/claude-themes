import { describe, expect, mock, test } from 'claude-code/testing'
import type { RenderElement } from 'claude-code'

import { DEFAULT, FRAMES_PER_VARIANT, SCENE_COLUMNS, SCENE_ROWS, VARIANTS, frame, paint, pixels, variantAt, wordAt } from '../hooks/scene'

const SPINNER = { word: 'Baking', message: null, suffix: '…', mode: 'responding' as const }
const FESTIVE = new RegExp(VARIANTS.flatMap(v => v.words).join('|'))
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

describe('scene', () => {
  test('cycles through five costumes', async () => {
    const names = ['Santa Clawd', 'Elf Clawd', 'Reindeer Clawd', 'Snowman Clawd', 'Tree Clawd']
    expect(VARIANTS.map(v => v.name)).toEqual(names)
    names.forEach((name, i) => expect(variantAt(FRAMES_PER_VARIANT * i).name).toBe(name))
    expect(variantAt(FRAMES_PER_VARIANT * names.length).name).toBe('Santa Clawd')
  })

  test('says every word of each costume, in its own costume', async () => {
    const said = new Map<string, Set<string>>()
    for (let t = 0; t < FRAMES_PER_VARIANT * VARIANTS.length * 6; t++) {
      const name = variantAt(t).name
      said.set(name, (said.get(name) ?? new Set()).add(wordAt(t)))
    }
    for (const v of VARIANTS) {
      expect([...(said.get(v.name) ?? [])].sort()).toEqual([...v.words].sort())
    }
  })

  test('every frame packs width 1 block glyphs for the whole raster', async () => {
    const glyphs = new Set([...QUADRANTS].map(ch => ch.charCodeAt(0)))
    for (let t = 0; t < FRAMES_PER_VARIANT * VARIANTS.length; t++) {
      const cells = paint(t)
      expect(cells.length).toBe(SCENE_COLUMNS * SCENE_ROWS * 3)
      for (let i = 0; i < cells.length; i += 3) {
        expect(glyphs.has(cells[i] ?? 0)).toBe(true)
      }
    }
    expect(frame(0).length).toBe(Math.ceil((SCENE_COLUMNS * SCENE_ROWS * 12) / 3) * 4)
  })

  // The screensaver bakes the pixels and the spinner packs them, so a pixel
  // the packing drops would show in one and not the other. The puff of snow
  // is noise either way.
  test('packing keeps every pixel of every costume', async () => {
    const width = SCENE_COLUMNS * 2
    for (let t = 0; t < FRAMES_PER_VARIANT * VARIANTS.length; t++) {
      if (t % FRAMES_PER_VARIANT < 3) continue
      const drawn = pixels(t)
      const cells = paint(t)
      for (let i = 0; i < SCENE_COLUMNS * SCENE_ROWS; i++) {
        const mask = QUADRANTS.indexOf(String.fromCharCode(cells[i * 3] ?? 0x20))
        const x = (i % SCENE_COLUMNS) * 2
        const y = Math.floor(i / SCENE_COLUMNS) * 2
        for (let q = 0; q < 4; q++) {
          const shown = mask & (1 << q) ? cells[i * 3 + 1] : cells[i * 3 + 2]
          expect(shown ?? DEFAULT).toBe(drawn[(y + (q >> 1)) * width + x + (q & 1)] ?? DEFAULT)
        }
      }
    }
  })
})

describe('spinner', () => {
  test('draws Clawd beside a festive word in the terminal', async ($, on) => {
    mock.clock(on)
    const ui = await $.ui.mount({
      plugin: 'christmas',
      surface: 'terminal',
      component: 'Spinner',
      requestId: 'main',
      props: SPINNER,
    })
    expect(await ui.find({ type: 'Raster', key: 'clawd' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: FESTIVE })).toBeDefined()
  })

  test('only swaps the word where it cannot draw a raster', async ($, on) => {
    on('ui.render', (engine, e) => {
      const { Text } = engine.ui.resolve(e)
      const props = e.props as { word?: string }
      return h(Text, {}, `engine ${props.word ?? ''}`) as RenderElement
    })
    const ui = await $.ui.mount({
      plugin: 'christmas',
      surface: 'desktop',
      component: 'Spinner',
      requestId: 'main',
      props: SPINNER,
    })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: FESTIVE })).toBeDefined()
  })
})

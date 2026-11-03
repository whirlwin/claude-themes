// The spinner's picture: a canvas of quadrant pixels, four to a terminal cell
// (the glyphs the welcome screen draws Clawd with), packed into Raster cells.

export const DEFAULT = 0x01000000
export const SCENE_COLUMNS = 12
export const SCENE_ROWS = 3
export const TICK_MS = 150
export const FRAMES_PER_VARIANT = 60

const WIDTH = SCENE_COLUMNS * 2
const HEIGHT = SCENE_ROWS * 2
const POOF_FRAMES = 3

// Clawd as the welcome screen draws him, one character per quadrant pixel.
const CLAWD = [
  '...############...',
  '...##.######.##...',
  '.################.',
  '...############...',
  '....#.#....#.#....',
]
const CLAWD_WIDTH = 18
const EYES = [5, 12]
const TOP = 1
// The columns right of Clawd where each costume's effect plays.
const ZONE = CLAWD_WIDTH

type Canvas = Uint32Array

export type Variant = {
  name: string
  color: string
  // What the spinner says while this costume is on.
  words: readonly string[]
  draw: (c: Canvas, t: number) => void
}

function rnd(a: number, b: number, c = 0): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function set(c: Canvas, x: number, y: number, color: number): void {
  if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) c[y * WIDTH + x] = color
}

function get(c: Canvas, x: number, y: number): number {
  return c[y * WIDTH + x] ?? DEFAULT
}

// Sets a pixel only where its cell can still show it: two colors to a cell,
// or one beside the background. Snow and sparkles go through here, so they
// slip behind Clawd instead of knocking a pixel out of him, and the
// screensaver, which bakes the pixels before they are packed, agrees.
function dab(c: Canvas, x: number, y: number, color: number): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return
  const colors = new Set([color])
  let isOpen = false
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const px = x - (x % 2) + dx
    const py = y - (y % 2) + dy
    if (px === x && py === y) continue
    const p = get(c, px, py)
    if (p === DEFAULT) isOpen = true
    else colors.add(p)
  }
  if (colors.size <= (isOpen ? 1 : 2)) set(c, x, y, color)
}

function body(c: Canvas, top: number, color: (x: number, y: number) => number, rows = CLAWD.length, left = 0): void {
  for (let y = 0; y < rows; y++) {
    const line = CLAWD[y] ?? ''
    for (let x = 0; x < CLAWD_WIDTH; x++) {
      if (line[x] === '#') set(c, left + x, top + y, color(x, y))
    }
  }
}

const SANTA = 0xd42426
const FUR = 0xf4f4f4
const SACK = 0x9c6b3c

const santa: Variant = {
  name: 'Santa Clawd',
  color: '#E0393E',
  words: ['Gifting', 'Ho-ho-hoing', 'Delivering', 'Chimneying'],
  draw(c, t) {
    body(c, TOP, () => SANTA)
    // The hat fills whole cells above the trim: a cell with a gap in it shows
    // one color, and the trim would be dropped.
    for (let x = 6; x <= 13; x++) set(c, x, 0, SANTA)
    set(c, 14, 0, FUR)
    set(c, 15, 0, FUR)
    for (let x = 3; x <= 14; x++) set(c, x, TOP, FUR)
    for (const eye of EYES) set(c, eye, TOP + 1, 0x2b1515)
    for (let x = 6; x <= 11; x++) set(c, x, TOP + 2, FUR)
    set(c, 8, TOP + 3, FUR)
    set(c, 9, TOP + 3, FUR)
    set(c, 1, TOP + 2, FUR)
    set(c, 16, TOP + 2, FUR)
    for (let y = 3; y < HEIGHT; y++) {
      for (let x = 19; x <= 22; x++) set(c, x, y, SACK)
    }
    set(c, 20, 2, 0xd4a017)
    set(c, 21, 2, 0xd4a017)
    // Snow falls in the gaps around him; a flake that reaches him drops behind.
    for (const [i, x] of [0, 3, 16, 18, 23].entries()) dab(c, x, (Math.floor(t / 2) + i * 4) % HEIGHT, 0xffffff)
  },
}

const ELF = 0x3cb043
const CAP = 0xd42426
const BELL = [0xffd700, 0xfff3a0]

const elf: Variant = {
  name: 'Elf Clawd',
  color: '#3CB043',
  words: ['Wrapping', 'Tinkering', 'Jingling', 'Toymaking'],
  draw(c, t) {
    body(c, TOP, () => ELF)
    for (let x = 3; x <= 14; x++) set(c, x, TOP, CAP)
    for (let x = 7; x <= 13; x++) set(c, x, 0, CAP)
    // The bell swings inside one cell, so it never shares a cell with a gap.
    const swing = Math.floor(t / 2) % 2
    set(c, 12 + swing, 0, BELL[t % 4 === 0 ? 1 : 0] ?? 0xffd700)
    // Pointed ears in skin rather than green, sharing cells with no gap.
    for (const [x, y] of [[2, 2], [1, 1], [15, 2], [16, 1]] as const) set(c, x, y, 0xf2c08f)
    for (const eye of EYES) set(c, eye, TOP + 1, 0x1e3320)
    for (let y = 3; y < HEIGHT; y++) {
      for (let x = 18; x <= 21; x++) set(c, x, y, x === 19 ? 0xffd700 : 0xd42426)
    }
    set(c, 18, 2, 0xffd700)
    set(c, 19, 2, 0xffd700)
  },
}

const DEER = 0x9c6b43
const NOSE = [0xff2a2a, 0x7a1f1f]
// One star to a cell, so no two of them fight over one.
const TRAIL = [[16, 5], [18, 4], [20, 3], [21, 1], [23, 0]] as const

const reindeer: Variant = {
  name: 'Reindeer Clawd',
  color: '#C08A5B',
  words: ['Prancing', 'Dashing', 'Galloping', 'Sleighing'],
  draw(c, t) {
    body(c, TOP, () => DEER)
    // Antlers in his own brown: a third color in the head's top cells would be
    // dropped.
    for (const x of [3, 5, 12, 14]) set(c, x, 0, DEER)
    for (const eye of EYES) set(c, eye, TOP + 1, 0x2a1a10)
    const nose = NOSE[t % 8 < 5 ? 0 : 1] ?? 0xff2a2a
    set(c, 8, TOP + 2, nose)
    set(c, 9, TOP + 2, nose)
    TRAIL.forEach(([x, y], i) => {
      const phase = (i + TRAIL.length * 4 - Math.floor(t / 2)) % 4
      if (phase < 3) dab(c, x, y, phase === 0 ? 0xffffff : 0xffd23f)
    })
  },
}

const SNOWMAN = 0xf4f8ff
const TOPHAT = 0x3b3f4a
const SCARF = 0xd62839

const snowman: Variant = {
  name: 'Snowman Clawd',
  color: '#E8F1FA',
  words: ['Snowing', 'Frosting', 'Flurrying', 'Chilling'],
  draw(c, t) {
    body(c, TOP, () => SNOWMAN)
    for (let x = 6; x <= 11; x++) set(c, x, 0, TOPHAT)
    for (let x = 4; x <= 13; x++) set(c, x, TOP, TOPHAT)
    for (const eye of EYES) set(c, eye, TOP + 1, 0x222831)
    set(c, 8, TOP + 1, 0xff8c1a)
    set(c, 9, TOP + 1, 0xff8c1a)
    for (let x = 6; x <= 11; x++) set(c, x, TOP + 2, SCARF)
    // The scarf's loose end hangs over his middle and flaps from side to side.
    set(c, 8, TOP + 3, SCARF)
    set(c, 9, TOP + 3, SCARF)
    set(c, Math.floor(t / 3) % 2 === 0 ? 8 : 9, TOP + 4, SCARF)
    for (const [x, y] of [[1, 3], [0, 2], [16, 3], [17, 2]] as const) set(c, x, y, 0x8b5a2b)
    for (let x = ZONE; x < WIDTH; x++) {
      if (rnd(x, 11) < 0.7) set(c, x, HEIGHT - 1, 0xe8f0fa)
    }
    for (let i = 0; i < 4; i++) {
      const x = ZONE + Math.floor(rnd(i, 5) * 6)
      const y = (Math.floor(t / 3) + i * 2) % (HEIGHT - 1)
      dab(c, x + (Math.floor(t / 5) % 2), y, 0xb3d9ff)
    }
  },
}

const TREE = 0x1f8a3b
const BAUBLES = [0xff3b3b, 0x4da3ff, 0xffd23f, 0xff7ad9, 0xb36bff]
// His corners: each is alone in its cell, so each can take its own color.
const HOOKS = [[3, 1], [14, 1], [1, 3], [16, 3], [3, 4], [14, 4]] as const

const tree: Variant = {
  name: 'Tree Clawd',
  color: '#FFD23F',
  words: ['Twinkling', 'Decorating', 'Glittering', 'Shining'],
  draw(c, t) {
    body(c, TOP, () => TREE)
    const star = t % 6 === 0 ? 0xfff6c0 : 0xffd700
    set(c, 8, 0, star)
    set(c, 9, 0, star)
    for (const eye of EYES) set(c, eye, TOP + 1, 0x0f3d1c)
    // The garland sags across his middle, one pixel to each of the three cells
    // that are green all the way round.
    for (const [x, y] of [[6, 2], [7, 3], [8, 3], [9, 3], [10, 3], [11, 2]] as const) set(c, x, y, 0xe8c547)
    HOOKS.forEach(([x, y], i) => {
      const lit = BAUBLES[(i + Math.floor(t / 4)) % BAUBLES.length] ?? 0xff3b3b
      set(c, x, y, rnd(i, t, 8) < 0.12 ? 0xffffff : lit)
    })
    for (const [x, top, box] of [[0, 0xffd700, 0xd42426], [16, 0xf4f4f4, 0x2f6fd6], [18, 0xffd700, 0xb36bff]] as const) {
      set(c, x, HEIGHT - 2, top)
      set(c, x + 1, HEIGHT - 2, top)
      set(c, x, HEIGHT - 1, box)
      set(c, x + 1, HEIGHT - 1, box)
    }
  },
}

export const VARIANTS: readonly Variant[] = [santa, elf, reindeer, snowman, tree]

export function variantAt(t: number): Variant {
  return VARIANTS[Math.floor(t / FRAMES_PER_VARIANT) % VARIANTS.length] ?? santa
}

// Each time a costume comes around again it says its next word.
export function wordAt(t: number): string {
  const v = variantAt(t)
  const round = Math.floor(t / (FRAMES_PER_VARIANT * VARIANTS.length))
  return v.words[round % v.words.length] ?? v.name
}

const SNOW = [0xffffff, 0xdcefff, 0xb3d9ff]

// A puff of snow over the first frames of each costume hides the swap.
function poof(c: Canvas, t: number): void {
  const f = t % FRAMES_PER_VARIANT
  if (f >= POOF_FRAMES) return
  const density = (POOF_FRAMES - f) / (POOF_FRAMES + 1)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < CLAWD_WIDTH; x++) {
      if (rnd(x, y, t) < density) set(c, x, y, SNOW[Math.floor(rnd(y, x, t) * SNOW.length)] ?? 0xffffff)
    }
  }
}

// Indexed by which quadrants hold the foreground: 1 upper left, 2 upper
// right, 4 lower left, 8 lower right.
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

// A cell holds two colors, so a busier block keeps its two commonest and
// paints the rest in the second.
function cell(pixels: number[]): [number, number, number] {
  const counts = new Map<number, number>()
  for (const p of pixels) counts.set(p, (counts.get(p) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === DEFAULT ? 1 : -1))
  const fg = ranked.find(([color]) => color !== DEFAULT)?.[0]
  if (fg === undefined) return [0x20, DEFAULT, DEFAULT]
  const bg = counts.has(DEFAULT) ? DEFAULT : (ranked.find(([color]) => color !== fg)?.[0] ?? DEFAULT)
  const mask = pixels.reduce((m, p, i) => (p === fg ? m | (1 << i) : m), 0)
  return [QUADRANTS.charCodeAt(mask), fg, bg]
}

// The picture before it is packed into cells, one color per quadrant pixel.
// The screensaver bakes these, since it has no two-colors-per-cell limit.
export function pixels(t: number): Uint32Array {
  const c: Canvas = new Uint32Array(WIDTH * HEIGHT).fill(DEFAULT)
  variantAt(t).draw(c, t)
  poof(c, t)
  return c
}

export function paint(t: number): Uint32Array {
  const c = pixels(t)
  const cells = new Uint32Array(SCENE_COLUMNS * SCENE_ROWS * 3)
  for (let row = 0; row < SCENE_ROWS; row++) {
    for (let col = 0; col < SCENE_COLUMNS; col++) {
      const x = col * 2
      const y = row * 2
      cells.set(cell([get(c, x, y), get(c, x + 1, y), get(c, x, y + 1), get(c, x + 1, y + 1)]), (row * SCENE_COLUMNS + col) * 3)
    }
  }
  return cells
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Raster cells are little-endian u32s; typed arrays use the host's order,
// which is little-endian on every platform Claude Code ships for.
export function encode(words: Uint32Array): string {
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const d = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | d
    out += ALPHABET[(n >> 18) & 63]
    out += ALPHABET[(n >> 12) & 63]
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '='
  }
  return out
}

export function frame(t: number): string {
  return encode(paint(t))
}

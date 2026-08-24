/** The opalescent palette profile colours are drawn from. */
export const opal = [
  { name: 'violet', hex: '#c084fc' },
  { name: 'indigo', hex: '#818cf8' },
  { name: 'cyan', hex: '#22d3ee' },
  { name: 'mint', hex: '#34d399' },
  { name: 'rose', hex: '#f472b6' },
  { name: 'gold', hex: '#b39051' },
  { name: 'navy', hex: '#051e39' },
] as const

export type OpalColor = (typeof opal)[number]

/**
 * Black or white, whichever can be read on top of `hex`. A profile's colour is anything from
 * a near-black navy to a bright cyan, so a glyph that is always one or the other is a glyph
 * that disappears on half the palette. Relative luminance, the way the web has measured this
 * since contrast was first written down.
 */
export function readableOn(hex: string): string {
  const value = normalizeHex(hex)
  if (!value) return '#000000'
  const channel = (at: number) => {
    const part = parseInt(value.slice(at, at + 2), 16) / 255
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  // Where black and white are exactly as readable as each other: solve the two contrast
  // ratios for equality and this is what falls out. Lighter than it and black wins.
  return luminance > 0.1791 ? '#000000' : '#ffffff'
}

/** A colour as the picker holds it: hue in degrees, saturation and value in 0–1. Kept
 *  apart from the hex so that sliding to black or white does not lose the hue underneath. */
export interface Hsv {
  h: number
  s: number
  v: number
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

/** Whatever was typed — `abc`, `#ABC`, `aabbcc`, `#aabbcc` — as the lowercase `#rrggbb`
 *  a profile stores, or null where it is not a colour. */
export function normalizeHex(text: string): string | null {
  const raw = text.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-f]{3}$/i.test(raw))
    return `#${raw
      .toLowerCase()
      .split('')
      .map((digit) => digit + digit)
      .join('')}`
  return null
}

export function hexToHsv(hex: string): Hsv {
  const normal = normalizeHex(hex) ?? '#000000'
  const r = parseInt(normal.slice(1, 3), 16) / 255
  const g = parseInt(normal.slice(3, 5), 16) / 255
  const b = parseInt(normal.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 1)
  const val = clamp(v, 0, 1)
  const c = val * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = val - c
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x]
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** How a colour is named on a control: by its opal name where it has one, and otherwise
 *  by the hex itself, in capitals so it reads as a code rather than a word. */
export function describeColor(hex: string): string {
  const named = opal.find((color) => color.hex === hex.toLowerCase())
  return named ? `opal ${named.name}` : hex.toUpperCase()
}

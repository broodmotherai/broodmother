import { expect, it } from 'vitest'
import { describeColor, hexToHsv, hsvToHex, normalizeHex, opal } from '@/colors'

it('takes a hex however it is typed and says it back the way profiles store it', () => {
  expect(normalizeHex('abc')).toBe('#aabbcc')
  expect(normalizeHex('#ABC')).toBe('#aabbcc')
  expect(normalizeHex('  C084FC ')).toBe('#c084fc')
  expect(normalizeHex('#c084fc')).toBe('#c084fc')
  expect(normalizeHex('#c084f')).toBeNull()
  expect(normalizeHex('grey')).toBeNull()
})

it('round-trips every opal through hsv unchanged', () => {
  for (const color of opal) expect(hsvToHex(hexToHsv(color.hex))).toBe(color.hex)
})

it('reads black and white without inventing a hue', () => {
  expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 })
  expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 1 })
  expect(hsvToHex({ h: 200, s: 0, v: 1 })).toBe('#ffffff')
})

it('names an opal and spells anything else out', () => {
  expect(describeColor('#c084fc')).toBe('opal violet')
  expect(describeColor('#C084FC')).toBe('opal violet')
  expect(describeColor('#8fb8d8')).toBe('#8FB8D8')
})

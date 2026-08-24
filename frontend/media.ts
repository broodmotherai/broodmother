import { extensionOf } from '@/path'

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

export function isImage(path: string): boolean {
  return extensionOf(path) in IMAGE_TYPES
}

export function imageTypeOf(path: string): string | null {
  return IMAGE_TYPES[extensionOf(path)] ?? null
}

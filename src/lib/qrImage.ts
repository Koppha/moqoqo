import { scanFromURLAsync } from 'expo-camera'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { decode } from 'jpeg-js'
import jsQR from 'jsqr'

/** Longest side the JS reader works at: big enough for a QR in a photo, small enough to stay quick. */
const MAX_SIDE = 1200

/**
 * The QR codes in a picture (e.g. one chosen from the gallery).
 * First the platform reader through expo-camera: Apple's on iPhone, Google's ML Kit on Android — which Expo only
 * allows on phones with Google Play services (not on Huawei phones since 2019, nor plain emulators). When that is
 * unavailable or finds nothing, the picture is shrunk, decoded and read in JavaScript (jsQR), which works anywhere.
 */
export async function readQrFromImage(uri: string): Promise<string[]> {
  try {
    const found = await scanFromURLAsync(uri, ['qr'])
    if (found.length) return found.map((f) => f.data)
  } catch {
    // No Play services: read it ourselves below.
  }
  const text = await readInJs(uri)
  return text ? [text] : []
}

async function readInJs(uri: string): Promise<string | null> {
  const original = await ImageManipulator.manipulate(uri).renderAsync()
  const scale = Math.min(1, MAX_SIDE / Math.max(original.width, original.height))
  const ctx = ImageManipulator.manipulate(original)
  if (scale < 1) ctx.resize({ width: Math.round(original.width * scale), height: null })
  const small = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true })
  if (!small.base64) return null
  const bytes = Uint8Array.from(atob(small.base64), (c) => c.charCodeAt(0))
  const { width, height, data } = decode(bytes, { useTArray: true, formatAsRGBA: true })
  const hit = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height, { inversionAttempts: 'attemptBoth' })
  return hit?.data ?? null
}

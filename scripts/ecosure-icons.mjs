// Draws the EcoSure app icons (assets/ecosure): a white shield with a tick on EcoSure's blue-to-purple gradient.
// A stand-in until EcoSure's designers supply the final artwork. Run: node scripts/ecosure-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const SIZE = 1024
const FROM = [0x3f, 0x7b, 0xef] // es hero gradient
const TO = [0x7a, 0x3f, 0xe4]

/** Shield outline in unit coordinates (0..1), centre top to centre bottom, drawn as a polygon. */
function shield(x, y) {
  if (y < 0.08 || y > 0.92) return false
  // Top rising to a point in the middle, straight sides, then curving to a point at the bottom.
  const top = 0.12 + 0.1 * (Math.abs(x - 0.5) / 0.36)
  if (y < top) return false
  const half = y < 0.5 ? 0.36 : 0.36 * Math.cos(((y - 0.5) / 0.42) * (Math.PI / 2))
  return Math.abs(x - 0.5) <= half
}

/** Tick inside the shield: two thick strokes. */
function tick(x, y) {
  const seg = (ax, ay, bx, by, w) => {
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    const px = ax + t * dx - x, py = ay + t * dy - y
    return px * px + py * py <= w * w
  }
  return seg(0.36, 0.5, 0.46, 0.6, 0.045) || seg(0.46, 0.6, 0.65, 0.39, 0.045)
}

/**
 * scale: how much of the canvas the shield fills (adaptive icons keep art inside the middle 66%).
 * Returns [inShield, inTick] coverage for a pixel, supersampled 4×4 for smooth edges.
 */
function coverage(px, py, scale) {
  let s = 0, k = 0
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x = ((px + (i + 0.5) / 4) / SIZE - 0.5) / scale + 0.5
    const y = ((py + (j + 0.5) / 4) / SIZE - 0.5) / scale + 0.5
    if (shield(x, y)) { s++; if (tick(x, y)) k++ }
  }
  return [s / 16, k / 16]
}

function draw(name, { background, shieldColor, tickColor, scale }) {
  const png = new PNG({ width: SIZE, height: SIZE })
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * SIZE)
    let rgba = background ? [...FROM.map((c, i) => Math.round(c + (TO[i] - c) * t)), 255] : [0, 0, 0, 0]
    if (shieldColor) {
      const [s, k] = coverage(x, y, scale)
      const mix = (a, b, f) => a.map((c, i) => Math.round(c + (b[i] - c) * f))
      if (s) rgba = mix(rgba, [...shieldColor, 255], s)
      if (k) rgba = mix(rgba, tickColor === 'clear' ? [0, 0, 0, 0] : [...(tickColor ?? FROM.map((c, i) => Math.round(c + (TO[i] - c) * t))), 255], k)
    }
    png.data.set(rgba, (y * SIZE + x) * 4)
  }
  writeFileSync(`assets/ecosure/${name}.png`, PNG.sync.write(png))
}

mkdirSync('assets/ecosure', { recursive: true })
const white = [255, 255, 255]
draw('icon', { background: true, shieldColor: white, scale: 0.78 }) // iOS / store icon: full bleed, no transparency
draw('adaptive-background', { background: true, scale: 1 })
draw('adaptive-foreground', { background: false, shieldColor: white, tickColor: [0x5b, 0x55, 0xe9], scale: 0.52 })
draw('adaptive-monochrome', { background: false, shieldColor: white, tickColor: 'clear', scale: 0.52 })
console.log('assets/ecosure: icon, adaptive-background, adaptive-foreground, adaptive-monochrome')

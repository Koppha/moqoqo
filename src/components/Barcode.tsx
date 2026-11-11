import { useMemo } from 'react'
import { PixelRatio, View } from 'react-native'

// Code 128 bar/space widths for symbol values 0–106 (each 11 modules; STOP is 13).
const PATTERNS = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
  '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
  '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
).split(' ')
const START_C = 105
const STOP = 106
const QUIET = 10 // modules of white either side, as scanners expect

/** Code 128 set C symbol values for an even-length digit string, with start, checksum and stop. */
export function code128C(digits: string): number[] {
  if (!/^(\d\d)+$/.test(digits)) throw new Error('Code 128 C needs an even number of digits')
  const values = [START_C]
  for (let i = 0; i < digits.length; i += 2) values.push(Number(digits.slice(i, i + 2)))
  const check = values.reduce((sum, v, i) => sum + v * Math.max(i, 1), 0) % 103
  return [...values, check, STOP]
}

/**
 * Numeric Code 128 barcode drawn with plain views. Bars are snapped to whole device pixels so
 * scanners see clean edges; the code is centred in `width`.
 */
export function Barcode({ value, width, height, label }: { value: string; width: number; height: number; label: string }) {
  const bars = useMemo(() => {
    const out: { x: number; w: number }[] = []
    let x = 0
    for (const v of code128C(value)) {
      PATTERNS[v].split('').forEach((d, i) => {
        const w = Number(d)
        if (i % 2 === 0) out.push({ x, w }) // even positions are bars, odd are spaces
        x += w
      })
    }
    return { out, modules: x }
  }, [value])

  const total = bars.modules + QUIET * 2
  const module = Math.max(1 / PixelRatio.get(), PixelRatio.roundToNearestPixel(width / total))
  const left = PixelRatio.roundToNearestPixel((width - bars.modules * module) / 2)
  return (
    <View accessibilityRole="image" accessibilityLabel={label} style={{ width, height, backgroundColor: '#fff' }}>
      {bars.out.map((b, i) => (
        <View key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: left + b.x * module, width: b.w * module, backgroundColor: '#0E0F14' }} />
      ))}
    </View>
  )
}

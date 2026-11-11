import makeQr from 'qrcode-generator'
import { useMemo, type ReactNode } from 'react'
import { View } from 'react-native'

/**
 * QR code drawn with plain views (no native SVG module). Each row's consecutive dark modules
 * are merged into one view, so a typical code is a few hundred views, not thousands.
 * `center` (e.g. an avatar) is drawn over the middle; use level 'H' with it so the code still scans.
 */
export function QrCode({ value, size, label, level = 'M', center }: {
  value: string; size: number; label: string; level?: 'L' | 'M' | 'Q' | 'H'; center?: ReactNode
}) {
  const rows = useMemo(() => {
    const qr = makeQr(0, level)
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    const runs: { row: number; start: number; len: number }[] = []
    for (let r = 0; r < n; r++) {
      let c = 0
      while (c < n) {
        if (!qr.isDark(r, c)) { c++; continue }
        const start = c
        while (c < n && qr.isDark(r, c)) c++
        runs.push({ row: r, start, len: c - start })
      }
    }
    return { n, runs }
  }, [value, level])

  // 4-module white quiet zone around the code, as scanners expect.
  const cell = size / (rows.n + 8)
  return (
    <View accessibilityRole="image" accessibilityLabel={label}
      style={{ width: size, height: size, backgroundColor: '#fff', borderRadius: 12 }}>
      {rows.runs.map((r, i) => (
        <View key={i} style={{
          position: 'absolute', backgroundColor: '#0E0F14',
          left: (r.start + 4) * cell, top: (r.row + 4) * cell,
          width: r.len * cell + 0.5, height: cell + 0.5,
        }} />
      ))}
      {center && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          {center}
        </View>
      )}
    </View>
  )
}

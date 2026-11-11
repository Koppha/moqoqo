export const fmt = (n: number) =>
  'M' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const clock = () => {
  const d = new Date()
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
}

let seq = 0
export const uid = () => Date.now().toString(36) + (seq++).toString(36)

/** +26662000021 → +266 62•• ••21 */
export const maskMsisdn = (msisdn: string) => {
  const local = msisdn.replace(/^\+266/, '')
  return `+266 ${local.slice(0, 2)}•• ••${local.slice(-2)}`
}

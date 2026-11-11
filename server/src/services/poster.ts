// Branded QR print-out for a merchant's till or an agent's counter: one HTML page, printed from the portal (staff)
// or from EcoCash Business (the merchant or agent themselves). Customers scan it with EcoCash Super App, or type the code.
import qrcode from 'qrcode-generator'
import type { Queryable } from '../db/index'
import { AppError } from '../errors'
import { getBranding, readAsset } from './branding'
import { displayName, type UserRow } from './users'

export type PosterSize = 'a4' | 'a5' | 'a6'
const PAGE: Record<PosterSize, { w: string; h: string; scale: number }> = {
  a4: { w: '210mm', h: '297mm', scale: 1 },
  a5: { w: '148mm', h: '210mm', scale: 0.71 },
  a6: { w: '105mm', h: '148mm', scale: 0.5 },
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The payment link a customer's EcoCash Super App opens when scanning (merchants and agents alike). */
export const payLink = (code: string) => `moqoqo://pay?m=${encodeURIComponent(code)}`

export async function posterHtml(q: Queryable, u: UserRow, size: PosterSize = 'a5'): Promise<string> {
  if (u.role === 'customer' || !u.code) throw new AppError('VALIDATION', 'Only merchants and agents have a QR print-out')
  const agent = u.role === 'agent'
  const qr = qrcode(0, 'H')
  qr.addData(payLink(u.code))
  qr.make()
  const svg = qr.createSvgTag({ cellSize: 10, margin: 0, scalable: true })

  const branding = await getBranding(q)
  let logo = '<div class="wordmark">EcoCash</div>'
  if (branding.logo) {
    const file = await readAsset(q, branding.logo.id)
    if (file) logo = `<img class="logo" alt="" src="data:${file.contentType};base64,${file.content.toString('base64')}">`
  }
  const p = PAGE[size]
  const title = agent ? 'Cash out here' : 'Pay here with EcoCash'
  const titleSt = agent ? 'Ntša chelete mona' : 'Lefa mona ka EcoCash'
  const how = agent
    ? ['Open EcoCash Super App and tap Scan', 'Scan this code, or type the agent code', 'Enter the amount and your PIN', 'Collect your cash']
    : ['Open EcoCash Super App and tap Scan', 'Scan this code, or type the merchant code', 'Enter the amount and your PIN', 'Show the receipt']
  const howSt = agent
    ? ['Bula EcoCash Super App u tobetse Scan', 'Skena khoutu ena, kapa u ngole khoutu ea agent', 'Kenya chelete le PIN ea hau', 'Nka chelete ea hau']
    : ['Bula EcoCash Super App u tobetse Scan', 'Skena khoutu ena, kapa u ngole khoutu ea morekisi', 'Kenya chelete le PIN ea hau', 'Bontša rasiti']

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(displayName(u))} · ${esc(u.code)}</title>
<style>
  @page { size: ${p.w} ${p.h}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0B1D86; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: ${p.w}; height: ${p.h}; margin: 0 auto; display: flex; flex-direction: column; overflow: hidden; background: #fff; }
  .top { background: linear-gradient(135deg, #2446E8, #0B1D86); color: #fff; padding: ${18 * p.scale}mm ${14 * p.scale}mm ${14 * p.scale}mm; text-align: center; }
  .logo { max-height: ${16 * p.scale}mm; max-width: 70%; }
  .wordmark { font-size: ${30 * p.scale}pt; font-weight: 900; font-style: italic; letter-spacing: -0.5pt; }
  h1 { margin: ${5 * p.scale}mm 0 0; font-size: ${26 * p.scale}pt; line-height: 1.1; }
  .st { margin-top: ${1.5 * p.scale}mm; font-size: ${14 * p.scale}pt; opacity: .85; }
  .middle { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: ${8 * p.scale}mm; }
  .qr { width: ${110 * p.scale}mm; height: ${110 * p.scale}mm; padding: ${5 * p.scale}mm; border: ${1.2 * p.scale}mm solid #2446E8; border-radius: ${6 * p.scale}mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .name { margin-top: ${6 * p.scale}mm; font-size: ${22 * p.scale}pt; font-weight: 800; text-align: center; }
  .code { margin-top: ${2 * p.scale}mm; font-size: ${18 * p.scale}pt; font-weight: 700; letter-spacing: 1.5pt; background: #EEF1FF; padding: ${1.5 * p.scale}mm ${5 * p.scale}mm; border-radius: 99px; }
  .how { display: flex; gap: ${6 * p.scale}mm; padding: 0 ${12 * p.scale}mm ${10 * p.scale}mm; font-size: ${10 * p.scale}pt; color: #1F2A5C; }
  .how ol { margin: 0; padding-left: 1.2em; flex: 1; }
  .how li { margin: ${0.8 * p.scale}mm 0; }
  .foot { background: #F4F6FF; text-align: center; font-size: ${8.5 * p.scale}pt; color: #4B5583; padding: ${3 * p.scale}mm; }
  @media screen { body { background: #e5e7eb; padding: 16px; } .page { box-shadow: 0 4px 24px rgba(0,0,0,.15); } }
</style></head>
<body><div class="page">
  <div class="top">${logo}<h1>${esc(title)}</h1><div class="st">${esc(titleSt)}</div></div>
  <div class="middle">
    <div class="qr" role="img" aria-label="QR code for ${esc(u.code)}">${svg}</div>
    <div class="name">${esc(displayName(u))}</div>
    <div class="code">${agent ? 'Agent code' : 'Merchant code'}: ${esc(u.code)}</div>
  </div>
  <div class="how"><ol>${how.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><ol lang="st">${howSt.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
  <div class="foot">Never share your PIN · Se ke oa arolelana PIN ea hau · EcoCash Super App, Econet Telecom Lesotho</div>
</div></body></html>`
}

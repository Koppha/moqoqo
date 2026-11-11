import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { USSD_DEFAULTS, ussdDialString, type UssdSettings } from '../../shared/api'
import { startTestServer, type TestServer } from './helpers'

let t: TestServer
let admin: string

beforeAll(async () => {
  t = await startTestServer()
  admin = await t.adminLogin()
})
afterAll(() => t.close())

describe('USSD fallback', () => {
  it('the apps get *199# and the steps in their config', async () => {
    const c = (await t.call('GET', '/v1/app-config')).body
    expect(c.ussd.code).toBe('*199#')
    expect(c.ussd.functions.send.steps.en).toMatch(/PIN/)
  })

  it('staff set shortcuts; a shortcut never carries the PIN and must be a dial string', async () => {
    const s: UssdSettings = structuredClone(USSD_DEFAULTS)
    s.functions.send.shortcut = '*199*1*1*{number}*{amount}#'
    const ok = await t.call('PUT', '/admin/v1/ussd-settings', s, admin)
    expect(ok.status).toBe(200)
    expect((await t.call('GET', '/v1/app-config')).body.ussd.functions.send.shortcut).toBe('*199*1*1*{number}*{amount}#')

    const pin = structuredClone(s)
    pin.functions.send.shortcut = '*199*1*{number}*{amount}*{pin}#'
    expect((await t.call('PUT', '/admin/v1/ussd-settings', pin, admin)).body.error.message).toMatch(/never carries the PIN/)
    const bad = structuredClone(s)
    bad.functions.lec.shortcut = 'tel:199'
    expect((await t.call('PUT', '/admin/v1/ussd-settings', bad, admin)).status).toBe(400)
    const code = structuredClone(s)
    code.code = '199'
    expect((await t.call('PUT', '/admin/v1/ussd-settings', code, admin)).status).toBe(400)
  })

  it('fills a shortcut only when it has every value, else dials the main code', () => {
    const s: UssdSettings = structuredClone(USSD_DEFAULTS)
    s.functions.send.shortcut = '*199*1*1*{number}*{amount}#'
    expect(ussdDialString(s, 'send', { number: '+266 6200 0021', amount: 150 })).toBe('*199*1*1*62000021*150#')
    expect(ussdDialString(s, 'send', { number: '62000021', amount: '12.50' })).toBe('*199*1*1*62000021*12.50#')
    expect(ussdDialString(s, 'send', { number: '62000021' })).toBe('*199#')
    expect(ussdDialString(s, 'send', { number: '62000021', amount: '1.234' })).toBe('*199#')
    expect(ussdDialString(s, 'balance')).toBe('*199#')
  })
})

// SMS and email providers. Both are mocks until ETL picks the real ones: a mock sends nothing and the
// notification is recorded with status 'mock' (visible in the portal under Notifications).
// To plug in a provider, implement the interface (e.g. an SMPP/HTTP SMS gateway, an SMTP or API email service),
// set `real = true` and pass it to buildApp.

export interface SmsGateway {
  /** false = mock: nothing leaves the server. */
  readonly real: boolean
  /** `to` is E.164 (+266…). Throws when the provider refuses the message. */
  send(to: string, text: string): Promise<void>
}

export interface EmailGateway {
  readonly real: boolean
  send(to: string, subject: string, text: string): Promise<void>
}

export class MockSms implements SmsGateway {
  readonly real = false
  readonly sent: { to: string; text: string }[] = []
  async send(to: string, text: string) {
    this.sent.push({ to, text })
  }
}

export class MockEmail implements EmailGateway {
  readonly real = false
  readonly sent: { to: string; subject: string; text: string }[] = []
  async send(to: string, subject: string, text: string) {
    this.sent.push({ to, subject, text })
  }
}

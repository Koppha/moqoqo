// Which number a request really comes from, as Econet's network sees it. Over Econet mobile data, ETL's gateway can
// add the subscriber's number to requests (header enrichment) or answer a number-verify lookup; that proves the
// wallet's SIM is in the phone making the request. MockNumberVerify doesn't know (null) until ETL connects it.

export interface NumberVerify {
  /** The verified number (+266…) of the connection this request came over, or null when unknown. */
  numberFor(req: { headers: Record<string, string | string[] | undefined>; ip: string }): Promise<string | null>
}

export class MockNumberVerify implements NumberVerify {
  async numberFor(): Promise<string | null> {
    return null
  }
}

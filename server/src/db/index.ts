// One thin adapter over node-postgres (real Postgres) and PGlite (embedded, zero setup).
// Everything else in the server only sees `Db` / `Queryable`.
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

export interface Queryable {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface Db extends Queryable {
  /** Runs fn inside BEGIN/COMMIT; rolls back if it throws. Use the passed Queryable only. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  /** Multi-statement SQL without parameters, applied atomically in one transaction (migrations). */
  exec(sql: string): Promise<void>
  close(): Promise<void>
  readonly driver: 'pg' | 'pglite'
}

// int8 (bigint, count) and numeric (sum) come back as JS numbers. Cents fit easily in 2^53.
const INT8 = 20
const NUMERIC = 1700
const toNumber = (v: string) => (v === null ? null : Number(v))

export async function createDb(opts: { databaseUrl: string | null; dataDir: string | null }): Promise<Db> {
  return opts.databaseUrl ? createPgDb(opts.databaseUrl) : createPgliteDb(opts.dataDir)
}

async function createPgDb(url: string): Promise<Db> {
  pg.types.setTypeParser(INT8, toNumber)
  pg.types.setTypeParser(NUMERIC, toNumber)
  const pool = new pg.Pool({ connectionString: url, max: 10 })
  await pool.query('SELECT 1')
  return {
    driver: 'pg',
    async query(sql, params) {
      return (await pool.query(sql, params as any[])).rows
    },
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn({ query: async (sql, params) => (await client.query(sql, params as any[])).rows })
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    async exec(sql) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

async function createPgliteDb(dataDir: string | null): Promise<Db> {
  const options = { parsers: { [INT8]: toNumber, [NUMERIC]: toNumber } }
  const db = dataDir ? await PGlite.create(dataDir, options) : await PGlite.create(options)
  return {
    driver: 'pglite',
    async query(sql, params) {
      return (await db.query<any>(sql, params as any[])).rows
    },
    // PGlite serialises transactions on its single connection, so row locks are trivially honoured.
    tx: (fn) => db.transaction((t) => fn({ query: async (sql, params) => (await t.query<any>(sql, params as any[])).rows })),
    async exec(sql) {
      await db.transaction(async (t) => {
        await t.exec(sql)
      })
    },
    close: () => db.close(),
  }
}

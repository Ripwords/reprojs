import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")

// Pool + timeout defaults chosen so a runaway query or a leaked transaction
// can't drain the pool:
//   - max=10                      caps concurrent connections per worker.
//   - statement_timeout=30s       kills any single query that runs too long.
//   - idle_in_transaction=10s     kills connections a caller BEGIN'd but never
//                                 COMMIT/ROLLBACK'd (leaked txn).
// The github:sync drain is network-heavy (GitHub API calls) but each DB
// statement it issues is a simple single-row SELECT/UPDATE/DELETE, so 30s is
// comfortably above any realistic query latency. Raise via env if a future
// workload legitimately needs longer.
const client = new Pool({
  connectionString: url,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000),
  idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 10_000),
})
export const db = drizzle(client, { schema })
export type DB = typeof db

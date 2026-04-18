import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { env } from "../lib/env"
import * as schema from "./schema"

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
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: env.DB_IDLE_TX_TIMEOUT_MS,
})
export const db = drizzle(client, { schema })
export type DB = typeof db

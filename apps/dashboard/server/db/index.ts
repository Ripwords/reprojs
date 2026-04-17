import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")

const client = new Pool({ connectionString: url })
export const db = drizzle(client, { schema })
export type DB = typeof db

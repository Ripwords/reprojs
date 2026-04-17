import { drizzle } from "drizzle-orm/bun-sql"
import { SQL } from "bun"
import * as schema from "./schema"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")

const client = new SQL(url)
export const db = drizzle(client, { schema })
export type DB = typeof db

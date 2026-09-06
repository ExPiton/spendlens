import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One pooled postgres.js client per server process, created lazily on first
 * use. `DATABASE_URL` is required at runtime but NOT at build time — Next.js
 * imports every route module while collecting page data, so throwing here
 * would break `next build` in environments without the database wired up yet
 * (e.g. the Docker builder stage).
 */

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __spendlensSql?: ReturnType<typeof postgres>;
  __spendlensDb?: Db;
};

function createDb(): Db {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (local) or configure it in your deployment.",
    );
  }
  const client =
    globalForDb.__spendlensSql ??
    postgres(connectionString, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      prepare: false,
    });
  if (process.env.NODE_ENV !== "production") globalForDb.__spendlensSql = client;
  return drizzle(client, { schema });
}

function getDb(): Db {
  return (globalForDb.__spendlensDb ??= createDb());
}

/** Drizzle client. Property access initialises the connection on first use. */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});

export { schema };

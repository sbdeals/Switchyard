import type { Database } from "@/lib/dokploy";
import { buildDatabaseConnection } from "./db-connect";

/**
 * Build the internal connection string for a database: other services reach it
 * at appName:defaultPort on the overlay network. (An externalPort, if set, is
 * published on the *host*, so it does not belong with the internal hostname.)
 */
export function connectionString(db: Database): string | null {
  if (!db.appName) return null;
  return buildDatabaseConnection(db, db.databasePassword ?? "").uri;
}

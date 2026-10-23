import type { Database } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";

/**
 * Build the internal connection string for a database: other services reach it
 * at appName:defaultPort on the overlay network. (An externalPort, if set, is
 * published on the *host*, so it does not belong with the internal hostname.)
 */
export function connectionString(db: Database): string | null {
  const meta = ENGINE_META[db.engine];
  const host = db.appName || db.name;
  const port = meta.defaultPort;
  const user = db.databaseUser ?? "";
  const pass = db.databasePassword ?? "";
  const name = db.databaseName ?? "";
  switch (db.engine) {
    case "postgres":
      return `postgresql://${user}:${pass}@${host}:${port}/${name}`;
    case "mysql":
    case "mariadb":
      return `mysql://${user}:${pass}@${host}:${port}/${name}`;
    case "mongo":
      return `mongodb://${user}:${pass}@${host}:${port}`;
    case "redis":
      return `redis://default:${pass}@${host}:${port}`;
    default:
      return null;
  }
}

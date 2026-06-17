import type { Database } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";

/** Build a client connection string for a database (internal host = appName). */
export function connectionString(db: Database): string | null {
  const meta = ENGINE_META[db.engine];
  const host = db.appName || db.name;
  const port = db.externalPort ?? meta.defaultPort;
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

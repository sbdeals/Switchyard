import type { Database } from "./dokploy";
import { ENGINE_META } from "./engines";

type ConnectionDatabase = Pick<
  Database,
  "engine" | "appName" | "databaseUser" | "databaseName"
>;

export interface DatabaseEndpoint {
  host: string;
  port: number;
}

/** Public connection fields; passwords are supplied separately after reveal. */
export function databaseConnectionDetails(db: ConnectionDatabase) {
  return {
    host: db.appName,
    port: ENGINE_META[db.engine].defaultPort,
    user: db.engine === "redis" ? "default" : db.databaseUser ?? "",
    database: db.engine === "redis"
      ? "0"
      : db.databaseName || (db.engine === "mongo" ? "admin" : ""),
  };
}

// Encode every reserved URI character, including the ones encodeURIComponent
// leaves unescaped. Each credential and database name is one URI component.
const encode = (value: string) => encodeURIComponent(value).replace(
  /[!'()*]/g,
  (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
);

/** A POSIX shell argument, including embedded single quotes. */
const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

/** Internal endpoints always use appName and the engine's private port. */
export function buildDatabaseConnection(
  db: ConnectionDatabase,
  password: string,
  endpoint?: DatabaseEndpoint,
): { uri: string; cli: string } {
  const details = databaseConnectionDetails(db);
  const { host, port } = endpoint ?? details;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Database endpoint is unavailable");
  }
  const { user, database } = details;
  const uriHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const authenticated = db.engine === "redis" ? password !== "" : user !== "" || password !== "";
  const credentials = authenticated ? `${encode(user)}:${encode(password)}@` : "";
  const scheme = db.engine === "postgres" ? "postgresql"
    : db.engine === "mongo" ? "mongodb"
    : db.engine === "mariadb" ? "mysql"
    : db.engine;
  // Dokploy's Mongo user is created in the admin authentication database.
  const query = db.engine === "mongo" ? "?authSource=admin" : "";
  const uri = `${scheme}://${credentials}${uriHost}:${port}/${encode(database)}${query}`;

  if (db.engine === "mysql" || db.engine === "mariadb") {
    // The mysql client accepts flags, not a mysql:// URI. Use long options with
    // '=' so a credential beginning with '-' cannot become another option.
    const cli = [
      "mysql --protocol=TCP",
      `--host=${shellQuote(host.replace(/^\[|\]$/g, ""))}`,
      `--port=${port}`,
      ...(user ? [`--user=${shellQuote(user)}`] : []),
      `--password=${shellQuote(password)}`,
      ...(database ? [`--database=${shellQuote(database)}`] : []),
    ].join(" ");
    return { uri, cli };
  }

  const command = db.engine === "postgres" ? "psql"
    : db.engine === "mongo" ? "mongosh"
    : "redis-cli -u";
  return { uri, cli: `${command} ${shellQuote(uri)}` };
}

import type { Database } from "./dokploy";
import { connectionString } from "./connection";

/** Undefined means credentials have not been explicitly loaded, not an empty password. */
export function databaseCredentialValue(
  db: Database,
  password: string | null | undefined,
  kind: "connection" | "password",
): string | null {
  if (password === undefined) return null;
  return kind === "connection"
    ? connectionString({ ...db, databasePassword: password })
    : password;
}

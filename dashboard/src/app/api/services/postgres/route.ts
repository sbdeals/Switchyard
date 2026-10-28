import { requireAppAccess } from "@/lib/api-auth";
import {
  fetchRows,
  listTables,
  listTargets,
  resolveTarget,
  runUserQuery,
} from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Backend for the service drawer's "Data" tab: a read-only-by-default Postgres
 * browser. Every operation runs by docker-exec'ing `psql` inside the service's
 * own container as its container-env POSTGRES_USER/DB — no external connection,
 * no user-supplied credentials (see lib/postgres.ts and lib/docker.ts).
 *
 * Security:
 *  - AuthN/Z: requireAppAccess opens the sealed session, validates it against
 *    Dokploy with this user's cookie, and loads their service tree on EVERY
 *    request before Docker access. Invalid sessions return 401, unowned apps
 *    403, and unavailable authorization 503. The proxy is only a coarse gate.
 *  - Read-only: PostgreSQL enforces read-only transactions unless the request
 *    explicitly sets allowWrites. The classifier also rejects statement batches
 *    and provides early feedback (lib/postgres.ts #classifyStatement).
 *  - Read-only SQL uses psql --command so meta-commands are not interpreted;
 *    write mode uses stdin. Neither uses a shell (see runPsqlCsv).
 *    Catalog-sourced identifiers are double-quoted.
 */

// Ops (documentation of the discriminated request shapes):
//   { op: "targets" }
//   { op: "tables";  target? }
//   { op: "rows";    target?, schema, table, limit?, offset? }
//   { op: "query";   target?, sql, allowWrites? }
// The body is parsed as a flat bag of unknowns and each field is validated with
// a typeof check below, so a malformed body can never coerce past the guards.
interface Body {
  app?: unknown;
  op?: unknown;
  target?: unknown;
  schema?: unknown;
  table?: unknown;
  limit?: unknown;
  offset?: unknown;
  sql?: unknown;
  allowWrites?: unknown;
}

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Invalid JSON body.");
  }

  const app = typeof body.app === "string" ? body.app : "";
  const op = typeof body.op === "string" ? body.op : "";
  if (!app) return bad("Missing service name.");
  if (!op) return bad("Missing op.");

  const allowed = await requireAppAccess(request, app);
  if (allowed instanceof Response) return allowed;

  try {
    if (op === "targets") {
      const targets = await listTargets(app);
      return Response.json({ targets });
    }

    // Every other op needs a concrete target container.
    const targetKey = typeof body.target === "string" ? body.target : undefined;
    const target = await resolveTarget(app, targetKey);
    if (!target) {
      return bad("No running Postgres container found for this service.", 404);
    }

    if (op === "tables") {
      const res = await listTables(target);
      if (!res.ok) return bad(res.error, 422);
      return Response.json({ target: target.meta, schemas: res.schemas });
    }

    if (op === "rows") {
      const schema = typeof body.schema === "string" ? body.schema : "";
      const table = typeof body.table === "string" ? body.table : "";
      if (!schema || !table) return bad("Missing schema or table.");
      const res = await fetchRows(
        target,
        schema,
        table,
        typeof body.limit === "number" ? body.limit : 50,
        typeof body.offset === "number" ? body.offset : 0,
      );
      if (!res.ok) return bad(res.error, 422);
      return Response.json(res.page);
    }

    if (op === "query") {
      const sql = typeof body.sql === "string" ? body.sql : "";
      const allowWrites = body.allowWrites === true;
      const res = await runUserQuery(target, sql, allowWrites);
      if (!res.ok) {
        // 403 when the read-only guard rejected a write; 422 for a SQL error.
        return Response.json(
          { error: res.error, readonlyRejected: res.readonlyRejected ?? false },
          { status: res.readonlyRejected ? 403 : 422 },
        );
      }
      return Response.json({
        columns: res.grid?.columns ?? [],
        rows: res.grid?.rows ?? [],
        rowCount: res.rowCount ?? 0,
        ms: res.ms ?? 0,
        messages: res.messages,
        truncated: res.truncated ?? false,
      });
    }

    return bad(`Unknown op "${op}".`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return bad(message, 500);
  }
}

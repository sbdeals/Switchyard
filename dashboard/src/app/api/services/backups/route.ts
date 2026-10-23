import { Readable } from "node:stream";
import { unstable_rethrow } from "next/navigation";
import { openBridgeDatabaseBackup } from "@/lib/bridge-backups";
import { parseBackupFilename } from "@/lib/bridge-backup-commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("composeId") ?? "";
  const filename = params.get("filename") ?? "";
  if (!id || !parseBackupFilename(filename)) {
    return Response.json({ error: "Invalid compose service or backup filename." }, { status: 400 });
  }
  try {
    // Reauthorizes this compose service for this user before opening any file.
    const { stream, size } = await openBridgeDatabaseBackup(id, filename);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    // Do not reveal paths, backup existence, or Dokploy details on a denied read.
    return Response.json({ error: "Backup unavailable or access denied. Refresh the backup list and retry." }, { status: 404 });
  }
}

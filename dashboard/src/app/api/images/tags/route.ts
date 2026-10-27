import { cookies } from "next/headers";

import { getImageTags } from "@/lib/image-tags";
import { SESSION_COOKIE, SESSION_MAX_AGE, openSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const store = await cookies();
  const session = openSession(store.get(SESSION_COOKIE)?.value);
  const now = Date.now();
  if (!session || !Number.isFinite(session.iat) || session.iat > now ||
      now - session.iat >= SESSION_MAX_AGE * 1000) {
    return Response.json({ tags: [], available: false }, { status: 401 });
  }
  const image = new URL(request.url).searchParams.get("image") ?? "";
  return Response.json(await getImageTags(image), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

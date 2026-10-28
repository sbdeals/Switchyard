import { requireApiSession } from "@/lib/api-auth";
import { getImageTags } from "@/lib/image-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireApiSession(request);
  if (denied) return denied;
  const image = new URL(request.url).searchParams.get("image") ?? "";
  return Response.json(await getImageTags(image), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

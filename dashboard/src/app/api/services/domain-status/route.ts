import { unstable_rethrow } from "next/navigation";

import { request as dokployRequest } from "@/lib/dokploy";
import { parseDomainStatusQuery, resolveOwnedDomain } from "@/lib/domain-status-access";
import { checkDomainStatus } from "@/lib/domain-status-network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const query = parseDomainStatusQuery(new URL(request.url).searchParams);
  if (!query) {
    return Response.json({ error: "Invalid domain status request" }, { status: 400, headers });
  }

  try {
    const domain = await resolveOwnedDomain(query, dokployRequest, process.env.SWITCHYARD_HOST_IP);
    if (!domain) {
      return Response.json({ error: "Domain unavailable" }, { status: 404, headers });
    }
    // Authorization always precedes the shared network result cache.
    return Response.json(await checkDomainStatus(domain), { headers });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: "Workspace unavailable" }, { status: 503, headers });
  }
}

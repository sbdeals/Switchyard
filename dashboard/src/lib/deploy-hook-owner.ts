import "server-only";
import { cookies } from "next/headers";
import { request } from "./dokploy";
import { parseManaged } from "./managed-compose";
import { openSession, SESSION_COOKIE } from "./session";

/** Verify the account and current service access before reading any hook secret. */
export async function deployHookOwner(serviceId: string) {
  if (!serviceId || serviceId.length > 256) throw new Error("Invalid service.");
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = openSession(sessionToken);
  if (!session || !sessionToken) throw new Error("Sign in to manage deploy hooks.");
  const identity = await request<{ user?: { id?: string } } | null>("auth/get-session");
  if (!identity?.user?.id) throw new Error("Sign in to manage deploy hooks.");
  const detail = await request<{ composeFile?: string }>(`compose.one?composeId=${encodeURIComponent(serviceId)}`);
  if (parseManaged(detail.composeFile)?.kind !== "repo") throw new Error("Deploy hooks require a managed Git repo service.");
  // This read-only procedure checks service management permission in Dokploy.
  // compose.one alone also admits readers, who must not claim a service's hook.
  await request(`compose.getDefaultCommand?composeId=${encodeURIComponent(serviceId)}`);
  return { ownerId: identity.user.id };
}

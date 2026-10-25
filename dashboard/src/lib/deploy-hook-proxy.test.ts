import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const hook = `/api/hooks/deploy/${"a".repeat(64)}`;

describe("deploy webhook session exemption", () => {
  it("allows only POST to an exact generated hook path without a session", () => {
    expect(proxy(new NextRequest(`http://dashboard.test${hook}`, { method: "POST" })).status).toBe(200);
    expect(proxy(new NextRequest(`http://dashboard.test${hook}?query=1`, { method: "POST" })).status).toBe(200);
  });

  it.each([
    "/api/hooks/deploy", "/api/hooks/deploy/", "/api/hooks/deploy/short", `${hook}/`, `${hook}/extra`,
    `${hook}a`, hook.replace("deploy/", "deploy-other/"), "/api/hooks/settings", "/api/services/deploy-logs",
    "/api/hooks/deploy/%61" + "a".repeat(63),
  ])("keeps session protection for %s", (pathname) => {
    expect(proxy(new NextRequest(`http://dashboard.test${pathname}`, { method: "POST" })).status).toBe(401);
  });

  it.each(["GET", "PUT", "PATCH", "DELETE"])("does not exempt %s even at the exact path", (method) => {
    expect(proxy(new NextRequest(`http://dashboard.test${hook}`, { method })).status).toBe(401);
  });
});

import { describe, expect, it, vi } from "vitest";

import { parseDomainStatusQuery, resolveOwnedDomain, type DomainStatusQuery } from "./domain-status-access";

const appQuery: DomainStatusQuery = {
  serviceType: "application",
  serviceId: "app-1",
  domainId: "domain-1",
};
const tree = [{ environments: [{ applications: [{ applicationId: "app-1" }], compose: [{ composeId: "compose-1" }] }] }];
const domain = { domainId: "domain-1", host: "stored.example.test", https: true, path: "/health" };
const application = { applicationId: "app-1", serverId: null, domains: [domain] };

function client(detail: unknown = application, projects: unknown = tree) {
  return vi.fn(async (path: string) => path === "project.all" ? projects : detail);
}

describe("domain status query", () => {
  it.each(["application", "compose"])("accepts %s IDs", (serviceType) => {
    expect(parseDomainStatusQuery(new URLSearchParams({ serviceType, serviceId: "service-1", domainId: "domain-1" })))
      .toEqual({ serviceType, serviceId: "service-1", domainId: "domain-1" });
  });

  it.each([
    "",
    "serviceType=database&serviceId=app-1&domainId=domain-1",
    "serviceType=application&serviceId=app-1",
    "serviceType=application&serviceId=&domainId=domain-1",
    "serviceType=application&serviceId=app-1%2Fother&domainId=domain-1",
    "serviceType=application&serviceId=app-1&domainId=domain-1&domainId=domain-2",
    "serviceType=application&serviceId=app-1&domainId=domain-1&host=localhost",
    "serviceType=application&serviceId=app-1&domainId=domain-1&https=false",
    `serviceType=application&serviceId=${"a".repeat(129)}&domainId=domain-1`,
  ])("rejects malformed or caller-controlled targets: %s", (query) => {
    expect(parseDomainStatusQuery(new URLSearchParams(query))).toBeNull();
  });
});

describe("domain ownership", () => {
  it("checks the user's tree before resolving an application domain", async () => {
    const request = client();
    expect(await resolveOwnedDomain(appQuery, request, "203.0.113.2")).toEqual({
      ...appQuery,
      host: domain.host,
      https: true,
      path: "/health",
      expectedIps: ["203.0.113.2"],
    });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "project.all", "application.one?applicationId=app-1",
    ]);
  });

  it("resolves compose domains and defaults absent TLS/path fields", async () => {
    const query: DomainStatusQuery = { ...appQuery, serviceType: "compose", serviceId: "compose-1" };
    const request = client({ composeId: "compose-1", domains: [{ domainId: "domain-1", host: domain.host }] });
    expect(await resolveOwnedDomain(query, request)).toEqual({ ...query, host: domain.host, https: false, path: null, expectedIps: [] });
    expect(request).toHaveBeenLastCalledWith("compose.one?composeId=compose-1");
  });

  it("never reads service details for a service outside the user's tree", async () => {
    const request = client();
    expect(await resolveOwnedDomain({ ...appQuery, serviceId: "someone-elses-app" }, request)).toBeNull();
    expect(request).toHaveBeenCalledExactlyOnceWith("project.all");
  });

  it("rejects domains absent from the owned service", async () => {
    expect(await resolveOwnedDomain({ ...appQuery, domainId: "another-domain" }, client())).toBeNull();
  });

  it.each([
    { ...application, applicationId: "another-app" },
    { ...application, domains: [{ ...domain, applicationId: "another-app" }] },
    { ...application, domains: [{ ...domain, composeId: "compose-1" }] },
  ])("rejects mismatched service/domain ownership", async (detail) => {
    expect(await resolveOwnedDomain(appQuery, client(detail))).toBeNull();
  });

  it("revalidates membership for every request", async () => {
    const request = client();
    await resolveOwnedDomain(appQuery, request);
    request.mockResolvedValueOnce([]);
    expect(await resolveOwnedDomain(appQuery, request)).toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenLastCalledWith("project.all");
  });

  it("does not compare remote-server DNS against this dashboard host", async () => {
    const result = await resolveOwnedDomain(appQuery, client({ ...application, serverId: "remote-1" }), "203.0.113.2");
    expect(result?.expectedIps).toEqual([]);
  });

  it.each([undefined, "", "https://203.0.113.2", "not-an-ip"])("ignores invalid expected host IP %s", async (hostIp) => {
    expect((await resolveOwnedDomain(appQuery, client(), hostIp))?.expectedIps).toEqual([]);
  });

  it("allows an IPv6 expected host IP", async () => {
    expect((await resolveOwnedDomain(appQuery, client(), "2001:db8::1"))?.expectedIps).toEqual(["2001:db8::1"]);
  });

  it("fails closed when project.all fails, without reading a service", async () => {
    const failure = new Error("Dokploy unavailable");
    const request = vi.fn().mockRejectedValue(failure);
    await expect(resolveOwnedDomain(appQuery, request)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledExactlyOnceWith("project.all");
  });

  it("propagates service failures, including framework authentication redirects", async () => {
    const failure = new Error("redirect to login");
    const request = client().mockResolvedValueOnce(tree).mockRejectedValueOnce(failure);
    await expect(resolveOwnedDomain(appQuery, request)).rejects.toBe(failure);
  });

  it.each([null, {}, [{ environments: null }], [{ environments: [{ applications: {} }] }]])(
    "fails closed on malformed workspace data", async (projects) => {
      const request = client(application, projects);
      await expect(resolveOwnedDomain(appQuery, request)).rejects.toThrow("Invalid workspace response");
      expect(request).toHaveBeenCalledExactlyOnceWith("project.all");
    },
  );

  it.each([
    { ...application, domains: {} },
    { ...application, domains: [{ ...domain, host: "" }] },
    { ...application, domains: [{ ...domain, https: "yes" }] },
    { ...application, domains: [{ ...domain, path: 123 }] },
  ])("fails closed on malformed stored domains", async (detail) => {
    await expect(resolveOwnedDomain(appQuery, client(detail))).rejects.toThrow("Invalid domain response");
  });
});

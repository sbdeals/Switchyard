import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApplicationAccess: vi.fn(),
  createRedirect: vi.fn(),
  updateRedirect: vi.fn(),
  deleteRedirect: vi.fn(),
  createSecurity: vi.fn(),
  updateSecurity: vi.fn(),
  deleteSecurity: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@/lib/dokploy", () => mocks);
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.unstable_rethrow }));

import {
  createRedirectAction,
  updateRedirectAction,
  deleteRedirectAction,
  createSecurityAction,
  updateSecurityAction,
  deleteSecurityAction,
} from "@/app/actions";

const regex = "^https://example[.]com/old/(.*)$";
const replacement = "https://example.com/new/${1}";
const password = "  exact throwaway password  ";
const mutations = [
  mocks.createRedirect,
  mocks.updateRedirect,
  mocks.deleteRedirect,
  mocks.createSecurity,
  mocks.updateSecurity,
  mocks.deleteSecurity,
];

const cases = [
  {
    name: "create redirect",
    run: () => createRedirectAction("app", ` ${regex} `, ` ${replacement} `, true),
    mutation: mocks.createRedirect,
    guard: ["app"],
    payload: ["app", { regex, replacement, permanent: true }],
  },
  {
    name: "update redirect",
    run: () => updateRedirectAction("app", "redirect", ` ${regex} `, ` ${replacement} `, false),
    mutation: mocks.updateRedirect,
    guard: ["app", { kind: "redirects", id: "redirect" }],
    payload: ["redirect", { regex, replacement, permanent: false }],
  },
  {
    name: "delete redirect",
    run: () => deleteRedirectAction("app", "redirect"),
    mutation: mocks.deleteRedirect,
    guard: ["app", { kind: "redirects", id: "redirect" }],
    payload: ["redirect"],
  },
  {
    name: "create basic-auth user",
    run: () => createSecurityAction("app", "  visitor  ", password),
    mutation: mocks.createSecurity,
    guard: ["app"],
    payload: ["app", { username: "visitor", password }],
  },
  {
    name: "replace basic-auth user",
    run: () => updateSecurityAction("app", "security", "  visitor  ", password),
    mutation: mocks.updateSecurity,
    guard: ["app", { kind: "security", id: "security" }],
    payload: ["security", { username: "visitor", password }],
  },
  {
    name: "delete basic-auth user",
    run: () => deleteSecurityAction("app", "security"),
    mutation: mocks.deleteSecurity,
    guard: ["app", { kind: "security", id: "security" }],
    payload: ["security"],
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertApplicationAccess.mockResolvedValue(undefined);
  for (const mutation of mutations) mutation.mockResolvedValue({ password, internal: true });
});

describe("application HTTP setting actions", () => {
  it.each(cases)("$name checks ownership and returns only success", async ({ run, mutation, guard, payload }) => {
    expect(await run()).toEqual({ ok: true });
    expect(mocks.assertApplicationAccess).toHaveBeenCalledExactlyOnceWith(...guard);
    expect(mutation).toHaveBeenCalledExactlyOnceWith(...payload);
    expect(mocks.assertApplicationAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mutation.mock.invocationCallOrder[0],
    );
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/");
    for (const other of mutations.filter((fn) => fn !== mutation)) expect(other).not.toHaveBeenCalled();
  });

  it.each(cases)("$name cannot mutate an inaccessible application or child", async ({ run }) => {
    mocks.assertApplicationAccess.mockRejectedValue(new Error("Application access denied."));
    expect(await run()).toMatchObject({ ok: false });
    for (const mutation of mutations) expect(mutation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { name: "invalid regex", run: () => createRedirectAction("app", "[", replacement, false) },
    { name: "blank regex", run: () => updateRedirectAction("app", "redirect", " ", replacement, false) },
    { name: "blank replacement", run: () => createRedirectAction("app", regex, " ", false) },
    { name: "non-string regex", run: () => createRedirectAction("app", null as unknown as string, replacement, false) },
    { name: "non-string replacement", run: () => updateRedirectAction("app", "redirect", regex, 1 as unknown as string, false) },
    { name: "non-boolean permanent", run: () => createRedirectAction("app", regex, replacement, "false" as unknown as boolean) },
    { name: "blank username", run: () => createSecurityAction("app", " ", password) },
    { name: "colon in username", run: () => updateSecurityAction("app", "security", "user:name", password) },
    { name: "empty password", run: () => createSecurityAction("app", "visitor", "") },
    { name: "non-string username", run: () => createSecurityAction("app", null as unknown as string, password) },
    { name: "non-string password", run: () => updateSecurityAction("app", "security", "visitor", 1 as unknown as string) },
  ])("rejects $name before writes", async ({ run }) => {
    const result = await run();
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    for (const mutation of mutations) expect(mutation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { run: cases[3].run, mutation: mocks.createSecurity, error: "Could not save basic-auth user." },
    { run: cases[4].run, mutation: mocks.updateSecurity, error: "Could not save basic-auth user." },
    { run: cases[5].run, mutation: mocks.deleteSecurity, error: "Could not remove basic-auth user." },
  ])("does not echo a password from a basic-auth API failure", async ({ run, mutation, error }) => {
    mutation.mockRejectedValue(new Error(`Upstream failure includes ${password}`));
    expect(await run()).toEqual({ ok: false, error });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves the login redirect when a basic-auth session expires", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.assertApplicationAccess.mockRejectedValue(redirect);
    mocks.unstable_rethrow.mockImplementation((error) => { throw error; });
    await expect(createSecurityAction("app", "visitor", password)).rejects.toBe(redirect);
    expect(mocks.createSecurity).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

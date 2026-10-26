import { describe, expect, it } from "vitest";
import { serviceNameWarning, validateServiceName } from "./service-name";

describe("validateServiceName", () => {
  it("trims the display name without converting it into a Docker name", () => {
    expect(validateServiceName("  API / Production  ")).toEqual({ name: "API / Production", error: null });
  });

  it.each(["", " \n\t ", undefined, null, 42])("rejects empty or non-text names: %s", (name) => {
    expect(validateServiceName(name).error).toBe("Service name is required.");
  });

  it("accepts the 1 and 63 character boundaries after trimming", () => {
    expect(validateServiceName(" a ").error).toBeNull();
    expect(validateServiceName(` ${"a".repeat(63)} `).error).toBeNull();
    expect(validateServiceName("a".repeat(64)).error).toBe("Service name must be 1–63 characters.");
  });
});

describe("serviceNameWarning", () => {
  const current = { id: "current", environmentId: "production", name: "API" };

  it("warns about a trimmed, case-insensitive duplicate in the same environment", () => {
    const warning = serviceNameWarning(" api ", current, [
      current,
      { id: "other", environmentId: "production", name: " API " },
    ]);
    expect(warning).toContain("You can still save it.");
    expect(validateServiceName(" api ").error).toBeNull();
  });

  it("ignores the service itself and services in other environments", () => {
    expect(serviceNameWarning("API", current, [
      current,
      { id: "other", environmentId: "staging", name: "API" },
    ])).toBeNull();
  });

  it("does not warn for a distinct or empty name", () => {
    expect(serviceNameWarning("Worker", current, [current])).toBeNull();
    expect(serviceNameWarning(" ", current, [
      { id: "other", environmentId: "production", name: "" },
    ])).toBeNull();
  });
});

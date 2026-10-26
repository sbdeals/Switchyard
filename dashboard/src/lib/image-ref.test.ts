import { describe, expect, it } from "vitest";
import { filterImageTags, parseImageRef, sortImageTags, withImageTag, type ImageTag } from "./image-ref";

const digest = `sha256:${"a".repeat(64)}`;

describe("parseImageRef", () => {
  it("defaults unqualified images to Docker Hub's library namespace", () => {
    expect(parseImageRef("nginx")).toEqual({
      registry: "registry-1.docker.io",
      namespace: "library",
      repository: "nginx",
      tag: null,
      digest: null,
      name: "nginx",
    });
  });

  it("parses a namespace and a case-sensitive tag", () => {
    expect(parseImageRef("traefik/whoami:v1.10-RC1")).toEqual({
      registry: "registry-1.docker.io",
      namespace: "traefik",
      repository: "whoami",
      tag: "v1.10-RC1",
      digest: null,
      name: "traefik/whoami",
    });
  });

  it.each(["docker.io", "index.docker.io", "registry-1.docker.io", "hub.docker.com", "DOCKER.IO"])(
    "normalizes the Hub host %s while retaining the entered prefix",
    (host) => {
      expect(parseImageRef(`${host}/nginx:latest`)).toMatchObject({
        registry: "registry-1.docker.io",
        namespace: "library",
        repository: "nginx",
        name: `${host}/nginx`,
      });
    }
  );

  it("parses nested namespaces, a tag, and a digest", () => {
    expect(parseImageRef(`ghcr.io/team/services/api:v2@${digest}`)).toEqual({
      registry: "ghcr.io",
      namespace: "team/services",
      repository: "api",
      tag: "v2",
      digest,
      name: "ghcr.io/team/services/api",
    });
  });

  it("allows digest-only references", () => {
    expect(parseImageRef(`library/nginx@${digest}`)).toMatchObject({
      name: "library/nginx", tag: null, digest,
    });
  });

  it.each(["localhost:5000", "registry.example.com:443", "registry.example.com"])(
    "separates the registry %s from the tag",
    (registry) => {
      expect(parseImageRef(`${registry}/team/api:stable`)).toMatchObject({
        registry, namespace: "team", repository: "api", tag: "stable",
      });
      expect(parseImageRef(`${registry}/api`)).toMatchObject({ registry, namespace: "", tag: null });
    }
  );

  it("accepts valid Docker name separators and the maximum tag length", () => {
    expect(parseImageRef(`my-team/my__image.test--one:${"a".repeat(128)}`)).not.toBeNull();
  });

  it.each([
    "", " nginx", "nginx ", "ngin\nx", "ngin\tx", "nginx\u0000", "https://hub.docker.com/nginx",
    "http://localhost/nginx", "user:password@hub.docker.com/nginx", "user@host/nginx", "nginx?tag=x",
    "nginx#fragment", "nginx\\other", "/nginx", "nginx/", "team//nginx", "../nginx", "team/../nginx",
    "team/%2e%2e/nginx", "team/Image", "team/.image", "team/image_", "team/image..name", "nginx:",
    "nginx:bad/tag", "nginx:has space", "nginx:-bad", "nginx:tag:extra", `nginx:${"a".repeat(129)}`,
    "localhost:0/nginx", "localhost:65536/nginx", "localhost:abc/nginx", "-registry.example/nginx",
    "nginx@", "nginx@sha256:abc", `nginx@${digest}@${digest}`, `nginx@sha256:${"g".repeat(64)}`,
    "a".repeat(256),
  ])("rejects malformed or unsafe reference %j", (input) => {
    expect(parseImageRef(input)).toBeNull();
  });
});

describe("withImageTag", () => {
  it.each([
    ["nginx", "nginx:stable"],
    ["nginx:latest", "nginx:stable"],
    [`nginx@${digest}`, "nginx:stable"],
    [`docker.io/library/nginx:latest@${digest}`, "docker.io/library/nginx:stable"],
    ["localhost:5000/team/api:v1", "localhost:5000/team/api:stable"],
  ])("rebuilds %s while dropping any digest", (input, expected) => {
    expect(withImageTag(input, "stable")).toBe(expected);
  });

  it.each(["", "-tag", "has space", "tag\n", "other/tag", "tag@digest", "a".repeat(129)])("rejects invalid tag %j", (tag) => {
    expect(withImageTag("nginx", tag)).toBeNull();
  });

  it("does not rebuild invalid image references", () => {
    expect(withImageTag("https://example.com/nginx", "stable")).toBeNull();
  });
});

describe("image tag sorting and filtering", () => {
  const tags: ImageTag[] = [
    { name: "old-Alpine", lastPushed: "2024-01-01T00:00:00Z" },
    { name: "unknown", lastPushed: null },
    { name: "stable", lastPushed: "2026-01-01T00:00:00Z" },
    { name: "invalid", lastPushed: "not-a-date" },
    { name: "new-alpine", lastPushed: "2026-01-01T00:00:00Z" },
  ];

  it("sorts newest first, breaks date ties by name, and leaves unknown dates last", () => {
    expect(sortImageTags(tags).map((tag) => tag.name)).toEqual([
      "new-alpine", "stable", "old-Alpine", "invalid", "unknown",
    ]);
    expect(tags[0].name).toBe("old-Alpine");
  });

  it("handles dates before the epoch and equivalent timestamps", () => {
    expect(sortImageTags([
      { name: "unknown", lastPushed: null },
      { name: "b", lastPushed: "1960-01-01T00:00:00Z" },
      { name: "a", lastPushed: "1960-01-01T01:00:00+01:00" },
    ]).map((tag) => tag.name)).toEqual(["a", "b", "unknown"]);
  });

  it("filters case-insensitive substrings and returns them sorted", () => {
    expect(filterImageTags(tags, " ALPINE ").map((tag) => tag.name)).toEqual(["new-alpine", "old-Alpine"]);
    expect(filterImageTags(tags, "missing")).toEqual([]);
    expect(filterImageTags(tags, "")).toEqual(sortImageTags(tags));
  });

  it("accepts empty tag lists", () => {
    expect(sortImageTags([])).toEqual([]);
    expect(filterImageTags([], "latest")).toEqual([]);
  });
});

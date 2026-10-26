import { describe, expect, it } from "vitest";
import { parseImageReference } from "./image-ref";

const digest = `sha256:${"a".repeat(64)}`;

describe("parseImageReference", () => {
  it.each([
    ["nginx", "docker.io/library/nginx:latest"],
    ["nginx:1.25-alpine", "docker.io/library/nginx:1.25-alpine"],
    ["library/nginx", "docker.io/library/nginx:latest"],
    ["docker.io/nginx", "docker.io/library/nginx:latest"],
    ["index.docker.io/library/nginx:stable", "docker.io/library/nginx:stable"],
    ["registry-1.docker.io/library/nginx:stable", "docker.io/library/nginx:stable"],
    ["user/image", "docker.io/user/image:latest"],
    ["ghcr.io/owner/image:Main", "ghcr.io/owner/image:Main"],
    ["GHCR.IO/owner/image", "ghcr.io/owner/image:latest"],
    ["localhost:5000/team/image", "localhost:5000/team/image:latest"],
    ["registry.example:5443/team/image:v1", "registry.example:5443/team/image:v1"],
    ["[::1]:5000/team/image:dev", "[::1]:5000/team/image:dev"],
    ["localhost/image", "localhost/image:latest"],
    ["nginx:5000", "docker.io/library/nginx:5000"],
    ["  nginx  ", "docker.io/library/nginx:latest"],
  ])("normalizes %s", (input, normalized) => {
    expect(parseImageReference(input)?.normalized).toBe(normalized);
  });

  it("keeps a pinned digest separate from an optional tag", () => {
    expect(parseImageReference(`nginx@${digest}`)).toEqual({
      registry: "docker.io", repository: "library/nginx", tag: null,
      digest, normalized: `docker.io/library/nginx@${digest}`,
    });
    expect(parseImageReference(`nginx:stable@${digest}`)).toEqual({
      registry: "docker.io", repository: "library/nginx", tag: "stable",
      digest, normalized: `docker.io/library/nginx:stable@${digest}`,
    });
  });

  it.each([
    "", "https://ghcr.io/owner/image", "nginx:", "nginx@", "nginx@sha256:1234",
    `nginx@${digest}@${digest}`, "ghcr.io//image", "OWNER/image", "nginx:two tags",
    "ghcr.io/../image", "ghcr.io/owner/image?token=secret", "ghcr.io/owner/image#tag",
    "registry.example:65536/image", "registry.example:0/image", "nginx:one:two",
    "ghcr.io/owner/image/", "user:password@ghcr.io/owner/image", "nginx\\other",
  ])("rejects invalid reference %s", (input) => {
    expect(parseImageReference(input)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { summarizeCompose } from "./compose-summary";

describe("summarizeCompose", () => {
  it("extracts per-service images, build types and replicas without configuration values", () => {
    const result = summarizeCompose(`services:
  web:
    image: "nginx:alpine"
    environment:
      TOKEN: private-inline-value
    deploy:
      replicas: 2
  api:
    build:
      context: .
      args:
        PASSWORD: private-build-value
    scale: 3
`);
    expect(result.image).toBe("web: nginx:alpine");
    expect(result.buildType).toBe("api: build\nweb: image");
    expect(result.replicas).toBe("api: 3\nweb: 2");
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it("supports flow YAML and anchors and defaults each service to one replica", () => {
    const result = summarizeCompose('services: {a: &service {image: "redis:7"}, b: *service}');
    expect(result.image).toBe("a: redis:7\nb: redis:7");
    expect(result.replicas).toBe("a: 1\nb: 1");
  });

  it("does not confuse nested configuration with service image metadata", () => {
    const result = summarizeCompose('services:\n  api:\n    environment:\n      image: private-value\n      replicas: 99');
    expect(result.image).toBeNull();
    expect(result.replicas).toBe("api: 1");
    expect(JSON.stringify(result)).not.toContain("private-value");
  });

  it("resolves Compose YAML merge keys before extracting metadata", () => {
    const result = summarizeCompose(`x-defaults: &defaults
  image: postgres:17
  deploy: {replicas: 2}
  environment: {PASSWORD: private-merged-value}
services:
  db:
    <<: *defaults
`);
    expect(result.image).toBe("db: postgres:17");
    expect(result.replicas).toBe("db: 2");
    expect(JSON.stringify(result)).not.toContain("private-merged-value");
  });

  it("handles empty files and never exposes invalid YAML in errors", () => {
    expect(summarizeCompose(null).image).toBeNull();
    expect(() => summarizeCompose("services: [private-secret")).toThrow("Unable to read compose configuration.");
  });
});

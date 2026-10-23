import { describe, expect, it } from "vitest";
import { parseAppPort, resolveAppPort } from "./app-port";

describe("parseAppPort", () => {
  it("accepts whole ports and treats blank overrides as absent", () => {
    expect(parseAppPort(" 8080 ")).toBe(8080);
    expect(parseAppPort(65535)).toBe(65535);
    expect(parseAppPort(" ")).toBeUndefined();
    expect(parseAppPort(null)).toBeUndefined();
  });

  it.each([0, 65536, -1, 1.5, "80/tcp", "3000abc", "1e3"])("rejects invalid explicit port %s", (port) => {
    expect(() => parseAppPort(port)).toThrow("Port must be a whole number between 1 and 65535.");
  });
});

describe("resolveAppPort", () => {
  it("prefers an explicit port over app variables and image metadata", () => {
    expect(resolveAppPort({ port: 8080, env: "PORT=5000", exposedPorts: ["80/tcp"], image: "nginx" })).toBe(8080);
  });

  it.each(["PORT=5000", 'export PORT="5000" # app port', " PORT = '5000'\r\nOTHER=1"])(
    "prefers the app's configured PORT: %s",
    (env) => {
      expect(resolveAppPort({ env, exposedPorts: ["80/tcp"], image: "nginx" })).toBe(5000);
    }
  );

  it("uses the final PORT assignment and ignores commented variables", () => {
    expect(resolveAppPort({ env: "# PORT=80\nPORT=8080\nPORT=9090" })).toBe(9090);
    expect(resolveAppPort({ env: "# PORT=80\nOTHER_PORT=8080" })).toBe(3000);
  });

  it.each(["0", "65536", "-1", "3.5", "3000abc", "${{other.PORT}}", ""])(
    "falls back to image metadata for invalid env PORT=%s",
    (port) => {
      expect(resolveAppPort({ env: `PORT=${port}`, exposedPorts: ["8080/tcp"] })).toBe(8080);
    }
  );

  it("chooses the lowest valid exposed TCP port numerically", () => {
    expect(resolveAppPort({ exposedPorts: ["9000/tcp", "443/tcp", "80/udp", "0/tcp", "65536/tcp", "bad/tcp"] })).toBe(443);
  });

  it.each(["nginx", "nginx:alpine", "httpd:2", "library/httpd", "docker.io/library/nginx:alpine", "index.docker.io/nginx@sha256:abc"])(
    "uses port 80 for the official image %s",
    (image) => {
      expect(resolveAppPort({ image })).toBe(80);
    }
  );

  it("prefers exposed metadata over the known image default", () => {
    expect(resolveAppPort({ image: "nginx", exposedPorts: ["8080/tcp"] })).toBe(8080);
  });

  it.each([undefined, "node:22", "example/nginx", "registry.example:5000/httpd:latest", "nginx-custom"])(
    "falls back to port 3000 for image %s without metadata",
    (image) => {
      expect(resolveAppPort({ image, exposedPorts: ["53/udp"] })).toBe(3000);
    }
  );
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = "/workspace/wt-auto-domain-port";
const ts = require(path.join(root, "dashboard/node_modules/typescript"));
const filename = path.join(root, "dashboard/src/lib/app-port.ts");
const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
});
const sourceModule = { exports: {} };
vm.runInNewContext(outputText, {
  exports: sourceModule.exports,
  module: sourceModule,
  require,
}, { filename });
const { parseAppPort, resolveAppPort } = sourceModule.exports;

let assertions = 0;
function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions++;
}
function rejects(value) {
  assert.throws(() => parseAppPort(value), undefined, `Invalid explicit port: ${String(value)}`);
  assert.throws(() => resolveAppPort({ port: value, image: "nginx", env: "PORT=5000" }), undefined,
    `Invalid explicit port must not silently infer: ${String(value)}`);
  assertions += 2;
}

for (const value of [undefined, null, "", " \t "]) {
  equal(parseAppPort(value), undefined, `Blank port ${JSON.stringify(value)} means auto`);
}
for (const value of [1, 80, 8080, 65535, "5000", " 8080 "]) {
  equal(parseAppPort(value), Number(value), `Valid explicit port: ${String(value)}`);
}
for (const value of [0, -1, 65536, 80.5, NaN, Infinity, "0", "-1", "65536", "8080.5", "5000x"]) {
  rejects(value);
}

equal(resolveAppPort({}), 3000, "No metadata defaults to 3000");
equal(resolveAppPort({ port: "", image: "unknown/service:latest" }), 3000, "Empty explicit port enables inference");
equal(resolveAppPort({ port: "5000", image: "nginx", exposedPorts: ["80/tcp"], env: "PORT=8080" }), 5000,
  "Explicit port wins over EXPOSE, known image, and env");
equal(resolveAppPort({ image: "nginx", exposedPorts: ["8080/tcp"], env: "PORT=5000" }), 5000,
  "Valid env PORT wins over EXPOSE and known image defaults");
equal(resolveAppPort({ image: "nginx", exposedPorts: ["8080/tcp"] }), 8080,
  "Local EXPOSE wins over known image defaults when env PORT is absent");
equal(resolveAppPort({ image: "custom/app", exposedPorts: ["5000/tcp"] }), 5000, "A 5000/TCP image gets a working route");
equal(resolveAppPort({ exposedPorts: ["8080/tcp", "5000/tcp", "80/tcp"] }), 80, "Lowest exposed TCP port is deterministic");
equal(resolveAppPort({ exposedPorts: ["80/tcp", "8080/tcp", "5000/tcp"] }), 80, "EXPOSE insertion order does not affect result");
equal(resolveAppPort({ exposedPorts: ["53/udp", "0/tcp", "65536/tcp", "bad/tcp", "8080/tcp"] }), 8080,
  "UDP and invalid EXPOSE keys are ignored");
equal(resolveAppPort({ exposedPorts: ["53/udp", "0/tcp", "65536/tcp"], env: "PORT=5000" }), 5000,
  "Valid env PORT is unaffected by invalid EXPOSE keys");

for (const image of [
  "nginx", "nginx:alpine", "httpd:2.4", "library/nginx:alpine", "library/httpd",
  "docker.io/library/nginx:alpine", "docker.io/library/httpd:2.4",
  `nginx@sha256:${"a".repeat(64)}`,
]) {
  equal(resolveAppPort({ image }), 80, `Known official image without env PORT: ${image}`);
  equal(resolveAppPort({ image, env: "PORT=5000" }), 5000, `Env PORT overrides known official image: ${image}`);
}
for (const image of ["someone/nginx", "someone/httpd", "registry.example.com/library/nginx", "my-nginx"]) {
  equal(resolveAppPort({ image }), 3000, `Custom image does not inherit official port: ${image}`);
  equal(resolveAppPort({ image, env: "PORT=5000" }), 5000, `Custom image uses valid env PORT: ${image}`);
}

for (const env of [
  "PORT=5000",
  "  PORT = 5000  ",
  "export PORT=5000",
  'PORT="5000"',
  "PORT='5000'",
  "PORT=5000 # web listener",
  'export PORT = "5000" # web listener',
  "# PORT=8080\nPORT=5000\nOTHER_PORT=80",
  "PORT=8080\r\nPORT=5000\r\n",
]) {
  equal(resolveAppPort({ env }), 5000, `Env parser handles ${JSON.stringify(env)}`);
}
equal(resolveAppPort({ env: "PORT=8080\nPORT=5000" }), 5000, "Last PORT assignment wins");
equal(resolveAppPort({ env: "PORT=5000\nPORT=invalid" }), 3000, "Invalid final PORT assignment does not use a stale value");
equal(resolveAppPort({ env: "PORT=5000\nPORT=" }), 3000, "Empty final PORT assignment falls back");
for (const env of ["PORT=0", "PORT=65536", "PORT=3.5", "PORT=$OTHER_PORT", "OTHER_PORT=5000", null]) {
  equal(resolveAppPort({ env }), 3000, `Invalid or absent env PORT: ${JSON.stringify(env)}`);
  equal(resolveAppPort({ env, image: "nginx", exposedPorts: ["8080/tcp"] }), 8080,
    `Invalid or absent env PORT falls back to EXPOSE: ${JSON.stringify(env)}`);
  equal(resolveAppPort({ env, image: "nginx" }), 80,
    `Invalid or absent env PORT falls back to known image: ${JSON.stringify(env)}`);
}

console.log(`PASS: ${assertions} assertions against dashboard/src/lib/app-port.ts`);
console.log("Verified explicit validation; env PORT precedence over EXPOSE and known defaults; 80/8080/5000 routing; EXPOSE ordering and filtering; official-image matching; env syntax and last assignment; invalid-env fallback.");

const mode = process.argv[2];
const dash = "http://127.0.0.1:3001";
const status = "/opt/Switchyard/resources/app/dist/index.html";
const statusUrl = "file://" + status;
const cases = [
  ["dashboard page", dash + "/project/abc"],
  ["look-alike host 127.0.0.1:3001.evil.example", "http://127.0.0.1:3001.evil.example/steal"],
  ["wrong port 127.0.0.1:30011", "http://127.0.0.1:30011/"],
  ["arbitrary local file", "file:///etc/passwd"],
  ["status view + query", statusUrl + "?x=1"],
  ["bundled status view", statusUrl],
  ["javascript: URL", "javascript:alert(1)"],
];
let decide, perm, ipc;
if (mode === "before") {
  // main 1fc46d5 desktop/src/main/index.ts
  const isInternalUrl = (u) => u.startsWith("file:") || u.startsWith(dash);
  decide = (u) => isInternalUrl(u) ? "allow (renders in-app)" : (/^https?:/i.test(u) ? "external" : "deny");
  perm = () => "granted (Electron default: no permission handler)";
  ipc = (u) => u.startsWith("file:") ? "ACCEPTED" : "rejected";
} else {
  const p = require("./url-policy.js");
  decide = (u) => p.navigationDecision(u, status, dash);
  perm = (u, k) => p.permissionDecision(k, u, status, dash) ? "granted" : "denied";
  ipc = (u) => p.isTrustedIpcSender({ url: u, processId: 1, routingId: 1 }, { url: u, processId: 1, routingId: 1 }, status) ? "ACCEPTED" : "rejected";
}
console.log(`== ${mode}: navigation / will-navigate`);
for (const [n, u] of cases) console.log(`  ${n.padEnd(44)} -> ${decide(u)}`);
console.log(`== ${mode}: permission requests from the dashboard origin`);
for (const k of ["clipboard-sanitized-write", "media", "geolocation", "notifications"]) console.log(`  ${k.padEnd(44)} -> ${perm(dash + "/", k)}`);
console.log(`== ${mode}: privileged IPC (getState/action) from the main frame at`);
for (const [n, u] of cases.filter(c => c[1].startsWith("file:"))) console.log(`  ${n.padEnd(44)} -> ${ipc(u)}`);

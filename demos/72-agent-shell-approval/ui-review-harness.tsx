import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChangesBar } from "/workspace/wt-agent-shell-approval/dashboard/src/components/agent/ChangesBar";
const command = "  printf '%s\\n' reviewed >> /tmp/proof\n";
const first = { id: "first", kind: "exec_in_service", description: "Run shell command", createdAt: 1,
  shell: { serviceId: "service-first", serviceName: "Review fixture", appName: "review-fixture", containerId: "a".repeat(64), workingDir: "/tmp", command } };
const second = { ...first, id: "second", shell: { ...first.shell, command: "echo later" } };
const approved = [];
const rejected = [];
function App() {
  const [changes, setChanges] = useState([first]);
  const [results, setResults] = useState(null);
  useEffect(() => { window.addLater = () => setChanges((current) => [...current, second]); }, []);
  return <ChangesBar changes={changes} busy={false} results={results}
    onApply={(ids) => { approved.push(ids); setChanges((current) => current.filter((c) => !ids.includes(c.id))); setResults([{ id: "first", description: "Executed reviewed command", ok: true, output: "stdout:\nreviewed\n\nexit code: 0" }]); }}
    onDiscard={(ids) => { rejected.push(ids); setChanges((current) => current.filter((c) => !ids.includes(c.id))); }}
    onDismissResults={() => setResults(null)} />;
}
createRoot(document.getElementById("app")).render(<App />);
const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
const button = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitFor(test) { for (let i = 0; i < 40; i++) { if (test()) return; await pause(); } throw new Error("Timed out waiting for UI"); }
(async () => {
  await waitFor(() => button("Review 1 change"));
  button("Review 1 change").click();
  await waitFor(() => document.querySelector('[role="dialog"]'));
  let dialog = document.querySelector('[role="dialog"]');
  assert(approved.length === 0, "Review executed before approval");
  assert(dialog.querySelector("pre").textContent === command, "Command whitespace changed");
  for (const text of ["Review fixture", "service-first", "a".repeat(64), "/tmp"]) assert(dialog.textContent.includes(text), "Missing target detail: " + text);
  window.addLater();
  await waitFor(() => button("Review 2 changes"));
  assert(!dialog.textContent.includes("echo later"), "Review snapshot unexpectedly changed");
  button("Approve reviewed").click();
  await waitFor(() => approved.length === 1 && !document.querySelector('[role="dialog"]'));
  assert(JSON.stringify(approved) === '[["first"]]', "Unreviewed command included in approval");
  assert(document.querySelector('[role="status"]').textContent.includes("exit code: 0"), "Output hidden while another command is pending");
  button("Review 1 change").click();
  await waitFor(() => document.querySelector('[role="dialog"]'));
  dialog = document.querySelector('[role="dialog"]');
  assert(dialog.textContent.includes("echo later"), "Next review missing new command");
  dialog.querySelector('[aria-label="Reject this change"]').click();
  await waitFor(() => rejected.length === 1);
  assert(JSON.stringify(rejected) === '[["second"]]', "Wrong command rejected");
  assert(approved.length === 1, "Rejection executed a command");
  document.body.dataset.testResult = "PASS";
  document.getElementById("result").textContent = "PASS: exact review details, explicit approval, frozen selection, persistent output, rejection";
})().catch((error) => { document.body.dataset.testResult = "FAIL"; document.getElementById("result").textContent = error.stack; });

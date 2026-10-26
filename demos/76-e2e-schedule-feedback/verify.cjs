const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = "/workspace/wt-e2e-schedule-feedback/dashboard";
const ts = require(path.join(root, "node_modules/typescript"));

// Extract the actual functions without importing application modules or credentials.
// All external calls below are stubs; this verifier cannot contact the stack.
function compile(relativePath, names, bindings = {}) {
  const filename = path.join(root, relativePath);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = names.map((name) => {
    const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `Missing source function ${name}`);
    return declaration.getText(source).replace(/^export\s+/, "");
  });
  const compiled = ts.transpileModule(declarations.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  return new Function(...Object.keys(bindings), `${compiled.outputText}\nreturn { ${names.join(", ")} };`)(...Object.values(bindings));
}

let passed = 0;
async function check(name, verify) {
  await verify();
  passed += 1;
  console.log(`PASS ${name}`);
}

const requests = [];
const revalidations = [];
const redirect = new Error("synthetic redirect");
let requestHandler = () => { throw new Error("Unexpected mocked request"); };
const actions = compile("src/app/actions.ts", [
  "fail", "scheduleRunResult", "runScheduleAction", "listScheduleExecutionsAction",
], {
  request: async (endpoint, init) => {
    requests.push({ endpoint, init });
    return requestHandler(endpoint, init);
  },
  // Lead fixup: actions call dokploy.ts wrappers; mirror them over the request mock.
  runSchedule: async (scheduleId) => { requests.push({ endpoint: "schedule.runManually", init: { method: "POST", body: { scheduleId } } }); return requestHandler("schedule.runManually", { method: "POST", body: { scheduleId } }); },
  listScheduleExecutions: async (scheduleId) => { const endpoint = `deployment.allByType?id=${encodeURIComponent(scheduleId)}&type=schedule`; requests.push({ endpoint, init: undefined }); return (await requestHandler(endpoint, undefined)) ?? []; },
  revalidatePath: (route) => revalidations.push(route),
  unstable_rethrow: (error) => { if (error === redirect) throw error; },
});

// A tiny deterministic hook/JSX harness exercises handlers and render output.
// It is not a browser or a substitute for the lead's live React/Playwright check.
let activeHarness;
function harness(component, props) {
  const slots = [];
  const effects = [];
  const tasks = [];
  let cursor = 0;
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const instance = {
    props,
    hooks: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useTransition() {
        const [pending, setPending] = instance.hooks.useState(false);
        return [pending, (callback) => {
          setPending(true);
          tasks.push(Promise.resolve(callback()).finally(() => setPending(false)));
        }];
      },
      useCallback(callback, dependencies) {
        const index = cursor++;
        if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { callback, dependencies };
        return slots[index].callback;
      },
      useEffect(callback, dependencies) {
        const index = cursor++;
        if (!same(slots[index], dependencies)) {
          slots[index] = dependencies;
          effects.push(callback);
        }
      },
    },
    render() {
      cursor = 0;
      activeHarness = instance;
      return component(instance.props);
    },
    async settle() {
      while (effects.length || tasks.length) {
        while (effects.length) effects.shift()();
        if (tasks.length) await Promise.all(tasks.splice(0));
      }
    },
  };
  return instance;
}

let runAction = actions.runScheduleAction;
let historyAction = actions.listScheduleExecutionsAction;
const components = compile("src/components/service/AppTabs.tsx", [
  "scheduleRunDisabledReason", "ScheduleRow", "ScheduleExecutionHistory", "IconBtn",
], {
  ...Object.fromEntries(["useState", "useTransition", "useCallback", "useEffect"].map((name) => [
    name, (...args) => activeHarness.hooks[name](...args),
  ])),
  React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
  cn: (...classes) => classes.filter(Boolean).join(" "),
  ...Object.fromEntries(["Clock", "Loader2", "Play", "Power", "Pencil", "Trash2", "Field", "SaveRow"].map((name) => [name, name])),
  inputCls: "input",
  runScheduleAction: (...args) => runAction(...args),
  listScheduleExecutionsAction: (...args) => historyAction(...args),
  updateScheduleAction: async () => ({ ok: true }),
  deleteScheduleAction: async () => ({ ok: true }),
});

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function find(tree, predicate) {
  const match = nodes(tree).find(predicate);
  assert.ok(match, "Expected rendered element");
  return match;
}
function textOf(tree) {
  if (Array.isArray(tree)) return tree.map(textOf).join(" ");
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return textOf(tree.props.children);
}
const runButton = (tree) => find(tree, (node) => node.type === components.IconBtn && ["Run now", "Start the service first"].includes(node.props.title));
const historyPanel = (tree) => find(tree, (node) => node.type === components.ScheduleExecutionHistory);
const statusText = (tree) => textOf(find(tree, (node) => node.props.role === "status"));
const alertText = (tree) => textOf(find(tree, (node) => node.props.role === "alert"));
const schedule = { scheduleId: "schedule-test", name: "Verifier", cronExpression: "0 0 1 1 *", command: "printf schedule-proof", shellType: "sh", enabled: true };
const row = (reason = null) => harness(components.ScheduleRow, { schedule, runDisabledReason: reason, onChanged: () => {} });

async function main() {
  await check("idle and stopped runtimes require 'Start the service first'", () => {
    assert.equal(components.scheduleRunDisabledReason({ total: 0, running: 0, health: "not-running" }), "Start the service first");
    assert.equal(components.scheduleRunDisabledReason({ total: 3, running: 0, health: "not-running" }), "Start the service first");
  });
  await check("running/degraded services and unavailable runtime remain runnable", () => {
    for (const runtime of [undefined, { total: 1, running: 1, health: "running" }, { total: 3, running: 1, health: "degraded" }]) {
      assert.equal(components.scheduleRunDisabledReason(runtime), null);
    }
  });
  await check("done, running, and legacy empty replies have explicit success feedback", () => {
    assert.deepEqual(actions.scheduleRunResult("done"), { ok: true, message: "Completed — see history below." });
    for (const status of ["running", undefined]) {
      assert.deepEqual(actions.scheduleRunResult(status), { ok: true, message: "Started — see history below." });
    }
  });
  await check("HTTP-200 error status is a failure with service/command/shell guidance", () => {
    const result = actions.scheduleRunResult("error");
    assert.equal(result.ok, false);
    assert.match(result.error, /Schedule failed.*service is running.*command and shell/);
  });
  await check("Run now posts the schedule ID and revalidates after completion", async () => {
    requestHandler = () => ({ status: "done", deploymentId: "execution-test", logPath: "/synthetic/log" });
    requests.length = 0;
    revalidations.length = 0;
    assert.deepEqual(await actions.runScheduleAction(schedule.scheduleId), { ok: true, message: "Completed — see history below." });
    assert.deepEqual(requests, [{ endpoint: "schedule.runManually", init: { method: "POST", body: { scheduleId: schedule.scheduleId } } }]);
    assert.deepEqual(revalidations, ["/"]);
  });
  await check("Run now preserves error status instead of reporting HTTP success", async () => {
    requestHandler = () => ({ status: "error" });
    assert.equal((await actions.runScheduleAction(schedule.scheduleId)).ok, false);
  });
  await check("empty legacy response acknowledges a start without claiming completion", async () => {
    requestHandler = () => null;
    assert.deepEqual(await actions.runScheduleAction(schedule.scheduleId), { ok: true, message: "Started — see history below." });
  });
  await check("backend failure is returned as an inline error", async () => {
    requestHandler = () => { throw new Error("Synthetic backend unavailable"); };
    assert.deepEqual(await actions.runScheduleAction(schedule.scheduleId), { ok: false, error: "Synthetic backend unavailable" });
  });
  await check("history reads only the selected schedule and returns display fields", async () => {
    requestHandler = () => [{ deploymentId: "run-1", status: "error", createdAt: "2026-10-26T10:00:00Z", logPath: "/synthetic/log", description: "not returned" }];
    requests.length = 0;
    assert.deepEqual(await actions.listScheduleExecutionsAction("id with & query"), {
      ok: true, executions: [{ deploymentId: "run-1", status: "error", createdAt: "2026-10-26T10:00:00Z" }],
    });
    assert.equal(requests[0].endpoint, "deployment.allByType?id=id%20with%20%26%20query&type=schedule");
  });
  await check("empty history and read failures return explicit results", async () => {
    requestHandler = () => null;
    assert.deepEqual(await actions.listScheduleExecutionsAction(schedule.scheduleId), { ok: true, executions: [] });
    requestHandler = () => { throw new Error("Synthetic history unavailable"); };
    assert.deepEqual(await actions.listScheduleExecutionsAction(schedule.scheduleId), { ok: false, error: "Synthetic history unavailable" });
  });
  await check("both actions preserve framework redirects", async () => {
    requestHandler = () => { throw redirect; };
    for (const action of [actions.runScheduleAction, actions.listScheduleExecutionsAction]) {
      await assert.rejects(action(schedule.scheduleId), (error) => error === redirect);
    }
  });
  await check("disabled Run now renders a tooltip and prevents even a direct handler call", async () => {
    const instance = row("Start the service first");
    const tree = instance.render();
    const button = runButton(tree);
    assert.equal(button.props.disabled, true);
    assert.equal(components.IconBtn(button.props).props.disabled, true);
    assert.equal(components.IconBtn(button.props).props.title, "Start the service first");
    find(tree, (node) => node.type === "span" && node.props.title === "Start the service first");
    requests.length = 0;
    button.props.onClick();
    await instance.settle();
    assert.equal(requests.length, 0);
  });
  const instance = row();
  await check("pending Run now disables duplicate submissions and displays a spinner", async () => {
    let resolve;
    requestHandler = () => new Promise((done) => { resolve = done; });
    requests.length = 0;
    runButton(instance.render()).props.onClick();
    const pending = runButton(instance.render());
    assert.equal(pending.props.disabled, true);
    find(pending, (node) => node.type === "Loader2");
    pending.props.onClick();
    assert.equal(requests.length, 1);
    resolve({ status: "done" });
    await instance.settle();
  });
  await check("completion renders a status message and opens refreshed execution history", () => {
    const tree = instance.render();
    assert.equal(statusText(tree), "Completed — see history below.");
    assert.equal(historyPanel(tree).props.scheduleId, schedule.scheduleId);
    assert.equal(historyPanel(tree).props.refreshKey, 1);
    assert.equal(runButton(tree).props.disabled, false);
  });
  await check("a failed run clears success feedback and refreshes history again", async () => {
    requestHandler = () => ({ status: "error" });
    runButton(instance.render()).props.onClick();
    await instance.settle();
    const tree = instance.render();
    assert.match(alertText(tree), /Schedule failed/);
    assert.equal(nodes(tree).some((node) => node.props.role === "status"), false);
    assert.equal(historyPanel(tree).props.refreshKey, 2);
  });
  await check("client transport failure explains uncertainty and still refreshes history", async () => {
    runAction = async () => { throw new Error("Synthetic transport loss"); };
    runButton(instance.render()).props.onClick();
    await instance.settle();
    const tree = instance.render();
    assert.match(alertText(tree), /Could not confirm the run.*history before retrying/);
    assert.equal(historyPanel(tree).props.refreshKey, 3);
    runAction = actions.runScheduleAction;
  });
  await check("retry success clears the prior error and reports Started for an accepted run", async () => {
    requestHandler = () => ({ status: "running" });
    runButton(instance.render()).props.onClick();
    await instance.settle();
    const tree = instance.render();
    assert.equal(statusText(tree), "Started — see history below.");
    assert.equal(nodes(tree).some((node) => node.props.role === "alert"), false);
    assert.equal(historyPanel(tree).props.refreshKey, 4);
  });
  await check("existing execution history can be opened without running a command", () => {
    const historyOnly = row("Start the service first");
    requests.length = 0;
    find(historyOnly.render(), (node) => node.type === "button" && textOf(node) === "View execution history").props.onClick();
    assert.equal(historyPanel(historyOnly.render()).props.refreshKey, 0);
    assert.equal(requests.length, 0);
  });
  const history = harness(components.ScheduleExecutionHistory, { scheduleId: schedule.scheduleId, refreshKey: 1 });
  await check("history loads on open and renders newest execution first", async () => {
    requestHandler = () => [
      { deploymentId: "old", status: "done", createdAt: "2026-10-25T12:00:00Z" },
      { deploymentId: "new", status: "error", createdAt: "2026-10-26T12:00:00Z" },
    ];
    history.render();
    await history.settle();
    const tree = history.render();
    const rendered = nodes(tree).filter((node) => ["old", "new"].includes(node.props.key));
    assert.deepEqual(rendered.map((node) => node.props.key), ["new", "old"]);
    assert.match(textOf(rendered[0]), /error/);
    assert.match(textOf(rendered[1]), /done/);
  });
  await check("a new run refreshes already-open history", async () => {
    requests.length = 0;
    requestHandler = () => [{ deploymentId: "latest", status: "done", createdAt: "2026-10-26T13:00:00Z" }];
    history.props.refreshKey += 1;
    history.render();
    await history.settle();
    assert.equal(requests.length, 1);
    const tree = history.render();
    find(tree, (node) => node.props.key === "latest");
    assert.equal(nodes(tree).some((node) => node.props.key === "old"), false);
  });
  await check("history failure is visible and preserves the last loaded executions", async () => {
    requestHandler = () => { throw new Error("Synthetic history refresh failure"); };
    find(history.render(), (node) => node.type === "button").props.onClick();
    await history.settle();
    const tree = history.render();
    assert.match(alertText(tree), /Synthetic history refresh failure/);
    find(tree, (node) => node.props.key === "latest");
    assert.doesNotMatch(textOf(tree), /No executions yet/);
  });
  await check("manual history refresh recovers from failure and shows an empty state", async () => {
    requestHandler = () => [];
    find(history.render(), (node) => node.type === "button").props.onClick();
    await history.settle();
    const tree = history.render();
    assert.match(textOf(tree), /No executions yet/);
    assert.equal(nodes(tree).some((node) => node.props.role === "alert"), false);
  });
  await check("history transport failure has retry guidance and does not claim an empty history", async () => {
    historyAction = async () => { throw new Error("Synthetic history transport loss"); };
    find(history.render(), (node) => node.type === "button").props.onClick();
    await history.settle();
    const tree = history.render();
    assert.match(alertText(tree), /Could not load execution history. Refresh to try again/);
    assert.doesNotMatch(textOf(tree), /No executions yet/);
  });
  console.log(`RESULT: ${passed} checks passed; no network, services, containers, or credentials accessed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

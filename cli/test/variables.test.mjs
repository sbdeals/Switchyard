import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createVariablesCommand, variables } from "../dist/lib.js";

const app = { applicationId: "app/1", name: "web" };
const project = {
  projectId: "p1", name: "demo",
  environments: [{ environmentId: "env1", name: "production", applications: [app] }],
};
const detail = "application.one?applicationId=app%2F1";

function clientFor(env, steps = []) {
  const remaining = [
    { path: "project.all", value: [project] },
    { path: detail, value: { ...app, env } },
    ...steps,
  ];
  return {
    async request(path, init = {}) {
      const next = remaining.shift();
      assert.ok(next, `Unexpected request: ${path}`);
      assert.equal(path, next.path);
      assert.equal(init.method ?? "GET", next.method ?? "GET");
      if (next.body) assert.deepEqual(init.body, next.body);
      if (next.error) throw next.error;
      return next.value;
    },
    done() { assert.deepEqual(remaining, []); },
  };
}

function save(env) {
  return { path: "application.update", method: "POST", body: { applicationId: app.applicationId, env } };
}

const quiet = { log: () => {} };
const selected = { service: "web" };

test("variables defaults to list and parses set/unset flags and values", async () => {
  let parsed;
  const command = () => createVariablesCommand(async (action, values, flags) => { parsed = { action, values, flags }; });
  await command().parseAsync([], { from: "user" });
  assert.deepEqual(parsed, { action: "list", values: [], flags: {} });
  await command().parseAsync(["set", "A=one=two", "EMPTY=", "--service", "web", "--deploy"], { from: "user" });
  assert.deepEqual(parsed, { action: "set", values: ["A=one=two", "EMPTY="], flags: { service: "web", deploy: true } });
  await command().parseAsync(["--reveal"], { from: "user" });
  assert.deepEqual(parsed, { action: "list", values: [], flags: { reveal: true } });
  await command().parseAsync(["unset", "A", "B"], { from: "user" });
  assert.deepEqual(parsed, { action: "unset", values: ["A", "B"], flags: {} });
});

for (const args of [["--service"], ["--unknown"]]) {
  test(`variables rejects invalid flags: ${args.join(" ")}`, async () => {
    const command = createVariablesCommand(async () => assert.fail("Must not run"))
      .exitOverride().configureOutput({ writeErr: () => {} });
    await assert.rejects(command.parseAsync(args, { from: "user" }));
  });
}

const initial = "# keep comment\nTOKEN=secret=value # private note\nEMPTY=\nexport MULTI=\"line one\nFAKE=still secret\nline three\" # multiline note\nTOKEN=latest\n";

test("list masks every value, skips comments and multiline contents, and uses final duplicate", async () => {
  const client = clientFor(initial);
  const output = [];
  await variables("list", [], selected, client, { log: (line) => output.push(line) });
  assert.deepEqual(output, ["TOKEN=********", "EMPTY=********", "MULTI=********"]);
  client.done();
});

test("list reveals dotenv values only when explicitly requested", async () => {
  const client = clientFor(initial);
  const output = [];
  await variables("list", [], { ...selected, reveal: true }, client, { log: (line) => output.push(line) });
  assert.deepEqual(output, ["TOKEN=latest", "EMPTY=", "MULTI=\"line one\nFAKE=still secret\nline three\""]);
  client.done();
});

test("list reports an empty/null environment", async () => {
  const client = clientFor(null);
  const output = [];
  await variables("list", [], selected, client, { log: (line) => output.push(line) });
  assert.deepEqual(output, ["No variables configured."]);
  client.done();
});

test("set replaces duplicates while retaining comments, multiline values, and other lines", async () => {
  const expected = initial.replace("TOKEN=secret=value", "TOKEN=new=token").replace("TOKEN=latest", "TOKEN=new=token") + "NEW='hello # world'\n";
  const client = clientFor(initial, [save(expected)]);
  const output = [];
  await variables("set", ["TOKEN=new=token", "NEW=hello # world"], selected, client, { log: (line) => output.push(line) });
  assert.deepEqual(output, ["Variables saved; redeploy to apply."]);
  client.done();
});

test("set replaces a complete multiline value while retaining its inline comment", async () => {
  const env = "  export MULTI = 'one\ntwo' # keep\nUNCHANGED=value\n";
  const client = clientFor(env, [save("  export MULTI = replacement # keep\nUNCHANGED=value\n")]);
  await variables("set", ["MULTI=replacement"], selected, client, quiet);
  client.done();
});

test("set preserves CRLF, adds missing final newline, handles empty values and quotes", async () => {
  const env = "# keep\r\nKEEP=old";
  const expected = "# keep\r\nKEEP=old\r\nEMPTY=\r\nQUOTE=`it's # a value`\r\nMULTI='first\nsecond'\r\n";
  const client = clientFor(env, [save(expected)]);
  await variables("set", ["EMPTY=", "QUOTE=it's # a value", "MULTI=first\nsecond"], selected, client, quiet);
  client.done();
});

test("set on empty environment uses the last value supplied for a duplicate key", async () => {
  const client = clientFor(null, [save("A=last\n")]);
  await variables("set", ["A=first", "A=last"], selected, client, quiet);
  client.done();
});

test("unquoted values ending in a backslash round-trip through set, list, and unset", async () => {
  const expected = "A=space\\\nB=ends'\n";
  const setter = clientFor(null, [save(expected)]);
  await variables("set", ["A=space\\", "B=ends'"], selected, setter, quiet);
  setter.done();
  const lister = clientFor(expected);
  const output = [];
  await variables("list", [], { ...selected, reveal: true }, lister, { log: (line) => output.push(line) });
  assert.deepEqual(output, ["A=space\\", "B=ends'"]);
  lister.done();
  const unsetter = clientFor(expected, [save("B=ends'\n")]);
  await variables("unset", ["A"], selected, unsetter, quiet);
  unsetter.done();
});

for (const values of [["A= space\\", "B=ends'"], ["A= # \\"], ["A=#'`\"\\n"]]) {
  test("unrepresentable quoted values are rejected before requests without leaking values", async () => {
    await assert.rejects(variables("set", values, selected, {
      request: async () => assert.fail("No request expected"),
    }, quiet), (error) => /quot/.test(error.message) && !error.message.includes(values[0]));
  });
}

for (const assignment of ["SERVICE.CONFIG=", "SERVICE-CONFIG=", "123=", "MULTI: "]) {
  test(`existing dotenv ${assignment} multiline assignment is preserved during set and unset`, async () => {
    const preserved = `${assignment}"first\nKEEP=inside value\nlast" # keep\n`;
    const original = preserved + "KEEP=outside\n";
    const client = clientFor(original, [save(preserved)]);
    await variables("unset", ["KEEP"], selected, client, quiet);
    client.done();
    const setter = clientFor(original, [save(preserved + "KEEP=new\n")]);
    await variables("set", ["KEEP=new"], selected, setter, quiet);
    setter.done();
    const lister = clientFor(original);
    const output = [];
    await variables("list", [], selected, lister, { log: (line) => output.push(line) });
    assert.deepEqual(output, [`${assignment.replace(/=|: /, "")}=********`, "KEEP=********"]);
    lister.done();
  });
}

test("unset matches a BOM-prefixed assignment while preserving the BOM and comments", async () => {
  const client = clientFor("\uFEFFTOKEN=secret # keep\nOTHER=value\n", [save("\uFEFF# keep\nOTHER=value\n")]);
  await variables("unset", ["TOKEN"], selected, client, quiet);
  client.done();
});

test("set and unset preserve CR-only line endings and quoted multiline contents", async () => {
  const env = "MULTI='first\rB=inside\rlast' # keep\rB=second\r";
  const client = clientFor(env, [save("MULTI='first\rB=inside\rlast' # keep\r")]);
  await variables("unset", ["B"], selected, client, quiet);
  client.done();
  const setter = clientFor("A=first\rB=second\r", [save("A=first\rB=new\rC=third\r")]);
  await variables("set", ["B=new", "C=third"], selected, setter, quiet);
  setter.done();
});

test("unset removes complete multiline values and duplicate keys while preserving comments", async () => {
  const expected = "# keep comment\n# private note\nEMPTY=\n# multiline note\n";
  const client = clientFor(initial, [save(expected)]);
  await variables("unset", ["TOKEN", "MULTI", "MISSING"], selected, client, quiet);
  client.done();
});

test("--deploy saves only env then queues one deployment", async () => {
  const client = clientFor("A=old\n", [save("A=new\n"), {
    path: "application.deploy", method: "POST", body: { applicationId: app.applicationId },
  }]);
  const output = [];
  await variables("set", ["A=new"], { ...selected, deploy: true }, client, { log: (line) => output.push(line) });
  assert.deepEqual(output, ["Variables saved; deployment queued."]);
  client.done();
});

test("variables resolves the current directory's linked service", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cli-vars-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, ".switchyard"));
  await writeFile(join(directory, ".switchyard", "link.json"), JSON.stringify({
    projectId: "p1", environmentId: "env1", applicationId: app.applicationId,
  }));
  const client = clientFor("A=secret\n");
  const output = [];
  await variables("list", [], {}, client, { directory, log: (line) => output.push(line) });
  assert.deepEqual(output, ["A=********"]);
  client.done();
});

for (const [action, values, flags] of [
  ["unknown", [], {}], ["list", ["secret"], {}], ["list", [], { deploy: true }],
  ["set", [], {}], ["unset", [], {}], ["set", ["A=secret"], { reveal: true }],
  ["set", ["MISSING_EQUALS"], {}], ["set", ["1A=secret"], {}],
  ["set", ["A-B=secret"], {}], ["set", ["=secret"], {}],
  ["unset", ["A=secret"], {}], ["set", ["VALID=secret", "BAD KEY=secret"], {}],
  ["set", ["A=secret\0"], {}],
]) {
  test(`invalid ${action} input fails before any requests without echoing values: ${JSON.stringify(values.map((v) => v.split("=")[0]))}`, async () => {
    await assert.rejects(variables(action, values, flags, {
      request: async () => assert.fail("No request expected"),
    }, quiet), (error) => !error.message.includes("secret"));
  });
}

for (const env of ["A='unterminated\nB=secret\n", 'A="quoted" trailing-secret\n']) {
  test("invalid existing quoted values fail without mutations or exposing contents", async () => {
    const client = clientFor(env);
    await assert.rejects(variables("set", ["B=value"], selected, client, quiet), (error) =>
      /quoted value/.test(error.message) && !error.message.includes("secret"));
    client.done();
  });
}

test("save failure never queues a deployment or exposes API response values", async () => {
  const client = clientFor("A=old\n", [{ ...save("A=new\n"), error: new Error("echoed-secret") }]);
  await assert.rejects(variables("set", ["A=new"], { ...selected, deploy: true }, client, quiet), (error) =>
    /Could not save/.test(error.message) && !error.message.includes("echoed-secret"));
  client.done();
});

test("service resolution and detail failures never expose API response values", async () => {
  for (const failAt of ["project.all", detail]) {
    await assert.rejects(variables("list", [], selected, {
      async request(path) {
        if (path === failAt) throw new Error("echoed-secret");
        assert.equal(path, "project.all");
        return [project];
      },
    }, quiet), (error) => /Could not/.test(error.message) && !error.message.includes("echoed-secret"));
  }
});

test("deploy failure distinguishes saved variables without exposing API response values", async () => {
  const client = clientFor("A=old\n", [save(""), {
    path: "application.deploy", method: "POST", body: { applicationId: app.applicationId }, error: new Error("echoed-secret"),
  }]);
  await assert.rejects(variables("unset", ["A"], { ...selected, deploy: true }, client, quiet), (error) =>
    /Variables saved.*redeploy to apply/.test(error.message) && !error.message.includes("echoed-secret"));
  client.done();
});

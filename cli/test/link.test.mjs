import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { createLinkCommand, linkDirectory, readLink, resolveApplication } from "../dist/lib.js";

const app = { applicationId: "a1", name: "web" };
const environment = { environmentId: "e1", name: "production", applications: [app] };
const project = { projectId: "p1", name: "demo", environments: [environment] };
const link = { projectId: "p1", environmentId: "e1", applicationId: "a1" };
const quiet = { log: () => {} };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "cli-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function clientFor(projects = [project]) {
  return { async request(path, init) {
    assert.equal(path, "project.all");
    assert.equal(init, undefined, "link and target selection must be read-only");
    return projects;
  } };
}

test("link parses defaults and explicit target flags", async () => {
  let flags;
  await createLinkCommand(async (value) => { flags = value; }).parseAsync([], { from: "user" });
  assert.deepEqual(flags, {});
  await createLinkCommand(async (value) => { flags = value; })
    .parseAsync(["--project", "demo", "--service", "web"], { from: "user" });
  assert.deepEqual(flags, { project: "demo", service: "web" });
});

for (const args of [["--service"], ["--project"], ["--unknown"], ["extra"]]) {
  test(`link rejects invalid arguments: ${args.join(" ")}`, async () => {
    const command = createLinkCommand(async () => assert.fail("Must not link"))
      .exitOverride().configureOutput({ writeErr: () => {} });
    await assert.rejects(command.parseAsync(args, { from: "user" }));
  });
}

test("link writes only IDs and prints gitignore guidance without editing ignore rules", async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, ".gitignore"), "node_modules\n");
  const output = [];
  await linkDirectory(directory, {}, clientFor(), { log: (s) => output.push(s) });
  assert.deepEqual(JSON.parse(await readFile(join(directory, ".switchyard/link.json"), "utf8")), link);
  assert.deepEqual(await readLink(directory), link);
  assert.equal(await readFile(join(directory, ".gitignore"), "utf8"), "node_modules\n");
  assert.ok(output.some((s) => s.includes("Add .switchyard/ to your .gitignore")));
});

test("link selects explicit names and IDs, production over other environments, and replaces a link", async (t) => {
  const directory = await fixture(t);
  const projects = [
    { ...project, projectId: "other", name: "other" },
    { ...project, environments: [{ ...environment, environmentId: "dev", name: "dev" }, environment] },
  ];
  await linkDirectory(directory, { project: "demo", service: "web" }, clientFor(projects), quiet);
  assert.deepEqual(await readLink(directory), link);
  const replacement = { ...app, applicationId: "a2", name: "worker" };
  const client = clientFor([{ ...project, environments: [{ ...environment, applications: [app, replacement] }] }]);
  await linkDirectory(directory, { project: "p1", service: "a2" }, client, quiet);
  assert.deepEqual(await readLink(directory), { ...link, applicationId: "a2" });
});

test("link prefers the directory name among several apps", async (t) => {
  const directory = await fixture(t);
  const named = { ...app, applicationId: "named", name: basename(directory) };
  await linkDirectory(directory, {}, clientFor([{ ...project, environments: [{ ...environment, applications: [app, named] }] }]), quiet);
  assert.equal((await readLink(directory)).applicationId, "named");
});

for (const [label, projects, flags, error] of [
  ["no projects", [], {}, /Project not found/],
  ["unknown project", [project], { project: "missing" }, /Project not found/],
  ["ambiguous projects", [project, project], {}, /More than one project/],
  ["unknown service", [project], { service: "missing" }, /Service not found/],
  ["ambiguous services", [{ ...project, environments: [{ ...environment, applications: [app, app] }] }], {}, /More than one service/],
  ["ambiguous environments", [{ ...project, environments: [{ ...environment, name: "dev" }, { ...environment, name: "staging" }] }], {}, /single production/],
  ["empty project", [project], { project: " " }, /must not be empty/],
  ["empty service", [project], { service: " " }, /must not be empty/],
]) {
  test(`link rejects ${label} without writing a link`, async (t) => {
    const directory = await fixture(t);
    await assert.rejects(linkDirectory(directory, flags, clientFor(projects), quiet), error);
    await assert.rejects(access(join(directory, ".switchyard/link.json")));
  });
}

test("readLink distinguishes absent links from invalid JSON or missing IDs", async (t) => {
  const directory = await fixture(t);
  assert.equal(await readLink(directory), undefined);
  await mkdir(join(directory, ".switchyard"));
  for (const text of ["not-json", "null", "[]", "{}", JSON.stringify({ ...link, applicationId: " " })]) {
    await writeFile(join(directory, ".switchyard/link.json"), text);
    await assert.rejects(readLink(directory), /Invalid .switchyard\/link.json/);
  }
});

test("variables target uses linked IDs after renames and scopes service overrides", async (t) => {
  const directory = await fixture(t);
  await linkDirectory(directory, {}, clientFor(), quiet);
  const renamed = { ...app, name: "renamed" };
  const other = { applicationId: "a2", name: "worker" };
  const client = clientFor([{ ...project, name: "renamed-project", environments: [{ ...environment, name: "staging", applications: [renamed, other] }] }]);
  assert.deepEqual(await resolveApplication(client, undefined, directory), renamed);
  assert.deepEqual(await resolveApplication(client, "worker", directory), other);
  assert.deepEqual(await resolveApplication(client, "a2", directory), other);
  await assert.rejects(resolveApplication(client, "missing", directory), /Service not found/);
});

test("unlinked variables requires a unique explicit service and never guesses", async (t) => {
  const directory = await fixture(t);
  await assert.rejects(resolveApplication(clientFor(), undefined, directory), /No linked service/);
  assert.deepEqual(await resolveApplication(clientFor(), "web", directory), app);
  assert.deepEqual(await resolveApplication(clientFor(), "a1", directory), app);
  await assert.rejects(resolveApplication(clientFor([project, project]), "web", directory), /More than one service/);
});

test("stale links reject missing project, environment, or app instead of choosing another target", async (t) => {
  const directory = await fixture(t);
  await linkDirectory(directory, {}, clientFor(), quiet);
  for (const projects of [[], [{ ...project, environments: [] }], [{ ...project, environments: [{ ...environment, applications: [] }] }]]) {
    await assert.rejects(resolveApplication(clientFor(projects), undefined, directory), /Run `switchyard link` again/);
  }
});

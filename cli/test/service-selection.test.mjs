import assert from "node:assert/strict";
import test from "node:test";

import { findService, resolveService, selectEnvironment, selectProject } from "../dist/lib.js";

const application = { applicationId: "app1", name: "web" };
const compose = { composeId: "compose1", name: "worker" };
const environment = { environmentId: "env1", name: "production", applications: [application], compose: [compose] };
const project = { projectId: "p1", name: "demo", environments: [environment] };

function clientFor(projects) {
  return {
    async request(path) {
      assert.equal(path, "project.all", "Service lookup must only read the project tree");
      return projects;
    },
  };
}

test("service lookup shares deploy's directory basename and production defaults", async () => {
  const selected = { ...project, environments: [{ ...environment, environmentId: "dev", name: "dev", applications: [] }, environment] };
  assert.deepEqual(await resolveService(clientFor([selected]), {}, "/tmp/web"), {
    serviceId: "app1", name: "web", type: "application",
  });
  assert.equal(selectEnvironment(selected), environment);
});

test("service lookup supports project and service names or IDs", async () => {
  for (const projectSelector of ["demo", "p1"]) {
    for (const service of ["worker", "compose1"]) {
      assert.deepEqual(await resolveService(clientFor([project]), { project: projectSelector, service }), {
        serviceId: "compose1", name: "worker", type: "compose",
      });
    }
  }
});

test("explicit IDs take precedence over colliding names", async () => {
  const selected = { ...project, environments: [{ ...environment, compose: [compose, { composeId: "compose2", name: "app1" }] }] };
  assert.equal(selectProject([{ ...project, projectId: "p2", name: "p1" }, selected], "p1"), selected);
  assert.deepEqual(await resolveService(clientFor([selected]), { service: "app1" }), {
    serviceId: "app1", name: "web", type: "application",
  });
});

for (const type of ["postgres", "mysql", "mariadb", "mongo", "redis"]) {
  test(`service lookup supports ${type}`, async () => {
    const selected = { ...project, environments: [{ ...environment, [type]: [{ [`${type}Id`]: "db1", name: "db" }] }] };
    assert.deepEqual(await resolveService(clientFor([selected]), { service: "db" }), { serviceId: "db1", name: "db", type });
  });
}

for (const [label, projects, flags, message] of [
  ["unknown service", [project], { service: "missing" }, /Unknown service: missing/],
  ["unknown project", [project], { project: "missing", service: "web" }, /Unknown project: missing/],
  ["no projects", [], { service: "web" }, /No projects found/],
  ["multiple projects", [project, { ...project, projectId: "p2", name: "other" }], { service: "web" }, /More than one project exists/],
  ["duplicate project names", [project, { ...project, projectId: "p2" }], { project: "demo", service: "web" }, /More than one project is named demo/],
  ["duplicate service names across kinds", [{ ...project, environments: [{ ...environment, compose: [{ ...compose, name: "web" }] }] }], { service: "web" }, /More than one service is named web/],
  ["multiple environments", [{ ...project, environments: [{ ...environment, name: "dev" }, { ...environment, name: "staging" }] }], { service: "web" }, /single production environment/],
  ["no environments", [{ ...project, environments: [] }], { service: "web" }, /single production environment/],
  ["blank service", [project], { service: " " }, /must not be empty/],
  ["blank project", [project], { project: " ", service: "web" }, /must not be empty/],
]) {
  test(`service lookup rejects ${label} without creating anything`, async () => {
    await assert.rejects(resolveService(clientFor(projects), flags), message);
  });
}

test("deploy can restrict selection to applications even when compose has the same name", () => {
  const selected = { ...environment, compose: [{ ...compose, name: "web" }] };
  assert.deepEqual(findService(project, selected, "web", ["application"]), { serviceId: "app1", name: "web", type: "application" });
  assert.equal(findService(project, environment, "worker", ["application"]), undefined);
});

test("the only environment is selected when none is named production", () => {
  const selected = { ...environment, name: "staging" };
  assert.equal(selectEnvironment({ ...project, environments: [selected] }), selected);
});

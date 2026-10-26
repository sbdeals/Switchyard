import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedVariableEditor, SharedVariablesPanel } from "../components/SharedVariablesPanel";
import { VariablesTab } from "../components/service/VariablesTab";
import type { ComposeService, ProjectNode } from "./dokploy";

const mocks = vi.hoisted(() => ({
  useSharedVariables: vi.fn(),
  saveSharedVariables: vi.fn(),
  saveServiceVariables: vi.fn(),
}));

vi.mock("@/components/use-shared-variables", () => ({ useSharedVariables: mocks.useSharedVariables }));
vi.mock("@/app/shared-variable-actions", () => ({ saveSharedVariablesAction: mocks.saveSharedVariables }));
vi.mock("@/app/actions", () => ({
  saveEnvironmentAction: mocks.saveServiceVariables,
  saveApplicationEnvAction: mocks.saveServiceVariables,
  saveComposeEnvAction: mocks.saveServiceVariables,
}));

const project: ProjectNode = {
  projectId: "shared-project",
  name: "Shared project",
  environments: [
    { environmentId: "development", name: "Development" },
    { environmentId: "preview", name: "Preview" },
  ],
};

function renderEditor(initialValue: string, scope: "project" | "environment" = "project") {
  return renderToStaticMarkup(createElement(SharedVariableEditor, {
    projectId: project.projectId,
    environmentId: "development",
    scope,
    initialValue,
  }));
}

describe("shared variable editor rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("masks every existing and new value and labels reveal, copy, delete and save controls", () => {
    const html = renderEditor("TOKEN=fixture-token\nEMPTY=\n");
    for (const key of ["TOKEN", "EMPTY", "New project variable"]) {
      const input = html.match(new RegExp(`<input[^>]*aria-label="${key} value"[^>]*>`))?.[0];
      expect(input).toContain('type="password"');
      expect(input).toContain('autoComplete="off"');
      expect(html).toContain(`aria-label="Reveal ${key}"`);
      expect(html).toContain(`aria-label="Copy ${key}"`);
    }
    expect(html).toContain('aria-label="Delete TOKEN"');
    expect(html).toContain('aria-label="Delete EMPTY"');
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('aria-label="Hide TOKEN"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save project variables<\/button>/);
    expect(mocks.saveSharedVariables).not.toHaveBeenCalled();
  });

  it("shows one editable row for the effective duplicate value and preserves multiline values", () => {
    const html = renderEditor('# retained comment\nTOKEN=old\nTOKEN="first\nsecond"\n');
    expect(html.match(/aria-label="TOKEN value"/g)).toHaveLength(1);
    expect(html).toContain('value="first\nsecond"');
    expect(html).not.toContain('value="old"');
    expect(html).toContain("Duplicate keys use the last value; deleting removes every occurrence.");
  });

  it("requires reveal before editing a multiline value through a masked single-line input", () => {
    const html = renderEditor('MULTI="first\nsecond"\nSINGLE=editable\n');
    const multiline = html.match(/<input[^>]*aria-label="MULTI value"[^>]*>/)?.[0];
    const single = html.match(/<input[^>]*aria-label="SINGLE value"[^>]*>/)?.[0];
    expect(multiline).toContain('type="password"');
    expect(multiline).toContain('readOnly=""');
    expect(single).not.toContain('readOnly=""');
    expect(html).toContain("Reveal to edit this multiline value.");
    expect(html).toContain('aria-label="Reveal MULTI"');
  });

  it("restores an unsaved draft with saving enabled against the persisted baseline", () => {
    const html = renderToStaticMarkup(createElement(SharedVariableEditor, {
      projectId: project.projectId,
      scope: "project",
      initialValue: "TOKEN=saved-value\n",
      initialDraft: "TOKEN=draft-value\n",
    }));
    expect(html).toContain('value="draft-value"');
    expect(html).not.toContain('value="saved-value"');
    const save = html.match(/<button[^>]*>Save project variables<\/button>/)?.[0];
    expect(save).toBeDefined();
    expect(save).not.toContain('disabled=""');
    expect(mocks.saveSharedVariables).not.toHaveBeenCalled();
  });

  it.each(["project", "environment"] as const)("shows the correct %s reference syntax and empty state", (scope) => {
    const html = renderEditor("# no variables yet\n", scope);
    expect(html).toContain(`\${{${scope}.KEY}}`);
    expect(html).toContain("No shared variables yet.");
    expect(html).toContain(`aria-label="New ${scope} variable name"`);
    expect(html).toContain(`Save ${scope} variables`);
    expect(html).not.toContain('role="row"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Add variable<\/button>/);
  });
});

describe("service shared reference rendering", () => {
  const service: ComposeService = {
    kind: "compose",
    id: "shared-service",
    name: "Shared service",
    appName: "shared-service",
    status: "idle",
    projectId: project.projectId,
    projectName: project.name,
    environmentId: "development",
    environmentName: "Development",
    dockerImage: null,
    env: 'TOKEN=${{project.TOKEN}}\nEMPTY=${{environment.EMPTY}}\nMISSING=${{environment.UNKNOWN}}\n',
    createdAt: null,
    cpuLimit: null,
    memoryLimit: null,
    replicas: null,
    composeFile: null,
    composeType: "docker-compose",
    domains: [],
    deployments: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSharedVariables.mockReturnValue({
      variables: { project: "TOKEN=fixture-project-secret", environment: "EMPTY=\n" },
    });
  });

  it("offers a collapsed reference picker and labels defined and missing references without revealing shared values", () => {
    const html = renderToStaticMarkup(createElement(VariablesTab, { service }));
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Add shared reference<\/button>/);
    expect(html).not.toContain('aria-label="Shared reference scope"');
    expect(html).toContain('aria-label="Shared reference status"');
    expect(html).toContain('<code>TOKEN: ${{project.TOKEN}}</code> — Defined');
    expect(html).toContain('<code>EMPTY: ${{environment.EMPTY}}</code> — Defined');
    expect(html).toContain('<code>MISSING: ${{environment.UNKNOWN}}</code> — Missing — deployment will fail');
    expect(html).not.toContain("fixture-project-secret");
    expect(html).toContain(">3 variables</span>");
    expect(mocks.useSharedVariables).toHaveBeenCalledWith("shared-project", "development", service);
    expect(mocks.saveServiceVariables).not.toHaveBeenCalled();
  });

  it("counts parsed keys rather than multiline values, duplicate lines or comments", () => {
    const html = renderToStaticMarkup(createElement(VariablesTab, {
      service: { ...service, env: '# comment\nMULTI="first\nsecond"\nDUP=old\nDUP=new\n' },
    }));
    expect(html).toContain(">2 variables</span>");
    expect(html).not.toContain('aria-label="Shared reference status"');
  });

  it("does not mark references missing while shared variables are still loading", () => {
    mocks.useSharedVariables.mockReturnValue(null);
    const html = renderToStaticMarkup(createElement(VariablesTab, { service }));
    expect(html).toMatch(/role="status"[^>]*>Checking shared variables…/);
    expect(html).not.toContain("Missing — deployment will fail");
    expect(html).not.toContain('aria-label="Shared reference status"');
  });

  it("reports read failures without claiming a reference is missing", () => {
    mocks.useSharedVariables.mockReturnValue({ error: "Could not load shared variables" });
    const html = renderToStaticMarkup(createElement(VariablesTab, { service }));
    expect(html).toMatch(/role="alert"[^>]*>Could not load shared variables/);
    expect(html).not.toContain("Missing — deployment will fail");
  });
});

describe("shared variables panel rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSharedVariables.mockReturnValue(null);
  });

  it("shows a loading status before shared values are available", () => {
    const html = renderToStaticMarkup(createElement(SharedVariablesPanel, { project }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading shared variables…");
    expect(html).not.toContain('role="table"');
    expect(mocks.useSharedVariables).toHaveBeenCalledWith("shared-project", "development");
  });

  it("shows both scopes and the selected environment once loaded", () => {
    mocks.useSharedVariables.mockReturnValue({ variables: { project: "SHARED=project", environment: "LOCAL=environment" } });
    const html = renderToStaticMarkup(createElement(SharedVariablesPanel, { project }));
    expect(html).toContain('aria-label="Project variables"');
    expect(html).toContain('aria-label="Environment variables"');
    expect(html).toContain('<option value="development" selected="">Development</option>');
    expect(html).toContain('<option value="preview">Preview</option>');
    expect(html).toContain('aria-label="SHARED value" type="password"');
    expect(html).toContain('aria-label="LOCAL value" type="password"');
    expect(html).toContain("redeploy each referencing service");
  });

  it("shows a read error without presenting an empty editable block", () => {
    mocks.useSharedVariables.mockReturnValue({ error: "Access denied" });
    const html = renderToStaticMarkup(createElement(SharedVariablesPanel, { project }));
    expect(html).toMatch(/role="alert"[^>]*>Access denied/);
    expect(html).not.toContain('role="table"');
    expect(html).not.toContain("Save project variables");
  });

  it("omits the environment editor when the project has no environment", () => {
    mocks.useSharedVariables.mockReturnValue({ variables: { project: "SHARED=project", environment: "" } });
    const html = renderToStaticMarkup(createElement(SharedVariablesPanel, { project: { ...project, environments: [] } }));
    expect(html).toContain("Save project variables");
    expect(html).not.toContain("Save environment variables");
    expect(html).not.toContain('aria-label="Shared variables environment"');
    expect(mocks.useSharedVariables).toHaveBeenCalledWith("shared-project", undefined);
  });
});

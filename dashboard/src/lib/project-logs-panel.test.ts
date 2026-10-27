import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectLogs } from "../components/ProjectLogs";
import type { ProjectNode } from "./dokploy";

const projects: ProjectNode[] = [
  { projectId: "first", name: "First project", environments: [{ environmentId: "first-env", name: "First environment" }] },
  { projectId: "second", name: "Second project", environments: [{ environmentId: "second-env", name: "Second environment" }] },
];

describe("project logs shared workspace filter", () => {
  it("uses the selected project's environments without rendering a second project selector", () => {
    const html = renderToStaticMarkup(createElement(ProjectLogs, { projects, selectedProjectId: "second" }));
    expect(html).not.toContain('aria-label="Log project"');
    expect(html).toContain("Second environment");
    expect(html).not.toContain("First environment");
    expect(html).toContain('aria-label="Project runtime logs"');
  });

  it("asks for a project when the workspace shows all projects instead of silently reading the first", () => {
    const html = renderToStaticMarkup(createElement(ProjectLogs, { projects, selectedProjectId: null }));
    expect(html).not.toContain('aria-label="Log project"');
    expect(html).not.toContain('aria-label="Project runtime logs"');
    expect(html).toContain("Select a project above to explore its logs.");
  });

  it("does not fall back to another project when the selected project disappears", () => {
    const html = renderToStaticMarkup(createElement(ProjectLogs, { projects, selectedProjectId: "removed" }));
    expect(html).not.toContain("First environment");
    expect(html).not.toContain('aria-label="Project runtime logs"');
  });

  it("preserves the standalone selector and default first project", () => {
    const html = renderToStaticMarkup(createElement(ProjectLogs, { projects }));
    expect(html).toContain('aria-label="Log project"');
    expect(html).toContain("First project");
    expect(html).toContain("Second project");
    expect(html).toContain("First environment");
    expect(html).toContain('aria-label="Project runtime logs"');
  });
});

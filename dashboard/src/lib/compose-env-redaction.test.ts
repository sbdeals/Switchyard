import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComposeOverviewTab } from "../components/service/ComposeTabs";
import { loadServiceEnvAction } from "@/app/actions";
import type { ComposeService } from "./dokploy";

vi.mock("@/app/actions", () => ({ loadServiceEnvAction: vi.fn() }));
vi.mock("@/app/staged-actions", () => ({}));
vi.mock("@/components/service/StagedChanges", () => ({
  useStaging: () => ({ hasChanges: false }),
  useOptionalStaging: () => null,
}));

const compose: ComposeService = {
  kind: "compose",
  id: "managed-db-id",
  name: "managed-db",
  appName: "managed-db-app",
  status: "idle",
  projectId: "project-id",
  projectName: "Test project",
  environmentId: "environment-id",
  environmentName: "production",
  dockerImage: "postgres:17",
  env: "POSTGRES_PASSWORD=managed-db-prop-sentinel\nPOSTGRES_USER=app\nPOSTGRES_DB=app",
  createdAt: null,
  cpuLimit: null,
  memoryLimit: null,
  replicas: null,
  composeFile: null,
  composeType: "docker-compose",
  domains: [],
  deployments: [],
  managed: { kind: "database", engine: "postgres", image: "postgres:17" },
};

describe("managed database overview", () => {
  it.each([compose.env, null])("waits for an explicit reveal without using page env (%s)", (env) => {
    const html = renderToStaticMarkup(createElement(ComposeOverviewTab, {
      compose: { ...compose, env },
    }));

    expect(html).toContain("Reveal connection string");
    expect(html).not.toContain("managed-db-prop-sentinel");
    expect(html).not.toContain("postgresql://");
    expect(loadServiceEnvAction).not.toHaveBeenCalled();
  });
});

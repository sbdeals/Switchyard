import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectionBar } from "@/components/agent/AgentPanel";

const config = {
  canConfigure: false,
  configured: true,
  provider: "openai" as const,
  source: "ui" as const,
  masked: "fixture…tail",
  baseUrl: "https://models.example.test/v1",
  model: "fixture-model",
  models: [],
  presets: [],
};

describe("agent settings permissions", () => {
  it("disables the entire settings fieldset for members while retaining visible status", () => {
    const html = renderToStaticMarkup(createElement(ConnectionBar, { config, onChanged: () => {} }));
    expect(html).toMatch(/^<fieldset disabled=""/);
    expect(html).toContain("Only workspace admins can change the agent provider");
    for (const status of [config.masked, config.baseUrl, config.model, "Provider", "Replace", "Remove"]) {
      expect(html).toContain(status);
    }
  });

  it("enables settings for an authoritative admin", () => {
    const html = renderToStaticMarkup(createElement(ConnectionBar, { config: { ...config, canConfigure: true }, onChanged: () => {} }));
    expect(html).toMatch(/^<fieldset class=/);
    expect(html).not.toContain("Only workspace admins");
  });

  it("keeps settings disabled while permission is unknown", () => {
    const html = renderToStaticMarkup(createElement(ConnectionBar, { config: null, onChanged: () => {} }));
    expect(html).toMatch(/^<fieldset disabled=""/);
  });
});

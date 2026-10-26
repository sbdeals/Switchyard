import { describe, expect, it } from "vitest";
import { previewEnvironment } from "./pr-previews";
import { parseManaged, repoStack } from "./managed-compose";

describe("preview environment snapshot", () => {
  it("omits vault secrets, annotated resolved secrets, and transitive aliases", () => {
    const env = [
      "PUBLIC=ok", "SECRET=${{vault.production.password}}", "ALIAS=${{ SECRET }}", "INDIRECT=${ALIAS}",
      "# switchyard:ref RESOLVED=${{vault.production.token}}", "RESOLVED=do-not-copy",
      "# switchyard:ref RESOLVED_ALIAS=${{ RESOLVED }}", "RESOLVED_ALIAS=also-do-not-copy",
      "ESCAPED=$${{vault.production.password}}",
    ].join("\n");
    expect(previewEnvironment(env)).toBe("PUBLIC=ok");
  });

  it("copies ordinary env values exactly, including unclassified credentials, without annotations", () => {
    expect(previewEnvironment('# comment\nexport PORT=8080\nPASSWORD="plain secret"\n# switchyard:ref URL=${{db.URL}}\nURL=resolved\n'))
      .toBe('PORT=8080\nPASSWORD="plain secret"\nURL=resolved');
    expect(previewEnvironment(null)).toBe("");
  });
});

describe("preview commit pin", () => {
  it("retains the branch for display and uses the full SHA for the build context", () => {
    const file = repoStack({ appName: "preview", repoUrl: "https://github.com/acme/web", branch: "feature", commit: "a".repeat(40), subdirectory: "web" });
    expect(file).toContain(`https://github.com/acme/web.git#${"a".repeat(40)}:web`);
    expect(parseManaged(file)).toMatchObject({ branch: "feature", commit: "a".repeat(40) });
  });

  it.each(["short", "main", "a".repeat(39), "g".repeat(40), "a".repeat(40) + ":other"])("rejects invalid pin %s", (commit) => {
    expect(() => repoStack({ appName: "preview", repoUrl: "https://github.com/acme/web", branch: "feature", commit })).toThrow("Invalid Git commit.");
  });
});

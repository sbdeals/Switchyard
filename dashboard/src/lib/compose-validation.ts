import { load } from "js-yaml";

function isMapping(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** Drafts need syntax feedback; deployment also requires a services mapping. */
export function validateComposeFile(composeFile: string, forDeploy = false): string | null {
  let document: unknown;
  try {
    document = load(composeFile);
  } catch (cause) {
    const error = cause as { reason?: string; mark?: { line: number; column: number } };
    const location = error.mark
      ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
      : "";
    const reason = (error.reason ?? "Could not parse the Compose file").replace(/\.?$/, ".");
    return `Invalid YAML${location}: ${reason}`;
  }

  if (forDeploy && (!isMapping(document) || !isMapping(document.services))) {
    return 'Cannot deploy: the Compose file must contain a top-level "services" mapping.';
  }
  return null;
}

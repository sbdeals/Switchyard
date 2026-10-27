import { stripUrlCredentials } from "./url-credentials";

function stripErrorCredentials(message: string): string {
  // Error prose may contain several quoted URLs, unlike a URL input field.
  return message.replace(
    /(?:[a-z][a-z\d+.-]*:\/{1,2}|\/\/)[^/?#"'<>\\\r\n]*@[^/?#"'<>\\\s]*/gi,
    stripUrlCredentials,
  ).replace(/\/api\/deploy\/[^/\s"'<>?\\#]+/gi, "/api/deploy/***");
}

/** Keep useful diagnostics without echoing credentials or submitted secrets. */
export function redactErrorMessage(
  error: unknown,
  fallback: string,
  secrets: readonly (string | null | undefined)[] = [],
): string {
  try {
    let message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (!message.trim()) return fallback;
    // request() truncates backend bodies at 300 characters. A truncated secret
    // cannot reliably be matched against the complete submitted value.
    const body = message.match(/^Dokploy .+ failed \(\d+\): ([\s\S]*)$/)?.[1];
    if (body && body.length >= 300) return fallback;

    const values = new Set<string>();
    for (const secret of secrets) {
      if (!secret) continue;
      if (typeof secret !== "string") return fallback;
      values.add(secret);
      // A backend can echo just the password from a submitted/preserved URL.
      let url: URL;
      try { url = new URL(secret); } catch { continue; }
      for (const credential of [url.username, url.password]) {
        if (credential) {
          values.add(credential);
          values.add(decodeURIComponent(credential));
        }
      }
    }
    // Scrub structure first: a password like "https" or "deploy" must not
    // disguise another URL/token before we have removed its credentials.
    message = stripErrorCredentials(message);
    const variants = [...values].flatMap((value) => [
      value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value),
    ]).flatMap((value) => [value, stripErrorCredentials(value)])
      .sort((a, b) => b.length - a.length);
    for (const value of variants) message = message.split(value).join("***");

    return message || fallback;
  } catch {
    return fallback;
  }
}

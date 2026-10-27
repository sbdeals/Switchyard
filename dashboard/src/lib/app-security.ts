/** The editor accepts a shared subset of JavaScript and Traefik's Go regexp. */
function validateRegex(regex: string): string | null {
  if (!regex.trim()) return "Enter a redirect regex.";
  if (regex.length > 1024) return "Keep the redirect regex under 1,025 characters.";

  let inClass = false;
  for (let i = 0; i < regex.length; i++) {
    const char = regex[i];
    if (char === "\\") {
      const escaped = regex[++i];
      if (!escaped || /[0-9]/.test(escaped) || escaped === "k") {
        return "Backreferences and numeric escapes are not supported by this editor.";
      }
      if (/[A-Za-z]/.test(escaped) && !/[dDsSwWbBfnrtvx]/.test(escaped)) {
        return "Unsupported regex escape. Use standard character classes or literal characters.";
      }
      if (inClass && /[bB]/.test(escaped)) return "Word boundaries cannot be used inside a character class.";
      continue;
    }
    if (char === "[" && !inClass) {
      inClass = true;
      if (regex[i + 1] === "]" || regex.slice(i + 1, i + 3) === "^]") {
        return "Empty character classes are not supported by Traefik.";
      }
    } else if (char === "]") {
      inClass = false;
    } else if (!inClass && char === "(" && regex[i + 1] === "?" && regex[i + 2] !== ":") {
      return "Use numbered or noncapturing groups. Lookaround and inline flags are not supported.";
    } else if (!inClass && char === "{") {
      const count = regex.slice(i).match(/^\{(\d+)(?:,(\d*))?\}/);
      if (count && (Number(count[1]) > 1000 || Number(count[2]) > 1000)) {
        return "Traefik supports repetition counts up to 1000.";
      }
    }
  }

  try {
    // Unicode mode rejects JS legacy escapes and syntax that Go would reject.
    new RegExp(regex, "u");
    return null;
  } catch {
    return "Invalid regex. Check brackets, groups, escapes, and repetition counts.";
  }
}

export function validateRedirect(regex: unknown, replacement: unknown, permanent: unknown): string | null {
  if (typeof regex !== "string") return "Enter a redirect regex.";
  const error = validateRegex(regex);
  if (error) return error;
  if (typeof replacement !== "string" || !replacement.trim()) return "Enter a replacement URL.";
  if (replacement.length > 2048) return "Keep the replacement URL under 2,049 characters.";
  if (typeof permanent !== "boolean") return "Permanent must be true or false.";
  return null;
}

export function validateBasicAuth(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || !username.trim()) return "Enter a username.";
  if (/[:\x00-\x1f\x7f]/.test(username)) return "Usernames cannot contain colons or control characters.";
  if (typeof password !== "string" || password.length === 0) return "Enter a password.";
  return null;
}

/** Never execute an arbitrary backtracking regex on the browser's main thread. */
function canPreview(regex: string, length: number): boolean {
  let inClass = false;
  let choices = 1;
  for (let i = 0; i < regex.length; i++) {
    const char = regex[i];
    if (char === "\\") { i++; continue; }
    if (char === "[") inClass = true;
    if (char === "]") inClass = false;
    if (inClass) continue;
    if (char === "?" && regex[i - 1] === "(") continue;

    const count = char === "{" ? regex.slice(i).match(/^\{(\d+)(?:,(\d*))?\}/) : null;
    const quantified = char === "*" || char === "+" || char === "?" || count;
    // Repeated groups can hide exponential branching, including nested repeats.
    if (quantified && regex[i - 1] === ")") return false;
    if (char === "*" || char === "+") choices *= length + 1;
    if (char === "?" || char === "|") choices *= 2;
    if (count) {
      if (count[2] !== undefined) {
        const max = count[2] === "" ? length : Math.min(Number(count[2]), length);
        choices *= Math.max(1, max - Number(count[1]) + 1);
      }
      i += count[0].length - 1;
    }
    if (quantified && regex[i + 1] === "?") i++;
    if (choices > 32768) return false;
  }
  return true;
}

/** Go expands the longest $name, so $1x is not ${1} followed by x. */
function expandReplacement(replacement: string, match: RegExpMatchArray): string {
  return replacement.replace(/\$\$|\$\{([\p{L}\p{Nd}_]+)\}|\$([\p{L}\p{Nd}_]+)/gu, (token, braced, bare) => {
    if (token === "$$") return "$";
    const name: string = braced ?? bare;
    return /^(0|[1-9][0-9]*)$/.test(name) ? match[Number(name)] ?? "" : "";
  });
}

export function previewRedirect(regex: string, replacement: string, url: string):
  | { ok: true; matched: boolean; result: string }
  | { ok: false; error: string } {
  const error = validateRedirect(regex, replacement, false);
  if (error) return { ok: false, error };
  // Match the normalization applied when the editor saves a redirect.
  regex = regex.trim();
  replacement = replacement.trim();
  if (!url) return { ok: false, error: "Enter a URL to preview." };
  if (url.length > 512 || /[^\x20-\x7e]/.test(url)) {
    return { ok: false, error: "Preview supports ASCII URLs up to 512 characters. Encode non-ASCII URL characters first." };
  }
  if (!canPreview(regex, url.length)) {
    return { ok: false, error: "This regex is too complex to preview safely in the browser. You can still save it for Traefik." };
  }

  let end = 0;
  let matched = false;
  let result = "";
  for (const match of url.matchAll(new RegExp(regex, "gu"))) {
    // Go ignores empty matches immediately following a previous match.
    if (matched && match[0] === "" && match.index === end) continue;
    result += url.slice(end, match.index) + expandReplacement(replacement, match);
    end = match.index + match[0].length;
    matched = true;
  }
  return { ok: true, matched, result: result + url.slice(end) };
}

/**
 * Railway-style reference variables: `KEY=${{ServiceName.VAR}}`.
 *
 * SYNTAX
 *   ${{ServiceName.VAR}}   the value of VAR on the service named ServiceName
 *                          (the name shown on the canvas; exact match first,
 *                          then case-insensitive). The service name is
 *                          everything before the LAST dot.
 *   VAR is looked up in the target's own variables first (themselves resolved,
 *   so references chain), then in its built-in variables (connection string,
 *   host, port… — see reference-vars.ts).
 *   Several references and literal text can share one value:
 *     REDIS_URL=redis://${{cache.REDIS_HOST}}:${{cache.REDIS_PORT}}/0
 *
 * PASSED THROUGH UNTOUCHED (the engine resolves these itself at deploy):
 *   ${{VAR}}                 no dot — the engine's same-service reference
 *   ${{project.VAR}}  ${{environment.VAR}}  ${{vault.…}}   engine shared vars
 *   $${{…}}                  escaped — Switchyard emits the literal `${{…}}`
 *                            (which the engine may then interpret itself)
 *
 * STORAGE
 *   The engine treats any `${{…}}` left in a value as its own reference and
 *   fails the deploy when it can't find it, so it must only ever see concrete
 *   values. A variable that uses references is stored as an annotation comment
 *   (which env parsers skip) followed by the resolved line:
 *     # switchyard:ref DATABASE_URL=${{db.DATABASE_URL}}
 *     DATABASE_URL=postgresql://app:…@db-x1y2z3:5432/app
 *   `decodeStoredEnv` turns that back into the editable template;
 *   `encodeStoredEnv` produces it from a template + resolution.
 *
 * Pure and dependency-free (unit-tested in references.test.ts).
 */

/** Everything the resolver may read about one service. */
export interface RefTarget {
  /** Display name — what `${{Name.VAR}}` matches. */
  name: string;
  /** The service's editable env TEMPLATE (decoded; may contain references). */
  template: string | null;
  /** Derived variables (connection string, host, port…). Own variables win. */
  builtins: Record<string, string>;
}

export interface RefIssue {
  /** Variable (line key) the problem is on. */
  key: string;
  /** The reference as written, e.g. "${{db.DATABASE_URL}}". */
  ref: string;
  message: string;
}

export interface Resolution {
  /** Resolved KEY -> value for every variable line (references expanded). */
  values: Record<string, string>;
  /** Keys whose value contained at least one expanded reference. */
  referencing: Set<string>;
  /** Target service names referenced (as matched), for edges and pickers. */
  services: Set<string>;
  issues: RefIssue[];
}

/** Prefix of the comment line that carries a variable's reference template. */
export const REF_ANNOTATION = "# switchyard:ref ";
const ANNOTATION = REF_ANNOTATION;
/** `$${{…}}` (escaped) or `${{…}}`. */
const REF = /(\$?)\$\{\{\s*([^{}]*?)\s*\}\}/g;
const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENGINE_SCOPES = new Set(["project", "environment", "vault"]);

/** Split `KEY=value` lines (comments/blank skipped). Later duplicates win. */
export function templateEntries(template: string | null | undefined): [string, string][] {
  const out = new Map<string, string>();
  for (const line of (template ?? "").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = line.match(KEY_LINE);
    if (m) out.set(m[1], m[2]);
  }
  return [...out.entries()];
}

type ParsedRef =
  | { kind: "literal"; text: string }
  | { kind: "passthrough"; text: string }
  | { kind: "service"; text: string; service: string; variable: string };

function classify(escaped: string, inner: string, whole: string): ParsedRef {
  if (escaped) return { kind: "literal", text: whole.slice(1) };
  const dot = inner.lastIndexOf(".");
  if (dot <= 0) return { kind: "passthrough", text: whole };
  if (ENGINE_SCOPES.has(inner.slice(0, inner.indexOf(".")).trim())) {
    return { kind: "passthrough", text: whole };
  }
  const service = inner.slice(0, dot).trim();
  const variable = inner.slice(dot + 1).trim();
  return { kind: "service", text: whole, service, variable };
}

/** Every service reference in a template (for pickers, edges, cheap checks). */
export function findReferences(
  template: string | null | undefined
): { key: string; service: string; variable: string; ref: string }[] {
  const refs: { key: string; service: string; variable: string; ref: string }[] = [];
  for (const [key, value] of templateEntries(template)) {
    for (const m of value.matchAll(REF)) {
      const r = classify(m[1], m[2], m[0]);
      if (r.kind === "service") refs.push({ key, service: r.service, variable: r.variable, ref: r.text });
    }
  }
  return refs;
}

export function hasReferences(template: string | null | undefined): boolean {
  return findReferences(template).length > 0;
}

/** Case-sensitive match first, then a unique case-insensitive one. */
function lookupTarget(targets: readonly RefTarget[], name: string): RefTarget | null {
  const exact = targets.find((t) => t.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  const loose = targets.filter((t) => t.name.toLowerCase() === lower);
  return loose.length === 1 ? loose[0] : null;
}

/**
 * Resolve `template` (the env of the service named `self`) against `targets`
 * (all services, including `self` if it exists yet).
 */
export function resolveTemplate(
  template: string | null | undefined,
  self: string | null,
  targets: readonly RefTarget[]
): Resolution {
  const resolution: Resolution = {
    values: {},
    referencing: new Set(),
    services: new Set(),
    issues: [],
  };
  const selfTarget: RefTarget = {
    name: self ?? "",
    template: template ?? "",
    builtins: (self && lookupTarget(targets, self)?.builtins) || {},
  };
  // Resolve against the in-progress template for self, stored templates for others.
  const all = [selfTarget, ...targets.filter((t) => !self || t.name !== self)];
  const entryCache = new Map<RefTarget, Map<string, string>>();
  const entries = (t: RefTarget) => {
    let e = entryCache.get(t);
    if (!e) entryCache.set(t, (e = new Map(templateEntries(t.template))));
    return e;
  };
  const memo = new Map<string, string>();

  /**
   * Expand references in one raw value; null if any reference failed. `stack`
   * is the chain of "service.VAR" nodes being resolved, ending with this one.
   */
  const expand = (
    raw: string,
    owner: RefTarget,
    stack: string[],
    report: (ref: string, message: string) => void
  ): string | null => {
    let ok = true;
    const out = raw.replace(REF, (whole, escaped: string, inner: string) => {
      const r = classify(escaped, inner, whole);
      if (r.kind !== "service") return r.text;
      if (!VAR_NAME.test(r.variable)) {
        ok = false;
        report(r.text, `"${r.variable}" isn't a valid variable name.`);
        return whole;
      }
      const target = lookupTarget(all, r.service);
      if (!target) {
        ok = false;
        report(r.text, `No service named "${r.service}".`);
        return whole;
      }
      if (owner === selfTarget && stack.length === 1) resolution.services.add(target.name);
      const value = resolveVar(target, r.variable, stack, report);
      if (value === null) {
        ok = false;
        return whole;
      }
      return value;
    });
    return ok ? out : null;
  };

  const resolveVar = (
    target: RefTarget,
    variable: string,
    stack: string[],
    report: (ref: string, message: string) => void
  ): string | null => {
    const node = `${target.name}.${variable}`;
    if (stack.includes(node)) {
      report(`\${{${node}}}`, `Reference cycle: ${[...stack, node].join(" → ")}.`);
      return null;
    }
    // "@self" can't collide: it isn't a usable service name in a reference.
    const memoKey = `${target === selfTarget ? "@self" : target.name}.${variable}`;
    const hit = memo.get(memoKey);
    if (hit !== undefined) return hit;
    const raw = entries(target).get(variable);
    let value: string | null;
    if (raw !== undefined) {
      value = expand(raw, target, stack.concat(node), report);
    } else if (variable in target.builtins) {
      value = target.builtins[variable];
    } else {
      const known = [...new Set([...entries(target).keys(), ...Object.keys(target.builtins)])];
      report(
        `\${{${node}}}`,
        `"${target.name}" has no variable ${variable}` +
          (known.length ? ` (available: ${known.slice(0, 8).join(", ")}${known.length > 8 ? ", …" : ""}).` : ".")
      );
      value = null;
    }
    // Only successes are memoized, so every failing reference reports its issue.
    if (value !== null) memo.set(memoKey, value);
    return value;
  };

  for (const [key, raw] of templateEntries(template)) {
    const seen = new Set<string>();
    const report = (ref: string, message: string) => {
      const sig = `${ref}|${message}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      resolution.issues.push({ key, ref, message });
    };
    const refsHere = [...raw.matchAll(REF)].some((m) => classify(m[1], m[2], m[0]).kind === "service");
    const value = expand(raw, selfTarget, [`${selfTarget.name}.${key}`], report);
    if (value !== null) resolution.values[key] = value;
    if (refsHere) resolution.referencing.add(key);
  }
  return resolution;
}

/**
 * Stored form for the engine: reference lines become an annotation comment +
 * the resolved line; everything else passes through verbatim. Escaped `$${{`
 * outside references is unescaped on the concrete line.
 */
export function encodeStoredEnv(template: string, resolution: Resolution): string {
  const out: string[] = [];
  for (const line of template.split("\n")) {
    const m = !line.trimStart().startsWith("#") ? line.match(KEY_LINE) : null;
    if (!m) {
      out.push(line);
      continue;
    }
    const key = m[1];
    const hasEscape = /\$\$\{\{/.test(m[2]);
    if (!resolution.referencing.has(key) && !hasEscape) {
      out.push(line);
      continue;
    }
    const value = resolution.values[key];
    if (value === undefined) {
      // Unresolved: never hand the engine a raw reference.
      throw new Error(`Variable ${key} has unresolved references.`);
    }
    out.push(`${ANNOTATION}${key}=${m[2]}`, `${key}=${value}`);
  }
  return out.join("\n");
}

/** Editable template from the stored form (inverse of encodeStoredEnv). */
export function decodeStoredEnv(stored: string | null | undefined): string {
  const lines = (stored ?? "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(ANNOTATION)) {
      const tpl = line.slice(ANNOTATION.length);
      const key = tpl.match(KEY_LINE)?.[1];
      out.push(tpl);
      // Skip the resolved line that follows it.
      if (key && lines[i + 1]?.match(KEY_LINE)?.[1] === key) i++;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Human summary of issues for an error message. */
export function describeIssues(issues: readonly RefIssue[]): string {
  return issues.map((i) => `${i.key}: ${i.ref} — ${i.message}`).join("\n");
}

/** Pure parsing and precedence for repository-root deployment configuration. */
export const CONFIG_FILES = ["switchyard.json", "railway.json", "railway.toml"] as const;
export type ConfigFileName = (typeof CONFIG_FILES)[number];

export interface RepoConfig {
  build?: {
    builder?: "NIXPACKS" | "DOCKERFILE" | "RAILPACK";
    buildCommand?: string;
    dockerfilePath?: string;
  };
  deploy?: {
    startCommand?: string;
    preDeployCommand?: string | string[];
    healthcheckPath?: string;
    healthcheckTimeout?: number;
    restartPolicyType?: "ALWAYS" | "ON_FAILURE" | "NEVER";
    restartPolicyMaxRetries?: number;
    cronSchedule?: string;
  };
}

export interface ParsedConfig {
  file: ConfigFileName;
  config: RepoConfig;
  warnings: string[];
  errors: string[];
}

const MAX_CONFIG_BYTES = 64 * 1024;
const BUILD_KEYS = ["builder", "buildCommand", "dockerfilePath"] as const;
const DEPLOY_KEYS = [
  "startCommand", "preDeployCommand", "healthcheckPath", "healthcheckTimeout",
  "restartPolicyType", "restartPolicyMaxRetries", "cronSchedule",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
}

function validate(key: string, value: unknown): string | null {
  switch (key) {
    case "buildCommand":
    case "startCommand":
      return typeof value === "string" && !value.includes("\0") ? null : "must be a string without null characters";
    case "builder":
      return typeof value === "string" && ["NIXPACKS", "DOCKERFILE", "RAILPACK"].includes(value)
        ? null : "must be NIXPACKS, DOCKERFILE, or RAILPACK";
    case "restartPolicyType":
      return typeof value === "string" && ["ALWAYS", "ON_FAILURE", "NEVER"].includes(value)
        ? null : "must be ALWAYS, ON_FAILURE, or NEVER";
    case "healthcheckTimeout":
      return Number.isSafeInteger(value) && (value as number) > 0 ? null : "must be a positive integer (seconds)";
    case "restartPolicyMaxRetries":
      return Number.isSafeInteger(value) && (value as number) >= 0 ? null : "must be a nonnegative integer";
    case "preDeployCommand":
      return isText(value) || (Array.isArray(value) && value.every(isText))
        ? null : "must be a nonempty string or an array of nonempty strings";
    case "healthcheckPath":
      return isText(value) && value.startsWith("/") && !/[\r\n]/.test(value)
        ? null : "must be a path starting with /";
    case "dockerfilePath":
      return isText(value) && !/^[\\/]|^[A-Za-z]:|[\r\n]/.test(value) && !value.split(/[\\/]/).includes("..")
        ? null : "must be a relative path within the repository";
    case "cronSchedule":
      return isText(value) && value.trim().split(/\s+/).length === 5
        ? null : "must contain five cron fields";
    default:
      return isText(value) ? null : "must be a nonempty string";
  }
}

/** Invalid files never produce a partially applicable configuration. */
export function parseConfigFile(file: ConfigFileName, text: string): ParsedConfig {
  const result: ParsedConfig = { file, config: {}, warnings: [], errors: [] };
  let value: unknown;
  try {
    if (new TextEncoder().encode(text).length > MAX_CONFIG_BYTES) throw new Error("File exceeds 64 KiB");
    value = file === "railway.toml" ? new ConfigTomlParser(text).parse() : JSON.parse(text);
  } catch (error) {
    result.errors.push(file === "railway.toml" && error instanceof Error ? error.message : "Invalid JSON or file exceeds 64 KiB");
    return result;
  }
  if (!isObject(value)) {
    result.errors.push("Config must be an object");
    return result;
  }
  for (const [section, entries] of Object.entries(value)) {
    if (section !== "build" && section !== "deploy") {
      result.warnings.push(`Unknown key: ${section}`);
      continue;
    }
    if (!isObject(entries)) {
      result.errors.push(`${section} must be an object`);
      continue;
    }
    const supported: readonly string[] = section === "build" ? BUILD_KEYS : DEPLOY_KEYS;
    const selected: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (!supported.includes(key)) {
        result.warnings.push(`Unknown key: ${section}.${key}`);
        continue;
      }
      const error = validate(key, entry);
      if (error) result.errors.push(`${section}.${key} ${error}`);
      else selected[key] = Array.isArray(entry) ? [...entry] : entry;
    }
    if (Object.keys(selected).length > 0) result.config[section] = selected;
  }
  if (result.errors.length > 0) result.config = {};
  return result;
}

/** Select one file; a broken preferred file must not silently fall back. */
export function selectConfigFile(files: Partial<Record<ConfigFileName, string>>): ParsedConfig | null {
  for (const file of CONFIG_FILES) {
    if (Object.hasOwn(files, file) && files[file] !== undefined) return parseConfigFile(file, files[file]);
  }
  return null;
}

/** Map only dashboard fields whose repository-config equivalents are known. */
export function dashboardConfig(settings: {
  buildType: string | null;
  dockerfile: string | null;
  command: string | null;
}): RepoConfig {
  const config: RepoConfig = {};
  const builders: Record<string, NonNullable<RepoConfig["build"]>["builder"]> = {
    nixpacks: "NIXPACKS", dockerfile: "DOCKERFILE", railpack: "RAILPACK",
  };
  if (settings.buildType && Object.hasOwn(builders, settings.buildType)) {
    config.build = { builder: builders[settings.buildType] };
    if (settings.buildType === "dockerfile") config.build.dockerfilePath = settings.dockerfile || "Dockerfile";
  }
  if (settings.command !== null) config.deploy = { startCommand: settings.command };
  return config;
}

/** Resolve per key and retain provenance for the UI, without mutating either input. */
export function resolveConfig(dashboard: RepoConfig, parsed: ParsedConfig): {
  config: RepoConfig;
  sources: Record<string, string>;
} {
  const config: RepoConfig = {};
  const sources: Record<string, string> = {};
  for (const section of ["build", "deploy"] as const) {
    const values: Record<string, unknown> = {};
    const keys = section === "build" ? BUILD_KEYS : DEPLOY_KEYS;
    for (const key of keys) {
      const local = Object.hasOwn(dashboard, section) ? dashboard[section] as Record<string, unknown> | undefined : undefined;
      const file = parsed.errors.length === 0 && Object.hasOwn(parsed.config, section)
        ? parsed.config[section] as Record<string, unknown> | undefined : undefined;
      const fromFile = file !== undefined && Object.hasOwn(file, key) && file[key] !== undefined;
      const value = fromFile ? file[key] : local && Object.hasOwn(local, key) ? local[key] : undefined;
      if (value === undefined) continue;
      values[key] = Array.isArray(value) ? [...value] : value;
      sources[`${section}.${key}`] = fromFile ? parsed.file : "dashboard";
    }
    if (Object.keys(values).length > 0) config[section] = values;
  }
  return { config, sources };
}

/**
 * Bounded TOML subset for deployment files: tables/dotted keys, strings,
 * decimal numbers, booleans, and arrays. Other TOML syntax fails explicitly.
 * Null-prototype tables and own-property checks keep untrusted keys inert.
 */
class ConfigTomlParser {
  private source: string;
  private offset = 0;
  private root: Record<string, unknown> = Object.create(null);
  private tables = new Map<string, "implicit" | "header" | "dotted">();

  constructor(source: string) {
    this.source = source.replace(/\r\n/g, "\n");
    if (/[\x00-\x08\x0b-\x1f\x7f]/.test(this.source)) this.fail("Invalid control character");
  }

  private fail(message: string): never {
    const line = this.source.slice(0, this.offset).split("\n").length;
    throw new Error(`TOML line ${line}: ${message}`);
  }

  private space(multiline = false) {
    while (this.offset < this.source.length) {
      const char = this.source[this.offset];
      if (char === " " || char === "\t" || (multiline && char === "\n")) this.offset++;
      else if (multiline && char === "#") {
        while (this.offset < this.source.length && this.source[this.offset] !== "\n") this.offset++;
      } else break;
    }
  }

  private expect(char: string) {
    if (this.source[this.offset] !== char) this.fail(`Expected ${char}`);
    this.offset++;
  }

  private path(): string[] {
    const keys: string[] = [];
    do {
      this.space();
      const char = this.source[this.offset];
      if (char === '"' || char === "'") keys.push(this.string(false));
      else {
        const key = this.source.slice(this.offset).match(/^[A-Za-z0-9_-]+/)?.[0];
        if (!key) this.fail("Expected a key");
        keys.push(key);
        this.offset += key.length;
      }
      if (keys.length > 20) this.fail("Keys are nested too deeply");
      this.space();
      if (this.source[this.offset] !== ".") break;
      this.offset++;
    } while (true);
    return keys;
  }

  private string(allowMultiline: boolean): string {
    const quote = this.source[this.offset];
    const multiline = this.source.startsWith(quote.repeat(3), this.offset);
    if (multiline && !allowMultiline) this.fail("Multiline keys are unsupported");
    this.offset += multiline ? 3 : 1;
    if (multiline && this.source[this.offset] === "\n") this.offset++;
    let value = "";
    while (this.offset < this.source.length) {
      if (this.source[this.offset] === quote) {
        let count = 1;
        while (this.source[this.offset + count] === quote) count++;
        if (!multiline || count >= 3) {
          if (multiline && count > 5) this.fail("Too many closing quotes");
          this.offset += multiline ? count : 1;
          return value + (multiline ? quote.repeat(count - 3) : "");
        }
      }
      const char = this.source[this.offset++];
      if (char === "\n" && !multiline) this.fail("Newline in a single-line string");
      if (char !== "\\" || quote === "'") {
        value += char;
        continue;
      }
      if (multiline && /^[ \t]*\n/.test(this.source.slice(this.offset))) {
        while (/[ \t\n]/.test(this.source[this.offset] ?? "") && this.offset < this.source.length) this.offset++;
        continue;
      }
      const escape = this.source[this.offset++];
      const escapes: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
      if (Object.hasOwn(escapes, escape)) value += escapes[escape];
      else if (escape === "u" || escape === "U") {
        const length = escape === "u" ? 4 : 8;
        const hex = this.source.slice(this.offset, this.offset + length);
        if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) this.fail("Invalid Unicode escape");
        const code = parseInt(hex, 16);
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) this.fail("Invalid Unicode scalar");
        value += String.fromCodePoint(code);
        this.offset += length;
      } else this.fail("Invalid string escape");
    }
    return this.fail("Unterminated string");
  }

  private value(depth = 0): unknown {
    if (depth > 20) this.fail("Arrays are nested too deeply");
    const char = this.source[this.offset];
    if (char === '"' || char === "'") return this.string(true);
    if (char === "[") {
      this.offset++;
      const values: unknown[] = [];
      this.space(true);
      while (this.source[this.offset] !== "]") {
        values.push(this.value(depth + 1));
        this.space(true);
        if (this.source[this.offset] === "]") break;
        this.expect(",");
        this.space(true);
      }
      this.offset++;
      return values;
    }
    const token = this.source.slice(this.offset).match(/^[^\s,#\]]+/)?.[0] ?? "";
    this.offset += token.length;
    if (token === "true" || token === "false") return token === "true";
    if (/^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?$/.test(token)) {
      const value = Number(token.replaceAll("_", ""));
      if (Number.isFinite(value)) return value;
    }
    return this.fail("Unsupported or invalid value (use strings, decimal numbers, booleans, or arrays)");
  }

  private table(path: string[], mode: "implicit" | "dotted", sectionLength = 0): Record<string, unknown> {
    if (path.length > 20) this.fail("Keys are nested too deeply");
    let table = this.root;
    for (let index = 0; index < path.length; index++) {
      const key = path[index];
      const id = JSON.stringify(path.slice(0, index + 1));
      if (!Object.hasOwn(table, key)) {
        table[key] = Object.create(null);
        this.tables.set(id, mode);
      }
      if (!isObject(table[key])) this.fail("Key conflicts with a value");
      if (mode === "dotted" && index >= sectionLength) {
        if (this.tables.get(id) === "header") this.fail("Dotted key redefines an existing table");
        this.tables.set(id, "dotted");
      }
      table = table[key];
    }
    return table;
  }

  parse(): Record<string, unknown> {
    let section: string[] = [];
    this.space(true);
    while (this.offset < this.source.length) {
      if (this.source[this.offset] === "[") {
        this.offset++;
        if (this.source[this.offset] === "[") this.fail("Array tables are unsupported");
        section = this.path();
        this.expect("]");
        const id = JSON.stringify(section);
        if (this.tables.has(id) && this.tables.get(id) !== "implicit") this.fail("Duplicate table");
        this.table(section, "implicit");
        this.tables.set(id, "header");
      } else {
        const path = [...section, ...this.path()];
        this.expect("=");
        this.space();
        const value = this.value();
        const table = this.table(path.slice(0, -1), "dotted", section.length);
        const key = path[path.length - 1];
        if (Object.hasOwn(table, key)) this.fail("Duplicate key or key conflicts with a table");
        table[key] = value;
      }
      this.space();
      if (this.source[this.offset] === "#") {
        while (this.offset < this.source.length && this.source[this.offset] !== "\n") this.offset++;
      }
      if (this.offset < this.source.length) this.expect("\n");
      this.space(true);
    }
    return this.root;
  }
}

export interface BuildArg {
  key: string;
  value: string;
}

/** Parse one KEY=VALUE assignment per line without expanding variables. */
export function parseBuildArgs(raw: string): { entries: BuildArg[]; errors: string[] } {
  const values = new Map<string, string>();
  const errors: string[] = [];

  for (const [index, source] of raw.split(/\r?\n/).entries()) {
    const line = source.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!assignment) {
      errors.push(`Line ${index + 1}: expected KEY=VALUE with a valid variable name.`);
      continue;
    }

    const [, key, rawValue] = assignment;
    let value = rawValue;
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      // Like dotenv, allow a final quote after a literal trailing backslash.
      const quoted = value.match(/^(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|`((?:\\`|[^`])*)`)\s*(?:#.*)?$/);
      if (!quoted) {
        errors.push(`Line ${index + 1}: close the quoted value before any comment.`);
        continue;
      }
      value = quoted[1] ?? quoted[2] ?? quoted[3];
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    } else {
      value = value.split("#", 1)[0].trim();
    }
    values.set(key, value);
  }

  return { entries: Array.from(values, ([key, value]) => ({ key, value })), errors };
}

export function secretBuildArgKeys(entries: readonly BuildArg[]): string[] {
  return entries.filter(({ key }) => /TOKEN|SECRET|PASSWORD|KEY/i.test(key)).map(({ key }) => key);
}

/** Review metadata deliberately excludes both old and new values. */
export function reviewBuildArgs(before: string, after: string): { key: string; change: "added" | "changed" | "removed" }[] {
  const previous = new Map(parseBuildArgs(before).entries.map(({ key, value }) => [key, value]));
  const next = new Map(parseBuildArgs(after).entries.map(({ key, value }) => [key, value]));
  const changes: ReturnType<typeof reviewBuildArgs> = [];
  for (const [key, value] of next) {
    if (!previous.has(key)) changes.push({ key, change: "added" });
    else if (previous.get(key) !== value) changes.push({ key, change: "changed" });
  }
  for (const key of previous.keys()) {
    if (!next.has(key)) changes.push({ key, change: "removed" });
  }
  return changes;
}

type ApplicationTree = readonly {
  environments?: readonly {
    applications?: readonly { applicationId: string }[] | null;
  }[] | null;
}[];

export function applicationInTree(tree: ApplicationTree, applicationId: string): boolean {
  return tree.some((project) => project.environments?.some((environment) =>
    environment.applications?.some((application) => application.applicationId === applicationId)
  ));
}

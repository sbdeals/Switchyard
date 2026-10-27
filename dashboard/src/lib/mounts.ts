export const MAX_FILE_CONTENT_BYTES = 64 * 1024;

export interface MountInput {
  type?: unknown;
  mountPath?: unknown;
  volumeName?: unknown;
  filePath?: unknown;
  content?: unknown;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}

/** Compare Linux destinations after resolving repeated slashes and dot segments. */
function canonicalMountPath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "" && segment !== ".") segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** Shared by the form and server actions; errors never include submitted values. */
export function validateMount(
  input: MountInput,
  existing: readonly { mountId: string; mountPath: string }[],
  editingId?: string,
): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "Choose a named volume or file mount.";
  }
  if (input.type !== "volume" && input.type !== "file") {
    return "Choose a named volume or file mount.";
  }
  if (
    typeof input.mountPath !== "string" ||
    !input.mountPath.startsWith("/") ||
    hasControlCharacters(input.mountPath)
  ) {
    return "Mount path must be an absolute path without control characters.";
  }
  const mountPath = canonicalMountPath(input.mountPath);
  if (existing.some((mount) =>
    mount.mountId !== editingId && canonicalMountPath(mount.mountPath) === mountPath
  )) {
    return "A mount already uses this path.";
  }
  if (input.type === "volume") {
    if (typeof input.volumeName !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(input.volumeName)) {
      return "Volume name must have at least two characters, start with a letter or number, and use only letters, numbers, underscores, dots, or hyphens.";
    }
    return null;
  }
  if (
    typeof input.filePath !== "string" ||
    input.filePath.length === 0 ||
    input.filePath === "." ||
    input.filePath === ".." ||
    /[/\\]/.test(input.filePath) ||
    hasControlCharacters(input.filePath)
  ) {
    return "File name must be a single name without slashes or control characters.";
  }
  if (typeof input.content !== "string") {
    return "File content must be text.";
  }
  if (new TextEncoder().encode(input.content).byteLength > MAX_FILE_CONTENT_BYTES) {
    return "File content must be 64 KiB or smaller.";
  }
  return null;
}

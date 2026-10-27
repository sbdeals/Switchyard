export const SERVICE_NOTES_MAX_LENGTH = 500;

/** Cap a draft without changing its whitespace or splitting a surrogate pair. */
export function capServiceNotesLength(value: string): string {
  const capped = value.slice(0, SERVICE_NOTES_MAX_LENGTH);
  const last = capped.charCodeAt(capped.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? capped.slice(0, -1) : capped;
}

/** Plain text stored in Dokploy's description field. */
export function normalizeServiceNotes(value: string): string {
  return capServiceNotesLength(value.replace(/\r\n?/g, "\n").trim()).trimEnd();
}

/** The first line for the canvas; existing descriptions need not fit the edit limit. */
export function serviceNotesSubtitle(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").trim().split("\n", 1)[0].trim();
}

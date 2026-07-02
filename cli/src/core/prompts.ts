import * as p from "@clack/prompts";
import pc from "picocolors";

export { p, pc };

/** Consistent ctrl-c handling: cancel any prompt -> clean exit 1. */
export function bail(message = "Cancelled."): never {
  p.cancel(message);
  process.exit(1);
}

export async function askText(opts: {
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string> {
  const v = await p.text(opts);
  if (p.isCancel(v)) bail();
  return v;
}

export async function askPassword(opts: {
  message: string;
  validate?: (value: string) => string | undefined;
}): Promise<string> {
  const v = await p.password(opts);
  if (p.isCancel(v)) bail();
  return v;
}

export async function askConfirm(opts: { message: string; initialValue?: boolean }): Promise<boolean> {
  const v = await p.confirm(opts);
  if (p.isCancel(v)) bail();
  return v;
}

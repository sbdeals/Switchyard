import type { ExecResult } from "./docker";

export interface ConsoleExecResult extends ExecResult {
  shellMissing?: boolean;
  notice?: string;
  details?: string;
}

function isExecStartFailure(output: string, exitCode: number | null): boolean {
  return (exitCode === null || exitCode === 126 || exitCode === 127) &&
    /OCI runtime exec failed/i.test(output);
}

/** Do not confuse a command missing inside a working shell with a missing sh. */
export function isMissingShell(output: string, exitCode: number | null): boolean {
  return isExecStartFailure(output, exitCode) &&
    /exec:\s*["'](?:\/(?:usr\/)?bin\/)?sh["']:\s*executable file not found/i.test(output.replace(/\\"/g, '"'));
}

const SHELL_SYNTAX = "This command needs a shell. Run one executable with arguments; pipes, redirects and expansions are unavailable.";

/** Split simple argv with quotes/escapes, without evaluating shell syntax. */
export function splitDirectCommand(command: string): string[] {
  const args: string[] = [];
  let word = "";
  let started = false;
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "\\" && quote !== "'") {
      if (i + 1 === command.length) throw new Error("Finish the escaped argument before running the command.");
      const next = command[++i];
      if (next === "\n" || next === "\r") throw new Error(SHELL_SYNTAX);
      if (quote === '"' && !/[\\"$`]/.test(next)) word += "\\";
      word += next;
      started = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else {
        if (quote === '"' && /[$`]/.test(char)) throw new Error(SHELL_SYNTAX);
        word += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === "\n" || char === "\r" || /[|&;<>()$`*?\[\]{}~]/.test(char)) {
      throw new Error(SHELL_SYNTAX);
    } else if (/\s/.test(char)) {
      if (started) args.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) throw new Error("Close the quoted argument before running the command.");
  if (started) args.push(word);
  if (!args[0]) throw new Error("Enter an executable to run.");
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) throw new Error(SHELL_SYNTAX);
  return args;
}

/** Retry only when the shell never started, so a command cannot run twice. */
export async function runConsoleCommand(
  command: string,
  exec: (argv: string[]) => Promise<ExecResult | null>,
): Promise<ConsoleExecResult | null> {
  let result: ExecResult | null;
  try {
    result = await exec(["sh", "-c", command]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingShell(message, null)) throw e;
    result = { stdout: "", stderr: message, exitCode: null, truncated: false };
  }
  if (!result) return null;
  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (!isMissingShell(details, result.exitCode)) return result;
  const fallback = {
    stdout: "", stderr: "", exitCode: result.exitCode,
    truncated: result.truncated, shellMissing: true, details,
  };
  let argv: string[];
  try {
    argv = splitDirectCommand(command);
  } catch (e) {
    return { ...fallback, notice: (e as Error).message };
  }
  try {
    const direct = await exec(argv);
    if (!direct) return null;
    const output = [direct.stdout, direct.stderr].filter(Boolean).join("\n");
    if (isExecStartFailure(output, direct.exitCode)) {
      return {
        ...fallback, exitCode: direct.exitCode, truncated: direct.truncated,
        notice: "The command could not start. Try an executable included in this image.",
        details: `${details}\n${output}`,
      };
    }
    return { ...direct, shellMissing: true, details };
  } catch (e) {
    return {
      ...fallback,
      notice: "The direct command could not start. Try an executable included in this image.",
      details: `${details}\n${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

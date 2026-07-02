import { run, runInherit } from "../core/docker.js";
import { UserError } from "../core/errors.js";
import { askConfirm, p } from "../core/prompts.js";

/**
 * Launch Claude Code in the current directory, installing the CLI first if
 * needed. Its own first run handles authentication.
 */
export async function claudeCommand(args: string[]): Promise<void> {
  const isWin = process.platform === "win32";
  const version = await run("claude", ["--version"], { shell: isWin });
  if (version.code !== 0) {
    if (!process.stdin.isTTY) {
      throw new UserError("Claude Code CLI not found. Install it: npm install -g @anthropic-ai/claude-code");
    }
    const install = await askConfirm({
      message: "Claude Code CLI not found. Install it now? (npm install -g @anthropic-ai/claude-code)",
      initialValue: true,
    });
    if (!install) {
      p.cancel("Install it later with: npm install -g @anthropic-ai/claude-code");
      return;
    }
    const code = await runInherit("npm", ["install", "-g", "@anthropic-ai/claude-code"], { shell: isWin });
    if (code !== 0) throw new UserError("npm install failed — install manually: npm install -g @anthropic-ai/claude-code");
  }
  process.exitCode = await runInherit("claude", args, { shell: isWin });
}

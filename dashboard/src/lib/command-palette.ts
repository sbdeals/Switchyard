import type { ProjectNode, Service } from "@/lib/dokploy";
import { workspaceMenuItems, type MenuItem, type NewServiceKind } from "@/lib/context-menu";

export interface PaletteCommand {
  id: string;
  label: string;
  section: "Navigate" | "Actions" | "Create" | "Recent";
  description?: string;
  keywords?: string[];
  disabledReason?: string;
  destructive?: boolean;
  run: () => void | Promise<void>;
}

const serviceActions = new Set(["deploy", "restart", "open-url", "logs", "variables", "settings", "stop", "delete"]);
const recentLimit = 5;

/** Actions retain the context menu's bound handlers, permissions and confirmations. */
export function buildCommandRegistry({ services, projects, focusedService, serviceItems = [], onOpenService, onOpenProject, onCreate }: {
  services: Service[];
  projects: ProjectNode[];
  focusedService: Service | null;
  serviceItems?: (MenuItem & { onSelect?: () => void | Promise<void> })[];
  onOpenService: (service: Service) => void;
  onOpenProject: (projectId?: string) => void;
  onCreate: (kind?: NewServiceKind) => void;
}): PaletteCommand[] {
  return [
    { id: "navigate:projects", label: "Projects", section: "Navigate", description: "All projects", run: () => onOpenProject() },
    ...projects.map((project): PaletteCommand => ({
      id: `navigate:project:${project.projectId}`, label: project.name, section: "Navigate",
      description: "Project", keywords: ["project"], run: () => onOpenProject(project.projectId),
    })),
    ...services.map((service): PaletteCommand => ({
      id: `navigate:service:${service.id}`, label: service.name, section: "Navigate",
      description: `${service.projectName} / ${service.environmentName}`,
      keywords: ["service", service.kind], run: () => onOpenService(service),
    })),
    ...(focusedService ? serviceItems.flatMap((item): PaletteCommand[] => item.onSelect && serviceActions.has(item.id) ? [{
      id: `action:${focusedService.id}:${item.id}`, label: item.label, section: "Actions",
      description: focusedService.name,
      keywords: [focusedService.projectName, focusedService.environmentName, item.id, item.description ?? ""],
      disabledReason: item.disabledReason, destructive: item.destructive, run: item.onSelect,
    }] : []) : []),
    { id: "create:service", label: "New service", section: "Create", run: () => onCreate() },
    ...workspaceMenuItems().map((item): PaletteCommand => ({
      id: `create:${item.id}`, label: item.label, section: "Create", description: item.description,
      keywords: ["new", "create", item.id], disabledReason: item.disabledReason,
      run: () => onCreate(item.id),
    })),
  ];
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Exact, prefix and substring matches outrank a loose subsequence. */
function textScore(text: string, query: string): number | null {
  if (text === query) return 1200;
  if (text.startsWith(query)) return 900;
  const contained = text.indexOf(query);
  if (contained >= 0) return 600 - Math.min(contained, 100);
  let cursor = 0;
  for (const character of query) {
    const found = text.indexOf(character, cursor);
    if (found < 0) return null;
    cursor = found + 1;
  }
  return 200 - Math.min(cursor - query.length, 100);
}

function commandScore(command: PaletteCommand, query: string): number | null {
  if (!query) return 0;
  const label = normalize(command.label);
  const fields = [label, normalize(command.description ?? ""), ...(command.keywords ?? []).map(normalize)];
  let score = 0;
  for (const token of query.split(" ")) {
    let best: number | null = null;
    fields.forEach((field, index) => {
      const match = textScore(field, token);
      if (match !== null) best = Math.max(best ?? 0, match + (index === 0 ? 400 : 0));
    });
    if (best === null) return null;
    score += best;
  }
  return score + (textScore(label, query) ?? 0);
}

/** Resolve recents against current commands so removed services and stale handlers disappear. */
export function filterCommands(commands: PaletteCommand[], query: string, recentIds: string[] = []): PaletteCommand[] {
  const normalized = normalize(query);
  const available = new Map(commands.map((command) => [command.id, command]));
  const recents = [...new Set(recentIds)].filter((id) => available.has(id)).slice(0, recentLimit);
  const recentSet = new Set(recents);
  const ordered = [
    ...recents.map((id): PaletteCommand => ({ ...available.get(id)!, section: "Recent" })),
    ...commands.filter((command) => !recentSet.has(command.id)),
  ];
  const sections = { Recent: 0, Navigate: 1, Actions: 2, Create: 3 };
  const matches = ordered.flatMap((command, index) => {
    const score = commandScore(command, normalized);
    return score === null ? [] : [{ command, score, index }];
  });
  const bestScores = { Recent: 0, Navigate: 0, Actions: 0, Create: 0 };
  for (const { command, score } of matches) {
    bestScores[command.section] = Math.max(bestScores[command.section], score);
  }
  return matches.sort((a, b) => (normalized ? bestScores[b.command.section] - bestScores[a.command.section] : 0)
    || sections[a.command.section] - sections[b.command.section] || b.score - a.score || a.index - b.index)
    .map(({ command }) => command);
}

export function recordRecentCommand(recentIds: string[], id: string): string[] {
  return [...new Set([id, ...recentIds])].slice(0, recentLimit);
}

interface PaletteKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

/** The palette shortcut also works when focus is in an editable field. */
export function isPaletteShortcut(event: PaletteKeyEvent): boolean {
  return event.key.toLowerCase() === "k" && !!(event.ctrlKey || event.metaKey)
    && !event.altKey && !event.shiftKey && !event.isComposing && !event.repeat;
}

export type PaletteKeyResult =
  | { type: "focus"; index: number }
  | { type: "activate"; index: number }
  | { type: "close" }
  | { type: "none" };

export function paletteKeyResult(event: PaletteKeyEvent, index: number, commands: PaletteCommand[]): PaletteKeyResult {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return { type: "none" };
  if (event.key === "Escape") return { type: "close" };
  if (!commands.length) return { type: "none" };
  if (event.key === "ArrowDown") return { type: "focus", index: (index + 1) % commands.length };
  if (event.key === "ArrowUp") return { type: "focus", index: (index <= 0 ? commands.length : index) - 1 };
  if (event.key === "Enter" && !event.repeat && commands[index] && !commands[index].disabledReason) return { type: "activate", index };
  return { type: "none" };
}

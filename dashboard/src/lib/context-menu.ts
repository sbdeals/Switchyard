import type { Action, Service } from "@/lib/dokploy";
import type { ActionResult } from "@/app/actions";
import { isStopped } from "@/lib/service-meta";

export interface MenuItem<Id extends string = string> {
  id: Id;
  label: string;
  disabledReason?: string;
  destructive?: boolean;
  separatorBefore?: boolean;
  description?: string;
  children?: MenuItem<Id>[];
}

/** Omitted capabilities mirror the existing buttons; denial must stay visible. */
export type MenuPermissions<Id extends string> = Partial<Record<Id, boolean | string>>;

function permitted<Id extends string>(items: MenuItem<Id>[], permissions: MenuPermissions<Id>): MenuItem<Id>[] {
  return items.map((item) => {
    const permission = permissions[item.id];
    return {
      ...item,
      ...(item.children ? { children: permitted(item.children, permissions) } : {}),
      disabledReason: permission === false
        ? "You do not have permission to perform this action."
        : typeof permission === "string" ? permission : item.disabledReason,
    };
  });
}

export type ServiceMenuAction =
  | "config" | "source" | "networking" | "deploy-settings" | "compose" | "volumes" | "backups"
  | "variables" | "metrics" | "settings" | "open" | "open-url" | "copy-url"
  | "logs" | "deploy" | "restart" | "stop" | "delete";

/** Only destinations already present in this service's drawer. */
export function serviceConfigItems(service: Service): MenuItem<ServiceMenuAction>[] {
  if (service.kind === "application") return [
    { id: "source", label: service.sourceType === "docker" ? "Source" : "Build" },
    { id: "networking", label: "Networking" },
    { id: "deploy-settings", label: "Deploy" },
    { id: "volumes", label: "Volumes" },
  ];
  if (service.kind === "compose") return [
    { id: "networking", label: "Networking" },
    { id: "compose", label: "Compose" },
    { id: "volumes", label: "Volumes" },
  ];
  return [{ id: "volumes", label: "Volumes" }, { id: "backups", label: "Backups" }];
}

export function servicePublicUrl(service: Service): string | null {
  if (service.kind === "database" || (service.kind === "compose" && service.managed?.kind === "database")) return null;
  const domain = service.domains.find((d) => d.https) ?? service.domains[0];
  return domain ? `${domain.https ? "https" : "http"}://${domain.host}` : null;
}

export function selectMenuService<T extends { id: string; selected?: boolean }>(nodes: T[], id: string): T[] {
  return nodes.map((node) => ({ ...node, selected: node.id === id }));
}

export function serviceMenuItems(service: Service, {
  pending = false,
  permissions = {},
}: { pending?: boolean; permissions?: MenuPermissions<ServiceMenuAction> } = {}): MenuItem<ServiceMenuAction>[] {
  const managedApp = service.kind === "compose" &&
    (service.managed?.kind === "image" || service.managed?.kind === "repo") ? service.managed : null;
  const busy = pending ? "An action is in progress."
    : managedApp && service.status === "running" ? "A deployment is in progress." : undefined;
  const stopped = isStopped(service);
  const deployLabel = managedApp?.kind === "repo" && managedApp.pinnedTag
    ? `Redeploy latest from ${managedApp.branch}`
    : service.status === "idle" && !stopped ? "Deploy" : "Redeploy";
  const running = service.status === "done" && (!service.runtime || service.runtime.running > 0);
  return permitted<ServiceMenuAction>([
    { id: "config", label: "Config", children: serviceConfigItems(service) },
    { id: "variables", label: "View Variables" },
    { id: "metrics", label: "View Metrics" },
    { id: "settings", label: "View Settings" },
    { id: "open", label: "Open", separatorBefore: true },
    ...(servicePublicUrl(service) ? [
      { id: "open-url" as const, label: "Open URL" },
      { id: "copy-url" as const, label: "Copy URL" },
    ] : []),
    { id: "logs", label: "View logs" },
    { id: "deploy", label: deployLabel, disabledReason: busy },
    { id: "restart", label: "Restart", disabledReason: busy ?? (running ? undefined : "The service is not running.") },
    { id: "stop", label: "Stop", disabledReason: busy ?? (service.status === "done" ? undefined : "The service is not running.") },
    { id: "delete", label: "Delete Service", destructive: true, separatorBefore: true, disabledReason: pending ? "An action is in progress." : undefined },
  ], permissions);
}

export type DeploymentMenuAction = "logs" | "redeploy" | "rollback" | "copy-id";
export function deploymentMenuItems({
  rollbackAvailable,
  pending = false,
  redeployDisabledReason,
  permissions = {},
}: { rollbackAvailable: boolean; pending?: boolean; redeployDisabledReason?: string; permissions?: MenuPermissions<DeploymentMenuAction> }): MenuItem<DeploymentMenuAction>[] {
  return permitted<DeploymentMenuAction>([
    { id: "logs", label: "View logs" },
    { id: "redeploy", label: "Redeploy", description: "Redeploy the service's current configuration.", disabledReason: pending ? "An action is in progress." : redeployDisabledReason },
    ...(rollbackAvailable ? [{ id: "rollback" as const, label: "Rollback to this deploy", separatorBefore: true, disabledReason: pending ? "An action is in progress." : undefined }] : []),
    { id: "copy-id", label: "Copy deployment ID", separatorBefore: !rollbackAvailable },
  ], permissions);
}

export type VariableMenuAction = "copy" | "edit" | "delete";
export function variableMenuItems({
  reference = false,
  pending = false,
  permissions = {},
}: { reference?: boolean; pending?: boolean; permissions?: MenuPermissions<VariableMenuAction> } = {}): MenuItem<VariableMenuAction>[] {
  const disabledReason = pending ? "Variables are being saved." : undefined;
  return permitted<VariableMenuAction>([
    { id: "copy", label: reference ? "Copy reference" : "Copy value" },
    { id: "edit", label: "Edit", disabledReason },
    { id: "delete", label: "Delete", destructive: true, disabledReason },
  ], permissions);
}

export type ProjectMenuAction = "open" | "rename" | "delete";
export function projectMenuItems({
  canRename,
  canDelete,
  pending = false,
  permissions = {},
}: { canRename: boolean; canDelete: boolean; pending?: boolean; permissions?: MenuPermissions<ProjectMenuAction> }): MenuItem<ProjectMenuAction>[] {
  const disabledReason = pending ? "An action is in progress." : undefined;
  return permitted<ProjectMenuAction>([
    { id: "open", label: "Open" },
    ...(canRename ? [{ id: "rename" as const, label: "Rename", disabledReason }] : []),
    ...(canDelete ? [{ id: "delete" as const, label: "Delete", destructive: true, disabledReason }] : []),
  ], permissions);
}

export type NewServiceKind = "github" | "template" | "database" | "image" | "empty";

export function workspaceMenuItems(permissions: MenuPermissions<NewServiceKind> = {}): MenuItem<NewServiceKind>[] {
  return permitted([
    { id: "github", label: "GitHub Repo" },
    { id: "template", label: "Template" },
    { id: "database", label: "Database" },
    { id: "image", label: "Docker Image" },
    { id: "empty", label: "Empty Service", description: "Create an empty Compose stack." },
  ], permissions);
}

/** Restart uses the same Stop/Start actions as the lifecycle controls. */
export async function runLifecycleAction(action: Action | "restart", run: (action: Action) => Promise<ActionResult>): Promise<ActionResult> {
  if (action !== "restart") return run(action);
  const stopped = await run("stop");
  return stopped.ok ? run("start") : stopped;
}

export function destroyConfirmation(name: string): string {
  return `Destroy "${name}"? This cannot be undone.`;
}

export function isContextMenuKey(key: string, shiftKey: boolean): boolean {
  return key === "ContextMenu" || (key === "F10" && shiftKey);
}

export function prefersNativeContextMenu({ editable, selection, nativeTarget }: { editable: boolean; selection: boolean; nativeTarget: boolean }): boolean {
  return editable || selection || nativeTarget;
}

export type MenuKeyResult =
  | { type: "focus" | "activate" | "open-submenu"; index: number }
  | { type: "close" | "close-submenu" | "none" };

/** Disabled items remain discoverable with arrows, but cannot be activated. */
export function menuKeyResult(key: string, index: number, items: MenuItem[], submenu = false): MenuKeyResult {
  if (submenu && (key === "ArrowLeft" || key === "Escape")) return { type: "close-submenu" };
  if (key === "Escape" || key === "Tab") return { type: "close" };
  if (!items.length) return { type: "none" };
  if (key === "ArrowDown") return { type: "focus", index: (index + 1) % items.length };
  if (key === "ArrowUp") return { type: "focus", index: (index <= 0 ? items.length : index) - 1 };
  if (key === "Home") return { type: "focus", index: 0 };
  if (key === "End") return { type: "focus", index: items.length - 1 };
  const item = items[index];
  if (item && !item.disabledReason) {
    if ((key === "ArrowRight" || key === "Enter" || key === " ") && item.children?.length) return { type: "open-submenu", index };
    if (key === "Enter" || key === " ") return { type: "activate", index };
  }
  return { type: "none" };
}

export function shouldCloseMenu(type: "pointerdown" | "focusin" | "scroll" | "wheel" | "blur" | "resize", insideMenu: boolean): boolean {
  return type === "blur" || type === "resize" || !insideMenu;
}

/** Ignore transient focus restoration while an overlay re-arms; null means unmounted. */
export function dismissAfterMenuFocusSettles(insideMenu: () => boolean | null, dismiss: () => void) {
  queueMicrotask(() => {
    const inside = insideMenu();
    if (inside !== null && shouldCloseMenu("focusin", inside)) dismiss();
  });
}

export function menuPosition(point: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  return {
    x: Math.max(8, Math.min(point.x, viewport.width - size.width - 8)),
    y: Math.max(8, Math.min(point.y, viewport.height - size.height - 8)),
  };
}

export function submenuPosition(anchor: { left: number; right: number; top: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const x = anchor.right + size.width + 4 <= viewport.width - 8 ? anchor.right + 4 : anchor.left - size.width - 4;
  return menuPosition({ x, y: anchor.top }, size, viewport);
}

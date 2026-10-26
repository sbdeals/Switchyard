import type { Action, Service } from "@/lib/dokploy";
import type { ContextMenuItem } from "@/components/ContextMenu";
import { destroyConfirmation, serviceMenuItems, servicePublicUrl, type MenuItem, type ServiceMenuAction } from "@/lib/context-menu";

export type ServiceSection = "overview" | "logs" | "settings" | "variables" | "metrics" | "build" | "domains" | "deploy" | "editor" | "volumes" | "backups";
export type ServiceActions = Record<Exclude<ServiceMenuAction, "config">, () => void | Promise<void>>;

/** Context menus and the palette use the same handlers and capability checks. */
export function bindServiceActions(service: Service | null, {
  onOpen, run, openUrl, copyUrl, confirm,
}: {
  onOpen: (section?: ServiceSection) => void;
  run: (action: Action | "restart") => void;
  openUrl: (url: string) => void;
  copyUrl: (url: string) => Promise<void>;
  confirm: (message: string) => boolean;
}, pending = false): { items: ContextMenuItem[]; actions: ServiceActions } {
  const open = (section: ServiceSection) => { if (service) onOpen(section); };
  const url = service ? servicePublicUrl(service) : null;
  const actions: ServiceActions = {
    source: () => open("build"),
    networking: () => open("domains"),
    "deploy-settings": () => open("deploy"),
    compose: () => open("editor"),
    volumes: () => open("volumes"),
    backups: () => open("backups"),
    variables: () => open("variables"),
    metrics: () => open("metrics"),
    open: () => open("overview"),
    deploy: () => run("deploy"),
    restart: () => run("restart"),
    stop: () => run("stop"),
    logs: () => open("logs"),
    "open-url": () => { if (url) openUrl(url); },
    "copy-url": () => { if (url) return copyUrl(url); },
    settings: () => open("settings"),
    delete: () => {
      if (service && confirm(destroyConfirmation(service.name))) run("remove");
    },
  };
  const bind = (item: MenuItem<ServiceMenuAction>): ContextMenuItem => ({
    ...item,
    onSelect: item.id === "config" ? undefined : actions[item.id],
    children: item.children?.map(bind),
  });
  return { items: service ? serviceMenuItems(service, { pending }).map(bind) : [], actions };
}

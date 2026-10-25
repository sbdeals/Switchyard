"use client";

import type { Service } from "@/lib/dokploy";
import { ContextMenu, type ContextMenuItem, type ContextMenuTriggerProps } from "@/components/ContextMenu";
import { useServiceLifecycle } from "@/components/service/primitives";
import { destroyConfirmation, serviceMenuItems, servicePublicUrl, type MenuItem, type ServiceMenuAction } from "@/lib/context-menu";

export type ServiceSection = "overview" | "logs" | "settings" | "variables" | "metrics" | "build" | "domains" | "deploy" | "editor" | "volumes" | "backups";

/** Both service surfaces share dispatch, pending state, errors and confirmation. */
export function ServiceContextMenu({ service, onOpen, onSelect, children }: {
  service: Service;
  onOpen: (section?: ServiceSection) => void;
  onSelect: () => void;
  children: (props: ContextMenuTriggerProps, deploy: () => void, pending: boolean, error: string | null) => React.ReactNode;
}) {
  const { pending, error, run } = useServiceLifecycle(service);
  const actions: Record<Exclude<ServiceMenuAction, "config">, () => void | Promise<void>> = {
    source: () => onOpen("build"),
    networking: () => onOpen("domains"),
    "deploy-settings": () => onOpen("deploy"),
    compose: () => onOpen("editor"),
    volumes: () => onOpen("volumes"),
    backups: () => onOpen("backups"),
    variables: () => onOpen("variables"),
    metrics: () => onOpen("metrics"),
    open: () => onOpen("overview"),
    deploy: () => run("deploy"),
    restart: () => run("restart"),
    stop: () => run("stop"),
    logs: () => onOpen("logs"),
    "open-url": () => { window.open(servicePublicUrl(service)!, "_blank", "noopener,noreferrer"); },
    "copy-url": () => navigator.clipboard.writeText(servicePublicUrl(service)!),
    settings: () => onOpen("settings"),
    delete: () => {
      if (confirm(destroyConfirmation(service.name))) run("remove");
    },
  };
  const bind = (item: MenuItem<ServiceMenuAction>): ContextMenuItem => ({
    ...item,
    onSelect: item.id === "config" ? undefined : actions[item.id],
    children: item.children?.map(bind),
  });
  const items = serviceMenuItems(service, { pending }).map(bind);
  return (
    <ContextMenu label={`${service.name} actions`} items={items} onBeforeOpen={onSelect}>
      {(props) => children(props, actions.deploy, pending, error)}
    </ContextMenu>
  );
}

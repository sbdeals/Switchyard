"use client";

import type { Service } from "@/lib/dokploy";
import { ContextMenu, type ContextMenuTriggerProps } from "@/components/ContextMenu";
import { useServiceLifecycle } from "@/components/service/primitives";
import { bindServiceActions, type ServiceSection } from "@/lib/service-actions";

export type { ServiceSection } from "@/lib/service-actions";

/** Keep lifecycle state mounted while menus and the palette open and close. */
export function useServiceActions(service: Service | null, onOpen: (section?: ServiceSection) => void) {
  const { pending, error, run } = useServiceLifecycle(service);
  const { items, actions } = bindServiceActions(service, {
    onOpen,
    run,
    openUrl: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
    copyUrl: (url) => navigator.clipboard.writeText(url),
    confirm: (message) => window.confirm(message),
  }, pending);
  return { items, actions, pending, error };
}

/** Both service surfaces share dispatch, pending state, errors and confirmation. */
export function ServiceContextMenu({ service, onOpen, onSelect, children }: {
  service: Service;
  onOpen: (section?: ServiceSection) => void;
  onSelect: () => void;
  children: (props: ContextMenuTriggerProps, deploy: () => void, pending: boolean, error: string | null) => React.ReactNode;
}) {
  const { items, actions, pending, error } = useServiceActions(service, onOpen);
  return (
    <ContextMenu label={`${service.name} actions`} items={items} onBeforeOpen={onSelect}>
      {(props) => children(props, actions.deploy, pending, error)}
    </ContextMenu>
  );
}

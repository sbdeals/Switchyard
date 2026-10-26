"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ArrowUpRight, Command, Loader2, Search } from "lucide-react";
import type { ProjectNode, Service } from "@/lib/dokploy";
import type { NewServiceKind } from "@/lib/context-menu";
import { buildCommandRegistry, filterCommands, isPaletteShortcut, paletteKeyResult, recordRecentCommand, type PaletteCommand } from "@/lib/command-palette";
import { useServiceActions, type ServiceSection } from "@/components/service/ServiceContextMenu";
import { useDialogFocus } from "@/components/use-focus-trap";
import { cn } from "@/lib/utils";

export function CommandPalette({ services, projects, focusedService, onOpenService, onOpenProject, onCreate }: {
  services: Service[];
  projects: ProjectNode[];
  focusedService: Service | null;
  onOpenService: (service: Service, section?: ServiceSection) => void;
  onOpenProject: (projectId?: string) => void;
  onCreate: (kind?: NewServiceKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);
  const { items, pending, error } = useServiceActions(focusedService, (section) => {
    if (focusedService) onOpenService(focusedService, section);
  });
  const commands = buildCommandRegistry({ services, projects, focusedService, serviceItems: items, onOpenService, onOpenProject, onCreate });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen((current) => !current);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  function execute(command: PaletteCommand) {
    if (command.disabledReason) return;
    // Restore the opener before a command opens another dialog or confirmation.
    flushSync(() => setOpen(false));
    setCommandError(null);
    setRecentIds((ids) => recordRecentCommand(ids, command.id));
    try {
      const result = command.run();
      if (result) void result.catch(() => setCommandError(`Could not ${command.label.toLowerCase()}. Please try again.`));
    } catch {
      setCommandError(`Could not ${command.label.toLowerCase()}. Please try again.`);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+k Control+k"
        title="Search commands (⌘K / Ctrl+K)"
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
        Commands <kbd className="text-[10px] text-[var(--color-fg-subtle)]">⌘K / Ctrl+K</kbd>
      </button>
      {(error || commandError) && <p role="alert" className="fixed bottom-4 left-4 z-[80] max-w-md rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-4 py-3 text-sm text-[var(--color-danger)] shadow-xl">{error || commandError}</p>}
      {open && createPortal(
        <PaletteDialog commands={commands} recentIds={recentIds} serviceName={focusedService?.name} onExecute={execute} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}

function PaletteDialog({ commands, recentIds, serviceName, onExecute, onClose }: {
  commands: PaletteCommand[];
  recentIds: string[];
  serviceName?: string;
  onExecute: (command: PaletteCommand) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const panelRef = useDialogFocus<HTMLDivElement>(onClose);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const results = filterCommands(commands, query, recentIds);
  const activeIndex = Math.max(0, results.findIndex((command) => command.id === activeId));
  const active = results[activeIndex];

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active?.id]);

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="flex max-h-[76vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <Search className="size-5 shrink-0 text-[var(--color-fg-subtle)]" />
          <input
            data-autofocus
            role="combobox"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={active ? `${id}-option-${activeIndex}` : undefined}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveId(null); }}
            onKeyDown={(event) => {
              const result = paletteKeyResult({ ...event, isComposing: event.nativeEvent.isComposing }, activeIndex, results);
              if (result.type === "none") return;
              event.preventDefault();
              event.stopPropagation();
              if (result.type === "close") onClose();
              else if (result.type === "focus") setActiveId(results[result.index].id);
              else onExecute(results[result.index]);
            }}
            placeholder="Search projects, services and commands…"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)]"
          />
          <button type="button" onClick={onClose} aria-label="Close command palette" className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]">Esc</button>
        </div>
        <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Commands" className="min-h-24 overflow-y-auto p-2">
          {[...new Set(results.map((command) => command.section))].map((section) => {
            const entries = results.map((command, index) => ({ command, index })).filter(({ command }) => command.section === section);
            if (!entries.length) return null;
            return (
              <div key={section} role="group" aria-labelledby={`${id}-${section}`}>
                <div id={`${id}-${section}`} className="truncate px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  {section}{section === "Actions" && serviceName ? ` · ${serviceName}` : ""}
                </div>
                {entries.map(({ command, index }) => (
                  <div
                    key={command.id}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    aria-disabled={!!command.disabledReason}
                    onPointerMove={() => setActiveId(command.id)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onExecute(command)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                      index === activeIndex && "bg-[var(--color-surface-hover)]",
                      command.disabledReason ? "cursor-not-allowed opacity-50" : command.destructive ? "text-[var(--color-danger)]" : "text-[var(--color-fg)]",
                    )}
                  >
                    {section === "Create" ? <Command className="size-4 shrink-0 text-[var(--color-fg-subtle)]" /> : <ArrowUpRight className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{command.label}</div>
                      {(command.disabledReason || command.description) && <div className="mt-0.5 truncate text-xs text-[var(--color-fg-subtle)]">{command.disabledReason || command.description}</div>}
                    </div>
                    <kbd aria-label="Enter" className="text-xs text-[var(--color-fg-subtle)]">↵</kbd>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {!results.length && <p role="status" className="px-5 pb-6 text-center text-sm text-[var(--color-fg-muted)]">No commands found.</p>}
        <div className="flex items-center gap-4 border-t border-[var(--color-border)] px-4 py-2.5 text-[10px] text-[var(--color-fg-subtle)]">
          <span><kbd>↑ ↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Select</span>
          <span><kbd>Esc</kbd> Close</span>
          {!serviceName && <span className="ml-auto">Select a service for actions</span>}
        </div>
      </div>
    </div>
  );
}

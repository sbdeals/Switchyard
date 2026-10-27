"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { parseImageRef, withImageTag, type ImageTag } from "@/lib/image-ref";
import { imageTagOptions, nextTagIndex } from "@/lib/image-tag-picker";
import { Field, inputCls } from "@/components/service/primitives";
import { cn } from "@/lib/utils";

export function ImageTagPicker({ image, currentImage, onChange }: {
  image: string;
  currentImage: string;
  onChange: (image: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<{ repository: string; tags: ImageTag[]; available: boolean } | null>(null);
  const ref = parseImageRef(image);
  const repository = ref ? `${ref.registry}/${ref.namespace}/${ref.repository}` : "";
  const loaded = result?.repository === repository;
  const available = loaded && result.available;
  const options = available ? imageTagOptions(image, currentImage, result.tags, search) : [];
  const activeId = open && options[active] ? `${id}-tag-${active}` : undefined;

  useEffect(() => {
    if (!repository) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/images/tags?image=${encodeURIComponent(repository)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Tags unavailable");
        const data: { tags: ImageTag[]; available: boolean } = await response.json();
        if (!controller.signal.aborted) setResult({ repository, ...data });
      } catch {
        if (!controller.signal.aborted) setResult({ repository, tags: [], available: false });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [repository]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  useEffect(() => {
    if (!open) return;
    // The drawer traps Escape at document capture. Close suggestions before
    // that handler sees the key, so the first Escape keeps the editor open.
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.target !== input.current) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [open]);

  function choose(tag: string) {
    const next = withImageTag(image, tag);
    if (next) onChange(next);
    setOpen(false);
    setSearch(false);
    setActive(-1);
  }

  const status = !repository || (loaded && !available)
    ? "Tags unavailable. You can still enter any image reference."
    : !loaded ? "Loading recent tags…"
    : options.length ? "Recent public Docker Hub tags. Type repo:tag to search."
    : "No matching recent tags. You can still enter any tag.";

  return (
    <div onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
    }}>
      <Field label="Image" hint="Applies on next deploy">
        <div className="relative">
          <input
            ref={input}
            id={`${id}-input`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? `${id}-tags` : undefined}
            aria-activedescendant={activeId}
            aria-describedby={`${id}-status`}
            autoComplete="off"
            spellCheck={false}
            value={image}
            onFocus={() => { setOpen(true); setSearch(false); setActive(-1); }}
            onChange={(event) => { onChange(event.target.value); setSearch(true); setOpen(true); setActive(-1); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setActive(nextTagIndex(event.key, open ? active : -1, options.length));
              } else if (event.key === "Enter" && open && options[active]) {
                event.preventDefault();
                choose(options[active].name);
              } else if (event.key === "Tab") {
                setOpen(false);
                setActive(-1);
              }
            }}
            placeholder="nginx:alpine"
            className={cn(inputCls, "min-h-11 pr-11")}
          />
          <button
            type="button"
            aria-label="Show recent image tags"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { input.current?.focus(); setOpen(true); setSearch(false); setActive(-1); }}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      </Field>
      <p id={`${id}-status`} role="status" className="mt-1.5 text-xs text-[var(--color-fg-subtle)]">{status}</p>
      {open && (
        <ul
          id={`${id}-tags`}
          role="listbox"
          aria-label="Recent image tags"
          aria-busy={Boolean(repository) && !loaded}
          className={cn("mt-2 max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]", !options.length && "hidden")}
        >
          {options.map((tag, index) => (
            <li
              key={tag.name}
              id={`${id}-tag-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(tag.name)}
              className={cn("flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)]", index === active && "bg-[var(--color-surface-hover)]")}
            >
              <span className="min-w-0 break-all font-mono">{tag.name}{tag.current && <span className="ml-2 font-sans text-xs text-[var(--color-brand)]">Current</span>}</span>
              {tag.lastPushed && <time dateTime={tag.lastPushed} title={tag.lastPushed} className="text-xs text-[var(--color-fg-subtle)]">Pushed {new Date(tag.lastPushed).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</time>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

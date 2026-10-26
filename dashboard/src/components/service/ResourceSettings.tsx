"use client";

import { useState, useTransition } from "react";
import type { Application, Database } from "@/lib/dokploy";
import { updateResourcesAction } from "@/app/actions";
import {
  parseResources,
  RESOURCE_PRESETS,
  resourceInputs,
  resourcePreset,
  type ResourceInputs,
} from "@/lib/resource-limits";
import {
  Field,
  inputCls,
  SaveRow,
  useSavedFlash,
} from "@/components/service/primitives";

export function ResourceSettings({ service }: { service: Application | Database }) {
  const [input, setInput] = useState(() => resourceInputs(service));
  const [custom, setCustom] = useState(false);
  const [saving, startSave] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const current = resourceInputs(service);
  const dirty = (Object.keys(input) as (keyof ResourceInputs)[]).some(
    (field) => input[field] !== current[field]
  );

  function edit(field: keyof ResourceInputs, value: string) {
    setInput((previous) => ({ ...previous, [field]: value }));
    setCustom(true);
    setError(null);
  }

  function save() {
    setError(null);
    try {
      parseResources(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid resource settings.");
      return;
    }
    startSave(async () => {
      const res = await updateResourcesAction(
        service.kind === "application" ? "application" : service.engine,
        service.id,
        input
      );
      if (res.ok) {
        setInput(resourceInputs(parseResources(input)));
        setCustom(false);
        flashSaved();
      } else setError(res.error);
    });
  }

  return (
    <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
      <h3 className="text-sm font-semibold">Resources</h3>
      <fieldset aria-label="Resources" disabled={saving} className="space-y-3">
        <Field label="Resource preset">
          <select
            value={custom ? "Custom" : resourcePreset(input)}
            onChange={(e) => {
              const preset = e.target.value as keyof typeof RESOURCE_PRESETS | "Custom";
              setCustom(preset === "Custom");
              if (preset !== "Custom") setInput({ ...RESOURCE_PRESETS[preset] });
              setError(null);
            }}
            className={inputCls}
          >
            <option value="Small">Small — 0.5 CPU / 512 MiB</option>
            <option value="Medium">Medium — 1 CPU / 1 GiB</option>
            <option value="Large">Large — 2 CPU / 2 GiB</option>
            <option value="Custom">Custom</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPU limit (cores)">
            <input
              value={input.cpuLimit}
              onChange={(e) => edit("cpuLimit", e.target.value)}
              inputMode="decimal"
              placeholder="unlimited"
              className={inputCls}
            />
          </Field>
          <Field label="Memory limit (MiB/GiB)">
            <input
              value={input.memoryLimit}
              onChange={(e) => edit("memoryLimit", e.target.value)}
              placeholder="unlimited"
              className={inputCls}
            />
          </Field>
          <Field label="CPU reservation (cores)">
            <input
              value={input.cpuReservation}
              onChange={(e) => edit("cpuReservation", e.target.value)}
              inputMode="decimal"
              placeholder="none"
              className={inputCls}
            />
          </Field>
          <Field label="Memory reservation (MiB/GiB)">
            <input
              value={input.memoryReservation}
              onChange={(e) => edit("memoryReservation", e.target.value)}
              placeholder="none"
              className={inputCls}
            />
          </Field>
        </div>
      </fieldset>
      <p className="text-xs text-[var(--color-fg-subtle)]">
        Leave a field blank to unset it. Memory accepts 512 MiB or 1 GiB; numbers without a unit
        use MiB. Reservations must not exceed limits. Presets leave reservations unset.
      </p>
      <p className="text-xs text-[var(--color-fg-muted)]">
        Dokploy cannot deploy native applications or databases on a bridge (non-Swarm) host.
        These limits take effect on the next deploy on a Swarm host. Saving does not deploy.
      </p>
      <SaveRow
        saving={saving}
        saved={saved}
        error={error}
        disabled={!dirty}
        onSave={save}
        label="Save resources"
      />
    </section>
  );
}

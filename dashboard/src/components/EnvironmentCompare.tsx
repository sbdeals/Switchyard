"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Eye, EyeOff, GitCompareArrows, Loader2 } from "lucide-react";
import {
  compareEnvironmentsAction,
  revealEnvironmentVariableAction,
} from "@/app/environment-compare-actions";
import type { ProjectNode } from "@/lib/dokploy";
import type { ComparisonServiceMetadata, ServiceComparison, VariableComparison } from "@/lib/environment-compare";

const fields: { key: ServiceComparison["differences"][number]; label: string }[] = [
  { key: "kind", label: "Service type" },
  { key: "image", label: "Image" },
  { key: "source", label: "Source" },
  { key: "branch", label: "Branch" },
  { key: "buildType", label: "Build type" },
  { key: "replicas", label: "Replicas" },
  { key: "domainsCount", label: "Domains" },
];

const statusLabels = {
  "only-a": "Only in A",
  "only-b": "Only in B",
  changed: "Different",
  identical: "Identical",
};

export function EnvironmentCompare({ project, onBack }: { project: ProjectNode; onBack: () => void }) {
  const [aId, setAId] = useState(project.environments[0].environmentId);
  const [bId, setBId] = useState(project.environments[1].environmentId);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { backRef.current?.focus(); }, []);

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
      <button
        ref={backRef}
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-md text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      >
        <ArrowLeft className="size-3.5" /> Back to projects
      </button>
      <div>
        <h3 className="text-sm font-semibold">{project.name}</h3>
        <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
          Read-only comparison. Services match by name. Variable changes are shown from A to B.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ["A", aId, bId, setAId],
          ["B", bId, aId, setBId],
        ] as const).map(([label, value, other, setValue]) => (
          <label key={label} className="space-y-1.5 text-xs text-[var(--color-fg-muted)]">
            <span>Environment {label}</span>
            <select
              value={value}
              onChange={(event) => {
                if (event.target.value === other) {
                  if (label === "A") setBId(value);
                  else setAId(value);
                }
                setValue(event.target.value);
              }}
              className="block w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
            >
              {project.environments.map((environment) => (
                <option key={environment.environmentId} value={environment.environmentId}>
                  {environment.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <PairComparison
        key={`${aId}:${bId}`}
        projectId={project.projectId}
        aId={aId}
        bId={bId}
        aName={project.environments.find((environment) => environment.environmentId === aId)?.name ?? "A"}
        bName={project.environments.find((environment) => environment.environmentId === bId)?.name ?? "B"}
      />
    </div>
  );
}

function PairComparison({ projectId, aId, bId, aName, bName }: {
  projectId: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ServiceComparison[] | null>(null);

  function compare() {
    setRows(null);
    setError(null);
    start(async () => {
      try {
        const result = await compareEnvironmentsAction(projectId, aId, bId);
        if (result.ok) setRows(result.rows);
        else setError(result.error);
      } catch {
        setError("Could not compare environments. Try again.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={compare}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <GitCompareArrows className="size-4" />}
          {pending ? "Comparing…" : "Compare"}
        </button>
        <span className="text-xs text-[var(--color-fg-subtle)]">Variable values stay masked until you reveal a row.</span>
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      <div aria-live="polite">
        {rows && (
          <p className="text-xs text-[var(--color-fg-muted)]">
            {rows.length === 0 ? "Both environments are empty." : rows.every((row) => row.status === "identical")
              ? "These environments are identical."
              : `${rows.filter((row) => row.status === "only-a").length} only in A · ${rows.filter((row) => row.status === "only-b").length} only in B · ${rows.filter((row) => row.status === "changed").length} different · ${rows.filter((row) => row.status === "identical").length} identical`}
          </p>
        )}
      </div>
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
          <table className="w-full min-w-[680px] table-fixed text-left text-xs">
            <caption className="sr-only">Service comparison: {aName} and {bName}</caption>
            <thead className="bg-[var(--color-surface)] text-[var(--color-fg-muted)]">
              <tr>
                <th scope="col" className="w-[18%] px-3 py-3 font-medium">Service</th>
                <th scope="col" className="w-[24%] px-3 py-3 font-medium">A · {aName}</th>
                <th scope="col" className="w-[24%] px-3 py-3 font-medium">B · {bName}</th>
                <th scope="col" className="w-[34%] px-3 py-3 font-medium">Variables · A → B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-[var(--color-border)] align-top">
                  <th scope="row" className="break-words px-3 py-4 font-medium">
                    {row.name}
                    <span className={`mt-2 block text-[10px] font-normal ${row.status === "identical" ? "text-[var(--color-fg-subtle)]" : "text-[var(--color-brand)]"}`}>
                      {statusLabels[row.status]}
                    </span>
                  </th>
                  <td className="px-3 py-4"><Metadata metadata={row.a} differences={row.differences} /></td>
                  <td className="px-3 py-4"><Metadata metadata={row.b} differences={row.differences} /></td>
                  <td className="px-3 py-4">
                    {row.variables.length === 0 ? <span className="text-[var(--color-fg-subtle)]">No variables</span> : (
                      <ul className="space-y-3">
                        {row.variables.map((variable) => (
                          <VariableRow key={variable.key} projectId={projectId} aId={aId} bId={bId} serviceName={row.name} variable={variable} />
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metadata({ metadata, differences }: { metadata: ComparisonServiceMetadata | null; differences: ServiceComparison["differences"] }) {
  if (!metadata) return <span className="text-[var(--color-fg-subtle)]">Service absent</span>;
  return (
    <dl className="space-y-2">
      {fields.map(({ key, label }) => (
        <div key={key} className={differences.includes(key) ? "rounded bg-[var(--color-brand)]/10 px-1.5 py-1" : "px-1.5"}>
          <dt className="text-[10px] text-[var(--color-fg-subtle)]">{label}{differences.includes(key) && <span className="sr-only"> differs</span>}</dt>
          <dd className="whitespace-pre-wrap break-words text-[var(--color-fg-muted)]">{metadata[key] ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function VariableRow({ projectId, aId, bId, serviceName, variable }: {
  projectId: string;
  aId: string;
  bId: string;
  serviceName: string;
  variable: VariableComparison;
}) {
  const [values, setValues] = useState<{ a: string | null; b: string | null } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    if (values) {
      setValues(null);
      return;
    }
    start(async () => {
      try {
        const result = await revealEnvironmentVariableAction(projectId, aId, bId, serviceName, variable.key);
        if (result.ok) setValues({ a: result.a, b: result.b });
        else setError(result.error);
      } catch {
        setError("Could not reveal this variable. Try again.");
      }
    });
  }

  return (
    <li className="rounded-lg border border-[var(--color-border)] p-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <code className="break-all text-[11px]">{variable.key}</code>
        <span className="text-[10px] text-[var(--color-fg-subtle)]">{variable.status}</span>
      </div>
      <div className="mt-2 space-y-1 font-mono text-[10px] text-[var(--color-fg-muted)]">
        {(["a", "b"] as const).map((side) => (
          <div key={side} className="flex gap-2">
            <span className="text-[var(--color-fg-subtle)]">{side.toUpperCase()}</span>
            <span className="min-w-0 whitespace-pre-wrap break-all">{values
              ? values[side] === null ? "Absent" : values[side] === "" ? "(empty)" : values[side]
              : (side === "a" && variable.status === "added") || (side === "b" && variable.status === "removed") ? "Absent" : "••••••••"}</span>
          </div>
        ))}
      </div>
      <button
        onClick={toggle}
        disabled={pending}
        aria-label={`${values ? "Hide" : "Reveal"} ${variable.key} values for ${serviceName}`}
        aria-expanded={values !== null}
        className="mt-2 inline-flex items-center gap-1 rounded text-[10px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-40"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : values ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        {pending ? "Revealing…" : values ? "Hide values" : "Reveal values"}
      </button>
      {error && <p role="alert" className="mt-1 text-[10px] text-[var(--color-danger)]">{error}</p>}
    </li>
  );
}

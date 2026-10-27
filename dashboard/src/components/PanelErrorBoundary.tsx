"use client";

import { Component, type HTMLAttributes } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

export class PanelErrorBoundary extends Component<
  HTMLAttributes<HTMLDivElement>,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const { children, ...props } = this.props;

    return (
      <div {...props}>
        {this.state.failed ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-6 py-10 text-center"
          >
            <TriangleAlert className="size-5 text-[var(--color-fg-muted)]" aria-hidden />
            <p className="text-sm font-medium">This panel failed to load</p>
            <button
              type="button"
              onClick={() => this.setState({ failed: false })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            >
              <RefreshCw className="size-3.5" aria-hidden /> Retry
            </button>
          </div>
        ) : children}
      </div>
    );
  }
}

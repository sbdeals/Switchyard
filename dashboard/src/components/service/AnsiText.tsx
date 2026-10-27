"use client";

import { memo, useMemo } from "react";
import { parseAnsi, type ParsedAnsi } from "@/lib/ansi";

/** Runtime lines are parsed on arrival; completed console output is parsed once. */
export const AnsiText = memo(function AnsiText({ value }: { value: string | ParsedAnsi }) {
  const parsed = useMemo(() => typeof value === "string" ? parseAnsi(value) : value, [value]);
  return parsed.spans.map((span, i) => (
    <span key={i} style={span.style}>{span.text}</span>
  ));
});

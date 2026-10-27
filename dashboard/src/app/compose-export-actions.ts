"use server";

import { unstable_rethrow } from "next/navigation";
import { loadComposeExportData } from "../lib/compose-export-data";
import type { ComposeExportInput } from "../lib/compose-export";

type ExportResult = { ok: true; data: ComposeExportInput } | { ok: false; error: string };

export async function loadComposeExportAction(id: string, includeValues = false): Promise<ExportResult> {
  try {
    return { ok: true, data: await loadComposeExportData(id, includeValues) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: "Could not export this application. Please try again." };
  }
}

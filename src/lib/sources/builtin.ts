/**
 * The adapters that ship with Loot.
 *
 * Importing this module registers them. Adding your own means calling
 * `registerFileSource` before this runs, or editing the list below — see
 * `docs/extending.md`.
 */
import { parseCsvStatement } from "@/lib/parse/csv";
import { parseDocumentStatement } from "@/lib/parse/pdf";
import { detectSourceKind } from "@/lib/parse/types";
import { hasLlm, hasPlaid } from "@/lib/env";
import { registerFileSource, registerSyncSource } from "./index";

registerFileSource({
  id: "csv",
  label: "CSV export",
  accepts: ({ mimeType, filename }) =>
    detectSourceKind(mimeType, filename) === "csv",
  parse: ({ bytes, accountKind }) =>
    parseCsvStatement(new TextDecoder().decode(bytes), { accountKind }),
});

registerFileSource({
  id: "document",
  label: "PDF or image statement",
  accepts: ({ mimeType, filename }) => {
    const kind = detectSourceKind(mimeType, filename);
    return kind === "pdf" || kind === "image";
  },
  parse: async ({ bytes, mimeType, filename }) => {
    const kind = detectSourceKind(mimeType, filename);
    if (kind !== "pdf" && kind !== "image") {
      throw new Error("Not a document statement.");
    }
    if (!hasLlm) {
      throw new Error(
        "Reading PDF and image statements needs a model. Set AI_API_KEY, or upload a CSV export instead.",
      );
    }
    return parseDocumentStatement({ bytes, mimeType, kind });
  },
});

/*
 * Plaid is registered lazily: importing the sync module pulls in the Plaid SDK
 * and the database, which a deployment without bank syncing has no reason to
 * load.
 */
registerSyncSource({
  id: "plaid",
  label: "Plaid",
  isConfigured: () => hasPlaid,
  sync: async (connectionId) => {
    const { syncItem } = await import("@/lib/plaid/sync");
    const report = await syncItem(connectionId);
    return {
      added: report.added,
      updated: report.updated,
      removed: report.removed,
      alreadyCovered: report.alreadyCovered,
      duplicates: report.duplicates,
      ...(report.error ? { error: report.error } : {}),
    };
  },
});

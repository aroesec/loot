"use server";
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { FundError, saveFund, removeFund } from "@/lib/funds";
import { fundInput } from "@/lib/funds/logic";
import { z } from "zod";

export type FundState = { error?: string; message?: string };
export async function saveFundAction(_previous: FundState, form: FormData): Promise<FundState> {
  if (!(await isAuthenticated())) return { error: "Your session expired. Sign in and try again." };
  const id = String(form.get("id") ?? "") || undefined;
  try {
    if (form.get("intent") === "remove") {
      if (!z.uuid().safeParse(id).success || !id) return { error: "Choose a valid fund." };
      await removeFund(id);
    } else {
      const parsed = fundInput.safeParse({ id, name: form.get("name"), kind: form.get("kind"),
        fundingAccountId: form.get("fundingAccountId"),
        destinationAccountId: form.get("destinationAccountId") || null,
        patterns: String(form.get("patterns") ?? "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean),
      });
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fund details." };
      const result = await saveFund(parsed.data);
      revalidatePath("/", "layout");
      return { message: `Fund saved. Updated ${result.changed} transactions; manual classifications were kept.` };
    }
    revalidatePath("/", "layout");
    return { message: "Fund removed and automatic classifications refreshed." };
  } catch (error) {
    return { error: error instanceof FundError ? error.message : "Could not save the fund. Nothing was changed. Please try again." };
  }
}

"use server";
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { IncomePlanError, saveIncomePlan } from "@/lib/income";
import { incomePlanInput } from "@/lib/income/logic";
export type IncomeState = { error?: string; message?: string };
export async function saveIncomeAction(_previous: IncomeState, form: FormData): Promise<IncomeState> {
  if (!(await isAuthenticated())) return { error: "Your session expired. Sign in again." };
  const amount = String(form.get("amount") ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return { error: "Enter a paycheck amount with up to two decimal places." };
  const parsed = incomePlanInput.safeParse({ sourceId: form.get("sourceId"), name: form.get("name"), accountId: form.get("accountId"), pattern: form.get("pattern"), effectiveMonth: form.get("effectiveMonth"), amountCents: Math.round(Number(amount) * 100), paymentsPerMonth: Number(form.get("paymentsPerMonth")), enabled: form.get("enabled") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the income details." };
  try {
    await saveIncomePlan(parsed.data);
    revalidatePath("/", "layout");
    return { message: "Income plan saved. Matching deposits will automatically mark payments received." };
  } catch (error) {
    return { error: error instanceof IncomePlanError ? error.message : "Could not save this income plan. Please try again." };
  }
}

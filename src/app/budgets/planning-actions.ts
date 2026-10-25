"use server";
import { isAuthenticated } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  PlanningError,
  saveCategoryBudget,
  saveExpensePlan,
} from "@/lib/planning";
import { expensePlanInput } from "@/lib/planning/logic";
import { budgetInput } from "@/lib/planning";
export type PlanningState = { error?: string; message?: string };
function cents(form: FormData) {
  const amount = String(form.get("amount") ?? "");
  return /^\d+(\.\d{1,2})?$/.test(amount)
    ? Math.round(Number(amount) * 100)
    : NaN;
}
export async function budgetAction(
  _state: PlanningState,
  form: FormData,
): Promise<PlanningState> {
  if (!(await isAuthenticated()))
    return { error: "Your session expired. Sign in again." };
  const value = budgetInput.safeParse({
    categoryId: form.get("categoryId"),
    month: form.get("month"),
    amountCents: cents(form),
    rollover: form.get("rollover") ?? "none",
  });
  if (!value.success)
    return {
      error: "Enter a valid monthly budget, including cents if needed.",
    };
  try {
    await saveCategoryBudget(value.data);
    revalidatePath("/", "layout");
    return { message: "Budget saved." };
  } catch (error) {
    return {
      error:
        error instanceof PlanningError
          ? error.message
          : "Could not save the budget. Try again.",
    };
  }
}
export async function expenseAction(
  _state: PlanningState,
  form: FormData,
): Promise<PlanningState> {
  if (!(await isAuthenticated()))
    return { error: "Your session expired. Sign in again." };
  const value = expensePlanInput.safeParse({
    accountId: form.get("accountId"),
    categoryId: form.get("categoryId"),
    merchant: form.get("merchant"),
    name: form.get("name"),
    effectiveMonth: form.get("month"),
    amountCents: cents(form),
    enabled: form.get("intent") !== "dismiss",
  });
  if (!value.success)
    return { error: "Enter a name and a positive monthly amount." };
  try {
    await saveExpensePlan(value.data);
    revalidatePath("/", "layout");
    return {
      message: value.data.enabled
        ? "Monthly bill approved."
        : "Bill excluded from the forecast.",
    };
  } catch (error) {
    return {
      error:
        error instanceof PlanningError
          ? error.message
          : "Could not save this bill. Try again.",
    };
  }
}

export async function populateAction(
  _state: PlanningState,
  form: FormData,
): Promise<PlanningState> {
  if (!(await isAuthenticated()))
    return { error: "Your session expired. Sign in again." };
  const { incomeMonth } = await import("@/lib/income/logic");
  const month = incomeMonth.safeParse(form.get("month"));
  if (!month.success) return { error: "Choose a valid month." };
  try {
    const { populateRecurringBudgets } = await import("@/lib/planning");
    const result = await populateRecurringBudgets(month.data);
    revalidatePath("/", "layout");
    return {
      message: `${result.approved} recurring bills included; ${result.created} category budgets created. Existing budgets preserved.`,
    };
  } catch {
    revalidatePath("/", "layout");
    return {
      error:
        "Some items could not be saved. Reload and retry; existing budgets will be preserved.",
    };
  }
}

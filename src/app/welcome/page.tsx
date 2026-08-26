import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { onboardingState } from "@/lib/onboarding";
import { ledgerMode, household } from "@/lib/mode";
import { PageHeader } from "@/components/ui";
import { OnboardingFlow } from "@/components/onboarding";
import { completeOnboardingAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * The first run.
 *
 * One question really matters here: personal or business. It decides which
 * chart of accounts the classifier uses, and a month spent in the wrong one is
 * a month of transactions filed against categories the reports never read.
 * Everything after it is a detail that can be changed later without
 * consequence, which is why the rest is skippable and this is not.
 */
export default async function WelcomePage() {
  await requireAuth();

  const state = await onboardingState();
  // Nothing to do here twice. Settings can re-open it.
  if (!state.needed) redirect("/");

  const [mode, home] = await Promise.all([ledgerMode(), household()]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Set up your ledger"
        subtitle="Two questions, then you can import a statement."
      />
      <OnboardingFlow
        initialMode={mode}
        initialHousehold={home}
        onComplete={completeOnboardingAction}
      />
    </div>
  );
}

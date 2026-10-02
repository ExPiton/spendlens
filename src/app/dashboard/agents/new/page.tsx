import Link from "next/link";
import { requireVerifiedUser } from "@/lib/auth/dal";
import { NewAgentForm } from "@/components/dashboard/NewAgentForm";

export const metadata = { title: "New agent" };

export default async function NewAgentPage() {
  await requireVerifiedUser();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="border-b border-border pb-6">
        <Link href="/dashboard/agents" className="text-xs text-muted hover:text-fg">
          ← Agents
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Register an agent</h1>
        <p className="mt-1 text-xs text-muted">
          Give it an id (used in the SDK and policy file) and a display name. It starts with a policy that only
          observes (generous budgets, alerts instead of blocks), so tighten it on the Policies screen before real
          money flows.
        </p>
      </div>
      <NewAgentForm />
    </div>
  );
}

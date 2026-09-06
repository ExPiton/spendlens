"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth/dal";
import {
  createAgent,
  deleteAgent,
  renameAgent,
  setAgentStatus,
} from "@/lib/db/agents";
import { createApiKey, revokeApiKey } from "@/lib/db/api-keys";
import { upsertPolicy } from "@/lib/db/policy";
import { seedDemoData, clearTenantData } from "@/lib/db/seed-demo";

export interface ActionState {
  ok?: boolean;
  error?: string;
  /** Populated by createApiKeyAction — the plaintext key, shown once. */
  secret?: string;
}

// ── agents ──────────────────────────────────────────────────────────────────

export async function createAgentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireVerifiedUser();
  const slug = String(formData.get("slug") ?? "");
  const label = String(formData.get("label") ?? "");
  try {
    const agent = await createAgent(user.id, { slug, label });
    revalidatePath("/dashboard", "layout");
    redirect(`/dashboard/agents/${agent.slug}`);
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    // redirect() throws a control-flow error; only real failures land here
    if (isRedirectError(err)) throw err;
    return { error: err instanceof Error ? err.message : "Could not create agent." };
  }
}

export async function setAgentStatusAction(formData: FormData): Promise<void> {
  const { user } = await requireVerifiedUser();
  const agentId = String(formData.get("agentId") ?? "");
  const status = formData.get("status") === "paused" ? "paused" : "active";
  await setAgentStatus(user.id, agentId, status);
  revalidatePath("/dashboard", "layout");
}

export async function renameAgentAction(formData: FormData): Promise<void> {
  const { user } = await requireVerifiedUser();
  await renameAgent(
    user.id,
    String(formData.get("agentId") ?? ""),
    String(formData.get("label") ?? ""),
  );
  revalidatePath("/dashboard", "layout");
}

export async function deleteAgentAction(formData: FormData): Promise<void> {
  const { user } = await requireVerifiedUser();
  await deleteAgent(user.id, String(formData.get("agentId") ?? ""));
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/agents");
}

// ── api keys ────────────────────────────────────────────────────────────────

export async function createApiKeyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireVerifiedUser();
  const agentId = String(formData.get("agentId") ?? "");
  const name = String(formData.get("name") ?? "");
  try {
    const { plaintext } = await createApiKey(user.id, agentId, name);
    revalidatePath("/dashboard/agents/[agentId]", "page");
    return { ok: true, secret: plaintext };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create key." };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const { user } = await requireVerifiedUser();
  await revokeApiKey(user.id, String(formData.get("keyId") ?? ""));
  revalidatePath("/dashboard/agents/[agentId]", "page");
}

// ── policy ──────────────────────────────────────────────────────────────────

export async function savePolicyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireVerifiedUser();
  const slug = String(formData.get("slug") ?? "");
  const raw = String(formData.get("raw") ?? "");
  try {
    await upsertPolicy(user.id, slug, raw);
    revalidatePath("/dashboard/policies");
    revalidatePath(`/dashboard/agents/${slug}`);
    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Policy is not valid.",
    };
  }
}

// ── demo data ───────────────────────────────────────────────────────────────

export async function seedDemoDataAction(): Promise<void> {
  const { user } = await requireVerifiedUser();
  await seedDemoData(user.id);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

export async function clearDataAction(): Promise<void> {
  const { user } = await requireVerifiedUser();
  await clearTenantData(user.id);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

// redirect() throws an internal error with this digest — re-throw it so the
// navigation actually happens instead of being swallowed as a form error.
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

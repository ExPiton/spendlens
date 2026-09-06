"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
      className={
        className ??
        "rounded-xs border border-border px-3 py-1 text-xs text-muted transition-slens hover:border-fg hover:text-fg"
      }
    >
      Sign out
    </button>
  );
}

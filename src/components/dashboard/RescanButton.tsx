"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RescanButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function rescan() {
    setBusy(true);
    try {
      await fetch("/api/reconciliation", { method: "POST" });
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={rescan}
      disabled={busy || pending}
      className="rounded-xs border border-border bg-surface-2 px-3 py-1.5 text-xs text-fg transition-slens hover:border-fg disabled:opacity-50"
    >
      {busy || pending ? "Rescanning…" : "⟳ Rescan Arc settlement"}
    </button>
  );
}

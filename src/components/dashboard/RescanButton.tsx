"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

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
    <Button type="button" variant="secondary" size="sm" onClick={rescan} disabled={busy || pending}>
      {busy || pending ? (
        "Rescanning…"
      ) : (
        <>
          <span aria-hidden="true">⟳</span> Rescan Arc settlement
        </>
      )}
    </Button>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="mx-auto w-full max-w-6xl px-6 py-6">
        <Link href="/" aria-label="Spendlens home" className="inline-flex">
          <Logo size={24} />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-20">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

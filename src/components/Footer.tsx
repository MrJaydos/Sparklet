"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The feed page owns its own full-bleed, non-document-scrolling layout
// (see AGENTS.md layout notes) — a footer appended after it would render
// below the viewport where nothing can scroll to reach it.
export function Footer() {
  const pathname = usePathname();
  if (pathname?.startsWith("/feed")) return null;

  return (
    <footer className="mt-auto px-6 py-6 text-center text-xs text-neutral-500">
      © {new Date().getFullYear()} Sparklet ·{" "}
      <Link href="/privacy" className="underline hover:text-neutral-300">
        Privacy Policy
      </Link>{" "}
      ·{" "}
      <Link href="/terms" className="underline hover:text-neutral-300">
        Terms of Service
      </Link>
    </footer>
  );
}

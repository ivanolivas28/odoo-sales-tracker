"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Tasks" },
  { href: "/dashboard", label: "Dashboard" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-[var(--border-hairline)] px-6 py-3 sm:px-10">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-[var(--series-blue)] text-white"
                : "text-[var(--ink-secondary)] hover:bg-[var(--grid-line)]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

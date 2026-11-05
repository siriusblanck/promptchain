"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [{ href: "/", label: "Collection" }, { href: "/chains/new", label: "New chain" }] as const;

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="container site-nav" aria-label="Main">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>
      ))}
    </nav>
  );
}

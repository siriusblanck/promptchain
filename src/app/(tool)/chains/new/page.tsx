import type { Metadata } from "next";
import Link from "next/link";
import { ChainForm } from "@/components/chain-form";
import { requireAdmin } from "@/lib/auth/require-admin";

export const metadata: Metadata = { title: "New chain" };

export default async function NewChainPage() {
  await requireAdmin();
  return (
    <section className="split">
      <div>
        <p className="crumb"><Link href="/">Collection</Link> / <strong>New chain</strong></p>
        <h1 className="display-2">New prompt chain</h1>
        <p className="lede">Name it here, then add and order its steps on the wall.</p>
      </div>
      <ChainForm mode="create" />
    </section>
  );
}

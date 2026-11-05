import { SiteHeader } from "@/components/site-header";
import { requireAdmin } from "@/lib/auth/require-admin";

export default async function ToolLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <SiteHeader />
      <main className="container page">{children}</main>
    </>
  );
}

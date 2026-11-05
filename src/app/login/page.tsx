import type { Metadata } from "next";
import { signOut } from "@/app/auth/actions";
import { SignInButton } from "@/components/sign-in-button";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  restricted: "That account isn't a superadmin. Ask a database operator to set profiles.is_superadmin, or switch accounts.",
  auth: "Google sign-in didn't finish. Please try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const { data: { user } } = await (await createClient()).auth.getUser();
  const notice = reason ? NOTICES[reason] : undefined;
  return (
    <main className="container login">
      <div className="login__bar"><ThemeSwitch /></div>
      <p className="wordmark wordmark--xl">MoPC</p>
      <h1 className="display-3">Museum of<br />Prompt Chains</h1>
      <p className="lede">A workshop for building, ordering and running the prompt chains behind Hog Wumbia.</p>
      <SignInButton />
      {user && (
        <form action={signOut} className="actions-row">
          <button className="link" type="submit">Switch accounts</button>
        </form>
      )}
      {notice && <p className="notice" role="alert">{notice}</p>}
    </main>
  );
}

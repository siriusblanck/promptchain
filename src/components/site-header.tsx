import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { SiteNav } from "./site-nav";
import { ThemeSwitch } from "./theme/theme-switch";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header__top">
        <Link href="/" className="wordmark" aria-label="MoPC, Museum of Prompt Chains: collection">MoPC</Link>
        <div className="site-header__tools">
          <ThemeSwitch />
          <form action={signOut}>
            <button type="submit" className="btn">Sign out</button>
          </form>
        </div>
      </div>
      <SiteNav />
    </header>
  );
}

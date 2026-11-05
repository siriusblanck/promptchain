# MoPC Prompt Chain Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build MoPC, a superadmin-only Next.js app that creates, edits, reorders and runs prompt chains stored in the shared Hog Wumbia Supabase DB, styled after moma.org, and deploy it to Vercel.

**Architecture:** Next.js 16 App Router with server components for reads and server actions for writes. Every action calls `requireAdmin()` before creating a service-role Supabase client. Chain runs execute one step per request (`startRun` once, then `advanceRun` per step) with state held in two new Postgres tables. Decisions live in pure modules (`order.ts`, `plan.ts`, `errors.ts`, `live-run.ts`, `media.ts`, `presentation.ts`), and IO lives in thin shells (`queries.ts`, `repository.ts`, `storage.ts`, `gemini.ts`, `actions.ts`).

**Tech Stack:** Next.js 16.4.2, React 19.2.8, TypeScript 5, `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.117.1, `@google/genai` 2.28.0, zod 4.6.5, next-themes 0.4.6, Vitest 4.1.11. Styling is plain CSS with CSS variables, as the sibling admin app does (no Tailwind).

**Spec:** `docs/superpowers/specs/2026-11-05-prompt-chain-tool-design.md`

## Global Constraints

- Supabase project ref `mtbtwriiqbsottfhwrma` is SHARED with two live apps. Changes go through one additive migration only. Never modify other apps' tables beyond the step-order constraint swap in Task 3.
- Every server action and every `(tool)` page starts with `await requireAdmin()` BEFORE `createAdminClient()` is called.
- `requireAdmin` admits only `user.app_metadata.provider === "google"` AND `profiles.is_superadmin === true`. Nothing is cached.
- Secrets (`SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`) are server-only and never printed, logged, or committed. `.env.example` holds names only.
- Parse external data with zod at the boundary (form data, RPC JSON, DB rows), using `z.guid()` for ids.
- Immutability: return new arrays and objects, never mutate params.
- Files stay ≤ 400 lines and functions ≤ 50 lines.
- Error messages shown to users are plain sentences. Server logs use `console.error("[area] …", { context })` without secrets.
- Tests are light by user request: Vitest on pure modules plus the gate tests. No Playwright.
- Dev server port 3002. Vercel team `raise-e9d2cfef`, project name `promptchain`.
- Visual tokens:
  - light: paper `#ffffff`, ink `#000000`, muted `#6b6b6b`, soft `#e9e9e9`, panel `#f2f2f2`
  - dark: `#0e0e0e`, `#f3f3f3`, `#a3a3a3`, `#2b2b2b`, `#1b1b1b`
  - accents: cyan `#12b5ea`, lime `#92c83e`, orange `#ff8b1f`, mint `#6cd9c3`, danger `#d62d20`
  - text on accent blocks is always `#000`
- Font: Libre Franklin (`next/font/google`). Display weight 900, letter-spacing −0.03em. Wordmark "MoPC".
- Wall: fixed media height 380px (240px under 640px). Photo cards take natural width (`aspect-ratio`, default 3/4). Text cards are 176px. The tile color cycle is cyan → lime → orange → mint.
- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`). No attribution trailer, per the user's git rules.

## File Structure

```
package.json, tsconfig.json, next.config.ts, eslint.config.mjs, vitest.config.mts, .env.example
supabase/migrations/20261105000000_prompt_chain_tool.sql   tables, constraint, RPCs, bucket, seed
supabase/checks/prompt_chain_tool_check.sql                rollback-only assertions
src/proxy.ts                                                session refresh
src/styles/{tokens,base,wall,pages}.css                     visual system
src/app/layout.tsx                                          fonts, ThemeProvider, CSS
src/app/login/page.tsx · src/app/auth/callback/route.ts · src/app/auth/actions.ts
src/app/(tool)/layout.tsx                                   gate + header
src/app/(tool)/page.tsx                                     collection
src/app/(tool)/chains/new/page.tsx
src/app/(tool)/chains/[id]/page.tsx                         workspace (maxDuration 120)
src/app/(tool)/chains/[id]/media/page.tsx
src/lib/action-result.ts                                    ActionResult / FormState
src/lib/supabase/{config,server,admin,client}.ts
src/lib/auth/{access,require-admin}.ts
src/lib/chains/types.ts · schemas.ts · order.ts · presentation.ts · card-view.ts   (pure)
src/lib/chains/queries.ts · repository.ts · actions.ts              (shell)
src/lib/runs/plan.ts · errors.ts · live-run.ts · media.ts           (pure)
src/lib/runs/gemini.ts · storage.ts · repository.ts · actions.ts · prepare-image.ts (shell)
src/components/sign-in-button.tsx · site-header.tsx · site-nav.tsx · chain-form.tsx · media-card.tsx
src/components/theme/{theme-provider,theme-switch}.tsx
src/components/workspace/{chain-workspace,chain-header,wall,step-card,step-editor,run-panel,use-chain-run}.tsx/.ts
tests/server-only.ts · tests/*.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `.env.example`, `tests/server-only.ts`, `src/lib/supabase/config.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/client.ts`, `src/lib/action-result.ts`, `src/app/layout.tsx` (temporary), `src/app/page.tsx` (temporary, deleted in Task 6)
- Test: `tests/action-result.test.ts`

**Interfaces:**
- Produces: `getSupabaseConfig(): { url, key }`; `createClient()` (server, async), `createAdminClient()` (service role), `createClient()` (browser); `ActionResult<T>`, `FormState`, `ok()`, `fail()`, `fieldErrorsOf()`.

- [ ] **Step 1: Write config files**

`package.json`:
```json
{
  "name": "promptchain",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@google/genai": "^2.28.0",
    "@supabase/ssr": "^0.12.7",
    "@supabase/supabase-js": "^2.117.1",
    "next": "16.4.2",
    "next-themes": "^0.4.6",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.4.2",
    "typescript": "^5",
    "vitest": "^4.1.11"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Run inputs are downscaled in the browser first; 4 MB stays under Vercel's 4.5 MB request cap.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
```

`eslint.config.mjs`:
```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Run images are short-lived signed Supabase URLs; next/image caching would outlive them.
  { rules: { "@next/next/no-img-element": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", ".superpowers/**"]),
]);
```

`vitest.config.mts`:
```ts
import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  test: { environment: "node", exclude: [...configDefaults.exclude, ".superpowers/**"], clearMocks: true },
});
```

`.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Server-only. Bypasses RLS; used only after requireAdmin().
SUPABASE_SECRET_KEY=
# Server-only.
GEMINI_API_KEY=
```

`tests/server-only.ts`:
```ts
// Next.js enforces this boundary in builds; the test runner uses a neutral module.
export {};
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes with `added N packages` and no peer-dependency errors.

- [ ] **Step 3: Write Supabase clients** (copied from `hogwumbia-admin`)

`src/lib/supabase/config.ts`:
```ts
export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are missing.");
  return { url, key };
}
```

`src/lib/supabase/server.ts`:
```ts
import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; the proxy refreshes them before rendering.
        }
      },
    },
  });
}
```

`src/lib/supabase/admin.ts`:
```ts
import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

// The secret key bypasses RLS. Call only after requireAdmin(); never import from client code.
export function createAdminClient() {
  const { url } = getSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is missing.");
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
```

`src/lib/supabase/client.ts`:
```ts
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

export function createClient() {
  const { url, key } = getSupabaseConfig();
  return createBrowserClient(url, key);
}
```

- [ ] **Step 4: Write the failing test for the action envelope**

`tests/action-result.test.ts`:
```ts
import { expect, it } from "vitest";
import { z } from "zod";
import { fail, fieldErrorsOf, ok } from "@/lib/action-result";

it("wraps success and failure", () => {
  expect(ok(5)).toEqual({ ok: true, data: 5 });
  expect(fail("Nope")).toEqual({ ok: false, error: "Nope" });
});

it("keeps the first zod message per field", () => {
  const parsed = z.object({ name: z.string().min(1, "Name is required") }).safeParse({ name: "" });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(fieldErrorsOf(parsed.error)).toEqual({ name: "Name is required" });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run tests/action-result.test.ts`
Expected: FAIL, `Cannot find module '@/lib/action-result'`.

- [ ] **Step 6: Implement `src/lib/action-result.ts`**

```ts
import { z } from "zod";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** State shape for forms driven by useActionState. */
export type FormState = { ok: boolean; error?: string; fieldErrors?: Record<string, string> };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult<never> =>
  fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const flat = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  return Object.fromEntries(
    Object.entries(flat).flatMap(([key, messages]) => (messages?.[0] ? [[key, messages[0]]] : [])),
  );
}
```

- [ ] **Step 7: Temporary layout and page so the build has a route**

`src/app/layout.tsx`:
```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function Placeholder() {
  return <p>MoPC</p>;
}
```

- [ ] **Step 8: Verify**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: 2 tests pass; tsc prints nothing; the build ends with `Compiled successfully` and a route list containing `/`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs vitest.config.mts .env.example tests src
git commit -m "chore: scaffold Next.js 16 app with Supabase clients and test setup"
```

---

### Task 2: Superadmin gate, auth routes and login page

**Files:**
- Create: `src/lib/auth/access.ts`, `src/lib/auth/require-admin.ts`, `src/proxy.ts`, `src/app/auth/callback/route.ts`, `src/app/auth/actions.ts`, `src/components/sign-in-button.tsx`, `src/app/login/page.tsx`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/server`.
- Produces: `hasSuperadminAccess(user, profile): boolean`; `requireAdmin(): Promise<{ user: User }>`, which redirects to `/login` (no session) or `/login?reason=restricted` (not an admin); `signOut()` server action; `<SignInButton />`.

- [ ] **Step 1: Write the failing tests**

`tests/auth.test.ts`:
```ts
import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  client: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(path);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: h.client }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import { hasSuperadminAccess } from "@/lib/auth/access";
import { requireAdmin } from "@/lib/auth/require-admin";
import { GET } from "@/app/auth/callback/route";

let user: unknown;
let profile: unknown;
let profileError: unknown;
let exchange: ReturnType<typeof vi.fn>;

beforeEach(() => {
  user = { id: "u1", app_metadata: { provider: "google" } };
  profile = { id: "u1", is_superadmin: true };
  profileError = null;
  exchange = vi.fn(async () => ({ error: null }));
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: profile, error: profileError })),
  };
  h.client.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })), exchangeCodeForSession: exchange },
    from: vi.fn(() => query),
  });
});

it("requires a Google identity and a true DB flag", () => {
  expect(hasSuperadminAccess({ app_metadata: { provider: "google" } }, { is_superadmin: true })).toBe(true);
  expect(hasSuperadminAccess({ app_metadata: { provider: "email" } }, { is_superadmin: true })).toBe(false);
  expect(hasSuperadminAccess({ app_metadata: { provider: "google" } }, { is_superadmin: "true" })).toBe(false);
  expect(hasSuperadminAccess(null, null)).toBe(false);
});

it("returns the verified admin", async () => {
  expect((await requireAdmin()).user).toEqual(user);
});

it("sends anonymous visitors to /login", async () => {
  user = null;
  await expect(requireAdmin()).rejects.toThrow("/login");
});

it.each([null, {}, { is_superadmin: false }])("restricts non-admin profile %j", async (p) => {
  profile = p;
  await expect(requireAdmin()).rejects.toThrow("/login?reason=restricted");
});

it("restricts when the profile read fails", async () => {
  profileError = { message: "offline" };
  await expect(requireAdmin()).rejects.toThrow("/login?reason=restricted");
});

it("re-reads the flag on every call (revocation applies immediately)", async () => {
  await requireAdmin();
  profile = { is_superadmin: false };
  await expect(requireAdmin()).rejects.toThrow("restricted");
  expect(h.client).toHaveBeenCalledTimes(2);
});

it("callback exchanges the code and always lands on /", async () => {
  const res = await GET(new Request("https://x.test/auth/callback?code=abc&next=https://evil.test"));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
  expect(exchange).toHaveBeenCalledWith("abc");
});

it("callback reports failed sign-in", async () => {
  exchange.mockResolvedValueOnce({ error: { message: "expired" } });
  const res = await GET(new Request("https://x.test/auth/callback?code=abc"));
  expect(res.headers.get("location")).toBe("/login?reason=auth");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL, `Cannot find module '@/lib/auth/access'`.

- [ ] **Step 3: Implement the gate**

`src/lib/auth/access.ts`:
```ts
/** A verified Google identity AND a current database grant are both required. */
export function hasSuperadminAccess(
  user: { app_metadata?: { provider?: unknown } } | null,
  profile: { is_superadmin?: unknown } | null,
): boolean {
  return user?.app_metadata?.provider === "google" && profile?.is_superadmin === true;
}
```

`src/lib/auth/require-admin.ts`:
```ts
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasSuperadminAccess } from "./access";

// No cache: a revoked flag applies on the next request or action.
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, is_superadmin")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !hasSuperadminAccess(user, profile)) redirect("/login?reason=restricted");
  return { user };
}
```

`src/app/auth/callback/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const to = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location } });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (code && !params.has("error")) {
    try {
      const client = await createClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return to("/");
      console.error("[auth] code exchange failed", { message: error.message });
    } catch (error) {
      console.error("[auth] code exchange threw", { message: (error as Error).message });
    }
  }
  return to("/login?reason=auth");
}
```

`src/app/auth/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const client = await createClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw new Error("Sign-out failed. Please retry.");
  redirect("/login");
}
```

`src/proxy.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = getSupabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  // Refresh cookies here; pages and actions verify the user again at the data boundary.
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Sign-in button and login page**

`src/components/sign-in-button.tsx`:
```tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (pending) return;
    setPending(true);
    setError(null);
    const { error: authError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) {
      setError("We couldn't start sign-in. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="actions-row">
      <button className="btn btn--strong" type="button" onClick={signIn} disabled={pending} aria-busy={pending}>
        {pending ? "Opening Google…" : "Sign in with Google"}
      </button>
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  );
}
```

`src/app/login/page.tsx`:
```tsx
import type { Metadata } from "next";
import { signOut } from "@/app/auth/actions";
import { SignInButton } from "@/components/sign-in-button";
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
```
(Task 6 adds the theme switch, fonts and CSS. The page renders unstyled until then.)

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all tests pass; the build lists `/login` and `/auth/callback`, plus `ƒ Proxy (Middleware)`.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: add superadmin gate, Google auth callback and login page"
```

---

### Task 3: Database migration, seed and SQL check

**Files:**
- Create: `supabase/migrations/20261105000000_prompt_chain_tool.sql`, `supabase/checks/prompt_chain_tool_check.sql`

**Interfaces:**
- Produces these RPCs, executable by service_role only:
  - `append_prompt_chain_step(p_chain_id uuid, p_title text, p_instructions text, p_model_id uuid) → uuid`
  - `reorder_prompt_chain_steps(p_chain_id uuid, p_step_ids uuid[]) → void` (SQLSTATE `22023` if the list isn't an exact permutation)
  - `delete_prompt_chain_step(p_step_id uuid) → void`
  - `create_prompt_chain_run(p_run_id, p_chain_id, p_requested_by, p_input_text, p_input_image_path, p_input_image_width, p_input_image_height) → uuid`, which raises `rate_limited` / `chain_has_no_steps` / `step_<n>_has_no_active_model`
  - `claim_next_run_step(p_run_id uuid) → jsonb`, one of `{state:'running'|'succeeded'|'failed'|'busy'}` or `{state:'claimed', step:{id, stepOrder, title, instructions, modelIdentifier, modality}, runInput:{text, imagePath}, previous:{text, imagePath}|null, isLast}`
- Also produces: tables `prompt_chain_runs` and `prompt_chain_run_steps`, the private bucket `chain-runs`, and the seeded chain "Five Captions From a Photo".

- [ ] **Step 1: Write the migration**

`supabase/migrations/20261105000000_prompt_chain_tool.sql`:
```sql
-- MoPC prompt chain tool: step-by-step run history, atomic step append/reorder/delete,
-- a private bucket for run images, and the assignment's example chain. Additive: the only
-- change to an existing object makes the step-order unique constraint DEFERRABLE, which
-- leaves single-row writes from the other apps unchanged.
--
-- Same house rule as the admin catalog: RLS on with no policies, anon/authenticated
-- revoked, functions executable by service_role only (used after requireAdmin()).

-- 1. Step order: checked at end of statement so one UPDATE can renumber a chain.
alter table public.prompt_chain_steps
  drop constraint prompt_chain_steps_prompt_chain_id_step_order_key;
alter table public.prompt_chain_steps
  add constraint prompt_chain_steps_prompt_chain_id_step_order_key
  unique (prompt_chain_id, step_order) deferrable initially immediate;

-- 2. Runs ------------------------------------------------------------------------------
create table public.prompt_chain_runs (
  id uuid primary key default gen_random_uuid(),
  prompt_chain_id uuid not null references public.prompt_chains(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  input_text text check (input_text is null or char_length(btrim(input_text)) between 1 and 2000),
  input_image_path text check (input_image_path is null or char_length(input_image_path) <= 300),
  input_image_width integer check (input_image_width is null or input_image_width > 0),
  input_image_height integer check (input_image_height is null or input_image_height > 0),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error_message text check (error_message is null or char_length(error_message) <= 600),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint prompt_chain_runs_has_input check (input_text is not null or input_image_path is not null)
);
create index prompt_chain_runs_chain_created_idx on public.prompt_chain_runs (prompt_chain_id, created_at desc);
create index prompt_chain_runs_requester_created_idx on public.prompt_chain_runs (requested_by, created_at desc);
alter table public.prompt_chain_runs enable row level security;
revoke all on public.prompt_chain_runs from anon, authenticated;
comment on table public.prompt_chain_runs is 'Prompt chain tool only: service role access, no RLS policies.';

-- 3. Run steps: snapshot of each step at run start, plus its output ----------------------
create table public.prompt_chain_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prompt_chain_runs(id) on delete cascade,
  prompt_chain_step_id uuid references public.prompt_chain_steps(id) on delete set null,
  step_order smallint not null check (step_order between 1 and 20),
  title text not null,
  instructions text not null,
  llm_model_id uuid references public.llm_models(id) on delete set null,
  model_identifier text not null,
  modality text not null check (modality in ('text', 'image')),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  output_text text check (output_text is null or char_length(output_text) <= 20000),
  output_image_path text check (output_image_path is null or char_length(output_image_path) <= 300),
  error_message text check (error_message is null or char_length(error_message) <= 600),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  unique (run_id, step_order)
);
create index prompt_chain_run_steps_latest_idx
  on public.prompt_chain_run_steps (prompt_chain_step_id, completed_at desc) where status = 'succeeded';
alter table public.prompt_chain_run_steps enable row level security;
revoke all on public.prompt_chain_run_steps from anon, authenticated;
comment on table public.prompt_chain_run_steps is 'Prompt chain tool only: service role access, no RLS policies.';

-- 4. Step helpers -------------------------------------------------------------------------
create function public.append_prompt_chain_step(p_chain_id uuid, p_title text, p_instructions text, p_model_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_next smallint; v_id uuid;
begin
  select coalesce(max(step_order), 0) + 1 into v_next from public.prompt_chain_steps where prompt_chain_id = p_chain_id;
  if v_next > 20 then raise exception 'chain_step_limit' using errcode = 'P0001'; end if;
  insert into public.prompt_chain_steps (prompt_chain_id, step_order, title, instructions, llm_model_id)
  values (p_chain_id, v_next, p_title, p_instructions, p_model_id) returning id into v_id;
  return v_id;
end $$;

create function public.reorder_prompt_chain_steps(p_chain_id uuid, p_step_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_step_ids is null
     or cardinality(p_step_ids) <> (select count(*) from public.prompt_chain_steps where prompt_chain_id = p_chain_id)
     or cardinality(p_step_ids) <> (select count(distinct x) from unnest(p_step_ids) as t(x))
     or exists (select 1 from unnest(p_step_ids) as t(x) where not exists (
          select 1 from public.prompt_chain_steps s where s.id = t.x and s.prompt_chain_id = p_chain_id))
  then
    raise exception 'step_ids_must_match_chain' using errcode = '22023';
  end if;
  update public.prompt_chain_steps s set step_order = o.ord
    from unnest(p_step_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.prompt_chain_id = p_chain_id and s.step_order <> o.ord;
end $$;

create function public.delete_prompt_chain_step(p_step_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_chain uuid;
begin
  delete from public.prompt_chain_steps where id = p_step_id returning prompt_chain_id into v_chain;
  if v_chain is null then raise exception 'step_not_found' using errcode = 'P0002'; end if;
  update public.prompt_chain_steps s set step_order = r.rn
    from (select id, row_number() over (order by step_order) as rn
            from public.prompt_chain_steps where prompt_chain_id = v_chain) r
   where s.id = r.id and s.step_order <> r.rn;
end $$;

-- 5. Run helpers --------------------------------------------------------------------------
create function public.create_prompt_chain_run(
  p_run_id uuid, p_chain_id uuid, p_requested_by uuid, p_input_text text,
  p_input_image_path text, p_input_image_width integer, p_input_image_height integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_missing smallint;
begin
  if p_requested_by is not null and (select count(*) from public.prompt_chain_runs
       where requested_by = p_requested_by and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.prompt_chain_steps where prompt_chain_id = p_chain_id) then
    raise exception 'chain_has_no_steps' using errcode = 'P0001';
  end if;
  select s.step_order into v_missing
    from public.prompt_chain_steps s left join public.llm_models m on m.id = s.llm_model_id
   where s.prompt_chain_id = p_chain_id and (m.id is null or not m.is_active)
   order by s.step_order limit 1;
  if v_missing is not null then
    raise exception 'step_%_has_no_active_model', v_missing using errcode = 'P0001';
  end if;
  insert into public.prompt_chain_runs
    (id, prompt_chain_id, requested_by, input_text, input_image_path, input_image_width, input_image_height)
  values (p_run_id, p_chain_id, p_requested_by, nullif(btrim(p_input_text), ''), p_input_image_path,
          p_input_image_width, p_input_image_height);
  insert into public.prompt_chain_run_steps
    (run_id, prompt_chain_step_id, step_order, title, instructions, llm_model_id, model_identifier, modality)
  select p_run_id, s.id, s.step_order, s.title, s.instructions, m.id, m.model_identifier, m.modality
    from public.prompt_chain_steps s join public.llm_models m on m.id = s.llm_model_id
   where s.prompt_chain_id = p_chain_id order by s.step_order;
  return p_run_id;
end $$;

create function public.claim_next_run_step(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run public.prompt_chain_runs%rowtype;
  v_step public.prompt_chain_run_steps%rowtype;
  v_prev public.prompt_chain_run_steps%rowtype;
begin
  select * into v_run from public.prompt_chain_runs where id = p_run_id for update;
  if not found then raise exception 'run_not_found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' then return jsonb_build_object('state', v_run.status); end if;

  select * into v_step from public.prompt_chain_run_steps
   where run_id = p_run_id and status <> 'succeeded' order by step_order limit 1;
  if not found then
    update public.prompt_chain_runs set status = 'succeeded', completed_at = now() where id = p_run_id;
    return jsonb_build_object('state', 'succeeded');
  end if;
  if v_step.status = 'running' then return jsonb_build_object('state', 'busy'); end if;
  if v_step.status = 'failed' then return jsonb_build_object('state', 'failed'); end if;

  update public.prompt_chain_run_steps set status = 'running', started_at = now() where id = v_step.id;
  select * into v_prev from public.prompt_chain_run_steps
   where run_id = p_run_id and step_order < v_step.step_order order by step_order desc limit 1;

  return jsonb_build_object(
    'state', 'claimed',
    'step', jsonb_build_object('id', v_step.id, 'stepOrder', v_step.step_order, 'title', v_step.title,
      'instructions', v_step.instructions, 'modelIdentifier', v_step.model_identifier, 'modality', v_step.modality),
    'runInput', jsonb_build_object('text', v_run.input_text, 'imagePath', v_run.input_image_path),
    'previous', case when v_prev.id is null then null
      else jsonb_build_object('text', v_prev.output_text, 'imagePath', v_prev.output_image_path) end,
    'isLast', not exists (select 1 from public.prompt_chain_run_steps
                          where run_id = p_run_id and step_order > v_step.step_order));
end $$;

-- 6. Execute grants: service role only ------------------------------------------------------
revoke execute on function public.append_prompt_chain_step(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.reorder_prompt_chain_steps(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.delete_prompt_chain_step(uuid) from public, anon, authenticated;
revoke execute on function public.create_prompt_chain_run(uuid, uuid, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.claim_next_run_step(uuid) from public, anon, authenticated;
grant execute on function public.append_prompt_chain_step(uuid, text, text, uuid) to service_role;
grant execute on function public.reorder_prompt_chain_steps(uuid, uuid[]) to service_role;
grant execute on function public.delete_prompt_chain_step(uuid) to service_role;
grant execute on function public.create_prompt_chain_run(uuid, uuid, uuid, text, text, integer, integer) to service_role;
grant execute on function public.claim_next_run_step(uuid) to service_role;

-- 7. Private bucket for run inputs and image outputs (no storage policies: service role only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chain-runs', 'chain-runs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- 8. The assignment's example chain: image → description → what's funny → five captions.
with chain as (
  insert into public.prompt_chains (name, description, is_active)
  values ('Five Captions From a Photo',
          'Turns any photo into five short, funny captions: describe it, find the joke, then write the captions.', true)
  returning id
), model as (
  select id from public.llm_models where model_identifier = 'gemini-3.5-flash-lite'
)
insert into public.prompt_chain_steps (prompt_chain_id, step_order, title, llm_model_id, instructions)
select chain.id, v.step_order, v.title, model.id, v.instructions
from chain, model, (values
  (1::smallint, 'Describe the image', 'Describe this image in plain, literal language: who or what is in it, what is happening, the setting and notable details. 3-5 sentences. No jokes yet.'),
  (2::smallint, 'Find the funny', 'You will receive a description of an image. In 2-3 sentences, explain what is absurd, ironic or funny about the scene. Be specific to the details given.'),
  (3::smallint, 'Five captions', 'You will receive a note on what is funny about an image. Write exactly five short, funny captions for it, each under 15 words, numbered 1-5, one per line. No other text.')
) as v(step_order, title, instructions);
```

- [ ] **Step 2: Apply it to the shared project**

Use the Supabase MCP tool `apply_migration` with `project_id: "mtbtwriiqbsottfhwrma"`, `name: "prompt_chain_tool"`, and `query` set to the full file contents.
Expected: success. Then run `execute_sql`: `select name, (select count(*) from prompt_chain_steps s where s.prompt_chain_id = c.id) as steps from prompt_chains c where name = 'Five Captions From a Photo';`
Expected: one row with `steps = 3`.

- [ ] **Step 3: Write the rollback-only check**

`supabase/checks/prompt_chain_tool_check.sql`:
```sql
-- Run with execute_sql. Every change is rolled back by the final RAISE.
-- Success = error text 'ALL_CHECKS_PASSED'; any other message names the failed assertion.
do $$
declare c uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; m uuid; r uuid; j jsonb;
begin
  select id into m from public.llm_models where model_identifier = 'gemini-3.5-flash-lite';
  insert into public.prompt_chains (name) values ('zz check chain') returning id into c;
  s1 := public.append_prompt_chain_step(c, 'A', 'a', m);
  s2 := public.append_prompt_chain_step(c, 'B', 'b', m);
  s3 := public.append_prompt_chain_step(c, 'C', 'c', m);
  assert (select step_order from public.prompt_chain_steps where id = s3) = 3, 'append numbers 1..n';

  perform public.reorder_prompt_chain_steps(c, array[s2, s1, s3]);
  assert (select step_order from public.prompt_chain_steps where id = s2) = 1, 'reorder moves B to 1';
  assert (select step_order from public.prompt_chain_steps where id = s1) = 2, 'reorder moves A to 2';
  begin
    perform public.reorder_prompt_chain_steps(c, array[s1, s2]);
    raise exception 'reorder accepted a partial list';
  exception when sqlstate '22023' then null;
  end;

  perform public.delete_prompt_chain_step(s1);
  assert (select array_agg(step_order order by step_order) from public.prompt_chain_steps where prompt_chain_id = c)
         = array[1, 2]::smallint[], 'delete renumbers to 1,2';

  r := gen_random_uuid();
  perform public.create_prompt_chain_run(r, c, null, 'hello', null, null, null);
  j := public.claim_next_run_step(r);
  assert j->>'state' = 'claimed' and (j->'step'->>'stepOrder')::int = 1, 'first claim is step 1';
  assert j->'previous' = 'null'::jsonb and j->'runInput'->>'text' = 'hello', 'step 1 gets the run input';
  assert public.claim_next_run_step(r)->>'state' = 'busy', 'a running step is busy';
  update public.prompt_chain_run_steps set status = 'succeeded', output_text = 'out1' where run_id = r and step_order = 1;
  j := public.claim_next_run_step(r);
  assert j->'previous'->>'text' = 'out1' and (j->>'isLast')::boolean, 'step 2 gets step 1 output and is last';
  update public.prompt_chain_run_steps set status = 'succeeded' where run_id = r and step_order = 2;
  assert public.claim_next_run_step(r)->>'state' = 'succeeded', 'run completes';
  assert (select status from public.prompt_chain_runs where id = r) = 'succeeded', 'run row marked succeeded';

  s4 := public.append_prompt_chain_step(c, 'D', 'd', null);
  begin
    perform public.create_prompt_chain_run(gen_random_uuid(), c, null, 'x', null, null, null);
    raise exception 'run started with a model-less step';
  exception when others then
    assert sqlerrm = 'step_3_has_no_active_model', 'model-less step blocks the run, got ' || sqlerrm;
  end;

  raise exception 'ALL_CHECKS_PASSED';
end $$;
```

- [ ] **Step 4: Run the check**

Use the MCP `execute_sql` tool on `mtbtwriiqbsottfhwrma` with the file contents.
Expected: an error whose message is exactly `ALL_CHECKS_PASSED`. Any other message is a failed assertion: fix the migration with a follow-up `apply_migration`, then re-run.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "feat: add prompt chain run tables, step RPCs, run bucket and example chain"
```

---

### Task 4: Chain domain core (pure)

**Files:**
- Create: `src/lib/chains/types.ts`, `src/lib/chains/schemas.ts`, `src/lib/chains/order.ts`, `src/lib/chains/presentation.ts`
- Test: `tests/order.test.ts`, `tests/presentation.test.ts`

**Interfaces:**
- Produces:
  - types `Modality`, `LlmModel`, `SignedImage`, `StepOutput`, `ChainStep`, `ChainDetail`, `ChainSummary`
  - zod `idSchema`, `readChainForm(fd)`, `readStepForm(fd)`, `reorderSchema`, plus row schemas `modelRowSchema`, `stepRowSchema`, `chainRowSchema`
  - `moveStep<T>(items, from, to): T[]`
  - `tileColor(i): "cyan"|"lime"|"orange"|"mint"`, `pad2(n)`, `snippet(text, max?)`, `describeTrail(trail)`, `ratioOf(img)`

- [ ] **Step 1: Write the failing tests**

`tests/order.test.ts`:
```ts
import { expect, it } from "vitest";
import { moveStep } from "@/lib/chains/order";

it("moves step 2 to step 1 without mutating the input", () => {
  const ids = ["a", "b", "c"];
  expect(moveStep(ids, 1, 0)).toEqual(["b", "a", "c"]);
  expect(ids).toEqual(["a", "b", "c"]);
});

it("moves the first step to the end", () => expect(moveStep(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]));

it.each([[-1, 0], [0, 3], [3, 0], [1, 1]])("returns an unchanged copy for move %i → %i", (from, to) => {
  const ids = ["a", "b", "c"];
  const out = moveStep(ids, from, to);
  expect(out).toEqual(ids);
  expect(out).not.toBe(ids);
});
```

`tests/presentation.test.ts`:
```ts
import { expect, it } from "vitest";
import { describeTrail, pad2, ratioOf, snippet, tileColor } from "@/lib/chains/presentation";

it("cycles tile colors", () => expect([0, 1, 2, 3, 4].map(tileColor)).toEqual(["cyan", "lime", "orange", "mint", "cyan"]));
it("pads step numbers", () => expect(pad2(2)).toBe("02"));
it("shortens long text on one line", () => expect(snippet("a\n b   c", 4)).toBe("a b…"));
it("describes the modality trail", () => {
  expect(describeTrail(["text", "image"])).toBe("2 steps · text → image");
  expect(describeTrail(["text", "text", "text"])).toBe("3 steps · text");
  expect(describeTrail([])).toBe("No steps yet");
});
it("uses stored dimensions or 3:4", () => {
  expect(ratioOf({ url: "u", width: 1600, height: 900 })).toBe("1600 / 900");
  expect(ratioOf({ url: "u", width: null, height: null })).toBe("3 / 4");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/order.test.ts tests/presentation.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/lib/chains/types.ts`:
```ts
export type Modality = "text" | "image";
export type LlmModel = { id: string; name: string; identifier: string; modality: Modality };
/** A signed (private bucket) image; null dimensions mean the 3:4 default used for generated images. */
export type SignedImage = { url: string; width: number | null; height: number | null };
export type StepOutput = { text: string | null; image: SignedImage | null };
export type ChainStep = {
  id: string;
  order: number;
  title: string;
  instructions: string;
  model: (LlmModel & { isActive: boolean }) | null;
  latest: StepOutput | null;
};
export type ChainDetail = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  steps: ChainStep[];
  latestInput: StepOutput | null;
  runCount: number;
};
export type ChainSummary = { id: string; name: string; isActive: boolean; trail: Modality[]; cover: SignedImage | null };
```

`src/lib/chains/schemas.ts`:
```ts
import { z } from "zod";

export const idSchema = z.guid();
const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, message).transform((value) => (value === "" ? null : value));

export const chainFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Keep the name under 120 characters"),
  description: optionalText(600, "Keep the description under 600 characters"),
  isActive: z.boolean(),
});
export type ChainFormInput = z.infer<typeof chainFormSchema>;

export const stepFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80, "Keep the title under 80 characters"),
  instructions: z.string().trim().min(1, "Instructions are required").max(4000, "Instructions are limited to 4,000 characters"),
  modelId: z.guid({ error: "Choose a model" }),
});
export type StepFormInput = z.infer<typeof stepFormSchema>;

export const reorderSchema = z.object({ chainId: z.guid(), stepIds: z.array(z.guid()).min(1).max(20) });

export const readChainForm = (formData: FormData) =>
  chainFormSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    isActive: formData.get("isActive") === "on",
  });

export const readStepForm = (formData: FormData) =>
  stepFormSchema.safeParse({
    title: formData.get("title") ?? "",
    instructions: formData.get("instructions") ?? "",
    modelId: formData.get("modelId") ?? "",
  });

// Rows read from the database, parsed at the boundary.
export const modelRowSchema = z.object({
  id: z.guid(),
  name: z.string(),
  model_identifier: z.string(),
  modality: z.enum(["text", "image"]),
  is_active: z.boolean(),
});
export const stepRowSchema = z.object({
  id: z.guid(),
  step_order: z.number().int(),
  title: z.string(),
  instructions: z.string(),
  llm_models: modelRowSchema.nullable(),
});
export const chainRowSchema = z.object({
  id: z.guid(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
});
```

`src/lib/chains/order.ts`:
```ts
/** Returns a new array with the item at `from` moved to `to`; invalid moves return an unchanged copy. */
export function moveStep<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  const inRange = (i: number) => i >= 0 && i < copy.length;
  if (!inRange(from) || !inRange(to) || from === to) return copy;
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}
```

`src/lib/chains/presentation.ts`:
```ts
import type { Modality, SignedImage } from "./types";

const TILE_COLORS = ["cyan", "lime", "orange", "mint"] as const;
export type TileColor = (typeof TILE_COLORS)[number];

export const tileColor = (index: number): TileColor => TILE_COLORS[((index % 4) + 4) % 4];
export const pad2 = (n: number) => String(n).padStart(2, "0");

export function snippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function describeTrail(trail: readonly Modality[]): string {
  if (trail.length === 0) return "No steps yet";
  const runs = trail.filter((m, i) => i === 0 || m !== trail[i - 1]);
  return `${trail.length} ${trail.length === 1 ? "step" : "steps"} · ${runs.join(" → ")}`;
}

export const ratioOf = (image: SignedImage) =>
  image.width && image.height ? `${image.width} / ${image.height}` : "3 / 4";
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/order.test.ts tests/presentation.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chains tests
git commit -m "feat: add chain types, form schemas, moveStep and presentation helpers"
```

---

### Task 5: Chain data shell (queries, repository, storage, actions)

**Files:**
- Create: `src/lib/runs/storage.ts`, `src/lib/chains/queries.ts`, `src/lib/chains/repository.ts`, `src/lib/chains/actions.ts`
- Test: `tests/actions-gate.test.ts`

**Interfaces:**
- Consumes:
  - `createAdminClient`, `AdminClient` (Task 1)
  - `requireAdmin` (Task 2)
  - the RPCs (Task 3)
  - schemas and types (Task 4)
  - `ActionResult`, `FormState`, `ok`, `fail`, `fieldErrorsOf` (Task 1)
- Produces:
  - `storage.ts`: `RUN_BUCKET`, `extFromMime(mime)`, `uploadRunImage(admin, path, bytes, contentType)`, `downloadRunImage(admin, path) → {mimeType, base64}`, `signRunImages(admin, paths) → Map<path,url>`, `removeRunFolders(admin, runIds)`
  - `queries.ts`: `listActiveModels() → LlmModel[]`, `getChainDetail(id) → ChainDetail|null`, `listChainSummaries() → ChainSummary[]`, `getChainName(id) → string|null`
  - server actions:
    - `createChain(prev, fd)`
    - `updateChain(chainId, prev, fd) → FormState`
    - `deleteChain(chainId) → ActionResult<null>` (redirects to `/` on success)
    - `saveStep(chainId, stepId|null, prev, fd) → FormState`
    - `deleteStep(chainId, stepId) → ActionResult<null>`
    - `reorderSteps(chainId, stepIds) → ActionResult<null>`

- [ ] **Step 1: Write the failing gate test**

`tests/actions-gate.test.ts`:
```ts
import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => {
    throw new Error("/login?reason=restricted");
  }),
  admin: vi.fn(),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import * as chains from "@/lib/chains/actions";

const ID = "c270c3da-f5b1-47dd-8e21-b76703c91c2f";
const calls: [string, () => Promise<unknown>][] = [
  ["createChain", () => chains.createChain({ ok: false }, new FormData())],
  ["updateChain", () => chains.updateChain(ID, { ok: false }, new FormData())],
  ["deleteChain", () => chains.deleteChain(ID)],
  ["saveStep", () => chains.saveStep(ID, null, { ok: false }, new FormData())],
  ["deleteStep", () => chains.deleteStep(ID, ID)],
  ["reorderSteps", () => chains.reorderSteps(ID, [ID])],
];

it.each(calls)("%s denies non-admins before creating the service-role client", async (_name, call) => {
  await expect(call()).rejects.toThrow("restricted");
  expect(h.admin).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/actions-gate.test.ts`
Expected: FAIL, `Cannot find module '@/lib/chains/actions'`.

- [ ] **Step 3: Implement storage**

`src/lib/runs/storage.ts`:
```ts
import "server-only";

import type { AdminClient } from "@/lib/supabase/admin";

export const RUN_BUCKET = "chain-runs";
const SIGNED_URL_TTL_S = 60 * 60;

export const extFromMime = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");
const mimeFromPath = (path: string) =>
  path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";

export async function uploadRunImage(admin: AdminClient, path: string, bytes: Blob | Buffer, contentType: string) {
  const { error } = await admin.storage.from(RUN_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`upload failed for ${path}: ${error.message}`);
}

export async function downloadRunImage(admin: AdminClient, path: string) {
  const { data, error } = await admin.storage.from(RUN_BUCKET).download(path);
  if (error || !data) throw new Error(`download failed for ${path}: ${error?.message ?? "empty"}`);
  const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
  return { mimeType: data.type || mimeFromPath(path), base64 };
}

/** Signs many paths in one request; unsigned paths are simply absent from the map. */
export async function signRunImages(admin: AdminClient, paths: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return new Map();
  const { data, error } = await admin.storage.from(RUN_BUCKET).createSignedUrls(unique, SIGNED_URL_TTL_S);
  if (error || !data) {
    console.error("[storage] signing failed", { count: unique.length, message: error?.message });
    return new Map();
  }
  return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
}

/** Best effort: rows are already gone, so failures are logged, never thrown. */
export async function removeRunFolders(admin: AdminClient, runIds: readonly string[]) {
  for (const runId of runIds) {
    const { data, error } = await admin.storage.from(RUN_BUCKET).list(runId);
    if (error) {
      console.error("[storage] list failed", { runId, message: error.message });
      continue;
    }
    const paths = (data ?? []).map((file) => `${runId}/${file.name}`);
    if (paths.length === 0) continue;
    const { error: removeError } = await admin.storage.from(RUN_BUCKET).remove(paths);
    if (removeError) console.error("[storage] remove failed", { runId, message: removeError.message });
  }
}
```

- [ ] **Step 4: Implement queries**

`src/lib/chains/queries.ts`:
```ts
import "server-only";

import { z } from "zod";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { signRunImages } from "@/lib/runs/storage";
import { chainRowSchema, modelRowSchema, stepRowSchema } from "./schemas";
import type { ChainDetail, ChainStep, ChainSummary, LlmModel, SignedImage, StepOutput } from "./types";

const outputRow = z.object({ output_text: z.string().nullable(), output_image_path: z.string().nullable() });
const inputRow = z.object({
  input_text: z.string().nullable(),
  input_image_path: z.string().nullable(),
  input_image_width: z.number().nullable(),
  input_image_height: z.number().nullable(),
});
const summaryRow = z.object({
  id: z.guid(),
  name: z.string(),
  is_active: z.boolean(),
  prompt_chain_steps: z.array(z.object({
    step_order: z.number(),
    llm_models: z.object({ modality: z.enum(["text", "image"]) }).nullable(),
  })),
});
const coverOutputRow = z.object({ output_image_path: z.string(), prompt_chain_runs: z.object({ prompt_chain_id: z.guid() }) });
const coverInputRow = inputRow.extend({ prompt_chain_id: z.guid(), input_image_path: z.string() });

type Output = z.infer<typeof outputRow>;
type Cover = { path: string; width: number | null; height: number | null };

function check(label: string, error: { message: string } | null) {
  if (error) throw new Error(`[queries] ${label}: ${error.message}`);
}

const toModel = (row: z.infer<typeof modelRowSchema>): LlmModel => ({
  id: row.id, name: row.name, identifier: row.model_identifier, modality: row.modality,
});

export async function listActiveModels(): Promise<LlmModel[]> {
  const { data, error } = await createAdminClient()
    .from("llm_models").select("id, name, model_identifier, modality, is_active").eq("is_active", true).order("name");
  check("models", error);
  return z.array(modelRowSchema).parse(data).map(toModel);
}

export async function getChainName(chainId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("prompt_chains").select("name").eq("id", chainId).maybeSingle();
  check("chain name", error);
  return data ? z.object({ name: z.string() }).parse(data).name : null;
}

async function latestOutputs(admin: AdminClient, stepIds: readonly string[]): Promise<Map<string, Output>> {
  const pairs = await Promise.all(stepIds.map(async (id) => {
    const { data, error } = await admin.from("prompt_chain_run_steps")
      .select("output_text, output_image_path").eq("prompt_chain_step_id", id).eq("status", "succeeded")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle();
    check(`latest output ${id}`, error);
    return data ? ([[id, outputRow.parse(data)]] as const) : [];
  }));
  return new Map(pairs.flat());
}

const signed = (urls: Map<string, string>, path: string | null, width: number | null = null, height: number | null = null): SignedImage | null => {
  const url = path ? urls.get(path) : undefined;
  return url ? { url, width, height } : null;
};

export async function getChainDetail(chainId: string): Promise<ChainDetail | null> {
  const admin = createAdminClient();
  const [chainRes, stepsRes, inputRes, countRes] = await Promise.all([
    admin.from("prompt_chains").select("id, name, description, is_active").eq("id", chainId).maybeSingle(),
    admin.from("prompt_chain_steps")
      .select("id, step_order, title, instructions, llm_models(id, name, model_identifier, modality, is_active)")
      .eq("prompt_chain_id", chainId).order("step_order"),
    admin.from("prompt_chain_runs").select("input_text, input_image_path, input_image_width, input_image_height")
      .eq("prompt_chain_id", chainId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("prompt_chain_runs").select("id", { count: "exact", head: true }).eq("prompt_chain_id", chainId),
  ]);
  [chainRes, stepsRes, inputRes, countRes].forEach((res) => check(`chain ${chainId}`, res.error));
  if (!chainRes.data) return null;

  const chain = chainRowSchema.parse(chainRes.data);
  const steps = z.array(stepRowSchema).parse(stepsRes.data);
  const latest = await latestOutputs(admin, steps.map((s) => s.id));
  const input = inputRes.data ? inputRow.parse(inputRes.data) : null;
  const paths = [...[...latest.values()].map((o) => o.output_image_path), input?.input_image_path ?? null];
  const urls = await signRunImages(admin, paths.filter((p): p is string => Boolean(p)));

  const toStep = (row: z.infer<typeof stepRowSchema>): ChainStep => {
    const out = latest.get(row.id);
    const output: StepOutput | null = out ? { text: out.output_text, image: signed(urls, out.output_image_path) } : null;
    return {
      id: row.id, order: row.step_order, title: row.title, instructions: row.instructions,
      model: row.llm_models ? { ...toModel(row.llm_models), isActive: row.llm_models.is_active } : null,
      latest: output,
    };
  };
  return {
    id: chain.id, name: chain.name, description: chain.description, isActive: chain.is_active,
    steps: steps.map(toStep),
    latestInput: input
      ? { text: input.input_text, image: signed(urls, input.input_image_path, input.input_image_width, input.input_image_height) }
      : null,
    runCount: countRes.count ?? 0,
  };
}

/** Newest image output per chain wins; otherwise the newest input photo. */
function pickCovers(outputs: z.infer<typeof coverOutputRow>[], inputs: z.infer<typeof coverInputRow>[]): Map<string, Cover> {
  const covers = new Map<string, Cover>();
  for (const o of outputs) {
    const id = o.prompt_chain_runs.prompt_chain_id;
    if (!covers.has(id)) covers.set(id, { path: o.output_image_path, width: null, height: null });
  }
  for (const i of inputs) {
    if (!covers.has(i.prompt_chain_id)) {
      covers.set(i.prompt_chain_id, { path: i.input_image_path, width: i.input_image_width, height: i.input_image_height });
    }
  }
  return covers;
}

export async function listChainSummaries(): Promise<ChainSummary[]> {
  const admin = createAdminClient();
  const [chainsRes, outputsRes, inputsRes] = await Promise.all([
    admin.from("prompt_chains").select("id, name, is_active, prompt_chain_steps(step_order, llm_models(modality))").order("name"),
    admin.from("prompt_chain_run_steps").select("output_image_path, prompt_chain_runs!inner(prompt_chain_id)")
      .eq("status", "succeeded").not("output_image_path", "is", null).order("completed_at", { ascending: false }).limit(300),
    admin.from("prompt_chain_runs").select("prompt_chain_id, input_text, input_image_path, input_image_width, input_image_height")
      .not("input_image_path", "is", null).order("created_at", { ascending: false }).limit(300),
  ]);
  [chainsRes, outputsRes, inputsRes].forEach((res) => check("collection", res.error));
  const covers = pickCovers(z.array(coverOutputRow).parse(outputsRes.data), z.array(coverInputRow).parse(inputsRes.data));
  const urls = await signRunImages(admin, [...covers.values()].map((c) => c.path));
  return z.array(summaryRow).parse(chainsRes.data).map((row) => {
    const cover = covers.get(row.id);
    return {
      id: row.id, name: row.name, isActive: row.is_active,
      trail: [...row.prompt_chain_steps].sort((a, b) => a.step_order - b.step_order).map((s) => s.llm_models?.modality ?? "text"),
      cover: cover ? signed(urls, cover.path, cover.width, cover.height) : null,
    };
  });
}
```

- [ ] **Step 5: Implement repository**

`src/lib/chains/repository.ts`:
```ts
import "server-only";

import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import { removeRunFolders } from "@/lib/runs/storage";
import type { ChainFormInput, StepFormInput } from "./schemas";

export class RepositoryError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const raise = (error: { message: string; code?: string } | null) => {
  if (error) throw new RepositoryError(error.message, error.code);
};
const chainColumns = (input: ChainFormInput) => ({ name: input.name, description: input.description, is_active: input.isActive });

export async function insertChain(admin: AdminClient, input: ChainFormInput): Promise<string> {
  const { data, error } = await admin.from("prompt_chains").insert(chainColumns(input)).select("id").single();
  raise(error);
  return z.object({ id: z.guid() }).parse(data).id;
}

export async function updateChainRow(admin: AdminClient, chainId: string, input: ChainFormInput) {
  const { error } = await admin.from("prompt_chains").update(chainColumns(input)).eq("id", chainId);
  raise(error);
}

export async function deleteChainRow(admin: AdminClient, chainId: string) {
  const { data: runs, error: runsError } = await admin.from("prompt_chain_runs").select("id").eq("prompt_chain_id", chainId);
  raise(runsError);
  const { error } = await admin.from("prompt_chains").delete().eq("id", chainId);
  raise(error);
  await removeRunFolders(admin, z.array(z.object({ id: z.guid() })).parse(runs ?? []).map((r) => r.id));
}

export async function appendStep(admin: AdminClient, chainId: string, input: StepFormInput): Promise<string> {
  const { data, error } = await admin.rpc("append_prompt_chain_step", {
    p_chain_id: chainId, p_title: input.title, p_instructions: input.instructions, p_model_id: input.modelId,
  });
  raise(error);
  return z.guid().parse(data);
}

export async function updateStepRow(admin: AdminClient, stepId: string, input: StepFormInput) {
  const { error } = await admin.from("prompt_chain_steps")
    .update({ title: input.title, instructions: input.instructions, llm_model_id: input.modelId }).eq("id", stepId);
  raise(error);
}

export async function deleteStepRow(admin: AdminClient, stepId: string) {
  const { error } = await admin.rpc("delete_prompt_chain_step", { p_step_id: stepId });
  raise(error);
}

export async function reorderStepRows(admin: AdminClient, chainId: string, stepIds: readonly string[]) {
  const { error } = await admin.rpc("reorder_prompt_chain_steps", { p_chain_id: chainId, p_step_ids: stepIds });
  raise(error);
}
```

- [ ] **Step 6: Implement actions**

`src/lib/chains/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, fieldErrorsOf, ok, type ActionResult, type FormState } from "@/lib/action-result";
import { idSchema, readChainForm, readStepForm, reorderSchema } from "./schemas";
import * as repo from "./repository";

function userMessage(error: unknown): string {
  if (error instanceof repo.RepositoryError) {
    if (error.code === "22023") return "This chain changed in another tab. Reload and try again.";
    if (error.message.includes("chain_step_limit")) return "A chain can have at most 20 steps.";
    if (error.code === "23505") return "Another change landed first. Reload and try again.";
  }
  return "Couldn't save. Try again.";
}

function logged(area: string, error: unknown, context: Record<string, unknown>): string {
  console.error(`[chains] ${area} failed`, { ...context, message: (error as Error).message });
  return userMessage(error);
}

const invalid = (error: Parameters<typeof fieldErrorsOf>[0]): FormState => ({
  ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(error),
});

export async function createChain(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = readChainForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  let chainId: string;
  try {
    chainId = await repo.insertChain(createAdminClient(), parsed.data);
  } catch (error) {
    return { ok: false, error: logged("create chain", error, {}) };
  }
  revalidatePath("/");
  redirect(`/chains/${chainId}`);
}

export async function updateChain(chainId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = readChainForm(formData);
  if (!idSchema.safeParse(chainId).success) return { ok: false, error: "Unknown chain." };
  if (!parsed.success) return invalid(parsed.error);
  try {
    await repo.updateChainRow(createAdminClient(), chainId, parsed.data);
  } catch (error) {
    return { ok: false, error: logged("update chain", error, { chainId }) };
  }
  revalidatePath(`/chains/${chainId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function deleteChain(chainId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  if (!idSchema.safeParse(chainId).success) return fail("Unknown chain.");
  try {
    await repo.deleteChainRow(createAdminClient(), chainId);
  } catch (error) {
    return fail(logged("delete chain", error, { chainId }));
  }
  revalidatePath("/");
  redirect("/");
}

export async function saveStep(chainId: string, stepId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = readStepForm(formData);
  const idsOk = idSchema.safeParse(chainId).success && (stepId === null || idSchema.safeParse(stepId).success);
  if (!idsOk) return { ok: false, error: "Unknown chain or step." };
  if (!parsed.success) return invalid(parsed.error);
  try {
    const admin = createAdminClient();
    if (stepId) await repo.updateStepRow(admin, stepId, parsed.data);
    else await repo.appendStep(admin, chainId, parsed.data);
  } catch (error) {
    return { ok: false, error: logged("save step", error, { chainId, stepId }) };
  }
  revalidatePath(`/chains/${chainId}`);
  return { ok: true };
}

export async function deleteStep(chainId: string, stepId: string): Promise<ActionResult<null>> {
  await requireAdmin();
  if (!idSchema.safeParse(chainId).success || !idSchema.safeParse(stepId).success) return fail("Unknown step.");
  try {
    await repo.deleteStepRow(createAdminClient(), stepId);
  } catch (error) {
    return fail(logged("delete step", error, { chainId, stepId }));
  }
  revalidatePath(`/chains/${chainId}`);
  return ok(null);
}

export async function reorderSteps(chainId: string, stepIds: string[]): Promise<ActionResult<null>> {
  await requireAdmin();
  const parsed = reorderSchema.safeParse({ chainId, stepIds });
  if (!parsed.success) return fail("That order isn't valid.");
  try {
    await repo.reorderStepRows(createAdminClient(), parsed.data.chainId, parsed.data.stepIds);
  } catch (error) {
    return fail(logged("reorder", error, { chainId }));
  }
  revalidatePath(`/chains/${chainId}`);
  return ok(null);
}
```

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: all tests pass (the 6 gate cases included); no type or lint errors.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat: add chain queries, repository, storage helpers and gated server actions"
```

---

### Task 6: Run engine core (pure)

**Files:**
- Create: `src/lib/runs/plan.ts`, `src/lib/runs/errors.ts`, `src/lib/runs/live-run.ts`, `src/lib/runs/media.ts`
- Test: `tests/plan.test.ts`, `tests/errors.test.ts`, `tests/live-run.test.ts`

**Interfaces:**
- Consumes: `Modality`, `SignedImage` (Task 4); `pad2` (Task 4).
- Produces:
  - `plan.ts`: `Payload`, `ClaimedStep`, `InlineImage`, `GeminiCall`, `TEXT_TIMEOUT_MS`, `IMAGE_TIMEOUT_MS`, `stepInput(runInput, previous)`, `hasInput(p)`, `buildGeminiCall(step, input)`
  - `errors.ts`: `RunError`, `EmptyResponseError`, `mapGeminiError(error, stepOrder, timeoutMs)`, `mapRunStartError(message)`
  - `live-run.ts`: `LiveRun`, `StepUpdate`, `AdvanceResult`, `startLiveRun`, `markStarted`, `applyAdvance`, `failLiveRun`, `markIncomplete`, `runningStepNumber`
  - `media.ts`: `MediaRunRow`, `MediaRun`, `splitNumbered`, `toMediaRun(row, urls, now)`

- [ ] **Step 1: Write the failing tests**

`tests/plan.test.ts`:
```ts
import { expect, it } from "vitest";
import { buildGeminiCall, hasInput, stepInput, type ClaimedStep } from "@/lib/runs/plan";

const step = (modality: "text" | "image"): ClaimedStep => ({
  id: "s", stepOrder: 2, title: "T", instructions: "Do the thing.", modelIdentifier: "m-1", modality,
});
const image = { mimeType: "image/jpeg", base64: "QUJD" };

it("feeds step 1 the run input and later steps the previous output", () => {
  const run = { text: "seed", imagePath: "r/input.jpg" };
  expect(stepInput(run, null)).toEqual(run);
  expect(stepInput(run, { text: "prev", imagePath: null })).toEqual({ text: "prev", imagePath: null });
});

it("detects empty input", () => {
  expect(hasInput({ text: "  ", imagePath: null })).toBe(false);
  expect(hasInput({ text: null, imagePath: "x.png" })).toBe(true);
});

it("builds a text call with instructions as system instruction and image before text", () => {
  const call = buildGeminiCall(step("text"), { text: "hello", image });
  expect(call).toEqual({
    kind: "text", model: "m-1", systemInstruction: "Do the thing.", maxOutputTokens: 2048, timeoutMs: 30_000,
    parts: [{ inlineData: { mimeType: "image/jpeg", data: "QUJD" } }, { text: "hello" }],
  });
});

it("builds an image call with instructions and input text in one prompt", () => {
  const call = buildGeminiCall(step("image"), { text: "a cat", image: null });
  expect(call).toEqual({
    kind: "image", model: "m-1", aspectRatio: "3:4", imageSize: "1K", timeoutMs: 55_000,
    parts: [{ text: "Do the thing.\n\na cat" }],
  });
});

it("passes an input image to an image step after the prompt", () => {
  const call = buildGeminiCall(step("image"), { text: null, image });
  expect(call.parts).toEqual([{ text: "Do the thing." }, { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }]);
});
```

`tests/errors.test.ts`:
```ts
import { expect, it } from "vitest";
import { EmptyResponseError, mapGeminiError, mapRunStartError } from "@/lib/runs/errors";

const withStatus = (status: number, message = "boom") => Object.assign(new Error(message), { status });

it.each([
  [Object.assign(new Error("aborted"), { name: "AbortError" }), "timeout", "Step 02 timed out after 30 s."],
  [withStatus(504), "timeout", "Step 02 timed out after 30 s."],
  [withStatus(429), "rate_limited", "Step 02: Gemini is rate-limiting; try again in a minute."],
  [withStatus(404), "model_unavailable", "Step 02: that model isn't available. Pick another model for the step."],
  [withStatus(403), "auth", "Step 02: Gemini rejected the API key."],
  [withStatus(400, "bad input"), "rejected", "Step 02: Gemini rejected the request (bad input)."],
  [new EmptyResponseError("SAFETY"), "empty", "Step 02: Gemini returned nothing (blocked: SAFETY). Try different input or instructions."],
  [new Error("weird"), "unknown", "Step 02 failed: weird"],
])("maps %s", (error, code, message) => {
  expect(mapGeminiError(error, 2, 30_000)).toEqual({ code, message });
});

it("maps run-start exceptions", () => {
  expect(mapRunStartError("rate_limited")).toMatch(/20 runs in 10 minutes/);
  expect(mapRunStartError("chain_has_no_steps")).toBe("Add a step before running this chain.");
  expect(mapRunStartError("step_3_has_no_active_model")).toBe("Step 03 has no active model. Choose one in the step editor.");
  expect(mapRunStartError("other")).toBe("Couldn't start the run. Try again.");
});
```

`tests/live-run.test.ts`:
```ts
import { expect, it } from "vitest";
import { applyAdvance, markStarted, runningStepNumber, startLiveRun } from "@/lib/runs/live-run";

const input = { text: "hi", previewUrl: null, width: null, height: null };

it("marks step 1 running once the run starts", () => {
  const live = markStarted(startLiveRun(3, input), "r1");
  expect(live.state).toBe("running");
  expect(runningStepNumber(live)).toBe(1);
});

it("fills a finished step and starts the next one", () => {
  const live = applyAdvance(markStarted(startLiveRun(3, input), "r1"), {
    state: "running",
    step: { stepOrder: 1, status: "succeeded", text: "out", imageUrl: null, error: null, latencyMs: 900 },
  });
  expect(live.steps[0]).toMatchObject({ status: "succeeded", text: "out" });
  expect(runningStepNumber(live)).toBe(2);
});

it("stops with the step's message on failure", () => {
  const live = applyAdvance(markStarted(startLiveRun(2, input), "r1"), {
    state: "failed",
    step: { stepOrder: 1, status: "failed", text: null, imageUrl: null, error: "Step 01 timed out after 30 s.", latencyMs: 30_000 },
  });
  expect(live.state).toBe("failed");
  expect(live.message).toBe("Step 01 timed out after 30 s.");
  expect(runningStepNumber(live)).toBe(0);
});

it("ignores busy results", () => {
  const live = markStarted(startLiveRun(2, input), "r1");
  expect(applyAdvance(live, { state: "busy", step: null })).toBe(live);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/plan.test.ts tests/errors.test.ts tests/live-run.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/lib/runs/plan.ts`**

```ts
import type { Modality } from "@/lib/chains/types";

export type Payload = { text: string | null; imagePath: string | null };
export type ClaimedStep = {
  id: string; stepOrder: number; title: string; instructions: string; modelIdentifier: string; modality: Modality;
};
export type InlineImage = { mimeType: string; base64: string };
export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export const TEXT_TIMEOUT_MS = 30_000;
export const IMAGE_TIMEOUT_MS = 55_000;

export type GeminiCall =
  | { kind: "text"; model: string; parts: Part[]; systemInstruction: string; maxOutputTokens: number; timeoutMs: number }
  | { kind: "image"; model: string; parts: Part[]; aspectRatio: "3:4"; imageSize: "1K"; timeoutMs: number };

/** Step 1 receives the run's input; every later step receives the previous step's output. */
export function stepInput(runInput: Payload, previous: Payload | null): Payload {
  return previous ?? runInput;
}

export const hasInput = (payload: Payload) => Boolean(payload.text?.trim()) || Boolean(payload.imagePath);

export function buildGeminiCall(step: ClaimedStep, input: { text: string | null; image: InlineImage | null }): GeminiCall {
  const imageParts: Part[] = input.image ? [{ inlineData: { mimeType: input.image.mimeType, data: input.image.base64 } }] : [];
  const text = input.text?.trim() || null;
  if (step.modality === "text") {
    return {
      kind: "text", model: step.modelIdentifier, systemInstruction: step.instructions, maxOutputTokens: 2048,
      timeoutMs: TEXT_TIMEOUT_MS, parts: [...imageParts, ...(text ? [{ text }] : [])],
    };
  }
  return {
    kind: "image", model: step.modelIdentifier, aspectRatio: "3:4", imageSize: "1K", timeoutMs: IMAGE_TIMEOUT_MS,
    parts: [{ text: text ? `${step.instructions}\n\n${text}` : step.instructions }, ...imageParts],
  };
}
```

- [ ] **Step 4: Implement `src/lib/runs/errors.ts`**

```ts
import { pad2 } from "@/lib/chains/presentation";

export type RunErrorCode = "timeout" | "rate_limited" | "model_unavailable" | "rejected" | "auth" | "empty" | "unknown";
export type RunError = { code: RunErrorCode; message: string };

export class EmptyResponseError extends Error {
  constructor(readonly finishReason: string | undefined) {
    super(`empty response (${finishReason ?? "unknown"})`);
    this.name = "EmptyResponseError";
  }
}

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const statusOf = (e: unknown) =>
  typeof e === "object" && e !== null && typeof (e as { status?: unknown }).status === "number"
    ? (e as { status: number }).status
    : undefined;
const isTimeout = (e: unknown, status: number | undefined, message: string) =>
  status === 504 || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) ||
  /timed? ?out|deadline/i.test(message);

export function mapGeminiError(error: unknown, stepOrder: number, timeoutMs: number): RunError {
  const label = `Step ${pad2(stepOrder)}`;
  if (error instanceof EmptyResponseError) {
    return { code: "empty", message: `${label}: Gemini returned nothing (blocked: ${error.finishReason ?? "unknown"}). Try different input or instructions.` };
  }
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : String(error);
  if (isTimeout(error, status, message)) return { code: "timeout", message: `${label} timed out after ${Math.round(timeoutMs / 1000)} s.` };
  if (status === 429) return { code: "rate_limited", message: `${label}: Gemini is rate-limiting; try again in a minute.` };
  if (status === 404) return { code: "model_unavailable", message: `${label}: that model isn't available. Pick another model for the step.` };
  if (status === 401 || status === 403) return { code: "auth", message: `${label}: Gemini rejected the API key.` };
  if (status === 400) return { code: "rejected", message: `${label}: Gemini rejected the request (${shorten(message, 160)}).` };
  return { code: "unknown", message: `${label} failed: ${shorten(message, 200)}` };
}

/** Turns create_prompt_chain_run exceptions into sentences. */
export function mapRunStartError(message: string): string {
  if (message.includes("rate_limited")) return "You've started 20 runs in 10 minutes. Wait a few minutes and try again.";
  if (message.includes("chain_has_no_steps")) return "Add a step before running this chain.";
  const missing = /step_(\d+)_has_no_active_model/.exec(message);
  if (missing) return `Step ${pad2(Number(missing[1]))} has no active model. Choose one in the step editor.`;
  if (message.includes("prompt_chain_runs_has_input")) return "Add an image or some text.";
  return "Couldn't start the run. Try again.";
}
```

- [ ] **Step 5: Implement `src/lib/runs/live-run.ts`**

```ts
export type LiveStepStatus = "pending" | "running" | "succeeded" | "failed";
export type LiveStep = { status: LiveStepStatus; text: string | null; imageUrl: string | null; error: string | null; latencyMs: number | null };
export type LiveInput = { text: string | null; previewUrl: string | null; width: number | null; height: number | null };
export type LiveRun = {
  runId: string | null;
  state: "starting" | "running" | "succeeded" | "failed" | "incomplete";
  message: string | null;
  input: LiveInput;
  steps: LiveStep[]; // index = step position (stepOrder - 1)
};
export type StepUpdate = {
  stepOrder: number; status: "succeeded" | "failed"; text: string | null; imageUrl: string | null; error: string | null; latencyMs: number | null;
};
export type AdvanceResult = { state: "running" | "succeeded" | "failed" | "busy"; step: StepUpdate | null };

const PENDING: LiveStep = { status: "pending", text: null, imageUrl: null, error: null, latencyMs: null };

export const startLiveRun = (stepCount: number, input: LiveInput): LiveRun => ({
  runId: null, state: "starting", message: null, input, steps: Array.from({ length: stepCount }, () => PENDING),
});

export const markStarted = (live: LiveRun, runId: string): LiveRun => ({
  ...live, runId, state: "running", steps: live.steps.map((s, i) => (i === 0 ? { ...s, status: "running" } : s)),
});

export function applyAdvance(live: LiveRun, result: AdvanceResult): LiveRun {
  if (result.state === "busy") return live;
  const update = result.step;
  const steps = live.steps.map((s, i): LiveStep => {
    if (!update) return s;
    if (i + 1 === update.stepOrder) {
      return { status: update.status, text: update.text, imageUrl: update.imageUrl, error: update.error, latencyMs: update.latencyMs };
    }
    return i + 1 === update.stepOrder + 1 && result.state === "running" ? { ...s, status: "running" } : s;
  });
  const message = update?.error ?? (result.state === "failed" ? "The run failed." : null);
  return { ...live, steps, state: result.state, message };
}

export const failLiveRun = (live: LiveRun, message: string): LiveRun => ({ ...live, state: "failed", message });
export const markIncomplete = (live: LiveRun): LiveRun => ({
  ...live, state: "incomplete", message: "This run stopped responding. Start a new run.",
});

/** 1-based number of the running step, or 0 when none is running. */
export const runningStepNumber = (live: LiveRun) => live.steps.findIndex((s) => s.status === "running") + 1;
```

- [ ] **Step 6: Implement `src/lib/runs/media.ts`**

```ts
import type { Modality, SignedImage } from "@/lib/chains/types";

export type MediaStepRow = {
  step_order: number; title: string; modality: Modality; status: string; output_text: string | null;
  output_image_path: string | null; latency_ms: number | null; started_at: string | null; completed_at: string | null;
};
export type MediaRunRow = {
  id: string; created_at: string; status: "running" | "succeeded" | "failed"; error_message: string | null;
  input_text: string | null; input_image_path: string | null; input_image_width: number | null; input_image_height: number | null;
  prompt_chain_run_steps: MediaStepRow[];
};
export type MediaRun = {
  id: string; createdAt: string; statusLabel: string; failed: boolean; photo: SignedImage | null;
  finalText: string | null; finalLines: string[] | null; inputText: string | null;
  trail: { order: number; title: string; status: string }[];
};

const STALE_MS = 90_000;
const NUMBERED = /^\d+[.)]\s+/;

/** "1. a\n2. b" → ["a", "b"]; null unless every non-empty line is numbered (and there are ≥ 2). */
export function splitNumbered(text: string): string[] | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every((l) => NUMBERED.test(l)) ? lines.map((l) => l.replace(NUMBERED, "")) : null;
}

function statusLabel(row: MediaRunRow, steps: MediaStepRow[], now: number): string {
  if (row.status === "succeeded") {
    const totalMs = steps.reduce((sum, s) => sum + (s.latency_ms ?? 0), 0);
    return `Done in ${(totalMs / 1000).toFixed(1)} s`;
  }
  if (row.status === "failed") return `Failed: ${row.error_message ?? "unknown error"}`;
  const times = [row.created_at, ...steps.flatMap((s) => [s.started_at, s.completed_at])].filter((t): t is string => Boolean(t));
  return now - Math.max(...times.map((t) => Date.parse(t))) > STALE_MS ? "Incomplete" : "Running…";
}

export function toMediaRun(row: MediaRunRow, urls: Map<string, string>, now: number): MediaRun {
  const steps = [...row.prompt_chain_run_steps].sort((a, b) => a.step_order - b.step_order);
  const done = steps.filter((s) => s.status === "succeeded");
  const lastImage = [...done].reverse().find((s) => s.output_image_path && urls.has(s.output_image_path));
  const lastText = [...done].reverse().find((s) => s.output_text);
  const inputUrl = row.input_image_path ? urls.get(row.input_image_path) : undefined;
  const photo: SignedImage | null = lastImage
    ? { url: urls.get(lastImage.output_image_path!)!, width: null, height: null }
    : inputUrl ? { url: inputUrl, width: row.input_image_width, height: row.input_image_height } : null;
  const finalText = lastText?.output_text ?? null;
  return {
    id: row.id, createdAt: row.created_at, statusLabel: statusLabel(row, steps, now), failed: row.status === "failed",
    photo, finalText, finalLines: finalText ? splitNumbered(finalText) : null, inputText: row.input_text,
    trail: steps.map((s) => ({ order: s.step_order, title: s.title, status: s.status })),
  };
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run`
Expected: PASS (all files, including 18 new cases).

- [ ] **Step 8: Commit**

```bash
git add src/lib/runs tests
git commit -m "feat: add pure run engine core (step input, Gemini call plan, error mapping, live state, media view)"
```

---

### Task 7: Run engine shell (env, Gemini client, run repository, run actions)

**Files:**
- Create: `.env.local` (never committed), `scripts/gemini-smoke.mjs`, `src/lib/runs/gemini.ts`, `src/lib/runs/repository.ts`, `src/lib/runs/actions.ts`
- Modify: `tests/actions-gate.test.ts` (add the run actions)

**Interfaces:**
- Consumes:
  - Task 3 RPCs
  - Task 5 `storage.ts`
  - Task 6 `plan.ts`, `errors.ts`, `AdvanceResult`, `StepUpdate`, `MediaRunRow`
- Produces:
  - server actions `startRun(chainId, formData) → ActionResult<{ runId }>` and `advanceRun(runId) → ActionResult<AdvanceResult>`
  - `listMediaRuns(chainId) → { runs: MediaRunRow[]; urls: Map<string,string> }`
  - `createGeminiClient()`

- [ ] **Step 1: Create `.env.local`** (approved by the user: copy from `hogwumbia-admin`)

Copy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SECRET_KEY` from `/Users/tristan/.superset/projects/hogwumbia-admin/.env.local`, then add `GEMINI_API_KEY` with the key the user supplies:
```bash
grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SECRET_KEY)=' /Users/tristan/.superset/projects/hogwumbia-admin/.env.local > .env.local
printf 'GEMINI_API_KEY=%s\n' "$GEMINI_KEY_FROM_USER" >> .env.local   # value supplied by the user; never echo it
sed -E 's/=.*/=<set>/' .env.local                                     # prints names only
git check-ignore .env.local                                           # must print .env.local
```
Expected: four `NAME=<set>` lines, and `.env.local` is reported as ignored.

- [ ] **Step 2: Smoke-test both model ids with the real key**

`scripts/gemini-smoke.mjs`:
```js
// Verifies the DB's model ids work with this key before the UI depends on them.
import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const text = await ai.models.generateContent({ model: "gemini-3.5-flash-lite", contents: "Reply with exactly: ready" });
console.log("text:", text.text?.trim());
const image = await ai.models.generateContent({
  model: "gemini-3.1-flash-lite-image",
  contents: "A small red square centered on a white background",
  config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "3:4", imageSize: "1K" } },
});
const part = image.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
console.log("image:", part?.inlineData?.mimeType, part?.inlineData?.data?.length ?? 0, "base64 chars");
```
Run: `node --env-file=.env.local scripts/gemini-smoke.mjs`
Expected: `text: ready` and `image: image/png <large number> base64 chars`. If a model id fails, stop and report: the `llm_models` rows must be corrected before continuing.

- [ ] **Step 3: Extend the gate test (failing)**

In `tests/actions-gate.test.ts`, add the import after the chains import:
```ts
import * as runs from "@/lib/runs/actions";
```
and append these two entries to the `calls` array:
```ts
  ["startRun", () => runs.startRun(ID, new FormData())],
  ["advanceRun", () => runs.advanceRun(ID)],
```
Run: `npx vitest run tests/actions-gate.test.ts`
Expected: FAIL, `Cannot find module '@/lib/runs/actions'`.

- [ ] **Step 4: Implement `src/lib/runs/gemini.ts`**

```ts
import "server-only";

import { GoogleGenAI, Modality, type GenerateContentResponse } from "@google/genai";
import { EmptyResponseError } from "./errors";
import type { GeminiCall } from "./plan";

export type GeminiOutput = { text: string } | { image: { mimeType: string; bytes: Buffer } };
export type GeminiClient = { generate(call: GeminiCall): Promise<GeminiOutput> };

function toRequest(call: GeminiCall) {
  const contents = [{ role: "user", parts: call.parts }];
  if (call.kind === "text") {
    return {
      model: call.model, contents,
      config: { systemInstruction: call.systemInstruction, maxOutputTokens: call.maxOutputTokens, httpOptions: { timeout: call.timeoutMs } },
    };
  }
  return {
    model: call.model, contents,
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: { aspectRatio: call.aspectRatio, imageSize: call.imageSize },
      httpOptions: { timeout: call.timeoutMs },
    },
  };
}

function readText(response: GenerateContentResponse): GeminiOutput {
  const text = response.text?.trim();
  if (!text) throw new EmptyResponseError(response.candidates?.[0]?.finishReason);
  return { text };
}

function readImage(response: GenerateContentResponse): GeminiOutput {
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const data = part?.inlineData?.data;
  if (!data) throw new EmptyResponseError(response.candidates?.[0]?.finishReason);
  return { image: { mimeType: part?.inlineData?.mimeType ?? "image/png", bytes: Buffer.from(data, "base64") } };
}

export function createGeminiClient(apiKey = process.env.GEMINI_API_KEY): GeminiClient {
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate(call) {
      const response = await ai.models.generateContent(toRequest(call));
      return call.kind === "text" ? readText(response) : readImage(response);
    },
  };
}
```

- [ ] **Step 5: Implement `src/lib/runs/repository.ts`**

```ts
import "server-only";

import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import type { MediaRunRow } from "./media";
import { signRunImages } from "./storage";

const payload = z.object({ text: z.string().nullable(), imagePath: z.string().nullable() });
const claimSchema = z.union([
  z.object({
    state: z.literal("claimed"),
    step: z.object({
      id: z.guid(), stepOrder: z.number().int(), title: z.string(), instructions: z.string(),
      modelIdentifier: z.string(), modality: z.enum(["text", "image"]),
    }),
    runInput: payload,
    previous: payload.nullable(),
    isLast: z.boolean(),
  }),
  z.object({ state: z.enum(["succeeded", "failed", "busy"]) }),
]);
export type Claim = z.infer<typeof claimSchema>;
export type ClaimedRun = Extract<Claim, { state: "claimed" }>;

const mediaRowSchema = z.object({
  id: z.guid(), created_at: z.string(), status: z.enum(["running", "succeeded", "failed"]), error_message: z.string().nullable(),
  input_text: z.string().nullable(), input_image_path: z.string().nullable(),
  input_image_width: z.number().nullable(), input_image_height: z.number().nullable(),
  prompt_chain_run_steps: z.array(z.object({
    step_order: z.number(), title: z.string(), modality: z.enum(["text", "image"]), status: z.string(),
    output_text: z.string().nullable(), output_image_path: z.string().nullable(), latency_ms: z.number().nullable(),
    started_at: z.string().nullable(), completed_at: z.string().nullable(),
  })),
});

const raise = (label: string, error: { message: string } | null) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

export async function createRun(admin: AdminClient, run: {
  runId: string; chainId: string; userId: string; text: string | null; imagePath: string | null; width: number | null; height: number | null;
}) {
  const { error } = await admin.rpc("create_prompt_chain_run", {
    p_run_id: run.runId, p_chain_id: run.chainId, p_requested_by: run.userId, p_input_text: run.text,
    p_input_image_path: run.imagePath, p_input_image_width: run.width, p_input_image_height: run.height,
  });
  if (error) throw new Error(error.message); // message carries rate_limited / step_N_has_no_active_model
}

export async function claimNextStep(admin: AdminClient, runId: string): Promise<Claim> {
  const { data, error } = await admin.rpc("claim_next_run_step", { p_run_id: runId });
  raise("claim", error);
  return claimSchema.parse(data);
}

export async function completeStep(admin: AdminClient, stepId: string, out: { text: string | null; imagePath: string | null; latencyMs: number }) {
  const { error } = await admin.from("prompt_chain_run_steps").update({
    status: "succeeded", output_text: out.text, output_image_path: out.imagePath, latency_ms: out.latencyMs,
    completed_at: new Date().toISOString(),
  }).eq("id", stepId).eq("status", "running");
  raise("complete step", error);
}

export async function completeRun(admin: AdminClient, runId: string) {
  const { error } = await admin.from("prompt_chain_runs")
    .update({ status: "succeeded", completed_at: new Date().toISOString() }).eq("id", runId).eq("status", "running");
  raise("complete run", error);
}

export async function failStep(admin: AdminClient, runId: string, stepId: string, message: string, latencyMs: number) {
  const now = new Date().toISOString();
  const short = message.slice(0, 600);
  const { error: stepError } = await admin.from("prompt_chain_run_steps")
    .update({ status: "failed", error_message: short, latency_ms: latencyMs, completed_at: now }).eq("id", stepId);
  raise("fail step", stepError);
  const { error: runError } = await admin.from("prompt_chain_runs")
    .update({ status: "failed", error_message: short, completed_at: now }).eq("id", runId);
  raise("fail run", runError);
}

export async function listMediaRuns(admin: AdminClient, chainId: string): Promise<{ runs: MediaRunRow[]; urls: Map<string, string> }> {
  const { data, error } = await admin.from("prompt_chain_runs")
    .select("id, created_at, status, error_message, input_text, input_image_path, input_image_width, input_image_height, prompt_chain_run_steps(step_order, title, modality, status, output_text, output_image_path, latency_ms, started_at, completed_at)")
    .eq("prompt_chain_id", chainId).order("created_at", { ascending: false }).limit(30);
  raise("media runs", error);
  const runs = z.array(mediaRowSchema).parse(data);
  const paths = runs.flatMap((r) => [r.input_image_path, ...r.prompt_chain_run_steps.map((s) => s.output_image_path)]);
  return { runs, urls: await signRunImages(admin, paths.filter((p): p is string => Boolean(p))) };
}
```

- [ ] **Step 6: Implement `src/lib/runs/actions.ts`**

```ts
"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { pad2 } from "@/lib/chains/presentation";
import { buildGeminiCall, hasInput, stepInput, TEXT_TIMEOUT_MS, type ClaimedStep } from "./plan";
import { mapGeminiError, mapRunStartError } from "./errors";
import { createGeminiClient, type GeminiOutput } from "./gemini";
import { downloadRunImage, extFromMime, RUN_BUCKET, signRunImages, uploadRunImage } from "./storage";
import * as runs from "./repository";
import type { AdvanceResult } from "./live-run";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const dimension = z.coerce.number().int().min(1).max(20000).nullable();
const startSchema = z.object({
  chainId: z.guid(),
  text: z.string().trim().max(2000, "Keep the text under 2,000 characters").transform((v) => (v === "" ? null : v)),
  width: dimension,
  height: dimension,
});

function readImage(formData: FormData): File | null | "invalid" {
  const value = formData.get("image");
  if (!(value instanceof File) || value.size === 0) return null;
  return IMAGE_TYPES.has(value.type) && value.size <= MAX_IMAGE_BYTES ? value : "invalid";
}

export async function startRun(chainId: string, formData: FormData): Promise<ActionResult<{ runId: string }>> {
  const { user } = await requireAdmin();
  const image = readImage(formData);
  const parsed = startSchema.safeParse({
    chainId, text: formData.get("text") ?? "", width: formData.get("width") || null, height: formData.get("height") || null,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the run input.");
  if (image === "invalid") return fail("Use a JPG, PNG or WebP image under 4 MB.");
  if (!image && !parsed.data.text) return fail("Add an image or some text.");

  const admin = createAdminClient();
  const runId = randomUUID();
  const imagePath = image ? `${runId}/input.${extFromMime(image.type)}` : null;
  try {
    if (image && imagePath) await uploadRunImage(admin, imagePath, image, image.type);
    await runs.createRun(admin, {
      runId, chainId: parsed.data.chainId, userId: user.id, text: parsed.data.text, imagePath,
      width: image ? parsed.data.width : null, height: image ? parsed.data.height : null,
    });
  } catch (error) {
    const message = (error as Error).message;
    console.error("[runs] start failed", { chainId, message });
    if (imagePath) await admin.storage.from(RUN_BUCKET).remove([imagePath]);
    return fail(mapRunStartError(message));
  }
  return ok({ runId });
}

export async function advanceRun(runId: string): Promise<ActionResult<AdvanceResult>> {
  await requireAdmin();
  if (!z.guid().safeParse(runId).success) return fail("Unknown run.");
  const admin = createAdminClient();
  let claim: runs.Claim;
  try {
    claim = await runs.claimNextStep(admin, runId);
  } catch (error) {
    console.error("[runs] claim failed", { runId, message: (error as Error).message });
    return fail("Couldn't continue the run. Try again.");
  }
  if (claim.state !== "claimed") return ok({ state: claim.state, step: null });
  return ok(await executeStep(admin, runId, claim));
}

async function executeStep(admin: AdminClient, runId: string, claim: runs.ClaimedRun): Promise<AdvanceResult> {
  const { step } = claim;
  const input = stepInput(claim.runInput, claim.previous);
  if (!hasInput(input)) return failWith(admin, runId, step, `Step ${pad2(step.stepOrder)} received no input.`, 0);
  const started = Date.now();
  let timeoutMs = TEXT_TIMEOUT_MS;
  let output: GeminiOutput;
  try {
    const image = input.imagePath ? await downloadRunImage(admin, input.imagePath) : null;
    const call = buildGeminiCall(step, { text: input.text, image });
    timeoutMs = call.timeoutMs;
    output = await createGeminiClient().generate(call);
  } catch (error) {
    const mapped = mapGeminiError(error, step.stepOrder, timeoutMs);
    console.error("[runs] step failed", {
      runId, stepOrder: step.stepOrder, model: step.modelIdentifier, latencyMs: Date.now() - started, code: mapped.code,
    });
    return failWith(admin, runId, step, mapped.message, Date.now() - started);
  }
  return saveOutput(admin, runId, claim, output, Date.now() - started);
}

async function saveOutput(admin: AdminClient, runId: string, claim: runs.ClaimedRun, output: GeminiOutput, latencyMs: number): Promise<AdvanceResult> {
  const { step } = claim;
  try {
    const imagePath = "image" in output ? `${runId}/step-${pad2(step.stepOrder)}.${extFromMime(output.image.mimeType)}` : null;
    if ("image" in output && imagePath) await uploadRunImage(admin, imagePath, output.image.bytes, output.image.mimeType);
    const text = "text" in output ? output.text.slice(0, 20000) : null;
    await runs.completeStep(admin, step.id, { text, imagePath, latencyMs });
    if (claim.isLast) await runs.completeRun(admin, runId);
    const urls = imagePath ? await signRunImages(admin, [imagePath]) : new Map<string, string>();
    return {
      state: claim.isLast ? "succeeded" : "running",
      step: { stepOrder: step.stepOrder, status: "succeeded", text, imageUrl: imagePath ? urls.get(imagePath) ?? null : null, error: null, latencyMs },
    };
  } catch (error) {
    console.error("[runs] saving output failed", { runId, stepOrder: step.stepOrder, message: (error as Error).message });
    return failWith(admin, runId, step, `Step ${pad2(step.stepOrder)}: couldn't save the output. Try again.`, latencyMs);
  }
}

async function failWith(admin: AdminClient, runId: string, step: ClaimedStep, message: string, latencyMs: number): Promise<AdvanceResult> {
  try {
    await runs.failStep(admin, runId, step.id, message, latencyMs);
  } catch (error) {
    console.error("[runs] recording failure failed", { runId, message: (error as Error).message });
  }
  return { state: "failed", step: { stepOrder: step.stepOrder, status: "failed", text: null, imageUrl: null, error: message, latencyMs } };
}
```

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: all pass (the gate test now has 8 cases).

- [ ] **Step 8: Commit**

```bash
git add scripts src tests
git commit -m "feat: add Gemini client, run repository and step-per-request run actions"
```

---

### Task 8: Visual system, theme, app shell, collection and new-chain form

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/wall.css`, `src/styles/pages.css`, `src/components/theme/theme-provider.tsx`, `src/components/theme/theme-switch.tsx`, `src/components/site-nav.tsx`, `src/components/site-header.tsx`, `src/components/chain-form.tsx`, `src/app/(tool)/layout.tsx`, `src/app/(tool)/page.tsx`, `src/app/(tool)/chains/new/page.tsx`
- Modify: `src/app/layout.tsx` (replace entirely), `src/app/login/page.tsx` (add theme switch)
- Delete: `src/app/page.tsx` (temporary; it conflicts with `(tool)/page.tsx`)

**Interfaces:**
- Consumes:
  - `requireAdmin` (Task 2)
  - `listChainSummaries` (Task 5)
  - `createChain`, `updateChain` (Task 5)
  - `describeTrail`, `ratioOf`, `tileColor` (Task 4)
- Produces:
  - `<ThemeProvider>`, `<ThemeSwitch>`, `<SiteHeader>`
  - `<ChainForm mode="create" />` and `<ChainForm mode="edit" chainId values onDone onCancel />`
  - CSS classes used by later tasks: `container page split display-1/2/3 eyebrow lede btn btn--primary btn--strong btn--danger link link--danger field field__label field__input field__error field__count check actions-row notice confirm sr-only crumb chain-head chain-head__meta chain-head__actions wall-bar wall wall__col wall__col--done node node__mark node__mark--hollow node__label card-media card-media--photo card-media--text tile tile--{cyan,lime,orange,mint,running,waiting,failed,empty} tile__n tile__q card-title card-meta card-stat card-stat--failed moves moves__btn add-tile editor editor__flow run-panel drop run-status section-title run-card run-card__photo trail output-list output-text`

- [ ] **Step 1: Write the CSS**

`src/styles/tokens.css`:
```css
:root {
  --paper: #ffffff;
  --ink: #000000;
  --muted: #6b6b6b;
  --soft: #e9e9e9;
  --panel: #f2f2f2;
  --cyan: #12b5ea;
  --lime: #92c83e;
  --orange: #ff8b1f;
  --mint: #6cd9c3;
  --danger: #d62d20;
  --font: var(--font-franklin), "Libre Franklin", Helvetica, Arial, sans-serif;
  --gutter: clamp(16px, 4vw, 40px);
  --wall-h: 380px;
  color-scheme: light;
}

[data-theme="dark"] {
  --paper: #0e0e0e;
  --ink: #f3f3f3;
  --muted: #a3a3a3;
  --soft: #2b2b2b;
  --panel: #1b1b1b;
  --danger: #ff6b5e; /* lighter red keeps 4.5:1 contrast on the dark paper */
  color-scheme: dark;
}

@media (max-width: 640px) {
  :root { --wall-h: 240px; }
}
```

`src/styles/base.css`:
```css
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--font); font-size: 16px; line-height: 1.35; }
a { color: inherit; }
img { display: block; max-width: 100%; }
button, input, textarea, select { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid var(--cyan); outline-offset: 2px; }

.container { max-width: 1180px; margin: 0 auto; padding-inline: var(--gutter); }
.page { padding-block: 22px 64px; }
.display-1 { font-weight: 900; font-size: clamp(36px, 6vw, 56px); letter-spacing: -0.03em; line-height: 0.93; margin: 0; }
.display-2 { font-weight: 900; font-size: clamp(26px, 3.4vw, 34px); letter-spacing: -0.025em; line-height: 0.95; margin: 0; }
.display-3 { font-weight: 900; font-size: 24px; letter-spacing: -0.02em; line-height: 1; margin: 0; }
.section-title { font-weight: 900; font-size: 20px; letter-spacing: -0.015em; margin: 0 0 14px; }
.eyebrow { font-size: 12px; font-weight: 600; color: var(--muted); margin: 0 0 6px; }
.lede { font-size: 15px; max-width: 46ch; margin: 10px 0 0; }
.wordmark { font-weight: 900; font-size: 40px; letter-spacing: -0.035em; line-height: 0.9; text-decoration: none; margin: 0; }
.wordmark--xl { font-size: clamp(72px, 13vw, 128px); }

.btn { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 0; padding: 8px 12px; font-weight: 800; font-size: 14px; line-height: 1.1; cursor: pointer; text-decoration: none; background: var(--soft); color: var(--ink); white-space: nowrap; }
.btn--primary { background: var(--cyan); color: #000; }
.btn--strong { background: var(--ink); color: var(--paper); }
.btn--danger { background: var(--danger); color: #000; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn:hover:not(:disabled), .link:hover { text-decoration: underline; }
.link { font-weight: 800; font-size: 14px; text-decoration: none; background: none; border: 0; padding: 0; cursor: pointer; }
.link--danger { color: var(--danger); }

.site-header { border-bottom: 1px solid var(--ink); }
.site-header__top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-top: 20px; flex-wrap: wrap; }
.site-header__tools { display: flex; align-items: center; gap: 8px; }
.site-nav { display: flex; gap: 26px; padding-block: 14px 12px; font-weight: 800; font-size: 15px; }
.site-nav a { text-decoration: none; padding-bottom: 3px; }
.site-nav a[aria-current="page"] { box-shadow: inset 0 -3px 0 var(--ink); }

.seg { display: inline-flex; border: 1px solid var(--ink); }
.seg__item { border: 0; background: transparent; padding: 5px 9px; font-size: 12px; font-weight: 800; cursor: pointer; }
.seg__item[aria-pressed="true"] { background: var(--ink); color: var(--paper); }

.field { display: block; margin-top: 12px; }
.field__label { display: block; font-size: 12px; font-weight: 800; margin-bottom: 5px; }
.field__input { width: 100%; border: 1px solid var(--ink); border-radius: 0; background: var(--paper); padding: 9px 11px; font-size: 15px; }
textarea.field__input { resize: vertical; line-height: 1.45; }
.field__error { color: var(--danger); font-size: 13px; font-weight: 700; margin: 4px 0 0; }
.field__count { color: var(--muted); font-size: 12px; text-align: right; margin: 4px 0 0; }
.check { display: inline-flex; gap: 8px; align-items: center; margin-top: 14px; font-weight: 700; font-size: 14px; }
.actions-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 16px; }
.confirm { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; font-weight: 800; font-size: 14px; }
.notice { background: var(--orange); color: #000; font-weight: 800; font-size: 14px; padding: 10px 12px; margin: 16px 0 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
```

`src/styles/wall.css`:
```css
.wall-bar { display: flex; justify-content: flex-end; gap: 4px; margin-bottom: 8px; }
.wall-bar button { border: 0; background: none; font-weight: 900; font-size: 22px; cursor: pointer; padding: 2px 6px; }
.wall { display: flex; overflow-x: auto; padding-bottom: 12px; scroll-behavior: smooth; }
.wall__col { position: relative; flex: none; padding-right: 26px; }
.wall__col::before { content: ""; position: absolute; left: 0; right: 0; top: 6px; height: 1px; background: var(--ink); }
.wall__col:last-child::before { display: none; }
.wall__col--done::before { top: 5px; height: 3px; }
.node { position: relative; display: flex; align-items: center; gap: 7px; font-weight: 900; font-size: 13px; margin-bottom: 14px; }
.node__mark { width: 13px; height: 13px; background: var(--ink); flex: none; }
.node__mark--hollow { background: var(--paper); border: 1px solid var(--ink); }
.node__label { background: var(--paper); padding-right: 6px; }
.card-media { display: block; height: var(--wall-h); overflow: hidden; border: 0; padding: 0; background: none; text-align: left; }
button.card-media { cursor: pointer; }
.card-media--photo { aspect-ratio: var(--ratio, 3 / 4); }
.card-media--text { width: 176px; }
.card-media[aria-pressed="true"] { outline: 3px solid var(--ink); outline-offset: 4px; }
.card-media img { width: 100%; height: 100%; object-fit: cover; }
.tile { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: space-between; padding: 12px; color: #000; }
.tile__n { font-weight: 900; font-size: 44px; letter-spacing: -0.04em; line-height: 0.9; }
.tile__q { font-weight: 800; font-size: 13.5px; line-height: 1.2; overflow-wrap: anywhere; }
.tile--cyan { background: var(--cyan); }
.tile--lime { background: var(--lime); }
.tile--orange { background: var(--orange); }
.tile--mint { background: var(--mint); }
.tile--running { color: var(--ink); border: 1px solid var(--ink); background: repeating-linear-gradient(-45deg, var(--paper) 0 9px, var(--soft) 9px 18px); background-size: 200% 200%; animation: tile-stripes 2.5s linear infinite; }
.tile--waiting, .tile--empty { color: var(--muted); border: 1px dashed var(--ink); background: transparent; }
.tile--failed { color: var(--danger); border: 1px solid var(--danger); background: transparent; }
@keyframes tile-stripes { to { background-position: 100% 100%; } }
@media (prefers-reduced-motion: reduce) { .tile--running { animation: none; } }
.card-title { font-weight: 800; font-size: 16px; letter-spacing: -0.01em; margin: 12px 0 0; max-width: 26ch; }
.card-meta { font-style: italic; font-size: 13px; margin: 0; }
.card-stat { font-size: 12.5px; font-weight: 700; color: var(--muted); margin: 4px 0 0; }
.card-stat--failed { color: var(--danger); }
.moves { display: flex; gap: 2px; margin-top: 6px; }
.moves__btn { border: 0; background: none; font-weight: 900; font-size: 16px; cursor: pointer; padding: 2px 6px; }
.moves__btn:disabled { opacity: 0.25; cursor: default; }
.add-tile { width: 64px; height: var(--wall-h); margin-top: 27px; border: 1px dashed var(--ink); background: none; font-weight: 900; font-size: 26px; cursor: pointer; }
.add-tile[aria-pressed="true"] { outline: 3px solid var(--ink); outline-offset: 4px; }
.editor { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 32px; margin-top: 34px; padding-top: 22px; border-top: 3px solid var(--ink); }
.editor__flow { font-size: 14px; line-height: 1.45; margin: 12px 0 0; }
@media (max-width: 768px) { .editor { grid-template-columns: 1fr; gap: 12px; } }
```

`src/styles/pages.css`:
```css
.split { display: grid; grid-template-columns: minmax(200px, 300px) minmax(0, 1fr); gap: 32px; }
@media (max-width: 768px) { .split { grid-template-columns: 1fr; } }
.crumb { font-size: 12px; font-weight: 600; color: var(--muted); margin: 0 0 12px; }
.crumb a { text-decoration: none; }
.crumb strong { color: var(--ink); }

.chain-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap; margin-bottom: 26px; }
.chain-head__meta { font-size: 14px; margin: 10px 0 0; max-width: 60ch; }
.chain-head__actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.run-panel { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 28px; background: var(--cyan); color: #000; padding: 22px 24px; margin-bottom: 28px; }
.run-panel p { font-size: 14px; max-width: 34ch; margin: 8px 0 0; }
.run-panel .field__input { border-color: #000; background: rgba(255, 255, 255, 0.4); color: #000; }
.run-panel .btn--strong { background: #000; color: #fff; }
.drop { display: flex; gap: 12px; align-items: center; border: 1px solid #000; padding: 12px; background: rgba(255, 255, 255, 0.35); font-size: 13px; font-weight: 800; cursor: pointer; }
.drop img { width: 44px; height: 58px; object-fit: cover; }
.run-status { font-size: 13px; font-weight: 800; margin-top: 12px; }
@media (max-width: 768px) { .run-panel { grid-template-columns: 1fr; } }

.collection-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px 24px; list-style: none; padding: 0; margin: 0; }
@media (max-width: 1024px) { .collection-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .collection-grid { grid-template-columns: 1fr; } }
.chain-card { display: block; text-decoration: none; }
.chain-card__cover { aspect-ratio: 1 / 1; overflow: hidden; }
.chain-card__cover img { width: 100%; height: 100%; object-fit: cover; }
.chain-card:hover .card-title { text-decoration: underline; }

.run-card { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 26px; padding-bottom: 26px; margin-bottom: 26px; border-bottom: 1px solid var(--ink); }
.run-card__photo { aspect-ratio: var(--ratio, 3 / 4); overflow: hidden; max-height: 640px; }
.run-card__photo img { width: 100%; height: 100%; object-fit: cover; }
.trail { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 14px; padding: 0; list-style: none; }
.trail li { font-size: 11px; font-weight: 800; padding: 4px 7px; color: #000; }
.output-list { padding-left: 22px; font-size: 17px; line-height: 1.35; font-weight: 600; margin: 12px 0 0; }
.output-list li { margin-bottom: 8px; }
.output-text { white-space: pre-wrap; font-size: 16px; line-height: 1.45; margin: 12px 0 0; }
@media (max-width: 768px) { .run-card { grid-template-columns: 1fr; } }

.login { min-height: 100svh; display: flex; flex-direction: column; justify-content: center; gap: 6px; padding-block: 56px; }
.login__bar { position: absolute; top: 20px; right: var(--gutter); }
```

- [ ] **Step 2: Theme components**

`src/components/theme/theme-provider.tsx`:
```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
```

`src/components/theme/theme-switch.tsx`:
```tsx
"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const OPTIONS = [["light", "Light"], ["dark", "Dark"], ["system", "System"]] as const;
const noopSubscribe = () => () => {};

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  // The stored choice is unknown on the server; render all buttons unpressed until hydrated.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <div className="seg" role="group" aria-label="Color theme">
      {OPTIONS.map(([value, label]) => (
        <button key={value} type="button" className="seg__item" aria-pressed={hydrated && theme === value} onClick={() => setTheme(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Root layout (replace `src/app/layout.tsx`) and delete the placeholder page**

```tsx
import type { Metadata } from "next";
import { Libre_Franklin } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/wall.css";
import "@/styles/pages.css";

const franklin = Libre_Franklin({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-franklin", display: "swap" });

export const metadata: Metadata = {
  title: { default: "MoPC · Museum of Prompt Chains", template: "%s · MoPC" },
  description: "Superadmin workshop for building, ordering and running Hog Wumbia's prompt chains.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={franklin.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```
Run: `git rm src/app/page.tsx`

- [ ] **Step 4: Header and tool layout**

`src/components/site-nav.tsx`:
```tsx
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
```

`src/components/site-header.tsx`:
```tsx
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
```

`src/app/(tool)/layout.tsx`:
```tsx
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
```

- [ ] **Step 5: Chain form**

`src/components/chain-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/action-result";
import { createChain, updateChain } from "@/lib/chains/actions";

type Values = { name: string; description: string | null; isActive: boolean };
type Props =
  | { mode: "create" }
  | { mode: "edit"; chainId: string; values: Values; onDone: () => void; onCancel: () => void };

const EMPTY: Values = { name: "", description: null, isActive: true };

export function ChainForm(props: Props) {
  const values = props.mode === "edit" ? props.values : EMPTY;
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, formData) => {
    if (props.mode === "create") return createChain(prev, formData);
    const result = await updateChain(props.chainId, prev, formData);
    if (result.ok) props.onDone();
    return result;
  }, { ok: false });

  return (
    <form action={formAction} noValidate>
      <label className="field">
        <span className="field__label">Name</span>
        <input className="field__input" name="name" defaultValue={values.name} maxLength={120} aria-invalid={Boolean(state.fieldErrors?.name)} />
      </label>
      {state.fieldErrors?.name && <p className="field__error">{state.fieldErrors.name}</p>}
      <label className="field">
        <span className="field__label">Description</span>
        <textarea className="field__input" name="description" defaultValue={values.description ?? ""} maxLength={600} rows={3} />
      </label>
      {state.fieldErrors?.description && <p className="field__error">{state.fieldErrors.description}</p>}
      <label className="check">
        <input type="checkbox" name="isActive" defaultChecked={values.isActive} /> Active
      </label>
      {state.error && <p className="notice" role="alert">{state.error}</p>}
      <div className="actions-row">
        <button className="btn btn--strong" type="submit" disabled={pending}>
          {pending ? "Saving…" : props.mode === "create" ? "Create chain" : "Save details"}
        </button>
        {props.mode === "edit" && <button className="btn" type="button" onClick={props.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
```

- [ ] **Step 6: Collection and new-chain pages**

`src/app/(tool)/page.tsx`:
```tsx
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { describeTrail, ratioOf, tileColor } from "@/lib/chains/presentation";
import { listChainSummaries } from "@/lib/chains/queries";

export default async function CollectionPage() {
  await requireAdmin();
  const chains = await listChainSummaries();
  const active = chains.filter((chain) => chain.isActive).length;
  return (
    <section className="split">
      <div>
        <h1 className="display-2">Prompt chains in the collection</h1>
        <p className="lede">{chains.length} chains · {active} active</p>
        <p className="actions-row"><Link className="link" href="/chains/new">+ New chain →</Link></p>
      </div>
      <ul className="collection-grid">
        {chains.map((chain, index) => (
          <li key={chain.id}>
            <Link className="chain-card" href={`/chains/${chain.id}`}>
              <div className="chain-card__cover">
                {chain.cover ? (
                  <img src={chain.cover.url} alt="" style={{ aspectRatio: ratioOf(chain.cover) }} />
                ) : (
                  <span className={`tile tile--${tileColor(index)}`}>
                    <span className="tile__n">{chain.trail.length}</span>
                    <span className="tile__q">{chain.trail.length === 1 ? "step" : "steps"}</span>
                  </span>
                )}
              </div>
              <p className="card-title">{chain.name}</p>
              <p className="card-meta">{describeTrail(chain.trail)}{chain.isActive ? "" : " · Inactive"}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`src/app/(tool)/chains/new/page.tsx`:
```tsx
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
```

- [ ] **Step 7: Theme switch on the login page**

In `src/app/login/page.tsx`, add `import { ThemeSwitch } from "@/components/theme/theme-switch";` and make `<div className="login__bar"><ThemeSwitch /></div>` the first child of `<main>`.

- [ ] **Step 8: Allow local and Vercel logins in Supabase Auth** (approved by the user: Management API)

```bash
RAW=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null)
TOKEN=$(printf '%s' "$RAW" | sed 's/^go-keyring-base64://' | { base64 -d 2>/dev/null || printf '%s' "$RAW"; })
API=https://api.supabase.com/v1/projects/mtbtwriiqbsottfhwrma/config/auth
CURRENT=$(curl -fsS -H "Authorization: Bearer $TOKEN" "$API" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).uri_allow_list||""))')
echo "current: $CURRENT"
NEXT=$(node -e 'const add=["http://localhost:3002/**","https://promptchain-*-raise-e9d2cfef.vercel.app/**"];const cur=process.argv[1].split(",").map(s=>s.trim()).filter(Boolean);console.log([...new Set([...cur,...add])].join(","))' "$CURRENT")
curl -fsS -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(node -e 'console.log(JSON.stringify({uri_allow_list:process.argv[1]}))' "$NEXT")" "$API" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("now:",JSON.parse(s).uri_allow_list))'
```
Expected: `now:` lists every previous entry plus the two new ones. If no token is found (empty `TOKEN`, or curl 401), stop and ask the user to add both URLs under Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.

- [ ] **Step 9: Verify**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`
Expected: all pass; the build lists `/`, `/chains/new`, `/login`, `/auth/callback`.
Then run `npm run dev`, then `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3002/`.
Expected: `307 http://localhost:3002/login`. Ask the user to sign in at http://localhost:3002/login and confirm they see the collection with 15 chains, and that Light, Dark and System all work.

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "feat: add MoMA-style visual system, theme switch, app shell, collection and new-chain form"
```

---

### Task 9: Chain workspace (wall, step editor, reorder, run panel)

**Files:**
- Create:
  - `src/lib/chains/card-view.ts` (pure)
  - `src/lib/runs/prepare-image.ts` (browser)
  - `src/components/workspace/use-chain-run.ts`
  - `src/components/workspace/run-panel.tsx`
  - `src/components/workspace/chain-header.tsx`
  - `src/components/workspace/step-card.tsx`
  - `src/components/workspace/wall.tsx`
  - `src/components/workspace/step-editor.tsx`
  - `src/components/workspace/chain-workspace.tsx`
  - `src/app/(tool)/chains/[id]/page.tsx`
- Test: `tests/card-view.test.ts`

**Interfaces:**
- Consumes:
  - `ChainDetail`, `ChainStep`, `LlmModel` (Task 4)
  - `getChainDetail`, `listActiveModels`, `deleteChain`, `saveStep`, `deleteStep`, `reorderSteps` (Task 5)
  - `startRun`, `advanceRun` (Task 7)
  - `LiveRun`, `startLiveRun`, `markStarted`, `applyAdvance`, `failLiveRun`, `markIncomplete`, `runningStepNumber` (Task 6)
  - `moveStep`, `pad2`, `ratioOf`, `snippet`, `tileColor` (Task 4)
  - `ChainForm` (Task 8)
- Produces:
  - `card-view.ts`: `CardView`, `stepCardView(step, index, live)`, `inputCardView(latestInput, live)`, `describeFlow(steps, index)`
  - `prepare-image.ts`: `PreparedImage`, `prepareImage(file)`
  - `<ChainWorkspace chain models />`

- [ ] **Step 1: Write the failing test**

`tests/card-view.test.ts`:
```ts
import { expect, it } from "vitest";
import { describeFlow, inputCardView, stepCardView } from "@/lib/chains/card-view";
import type { ChainStep } from "@/lib/chains/types";
import { markStarted, startLiveRun } from "@/lib/runs/live-run";

const model = (modality: "text" | "image") => ({ id: "m", name: "M", identifier: "m", modality, isActive: true });
const step = (id: string, modality: "text" | "image", latest: ChainStep["latest"] = null): ChainStep => ({
  id, order: 1, title: id, instructions: "x", model: model(modality), latest,
});

it("shows the latest image output as a 3:4 photo", () => {
  const view = stepCardView(step("a", "image", { text: null, image: { url: "u", width: null, height: null } }), 0, null);
  expect(view).toEqual({ kind: "photo", url: "u", ratio: "3 / 4", stat: null });
});

it("shows live progress over saved outputs", () => {
  const live = markStarted(startLiveRun(2, { text: "t", previewUrl: null, width: null, height: null }), "r");
  expect(stepCardView(step("a", "text"), 0, live)).toMatchObject({ kind: "tile", tone: "running" });
  expect(stepCardView(step("b", "text"), 1, live)).toMatchObject({ kind: "tile", tone: "waiting" });
});

it("uses an empty placeholder before any run", () => {
  expect(inputCardView(null, null)).toEqual({ kind: "tile", tone: "empty", text: "Your image or text", stat: null });
});

it("describes what a step receives and sends", () => {
  const steps = [step("a", "text"), step("b", "image")];
  expect(describeFlow(steps, 0)).toEqual({ receives: "Receives your image and/or text.", sends: "Sends text to step 02." });
  expect(describeFlow(steps, 1)).toEqual({ receives: "Receives text from step 01.", sends: "Its output is the chain's final result." });
});
```
Run: `npx vitest run tests/card-view.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement `src/lib/chains/card-view.ts`**

```ts
import type { LiveRun } from "@/lib/runs/live-run";
import { pad2, ratioOf, snippet, tileColor } from "./presentation";
import type { ChainStep, StepOutput } from "./types";

export type CardView =
  | { kind: "photo"; url: string; ratio: string; stat: string | null }
  | { kind: "tile"; tone: string; text: string | null; stat: string | null };

const done = (ms: number | null) => (ms === null ? "Done" : `Done · ${(ms / 1000).toFixed(1)} s`);

function fromOutput(output: StepOutput | null, tone: string): CardView {
  if (output?.image) return { kind: "photo", url: output.image.url, ratio: ratioOf(output.image), stat: null };
  return { kind: "tile", tone, text: output?.text ? snippet(output.text) : null, stat: null };
}

export function stepCardView(step: ChainStep, index: number, live: LiveRun | null): CardView {
  const color = tileColor(index);
  const state = live?.steps[index];
  if (!state) return fromOutput(step.latest, color);
  if (state.status === "pending") return { kind: "tile", tone: "waiting", text: "Waiting", stat: "Waiting" };
  if (state.status === "running") return { kind: "tile", tone: "running", text: "Running…", stat: "Running" };
  if (state.status === "failed") return { kind: "tile", tone: "failed", text: state.error, stat: "Failed" };
  return state.imageUrl
    ? { kind: "photo", url: state.imageUrl, ratio: "3 / 4", stat: done(state.latencyMs) }
    : { kind: "tile", tone: color, text: state.text ? snippet(state.text) : null, stat: done(state.latencyMs) };
}

export function inputCardView(latestInput: StepOutput | null, live: LiveRun | null): CardView {
  if (live) {
    const { previewUrl, width, height, text } = live.input;
    if (previewUrl) return { kind: "photo", url: previewUrl, ratio: width && height ? `${width} / ${height}` : "3 / 4", stat: "This run" };
    return { kind: "tile", tone: "mint", text: text ? snippet(text) : null, stat: "This run" };
  }
  if (latestInput?.image) return { kind: "photo", url: latestInput.image.url, ratio: ratioOf(latestInput.image), stat: null };
  if (latestInput?.text) return { kind: "tile", tone: "mint", text: snippet(latestInput.text), stat: null };
  return { kind: "tile", tone: "empty", text: "Your image or text", stat: null };
}

export function describeFlow(steps: readonly ChainStep[], index: number): { receives: string; sends: string } {
  const receives = index === 0
    ? "Receives your image and/or text."
    : `Receives ${steps[index - 1]?.model?.modality ?? "text"} from step ${pad2(index)}.`;
  const sends = index < steps.length - 1
    ? `Sends ${steps[index]?.model?.modality ?? "its output"} to step ${pad2(index + 2)}.`
    : "Its output is the chain's final result.";
  return { receives, sends };
}
```
Run: `npx vitest run tests/card-view.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Browser image preparation**

`src/lib/runs/prepare-image.ts`:
```ts
export type PreparedImage = { blob: Blob; width: number; height: number; previewUrl: string };

const MAX_EDGE = 1600;
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Downscales in the browser so uploads stay under Vercel's 4.5 MB request cap. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!TYPES.has(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't resize images.");
  context.fillStyle = "#ffffff"; // flatten transparency before JPEG encoding
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))), "image/jpeg", 0.85),
  );
  if (blob.size > MAX_BYTES) throw new Error("That image is still over 4 MB after resizing.");
  return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
}
```

- [ ] **Step 4: Run loop hook**

`src/components/workspace/use-chain-run.ts`:
```ts
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { advanceRun, startRun } from "@/lib/runs/actions";
import { applyAdvance, failLiveRun, markIncomplete, markStarted, startLiveRun, type LiveRun } from "@/lib/runs/live-run";
import type { PreparedImage } from "@/lib/runs/prepare-image";

const BUSY_RETRY_MS = 1_500;
const BUSY_GIVE_UP_MS = 90_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type RunRequest = { image: PreparedImage | null; text: string };

export function useChainRun(chainId: string, stepCount: number) {
  const router = useRouter();
  const [live, setLive] = useState<LiveRun | null>(null);
  const inFlight = useRef(false);

  async function loop(runId: string) {
    let busySince: number | null = null;
    for (;;) {
      const response = await advanceRun(runId);
      if (!response.ok) return setLive((l) => l && failLiveRun(l, response.error));
      const result = response.data;
      if (result.state === "busy") {
        busySince ??= Date.now();
        if (Date.now() - busySince > BUSY_GIVE_UP_MS) return setLive((l) => l && markIncomplete(l));
        await wait(BUSY_RETRY_MS);
        continue;
      }
      busySince = null;
      setLive((l) => l && applyAdvance(l, result));
      if (result.state !== "running") return;
    }
  }

  async function start({ image, text }: RunRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLive(startLiveRun(stepCount, {
      text: text.trim() || null, previewUrl: image?.previewUrl ?? null, width: image?.width ?? null, height: image?.height ?? null,
    }));
    try {
      const formData = new FormData();
      formData.set("text", text);
      if (image) {
        formData.set("image", image.blob, "input.jpg");
        formData.set("width", String(image.width));
        formData.set("height", String(image.height));
      }
      const started = await startRun(chainId, formData);
      if (!started.ok) return setLive((l) => l && failLiveRun(l, started.error));
      setLive((l) => l && markStarted(l, started.data.runId));
      await loop(started.data.runId);
      router.refresh();
    } catch (error) {
      console.error("[run] client loop failed", error);
      setLive((l) => l && failLiveRun(l, "The connection dropped. Check the media page for this run's state."));
    } finally {
      inFlight.current = false;
    }
  }

  const running = live?.state === "starting" || live?.state === "running";
  return { live, running, start, clear: () => setLive(null) };
}
```

- [ ] **Step 5: Run panel**

`src/components/workspace/run-panel.tsx`:
```tsx
"use client";

import { useState, type FormEvent } from "react";
import { prepareImage, type PreparedImage } from "@/lib/runs/prepare-image";
import { runningStepNumber, type LiveRun } from "@/lib/runs/live-run";
import type { RunRequest } from "./use-chain-run";

function statusLine(live: LiveRun, total: number): string | null {
  if (live.state === "starting") return "Starting…";
  if (live.state === "running") return `Running step ${runningStepNumber(live)} of ${total}…`;
  if (live.state === "succeeded") return "Done. The outputs are on the wall.";
  return live.message;
}

type Props = { stepCount: number; live: LiveRun | null; running: boolean; onStart: (request: RunRequest) => void };

export function RunPanel({ stepCount, live, running, onStart }: Props) {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!image && !text.trim()) return setError("Add an image or some text.");
    setError(null);
    onStart({ image, text });
  }

  const status = live ? statusLine(live, stepCount) : null;
  return (
    <section className="run-panel" aria-label="Run this chain">
      <div>
        <h2 className="display-3">Run this chain</h2>
        <p>Step 01 receives your image and text. Each step&apos;s output becomes the next step&apos;s input.</p>
      </div>
      <form onSubmit={submit}>
        <label className="drop">
          {image && <img src={image.previewUrl} alt="Selected input" />}
          <span>
            {image ? `${image.width} × ${image.height} · ${(image.blob.size / 1024 / 1024).toFixed(1)} MB` : preparing ? "Preparing image…" : "Choose an image (JPG, PNG or WebP)"}
            <br /><u>{image ? "Replace" : "Browse"}</u>
          </span>
          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={running} onChange={(e) => choose(e.target.files?.[0])} />
        </label>
        <label className="field">
          <span className="field__label">Text for step 01 (optional)</span>
          <textarea className="field__input" rows={2} maxLength={2000} value={text} disabled={running} onChange={(e) => setText(e.target.value)} />
        </label>
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="actions-row">
          <button className="btn btn--strong" type="submit" disabled={running || preparing}>
            {running ? "Running…" : `Run ${stepCount} ${stepCount === 1 ? "step" : "steps"} →`}
          </button>
        </div>
        {status && <p className="run-status" role="status">{status}</p>}
      </form>
    </section>
  );
}
```

- [ ] **Step 6: Chain header**

`src/components/workspace/chain-header.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChainForm } from "@/components/chain-form";
import { deleteChain } from "@/lib/chains/actions";
import type { ChainDetail } from "@/lib/chains/types";

type Props = { chain: ChainDetail; runOpen: boolean; onToggleRun: () => void };

export function ChainHeader({ chain, runOpen, onToggleRun }: Props) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const steps = chain.steps.length;

  if (editing) {
    const values = { name: chain.name, description: chain.description, isActive: chain.isActive };
    return <ChainForm mode="edit" chainId={chain.id} values={values} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  }

  const remove = () => startDelete(async () => {
    const result = await deleteChain(chain.id);
    if (!result.ok) setError(result.error);
  });

  return (
    <header className="chain-head">
      <div>
        <p className="crumb"><Link href="/">Collection</Link> / <strong>{chain.name}</strong></p>
        <h1 className="display-1">{chain.name}</h1>
        <p className="chain-head__meta">
          {chain.description ? `${chain.description} · ` : ""}<strong>{chain.isActive ? "Active" : "Inactive"}</strong> · {steps} {steps === 1 ? "step" : "steps"}
        </p>
      </div>
      <div className="chain-head__actions">
        <button className="btn btn--primary" type="button" onClick={onToggleRun} disabled={steps === 0} aria-expanded={runOpen}>Run chain</button>
        <button className="btn" type="button" onClick={() => setEditing(true)}>Edit details</button>
        {confirming ? (
          <span className="confirm">
            Delete chain and its {chain.runCount} runs?
            <button className="btn btn--danger" type="button" disabled={deleting} onClick={remove}>{deleting ? "Deleting…" : "Confirm"}</button>
            <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        ) : (
          <button className="btn" type="button" onClick={() => setConfirming(true)}>Delete</button>
        )}
        <Link className="link" href={`/chains/${chain.id}/media`}>View media ({chain.runCount}) →</Link>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
    </header>
  );
}
```

- [ ] **Step 7: Step card and wall**

`src/components/workspace/step-card.tsx`:
```tsx
import type { CSSProperties, ReactNode } from "react";
import type { CardView } from "@/lib/chains/card-view";

type Props = {
  label: string; tileNumber?: string; title: string; meta: string; view: CardView;
  done: boolean; hollow: boolean; selected?: boolean; onSelect?: () => void; moves?: ReactNode;
};

export function StepCard({ label, tileNumber = label, title, meta, view, done, hollow, selected, onSelect, moves }: Props) {
  const className = `card-media card-media--${view.kind === "photo" ? "photo" : "text"}`;
  const style = view.kind === "photo" ? ({ "--ratio": view.ratio } as CSSProperties) : undefined;
  const media = view.kind === "photo" ? (
    <img src={view.url} alt={`${title}: latest image`} />
  ) : (
    <span className={`tile tile--${view.tone}`}>
      <span className="tile__n">{tileNumber}</span>
      {view.text && <span className="tile__q">{view.text}</span>}
    </span>
  );
  return (
    <div className={`wall__col${done ? " wall__col--done" : ""}`}>
      <div className="node">
        <span className={`node__mark${hollow ? " node__mark--hollow" : ""}`} />
        <span className="node__label">{label}</span>
      </div>
      {onSelect ? (
        <button type="button" className={className} style={style} aria-pressed={selected} onClick={onSelect} aria-label={`Edit step ${label}, ${title}`}>{media}</button>
      ) : (
        <div className={className} style={style}>{media}</div>
      )}
      <p className="card-title">{title}</p>
      <p className="card-meta">{meta}</p>
      {view.stat && <p className="card-stat">{view.stat}</p>}
      {moves}
    </div>
  );
}
```

`src/components/workspace/wall.tsx`:
```tsx
"use client";

import { useRef } from "react";
import { inputCardView, stepCardView } from "@/lib/chains/card-view";
import { pad2 } from "@/lib/chains/presentation";
import type { ChainStep, StepOutput } from "@/lib/chains/types";
import type { LiveRun } from "@/lib/runs/live-run";
import { StepCard } from "./step-card";

type Props = {
  latestInput: StepOutput | null; steps: ChainStep[]; live: LiveRun | null; selectedId: string | null;
  locked: boolean; onSelect: (id: string) => void; onMove: (index: number, direction: -1 | 1) => void;
};

function inputMeta(text: string | null | undefined, hasImage: boolean): string {
  if (hasImage && text) return "Image + text";
  if (hasImage) return "Image";
  return text ? "Text" : "Image and/or text";
}

export function Wall({ latestInput, steps, live, selectedId, locked, onSelect, onMove }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (direction: -1 | 1) => scroller.current?.scrollBy({ left: direction * 480, behavior: "smooth" });
  const input = live ? { text: live.input.text, hasImage: Boolean(live.input.previewUrl) } : { text: latestInput?.text, hasImage: Boolean(latestInput?.image) };

  return (
    <section aria-label="Prompt chain steps">
      <div className="wall-bar">
        <button type="button" onClick={() => scroll(-1)} aria-label="Scroll the wall left">←</button>
        <button type="button" onClick={() => scroll(1)} aria-label="Scroll the wall right">→</button>
      </div>
      <div className="wall" ref={scroller}>
        <StepCard label="Input" tileNumber="In" title={live ? "This run's input" : "Latest input"} meta={inputMeta(input.text, input.hasImage)}
          view={inputCardView(latestInput, live)} done={Boolean(live && live.state !== "starting")} hollow={false} />
        {steps.map((step, index) => {
          const status = live?.steps[index]?.status;
          const meta = step.model ? `${step.model.name}${step.model.isActive ? "" : " (inactive)"}` : "No model chosen";
          return (
            <StepCard key={step.id} label={pad2(index + 1)} title={step.title} meta={meta} view={stepCardView(step, index, live)}
              done={status === "succeeded"} hollow={status === "pending"} selected={selectedId === step.id} onSelect={() => onSelect(step.id)}
              moves={
                <div className="moves">
                  <button type="button" className="moves__btn" disabled={locked || index === 0} onClick={() => onMove(index, -1)} aria-label={`Move step ${index + 1} earlier`}>←</button>
                  <button type="button" className="moves__btn" disabled={locked || index === steps.length - 1} onClick={() => onMove(index, 1)} aria-label={`Move step ${index + 1} later`}>→</button>
                </div>
              } />
          );
        })}
        <div className="wall__col">
          <button type="button" className="add-tile" aria-pressed={selectedId === "new"} disabled={steps.length >= 20} onClick={() => onSelect("new")} aria-label="Add a step">+</button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Step editor**

`src/components/workspace/step-editor.tsx`:
```tsx
"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/lib/action-result";
import { deleteStep, saveStep } from "@/lib/chains/actions";
import { pad2 } from "@/lib/chains/presentation";
import type { ChainStep, LlmModel } from "@/lib/chains/types";

type Props = {
  chainId: string; step: ChainStep | null; position: number; models: LlmModel[];
  receives: string; sends: string; onClose: () => void;
};

export function StepEditor({ chainId, step, position, models, receives, sends, onClose }: Props) {
  const [count, setCount] = useState(step?.instructions.length ?? 0);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await saveStep(chainId, step?.id ?? null, prev, formData);
    if (result.ok) onClose();
    return result;
  }, { ok: false });

  const remove = () => startDelete(async () => {
    if (!step) return;
    const result = await deleteStep(chainId, step.id);
    if (result.ok) onClose();
    else setDeleteError(result.error);
  });

  const label = pad2(position);
  return (
    <section className="editor" aria-label={step ? `Edit step ${label}` : "New step"}>
      <div>
        <p className="eyebrow">{step ? "Editing step" : "New step"}</p>
        <h2 className="display-2">{label}<br />{step?.title ?? "Untitled step"}</h2>
        <p className="editor__flow">{receives}<br />{sends}</p>
      </div>
      <form action={formAction} noValidate>
        <label className="field">
          <span className="field__label">Title</span>
          <input className="field__input" name="title" defaultValue={step?.title ?? ""} maxLength={80} />
        </label>
        {state.fieldErrors?.title && <p className="field__error">{state.fieldErrors.title}</p>}
        <label className="field">
          <span className="field__label">Model</span>
          <select className="field__input" name="modelId" defaultValue={step?.model?.isActive ? step.model.id : ""}>
            <option value="" disabled>Choose a model</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.modality}</option>)}
          </select>
        </label>
        {state.fieldErrors?.modelId && <p className="field__error">{state.fieldErrors.modelId}</p>}
        <label className="field">
          <span className="field__label">Instructions</span>
          <textarea className="field__input" name="instructions" rows={7} maxLength={4000} defaultValue={step?.instructions ?? ""} onChange={(e) => setCount(e.target.value.length)} />
        </label>
        <p className="field__count">{count.toLocaleString("en-US")} / 4,000</p>
        {state.fieldErrors?.instructions && <p className="field__error">{state.fieldErrors.instructions}</p>}
        {state.error && <p className="notice" role="alert">{state.error}</p>}
        <div className="actions-row">
          <button className="btn btn--strong" type="submit" disabled={pending}>{pending ? "Saving…" : step ? "Save step" : "Add step"}</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          {step && !confirming && <button className="link link--danger" type="button" onClick={() => setConfirming(true)}>Delete step</button>}
          {step && confirming && (
            <span className="confirm">
              Delete step {label}?
              <button className="btn btn--danger" type="button" disabled={deleting} onClick={remove}>{deleting ? "Deleting…" : "Confirm"}</button>
              <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          )}
        </div>
        {deleteError && <p className="notice" role="alert">{deleteError}</p>}
      </form>
    </section>
  );
}
```

- [ ] **Step 9: Workspace and page**

`src/components/workspace/chain-workspace.tsx`:
```tsx
"use client";

import { useOptimistic, useState, useTransition } from "react";
import { reorderSteps } from "@/lib/chains/actions";
import { describeFlow } from "@/lib/chains/card-view";
import { moveStep } from "@/lib/chains/order";
import type { ChainDetail, LlmModel } from "@/lib/chains/types";
import { ChainHeader } from "./chain-header";
import { RunPanel } from "./run-panel";
import { StepEditor } from "./step-editor";
import { useChainRun } from "./use-chain-run";
import { Wall } from "./wall";

export function ChainWorkspace({ chain, models }: { chain: ChainDetail; models: LlmModel[] }) {
  const [steps, setOptimisticSteps] = useOptimistic(chain.steps);
  const [selected, setSelected] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startMove] = useTransition();
  const run = useChainRun(chain.id, chain.steps.length);

  function move(index: number, direction: -1 | 1) {
    const next = moveStep(steps, index, index + direction);
    setNotice(null);
    startMove(async () => {
      setOptimisticSteps(next);
      const result = await reorderSteps(chain.id, next.map((s) => s.id));
      if (!result.ok) setNotice(result.error);
    });
  }

  function toggleRun() {
    if (runOpen && !run.running) run.clear();
    setRunOpen(!runOpen);
  }

  const selectedIndex = selected === "new" ? steps.length : steps.findIndex((s) => s.id === selected);
  const editing = selected !== null && selectedIndex >= 0;

  return (
    <>
      <ChainHeader chain={chain} runOpen={runOpen} onToggleRun={toggleRun} />
      {runOpen && <RunPanel stepCount={steps.length} live={run.live} running={run.running} onStart={run.start} />}
      {notice && <p className="notice" role="alert">{notice}</p>}
      <Wall latestInput={chain.latestInput} steps={steps} live={run.live} selectedId={selected} locked={run.running}
        onSelect={(id) => setSelected((current) => (current === id ? null : id))} onMove={move} />
      {editing && (
        <StepEditor key={selected} chainId={chain.id} step={selected === "new" ? null : steps[selectedIndex]}
          position={selectedIndex + 1} models={models} {...describeFlow(steps, selectedIndex)} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
```

`src/app/(tool)/chains/[id]/page.tsx`:
```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChainWorkspace } from "@/components/workspace/chain-workspace";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getChainDetail, listActiveModels } from "@/lib/chains/queries";
import { idSchema } from "@/lib/chains/schemas";

// advanceRun runs one Gemini step (≤55 s) plus storage; keep well above that.
export const maxDuration = 120;
export const metadata: Metadata = { title: "Chain" };

export default async function ChainPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const [chain, models] = await Promise.all([getChainDetail(id), listActiveModels()]);
  if (!chain) notFound();
  return <ChainWorkspace chain={chain} models={models} />;
}
```

- [ ] **Step 10: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: all pass; the build lists `/chains/[id]` as `ƒ` (dynamic).
Manual (the user, signed in at http://localhost:3002):
1. Open "Five Captions From a Photo". The wall shows Input plus 01–03 cyan, lime and orange blocks.
2. Click `→` under 01. It becomes 02 instantly and stays after a reload.
3. Edit a step's instructions and Save. The editor closes, and the change persists.
4. "+" → add a step → it appears as 04. Delete it → numbering returns to 01–03.
5. Run chain with a photo plus text. The Input card shows the photo, step tiles go running → done one by one, and the rail thickens. Five numbered captions end up in step 03's tile.

- [ ] **Step 11: Commit**

```bash
git add src tests
git commit -m "feat: add chain workspace with exhibition wall, step editor, reorder and live runs"
```

---

### Task 10: Media page

**Files:**
- Create: `src/components/media-card.tsx`, `src/app/(tool)/chains/[id]/media/page.tsx`
- Test: `tests/media.test.ts`

**Interfaces:**
- Consumes:
  - `listMediaRuns` (Task 7)
  - `toMediaRun`, `splitNumbered`, `MediaRun`, `MediaRunRow` (Task 6)
  - `getChainName` (Task 5)
  - `pad2`, `ratioOf`, `tileColor` (Task 4)
- Produces: the `/chains/[id]/media` route.

- [ ] **Step 1: Write the test** (covers the Task 6 media module)

`tests/media.test.ts`:
```ts
import { expect, it } from "vitest";
import { splitNumbered, toMediaRun, type MediaRunRow } from "@/lib/runs/media";

const step = (order: number, text: string, ms: number) => ({
  step_order: order, title: `S${order}`, modality: "text" as const, status: "succeeded", output_text: text,
  output_image_path: null, latency_ms: ms, started_at: null, completed_at: null,
});
const row: MediaRunRow = {
  id: "r", created_at: "2026-11-05T19:00:00.000Z", status: "succeeded", error_message: null, input_text: "hi",
  input_image_path: "r/input.jpg", input_image_width: 1600, input_image_height: 900,
  prompt_chain_run_steps: [step(2, "1. a\n2. b", 1500), step(1, "desc", 500)],
};

it("splits numbered captions only when every line is numbered", () => {
  expect(splitNumbered("1. a\n2) b")).toEqual(["a", "b"]);
  expect(splitNumbered("intro\n1. a")).toBeNull();
});

it("shows the input photo and the final captions for a text chain", () => {
  const run = toMediaRun(row, new Map([["r/input.jpg", "signed"]]), Date.parse(row.created_at));
  expect(run.photo).toEqual({ url: "signed", width: 1600, height: 900 });
  expect(run.finalLines).toEqual(["a", "b"]);
  expect(run.statusLabel).toBe("Done in 2.0 s");
  expect(run.trail.map((s) => s.order)).toEqual([1, 2]);
});

it("labels a silent running run as incomplete", () => {
  const run = toMediaRun({ ...row, status: "running" }, new Map(), Date.parse(row.created_at) + 91_000);
  expect(run.statusLabel).toBe("Incomplete");
});
```
Run: `npx vitest run tests/media.test.ts`
Expected: PASS (3 tests; the module already exists from Task 6).

- [ ] **Step 2: Media card**

`src/components/media-card.tsx`:
```tsx
import type { CSSProperties } from "react";
import { pad2, ratioOf, tileColor } from "@/lib/chains/presentation";
import type { MediaRun } from "@/lib/runs/media";

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export function MediaCard({ run }: { run: MediaRun }) {
  const style = run.photo ? ({ "--ratio": ratioOf(run.photo) } as CSSProperties) : undefined;
  return (
    <article className="run-card">
      <div className="run-card__photo" style={style}>
        {run.photo ? (
          <img src={run.photo.url} alt="Run media" />
        ) : (
          <span className="tile tile--orange"><span className="tile__n">{pad2(run.trail.length)}</span><span className="tile__q">Text-only run</span></span>
        )}
      </div>
      <div>
        <p className="card-title" style={{ marginTop: 0 }}>{WHEN.format(new Date(run.createdAt))}</p>
        <p className={run.failed ? "card-stat card-stat--failed" : "card-stat"}>{run.statusLabel}</p>
        <ol className="trail" aria-label="Steps">
          {run.trail.map((s, i) => <li key={s.order} className={`tile--${tileColor(i)}`}>{pad2(s.order)} {s.title}</li>)}
        </ol>
        {run.inputText && <p className="card-meta">Input: “{run.inputText}”</p>}
        {run.finalLines ? (
          <ol className="output-list">{run.finalLines.map((line, i) => <li key={i}>{line}</li>)}</ol>
        ) : (
          run.finalText && <p className="output-text">{run.finalText}</p>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Media page**

`src/app/(tool)/chains/[id]/media/page.tsx`:
```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaCard } from "@/components/media-card";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getChainName } from "@/lib/chains/queries";
import { idSchema } from "@/lib/chains/schemas";
import { toMediaRun } from "@/lib/runs/media";
import { listMediaRuns } from "@/lib/runs/repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Media" };

// Plain async helper (not a component), so reading the clock here is fine.
async function loadMedia(chainId: string) {
  const { runs, urls } = await listMediaRuns(createAdminClient(), chainId);
  const now = Date.now();
  return runs.map((row) => toMediaRun(row, urls, now));
}

export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const name = await getChainName(id);
  if (!name) notFound();
  const media = await loadMedia(id);
  return (
    <section className="split">
      <div>
        <h1 className="display-2">Media</h1>
        <p className="lede">{name}</p>
        <p className="actions-row"><Link className="link" href={`/chains/${id}`}>← Back to chain</Link></p>
      </div>
      <div>
        <h2 className="section-title">Runs in this tool</h2>
        {media.length === 0
          ? <p className="lede">No runs yet. Run the chain to generate media.</p>
          : media.map((run) => <MediaCard key={run.id} run={run} />)}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: all pass; the build lists `/chains/[id]/media`.
Manual (the user): after the Task 9 run, "View media (1) →" shows a large photo with the date, "Done in N s", the step trail and five numbered captions.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add per-chain media page with large photos and wall-label run cards"
```

---

### Task 11: Deploy to Vercel and collect the submission URLs

**Files:** none in the repo (`.vercel/` is gitignored).

- [ ] **Step 1: Push the branch**

Run: `git push -u origin prompt-chain-manager`
Expected: the branch is created on `siriusblanck/promptchain`.

- [ ] **Step 2: Create and link the Vercel project**

```bash
vercel project add promptchain --scope raise-e9d2cfef
vercel link --yes --project promptchain --scope raise-e9d2cfef
```
Expected: `Linked to raise-e9d2cfef/promptchain`, and `.vercel/project.json` exists.

- [ ] **Step 3: Set environment variables** (values come from `.env.local` and are never printed)

```bash
for NAME in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SECRET_KEY GEMINI_API_KEY; do
  grep "^$NAME=" .env.local | cut -d= -f2- | tr -d '\n' | vercel env add "$NAME" production --scope raise-e9d2cfef >/dev/null && echo "$NAME production ok"
done
vercel env ls production --scope raise-e9d2cfef
```
Expected: four names listed for Production. Preview variables are optional, because the submission uses the production deployment.

- [ ] **Step 4: Deploy production**

Run: `vercel deploy --prod --yes --scope raise-e9d2cfef`
Expected: the command prints a deployment URL like `https://promptchain-<hash>-raise-e9d2cfef.vercel.app` and an aliased production domain. Record both. The first is the commit-specific URL.

- [ ] **Step 5: Turn off deployment protection**

```bash
vercel project protection disable promptchain --sso --scope raise-e9d2cfef
vercel project protection promptchain --format json --scope raise-e9d2cfef
```
Expected: SSO (Vercel Authentication) is reported as disabled.
Then check logged out, using the URL from Step 4:
`curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://promptchain-<hash>-raise-e9d2cfef.vercel.app/`
Expected: `307 …/login`, not `401`.
Also: `curl -s https://promptchain-<hash>-raise-e9d2cfef.vercel.app/login | grep -c "Museum of"` → `1`.

- [ ] **Step 6: Allow login on the production alias**

Re-run the Task 8 Step 8 script with the `add` array set to `["https://<production-alias-from-step-4>/**"]`.
Expected: `now:` includes the alias. Then the user signs in on the commit URL and lands on the collection.

- [ ] **Step 7: Check the other two apps' protection** (read-only; ask before changing)

```bash
vercel project protection tristans-humor --format json --scope raise-e9d2cfef
vercel project protection hogwumbia-admin --format json --scope raise-e9d2cfef
```
If either shows SSO enabled, ask the user before running `vercel project protection disable <name> --sso --scope raise-e9d2cfef`.

- [ ] **Step 8: Collect the three latest commit-specific URLs**

```bash
for P in tristans-humor hogwumbia-admin promptchain; do echo "== $P"; vercel ls "$P" --prod --scope raise-e9d2cfef 2>/dev/null | grep -m1 -E "https://.*Ready" ; done
```
Expected: one `Ready` deployment URL per project. For each, `curl -s -o /dev/null -w "%{http_code}\n" <url>` must print `200` or `307` (never `401`). Give the user all three URLs for the Submissions section.

- [ ] **Step 9: Production smoke test** (the user, signed in, on the commit URL)

1. Incognito shows the MoPC login, not a Vercel wall.
2. A non-superadmin Google account sees the orange "isn't a superadmin" notice.
3. Create a chain.
4. Add three steps.
5. Move step 2 → 1.
6. Edit a step.
7. Run "Five Captions From a Photo" with a photo, and watch the tiles fill.
8. Its media page shows the run.
9. Delete a step, then delete the test chain.
10. Light, Dark and System all render correctly.

---

### Task 12 (stretch, only if time remains): "From the public site" on the media page

**Files:**
- Modify: `src/lib/chains/queries.ts` (add `listPublicGenerations`), `src/app/(tool)/chains/[id]/media/page.tsx`, `src/styles/pages.css`

- [ ] **Step 1: Add the query** (append to `src/lib/chains/queries.ts`; add `import { getSupabaseConfig } from "@/lib/supabase/config";` at the top)

```ts
const publicRow = z.object({
  generations: z.object({
    id: z.guid(), caption: z.string(), image_path: z.string(), characters: z.object({ name: z.string().nullable() }).nullable(),
  }).nullable(),
});
export type PublicGeneration = { id: string; caption: string; imageUrl: string; character: string | null };

/** Captioned images the public app produced for this chain (the `generations` bucket is public). */
export async function listPublicGenerations(chainId: string): Promise<PublicGeneration[]> {
  const { data, error } = await createAdminClient().from("generation_requests")
    .select("generations(id, caption, image_path, characters(name))")
    .eq("prompt_chain_id", chainId).eq("status", "succeeded").not("generation_id", "is", null)
    .order("created_at", { ascending: false }).limit(12);
  check("public generations", error);
  const base = `${getSupabaseConfig().url}/storage/v1/object/public/generations/`;
  return z.array(publicRow).parse(data).flatMap(({ generations: g }) =>
    g ? [{ id: g.id, caption: g.caption, imageUrl: base + g.image_path, character: g.characters?.name ?? null }] : []);
}
```

- [ ] **Step 2: Render it under the runs** (in the media page, fetch `listPublicGenerations(id)` alongside `loadMedia(id)` via `Promise.all`, then after the runs list add):

```tsx
{publicGenerations.length > 0 && (
  <>
    <h2 className="section-title">From the public site</h2>
    <div className="pub-grid">
      {publicGenerations.map((g) => (
        <figure key={g.id} className="pub-card">
          <img src={g.imageUrl} alt={g.caption} />
          <figcaption><strong className="card-title">{g.character ?? "Hog Wumbia"}</strong><span className="output-text">“{g.caption}”</span></figcaption>
        </figure>
      ))}
    </div>
  </>
)}
```
and in `src/styles/pages.css`:
```css
.pub-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px; margin-bottom: 26px; }
.pub-card { margin: 0; }
.pub-card img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; }
.pub-card figcaption { display: grid; gap: 4px; margin-top: 10px; font-style: italic; }
@media (max-width: 560px) { .pub-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm run lint && npm run build`. Then the user checks "Ronald Weasley's Owl Post" → media, which shows his public images.
```bash
git add src && git commit -m "feat: show public-site generations on the media page" && vercel deploy --prod --yes --scope raise-e9d2cfef
```

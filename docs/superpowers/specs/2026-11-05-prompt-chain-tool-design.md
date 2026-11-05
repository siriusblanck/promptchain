# MoPC: Prompt Chain Tool (Design)

- **Date:** 2026-11-05
- **Repo:** `siriusblanck/promptchain`, branch `prompt-chain-manager`
- **Status:** approved in brainstorming. This document is the source for the implementation plan.

MoPC ("Museum of Prompt Chains") is a superadmin-only web tool to create, edit, reorder and **run** the
prompt chains stored in the Hog Wumbia Supabase database, and to view the media each chain produces.
It is the third Vercel app beside `tristans-humor` (public site) and `hogwumbia-admin` (admin console).
Its visual language follows moma.org. It does not use MoMA's name, logo or proprietary font.

## 1. Scope

### 1.1 Acceptance checklist (from the assignment)

| # | Requirement | Covered by |
|---|---|---|
| A1 | New GitHub repo + new Vercel project | `siriusblanck/promptchain` (exists); Vercel project `promptchain` (team `raise-e9d2cfef`) via CLI |
| A2 | Works only when `profiles.is_superadmin = TRUE` | `requireAdmin()` in the `(tool)` layout **and** first line of every server action |
| A3 | Create / update / delete a prompt chain | `/chains/new`; "Edit details" inline form; "Delete → Confirm" |
| A4 | Create / update / delete a step | "+" tile → editor; editor "Save step"; "Delete step" |
| A5 | Reorder steps (move 2 → 1, …) | ← → buttons on each wall card → `reorder_prompt_chain_steps` RPC |
| A6 | Generate media from the chain | Run panel → step-per-request run engine (§5) |
| A7 | View media produced by a specific chain | `/chains/[id]/media` |
| A8 | Dark / light / system default | `next-themes`, Light · Dark · System switch in header |
| A9 | Deployment protection off (Incognito works) | Vercel project setting; verified in a logged-out browser |
| A10 | Submit latest commit-specific URLs of all 3 apps | Collected at the end; the user submits them |
| A11 | Example chain: image → description → funny → five captions | Seeded as "Five Captions From a Photo" (§4.5) |

### 1.2 Out of scope (cut for time, may return later)
- Run detail page. Media cards show the whole run.
- Resume and retry. A failed or abandoned run shows its state, and "Run again" starts a new run.
- Character picker. Existing `character_id` links are untouched, and new chains get `NULL`.
- "From the public site" section in media. This is a stretch goal, built last only if time remains.
- Any change to `tristans-humor` or `hogwumbia-admin` code, `prompt_chain_mix`, `generation_examples`, or
  model/provider management.

## 2. Existing system (facts this design relies on)

- **Supabase project:** `mtbtwriiqbsottfhwrma` ("tristans-humor"), shared by all three apps.
- **Existing tables used:**
  - `prompt_chains` (id, character_id unique nullable, name 1–120, description ≤600, is_active, created_at).
  - `prompt_chain_steps` (id, prompt_chain_id, step_order 1–20, title 1–80, llm_model_id nullable,
    instructions 1–4000, created_at), with `UNIQUE (prompt_chain_id, step_order)`, which is **not deferrable**.
  - `llm_models` (id, name, model_identifier, modality `text|image`, is_active). Active models:
    `gemini-3.5-flash-lite` (text) and `gemini-3.1-flash-lite-image` (image).
  - `profiles` (is_superadmin). The "users read own profile" policy exists.
- **Access:** chain and model tables have RLS on with no policies, and are reachable only with the service-role
  key. The admin app gates with Google login + `is_superadmin`, then uses a server-only service-role client.
  This tool copies that pattern.
- **The public app's prompts live in code and never read `prompt_chain_steps`.** The 14 existing chains (each
  Caption → Illustration) have descriptive instructions. This tool runs those instructions literally.
- **FK behavior on chain delete:** steps `CASCADE`, `prompt_chain_mix` `CASCADE`,
  `generation_requests` / `generation_examples` `SET NULL`.

## 3. Architecture

**Stack** (matches `hogwumbia-admin`): Next.js 16 App Router, React 19, TypeScript, plain CSS with CSS variables,
`@supabase/ssr` + `@supabase/supabase-js`, `@google/genai`, zod 4, `next-themes`, Vitest.
Font: Libre Franklin via `next/font/google` (400, 600, 800, 900, italic 400).

**Routes**
```
/login                      public; wordmark, "Sign in with Google", ?reason=restricted|error notice
/auth/callback              exchangeCodeForSession → redirect "/"
(tool)/layout.tsx           requireAdmin(); header (wordmark, nav, theme switch, sign out)
  /                         collection grid of chains + "New chain"
  /chains/new               create-chain form (name, description, active) → redirects to the new chain
  /chains/[id]              chain header, run panel, exhibition wall, inline step editor (maxDuration = 120)
  /chains/[id]/media        runs of this chain, newest first
src/proxy.ts                Supabase session refresh (Next 16 "proxy", formerly middleware)
```

**Modules**: a pure core (no IO) and a thin IO shell.
```
lib/auth/          access.ts (pure hasSuperadminAccess) · require-admin.ts
lib/supabase/      config.ts (env validation) · server.ts (session) · admin.ts (service role, server-only)
lib/chains/        schemas.ts (zod) · order.ts (pure moveStep) · repository.ts · actions.ts
lib/runs/          plan.ts (pure stepInput / buildGeminiRequest) · errors.ts (pure mapGeminiError)
                   gemini.ts (client factory, injectable) · storage.ts · repository.ts · actions.ts
components/        wall/ (Wall, Rail, StepCard, AddTile) · StepEditor · ChainForm · RunPanel
                   MediaCard · theme/ (ThemeProvider, ThemeSwitch)
```

**Server action contract.** Every action:
1. Calls `requireAdmin()` first. It redirects to `/login?reason=restricted` before any service-role client exists.
2. Parses its input with zod.
3. Calls the repository.
4. Calls `revalidatePath`.
5. Returns the envelope `{ ok: true, data } | { ok: false, error, fieldErrors? }`.

**Gate**: `hasSuperadminAccess(user, profile)` is true iff `user.app_metadata.provider === "google"` and
`profile.is_superadmin === true`. The profile is read through the session client (own-row policy). Nothing is cached, so a
revoked flag takes effect on the next request.

## 4. Data model (one additive migration)

### 4.1 Constraint change
Drop and re-add `prompt_chain_steps_prompt_chain_id_step_order_key` as
`UNIQUE (prompt_chain_id, step_order) DEFERRABLE INITIALLY IMMEDIATE`. Behavior for the other apps'
single-row writes is unchanged. Multi-row renumbering in one statement becomes possible.

### 4.2 `prompt_chain_runs`
| column | type / rule |
|---|---|
| id | uuid PK (generated by the app so the input image can be stored under the run's folder first) |
| prompt_chain_id | uuid NOT NULL → prompt_chains ON DELETE CASCADE |
| requested_by | uuid → auth.users ON DELETE SET NULL |
| input_text | text NULL, trimmed length 1–2000 |
| input_image_path | text NULL, ≤300 chars |
| input_image_width / input_image_height | int NULL, > 0 |
| status | text NOT NULL default `running`, in (`running`,`succeeded`,`failed`) |
| error_message | text NULL, ≤600 |
| created_at / completed_at | timestamptz (default now()) / NULL |
| check | `input_text IS NOT NULL OR input_image_path IS NOT NULL` |
| index | `(prompt_chain_id, created_at DESC)` |

### 4.3 `prompt_chain_run_steps`: snapshot of each step at run start, plus its output
| column | type / rule |
|---|---|
| id | uuid PK default gen_random_uuid() |
| run_id | uuid NOT NULL → prompt_chain_runs ON DELETE CASCADE |
| prompt_chain_step_id | uuid NULL → prompt_chain_steps ON DELETE SET NULL (lets each wall card show its own latest output even after reorders) |
| step_order | smallint 1–20; `UNIQUE (run_id, step_order)` |
| title, instructions, model_identifier | text NOT NULL (copied) |
| llm_model_id | uuid NULL → llm_models ON DELETE SET NULL |
| modality | text in (`text`,`image`) |
| status | text NOT NULL default `pending`, in (`pending`,`running`,`succeeded`,`failed`) |
| output_text | text NULL, ≤20000 |
| output_image_path | text NULL (image outputs are always requested at 3:4, so no dimensions are stored) |
| error_message | text NULL, ≤600 |
| latency_ms | int NULL ≥ 0; started_at / completed_at timestamptz NULL |
| index | `(prompt_chain_step_id, completed_at DESC) WHERE status = 'succeeded'` |

Both tables: RLS enabled, no policies, `REVOKE ALL` from `anon` and `authenticated`. Comment: "Prompt chain tool
only: service role access." This matches the house convention.

### 4.4 Functions
All are `SECURITY INVOKER` with `SET search_path = ''`. `EXECUTE` is revoked from `public`, `anon` and `authenticated`, and granted to `service_role`.

- **`reorder_prompt_chain_steps(p_chain_id uuid, p_step_ids uuid[]) → void`.** Raises SQLSTATE `22023`
  unless `p_step_ids` is exactly a permutation of the chain's current step ids (same count, no duplicates,
  all belong to the chain). It then runs one `UPDATE … FROM unnest(p_step_ids) WITH ORDINALITY` that sets
  `step_order = ordinality`.
- **`delete_prompt_chain_step(p_step_id uuid) → void`.** Deletes the step, then renumbers the chain's remaining
  steps 1…n with one `UPDATE` using `row_number() OVER (ORDER BY step_order)`.
- **`create_prompt_chain_run(p_run_id, p_chain_id, p_requested_by, p_input_text, p_input_image_path,
  p_input_image_width, p_input_image_height) → uuid`.** Steps:
  1. Rate guard: at most 20 runs per `requested_by` in the last 10 minutes, otherwise raise `rate_limited`.
  2. The chain must have ≥1 step, and every step must have an active model, otherwise raise
     `step_<n>_has_no_active_model` or `chain_has_no_steps`.
  3. Insert the run, then insert the snapshot rows (`INSERT … SELECT` from steps ⨝ llm_models), all in one transaction.
- **`claim_next_run_step(p_run_id uuid) → jsonb`.** Locks the run row (`FOR UPDATE`), then:
  - Run not `running` → `{state: <run status>}`.
  - First step whose status is not `succeeded`:
    - `pending` → mark it `running` with `started_at = now()`, and return
      `{state:'claimed', step:{…snapshot}, input:{text, image_path}}`. The input is the previous step's
      output, or the run's input for step 1.
    - `running` → `{state:'busy'}`.
    - `failed` → `{state:'failed'}`.
  - No steps left → set the run to `succeeded` with `completed_at`, and return `{state:'succeeded'}`.

Completing a step uses plain service-role updates guarded by `WHERE id = $1 AND status = 'running'`. A failure sets
the step **and** the run to `failed`, with a user-facing `error_message`.

### 4.5 Storage and seed
- **Private bucket `chain-runs`:** 10 MB file limit, mime types jpeg/png/webp.
  - Paths: `{runId}/input.{ext}` and `{runId}/step-{nn}.{ext}`.
  - Reads go through batched signed URLs (`createSignedUrls`, 1 h TTL).
  - Chain delete removes `{runId}/…` objects for its runs (best-effort, failures logged).
- **Seed chain "Five Captions From a Photo"** (active, no character, all steps `gemini-3.5-flash-lite`):
  1. **Describe the image**: "Describe this image in plain, literal language: who or what is in it, what is
     happening, the setting and notable details. 3–5 sentences. No jokes yet."
  2. **Find the funny**: "You will receive a description of an image. In 2–3 sentences, explain what is
     absurd, ironic or funny about the scene. Be specific to the details given."
  3. **Five captions**: "You will receive a note on what is funny about an image. Write exactly five short,
     funny captions for it, each under 15 words, numbered 1–5, one per line. No other text."

## 5. Run engine (step per request)

1. **`startRun(chainId, formData)`.**
   - The browser has already downscaled any image to ≤1600 px on the long edge (JPEG q≈0.85, ≤4 MB) and
     recorded its width and height.
   - The action validates the input: text ≤2000 chars, at least one of image or text, mime jpeg/png/webp.
   - It generates the run id and uploads `{runId}/input.jpg`.
   - It calls `create_prompt_chain_run`. On an RPC error it deletes the uploaded object and returns the mapped message.
   - `next.config.ts` sets `serverActions.bodySizeLimit: "4mb"`. Vercel caps request bodies at 4.5 MB.
2. **The client loop calls `advanceRun(runId)` until the state is `succeeded` or `failed`.** On `busy` it waits 1.5 s and
   calls again. After 90 s of continuous `busy` it stops and shows the run as Incomplete, because Resume is out
   of scope (§1.2). Each call:
   - claims the next step;
   - downloads the input image if any;
   - calls Gemini;
   - stores the output (text, or image → `{runId}/step-NN.<ext>`);
   - marks the step `succeeded` with `latency_ms`;
   - returns the step result so its card fills in.
3. **`stepInput` (pure):** step 1 receives the run input. Step k receives step k−1's output. The shape is always
   `{ text?: string; image?: { path, mimeType } }`.
4. **`buildGeminiRequest` (pure):**
   - **Text model:** `systemInstruction = instructions`; user `parts = [inlineData(image)?, text?]`;
     `maxOutputTokens: 2048`; timeout 30 s. Output is `response.text`, trimmed.
   - **Image model:** user `parts = [text: instructions + "\n\n" + input text, inlineData(image)?]`;
     `responseModalities: [IMAGE]`, `imageConfig: { aspectRatio: "3:4", imageSize: "1K" }`; timeout 55 s.
     Output is the first `inlineData` part.
5. **`mapGeminiError` (pure)** maps to `{ code, message }`:

   | code | message |
   |---|---|
   | `timeout` | "Step 02 timed out after 30 s." |
   | `rate_limited` | 429: "Gemini is rate-limiting; try again in a minute." |
   | `model_unavailable` | 404 |
   | `rejected` | 400, with a short reason |
   | `auth` | 401/403 |
   | `empty` | "Gemini returned nothing (blocked: SAFETY)." Uses the finish reason. |
   | `unknown` | First 200 chars of the error. |

   Server logs record `{runId, stepOrder, model, latencyMs, code}`. User messages never include keys or raw payloads.
6. **Wall data:**
   - Each step card shows the latest succeeded output for its `prompt_chain_step_id`.
   - The Input card shows the latest run's input.
   - A run still `running` with no step activity for >90 s is shown as "Incomplete".
   - Before any run, the Input card is a dashed 3:4 placeholder reading "Your image or text", and text cards
     show only their step number.
   - A run in progress uses its own snapshot, so edits or reorders never change it.

## 6. UI and visual system

**Tokens**, defined as CSS variables on `:root` and `[data-theme="dark"]`:

| token | light | dark |
|---|---|---|
| --paper | #ffffff | #0e0e0e |
| --ink | #000000 | #f3f3f3 |
| --muted | #6b6b6b | #a3a3a3 |
| --soft | #e9e9e9 | #2b2b2b |
| --panel | #f2f2f2 | #1b1b1b |

Accents are the same in both themes: cyan #12b5ea, lime #92c83e, orange #ff8b1f, mint #6cd9c3, danger #d62d20.
Text on accent blocks is always #000.

**Typography and controls**
- Display text uses Libre Franklin 900 at −0.03em, line-height 0.93. Card titles use 800. Model names are italic 400. Labels are 600 in `--muted`.
- Rules are 1px `--ink`. "Selected" is a 3px `--ink` outline offset 4px. The editor has a 3px top rule.
- Buttons are flat with no radius:
  - primary: cyan background, black text;
  - strong: `--ink` background, `--paper` text;
  - quiet: `--soft` background;
  - links: bold with " →".
- Wordmark: **MoPC**, set in 900 weight.

**Theme**
- `ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange`.
- `suppressHydrationWarning` on `<html>`.
- Tokens are CSS variables redefined under `[data-theme="dark"]` (no Tailwind).
- The header has a segmented Light · Dark · System control.

**Exhibition wall** (chain page). It follows MoMA's Exhibitions carousel:
- **Layout:** a horizontally scrollable row with ← → scroll buttons.
  A 1px rail runs over the cards with a 13px black square node and label (`Input`, `01`, `02`…) per card.
- **Card height:** the media box is fixed at 380 px (240 px below 640 px wide).
- **Photo cards** (input image, image outputs) take their natural width from stored dimensions (default 3:4),
  so photos are the largest cards.
- **Text cards** are 176 px wide. Their colors cycle cyan → lime → orange → mint by position, and they show the
  step number and a ~120-char snippet of the latest output.
- **States:** running is animated diagonal stripes (static under `prefers-reduced-motion`); waiting is a dashed outline.
- **Below each card:** title (800), model (italic), and ← → move buttons. These are real `<button>`s with
  `aria-label="Move step N earlier/later"`, disabled at the ends.
- **Editing:** clicking a card selects it (3px outline) and opens the inline editor below the wall. The editor
  has two columns: left is the step number, title and "Receives text/image from step N"; right is Title, Model
  (active models, labelled by modality), Instructions with a count out of 4,000, Save step, Cancel, Delete step.
  If a step's model is `NULL` or inactive, the dropdown shows "Choose a model", and Save requires a choice.
  The "+" tile appends a step (max 20).
- **Reorder** updates the UI optimistically, then calls `reorderSteps`. On failure it reverts and shows an error notice.

**Other screens**
- **Login:** large MoPC wordmark, "Museum of Prompt Chains", tagline, black "Sign in with Google", and an orange notice for
  `?reason=restricted` ("That account isn't a superadmin…") or `?reason=error`.
- **Collection** (`/`): MoMA two-column section.
  - Left: "Prompt chains in the collection", counts, "+ New chain →".
  - Right: a 3/2/1-column grid of chain cards. The cover is the latest image output, otherwise a color block with the step count. Each card shows the name, italic "N steps · text → image", and an "Inactive" label when relevant.
- **Chain page header:**
  - Breadcrumb, title (900), description, Active and step count.
  - Actions: Run chain (cyan), Edit details (inline form: name, description, active), Delete (an inline
    "Delete chain and its N runs? Confirm / Cancel"), View media (N) →.
  - Run chain opens a cyan panel: image drop zone with a preview, optional text, "Run N steps →", and a status line ("Running step 2 of 3…").
- **Media:** two-column.
  - Left: "Media", the chain name, ← Back.
  - Right: runs newest first (latest 30). Each is a large photo beside a wall label: date and time, status and duration, colored step-trail chips, then the final output.
  - The photo is the final image if the last step outputs an image, else the input image, else a color block.
  - Text output keeps its line breaks, and numbered lines render as a list. Failed runs show their error.

**Responsive:** gutters ≥16 px. The two-column sections and the editor stack below 768 px. The wall always scrolls
horizontally inside its own container, never the page.

## 7. Error handling (summary)
- **Validation:** zod field errors are shown next to the field. Nothing is saved.
- **Auth:** pages and actions redirect to `/login?reason=restricted`. An expired session goes to `/login`.
- **Gemini:** `mapGeminiError` (§5.5). The step and run are marked failed with the message, and "Run again" is offered.
- **Database:** "Couldn't save. Try again." is shown, and the server log keeps the context. Reorder or delete conflicts (a stale tab) return the
  `22023` error, which shows "This chain changed elsewhere; reloaded." followed by a refresh.
- **Concurrent edits to the same step:** last write wins (accepted for a superadmin-only tool).

## 8. Testing (light, by user request; below the usual 80% / E2E bar on purpose)
- **Vitest unit tests (pure core):**
  - `moveStep`: moves, bounds, immutability.
  - `stepInput` and `buildGeminiRequest`: step 1 vs step k; text vs image models; image vs text inputs.
  - `mapGeminiError`: each code.
  - `hasSuperadminAccess` / `requireAdmin`: non-admin redirected **before** the service-role client is created.
- **SQL check:** run once, inside a `BEGIN … ROLLBACK` transaction:
  - reorder swaps 1↔2 without a constraint error;
  - a non-permutation raises `22023`;
  - delete renumbers;
  - claim walks steps in order and returns `busy` for a running step.
- **Manual smoke test** on the deployed URL:
  1. Logged-out / Incognito shows the login page, not a Vercel wall.
  2. A non-superadmin is blocked.
  3. Create a chain.
  4. Add three steps.
  5. Move step 2 → 1.
  6. Edit a step.
  7. Run with a photo + text, and watch the cards fill in.
  8. The media page shows the run.
  9. Delete a step, then the chain.
  10. Light / Dark / System all render.

## 9. Deployment
1. Apply the migration (§4) and seed (§4.5) to `mtbtwriiqbsottfhwrma`.
2. `vercel link` creates project `promptchain` in `raise-e9d2cfef`. Set env vars for production + preview:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`.
   Values are never printed or committed. `.env.example` lists the names only.
3. Run `vercel deploy --prod`. Disable deployment protection (Vercel Authentication) on the project. Verify the
   commit-specific deployment URL in a logged-out browser.
4. Add to the Supabase Auth redirect allowlist: `https://promptchain-*-raise-e9d2cfef.vercel.app/**`, the
   production alias (known after the first deploy, e.g. `https://promptchain-raise-e9d2cfef.vercel.app/**`), and
   `http://localhost:3002/**`. Without this, Google login falls back to the Site URL. The dev server runs on port
   3002 because `hogwumbia-admin` already uses 3001.
5. Confirm deployment protection is off for `tristans-humor` and `hogwumbia-admin` too (check first, and ask
   before changing). Collect the latest commit-specific deployment URL of all three apps for submission.

**Pending user approvals:**
- **(a)** Copy `SUPABASE_SECRET_KEY` from `hogwumbia-admin/.env.local` (same Supabase project).
- **(b)** Update the Supabase Auth redirect allowlist, either via the Management API (read the list, then patch only
  `uri_allow_list`) or by the user in the dashboard.
- **(c)** The user supplies `GEMINI_API_KEY`.

## 10. Risks
- **Model identifiers:** the active `llm_models` identifiers must be callable with the supplied Gemini key. Verify with
  one text and one image call before building the UI on top of them.
- **Existing chains:** their descriptive instructions will produce plausible but non-production output. That is
  expected, and they stay editable.
- **Next 16 API changes:** check `node_modules/next/dist/docs/` (per the sibling repos' AGENTS.md) for `proxy.ts`
  and the server-action config keys before writing them.

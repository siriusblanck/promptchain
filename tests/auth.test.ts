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

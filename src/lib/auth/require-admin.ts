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

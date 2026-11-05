/** A verified Google identity AND a current database grant are both required. */
export function hasSuperadminAccess(
  user: { app_metadata?: { provider?: unknown } } | null,
  profile: { is_superadmin?: unknown } | null,
): boolean {
  return user?.app_metadata?.provider === "google" && profile?.is_superadmin === true;
}

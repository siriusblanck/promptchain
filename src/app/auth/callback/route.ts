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

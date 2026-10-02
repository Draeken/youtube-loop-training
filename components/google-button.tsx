"use client";

import { createClient } from "@/lib/supabase/client";

export function GoogleButton({ next = "/" }: { next?: string }) {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }
  return (
    <button
      onClick={signIn}
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
    >
      Se connecter avec Google
    </button>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.refresh();
  }
  return (
    <button onClick={signOut} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
      Se déconnecter
    </button>
  );
}

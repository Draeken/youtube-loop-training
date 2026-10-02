import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { GoogleButton } from '@/components/google-button';
import { SignOutButton } from '@/components/sign-out-button';

export const SITE_NAME = 'Loops Training'; // à remplacer par le nom de ton site

// `next` : page où revenir après la connexion
export async function SiteHeader({ next = '/' }: { next?: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let username: string | null = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();
    username = data?.username ?? null;
  }

  return (
    <header className="border-b">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 text-sm">
        <Link href="/" className="text-base font-semibold">
          {SITE_NAME}
        </Link>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {username ? (
                <span className="font-medium">@{username}</span>
              ) : (
                <Link
                  href={`/onboarding?next=${encodeURIComponent(next)}`}
                  className="underline underline-offset-2">
                  Choisis ton nom d'utilisateur
                </Link>
              )}
              <SignOutButton />
            </>
          ) : (
            <>
              <GoogleButton next={next} />
              <Link href="/auth/login" className="underline underline-offset-2">
                Email
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

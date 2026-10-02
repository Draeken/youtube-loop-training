import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';
  // On n'accepte que les chemins internes
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Première connexion : pas encore de nom d'utilisateur -> on le demande
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
        if (!profile) {
          return NextResponse.redirect(`${origin}/onboarding?next=${encodeURIComponent(safeNext)}`);
        }
      }
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }
  return NextResponse.redirect(`${origin}/auth/error`);
}

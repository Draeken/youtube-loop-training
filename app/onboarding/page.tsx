import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UsernameForm } from '@/components/username-form';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = '/' } = await searchParams;
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (profile) redirect(safeNext);

  // Suggestion tirée du nom du compte Google (sans accents ni caractères spéciaux)
  const fullName = String(user.user_metadata?.full_name ?? '');
  const suggestion = fullName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '')
    .slice(0, 20);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Choisis ton nom d'utilisateur</h1>
      <p className="text-sm text-muted-foreground">
        Il sera affiché comme auteur de tes listes publiées. Tu n'auras plus à le saisir ensuite.
      </p>
      <UsernameForm suggestion={suggestion} next={safeNext} />
    </main>
  );
}

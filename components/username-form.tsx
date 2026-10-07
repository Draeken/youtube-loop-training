'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function UsernameForm({ suggestion, next }: { suggestion: string; next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState(suggestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    const name = username.trim();
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(name)) {
      setError('3 à 20 caractères : lettres, chiffres, _ et - uniquement.');
      return;
    }
    setBusy(true);
    setError('');
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      setError("Tu n'es plus connecté.");
      return;
    }
    const { error } = await supabase.from('profiles').insert({ id: user.id, username: name });
    setBusy(false);
    if (error) {
      // Ce compte a déjà un profil (autre onglet, double clic…) : rien à faire, on continue
      if (error.code === '23505' && error.message.includes('profiles_pkey')) {
        router.push(next);
        router.refresh();
        return;
      }
      setError(error.code === '23505' ? 'Ce nom est déjà pris.' : error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Nom d'utilisateur"
        maxLength={20}
        autoFocus
        className="rounded-md border bg-background px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-md bg-foreground px-4 py-2 text-sm text-background hover:opacity-90 disabled:opacity-40">
        {busy ? 'Enregistrement…' : 'Valider'}
      </button>
    </form>
  );
}

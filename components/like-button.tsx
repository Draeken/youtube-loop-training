'use client';

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Props = {
  loopId: string;
  initialCount: number;
  initialLiked: boolean;
  isOwn: boolean; // sa propre publication : on affiche seulement le total
  loggedIn: boolean;
};

export function LikeButton({ loopId, initialCount, initialLiked, isOwn, loggedIn }: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  if (isOwn) {
    return (
      <span
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
        title="Tu ne peux pas aimer ta propre publication">
        <Heart className="h-4 w-4" />
        <span className="tabular-nums">{count}</span>
      </span>
    );
  }

  async function toggle() {
    if (!loggedIn) {
      // Pas connecté : on lance la connexion Google puis on revient sur la page
      await createClient().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(
            location.pathname
          )}`,
        },
      });
      return;
    }
    if (busy) return;
    setBusy(true);

    const next = !liked;
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));

    const supabase = createClient();
    const { error } = next
      ? await supabase.from('likes').insert({ loop_id: loopId })
      : await supabase.from('likes').delete().eq('loop_id', loopId);

    if (error) {
      if (next && error.code === '23505') {
        // Déjà aimé (état périmé) : le total en base n'a pas bougé
        setCount((c) => c - 1);
      } else {
        // Échec : on annule la mise à jour optimiste
        setLiked(!next);
        setCount((c) => c + (next ? -1 : 1));
      }
    }
    setBusy(false);
  }

  return (
    <button
      onClick={toggle}
      aria-pressed={liked}
      title={loggedIn ? (liked ? "Je n'aime plus" : "J'aime") : 'Connecte-toi pour aimer'}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent">
      <Heart className={`h-4 w-4 ${liked ? 'fill-red-500 text-red-500' : ''}`} />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

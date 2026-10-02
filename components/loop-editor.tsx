'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LoopPlayer } from '@/components/loop-player';
import { GoogleButton } from '@/components/google-button';
import { clearDraft, readDraft, writeDraft } from '@/lib/loop-draft';

const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm';

export function LoopEditor() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  const [initial, setInitial] = useState<{ videoId: string | null; marks: number[] }>({
    videoId: null,
    marks: [],
  });
  const [player, setPlayer] = useState<{ videoId: string | null; marks: number[] }>({
    videoId: null,
    marks: [],
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const published = useRef(false);

  // Chargement du brouillon, de l'utilisateur et de son nom d'utilisateur
  useEffect(() => {
    (async () => {
      const saved = readDraft();
      let u: any = null;
      let name: string | null = null;
      try {
        const supabase = createClient();
        u = (await supabase.auth.getUser()).data.user;
        if (u) {
          const { data } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', u.id)
            .maybeSingle();
          name = data?.username ?? null;
        }
      } catch {}
      setUser(u);
      setUsername(name);
      setInitial({ videoId: saved?.videoId ?? null, marks: saved?.marks ?? [] });
      setTitle(saved?.title ?? '');
      setDescription(saved?.description ?? '');
      setReady(true);
    })();
  }, []);

  // Sauvegarde automatique du brouillon
  useEffect(() => {
    if (!ready || published.current) return;
    writeDraft({ ...player, title, description });
  }, [ready, player, title, description]);

  function discardDraft() {
    if (!confirm('Supprimer le brouillon en cours ?')) return;
    clearDraft();
    setInitial({ videoId: null, marks: [] });
    setPlayer({ videoId: null, marks: [] });
    setTitle('');
    setDescription('');
    setPlayerKey((k) => k + 1);
  }

  async function publish() {
    if (!player.videoId || player.marks.length === 0) {
      setError('Ajoute au moins un timecode avant de publier.');
      return;
    }
    if (!title.trim()) {
      setError('Le titre est obligatoire.');
      return;
    }
    if (!user) {
      setError('Connecte-toi pour publier.');
      return;
    }
    if (!username) {
      // Le brouillon est déjà sauvegardé localement : on le retrouvera au retour
      router.push('/onboarding?next=/');
      return;
    }
    setBusy(true);
    setError('');
    const { data, error } = await createClient()
      .from('loops')
      .insert({
        video_id: player.videoId,
        title: title.trim(),
        description: description.trim(),
        marks: player.marks,
      })
      .select('id')
      .single();
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? 'La publication a échoué.');
      return;
    }
    published.current = true;
    clearDraft();
    router.push(`/l/${data.id}`);
  }

  if (!ready) return null;

  const hasDraft = !!player.videoId;

  return (
    <div className="flex flex-col gap-6">
      {!user && (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 text-sm">
          <span>Connecte-toi pour pouvoir publier ta liste.</span>
          <GoogleButton />
        </div>
      )}

      {hasDraft && (
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 text-sm text-muted-foreground">
          <span>
            Brouillon enregistré automatiquement sur cet appareil : tu peux fermer la page ou te
            connecter sans rien perdre.
          </span>
          <button onClick={discardDraft} className="shrink-0 underline underline-offset-2">
            Supprimer le brouillon
          </button>
        </div>
      )}

      <LoopPlayer
        key={playerKey}
        initialVideoId={initial.videoId}
        initialMarks={initial.marks}
        onChange={setPlayer}
      />

      {player.videoId && player.marks.length > 0 && (
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">
          <h2 className="text-lg font-semibold">Publier</h2>
          <input
            className={field}
            placeholder="Titre"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className={field}
            placeholder="Description (optionnel)"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {user && username && (
            <p className="text-sm text-muted-foreground">Publié sous le nom @{username}</p>
          )}
          {user && !username && (
            <p className="text-sm text-muted-foreground">
              Il te manque un nom d'utilisateur pour publier :{' '}
              <Link href="/onboarding?next=/" className="underline underline-offset-2">
                le choisir maintenant
              </Link>{' '}
              (ton brouillon sera conservé).
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={publish}
            disabled={busy || !user}
            className="self-start rounded-md bg-foreground px-4 py-2 text-sm text-background hover:opacity-90 disabled:opacity-40">
            {busy ? 'Publication…' : 'Publier'}
          </button>
        </section>
      )}
    </div>
  );
}

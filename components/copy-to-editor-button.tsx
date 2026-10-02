'use client';

import { useRouter } from 'next/navigation';
import { readDraft, writeDraft } from '@/lib/loop-draft';

// Reprend uniquement la vidéo et les timecodes : titre, description… sont à remplir de nouveau,
// et une publication créera une nouvelle entrée (l'original n'est jamais modifié).
export function CopyToEditorButton({ videoId, marks }: { videoId: string; marks: number[] }) {
  const router = useRouter();

  function copy() {
    const existing = readDraft();
    if (
      existing?.videoId &&
      !confirm(
        'Tu as déjà un brouillon en cours : il sera remplacé par une copie de cette liste. Continuer ?'
      )
    )
      return;
    const ok = writeDraft({ videoId, marks, title: '', description: '' });
    if (!ok) {
      alert("Impossible d'enregistrer la copie : le stockage du navigateur est indisponible.");
      return;
    }
    router.push('/');
  }

  return (
    <button
      onClick={copy}
      className="shrink-0 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
      title="Reprend la vidéo et les timecodes dans l'éditeur, sans modifier l'original">
      Modifier une copie
    </button>
  );
}

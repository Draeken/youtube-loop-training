// Brouillon de l'éditeur, conservé dans le localStorage tant que rien n'est publié.
export const DRAFT_KEY = 'loop-draft-v1';

export type Draft = {
  videoId: string | null;
  marks: number[];
  title: string;
  description: string;
};

export function readDraft(): Partial<Draft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Renvoie false si le stockage est indisponible
export function writeDraft(d: Draft): boolean {
  try {
    if (!d.videoId) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

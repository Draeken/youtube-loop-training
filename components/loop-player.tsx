'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytPromise) {
    ytPromise = new Promise((resolve) => {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    });
  }
  return ytPromise;
}

function extractVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {}
  return null;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${rest}`;
}

const btn =
  'rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40 disabled:pointer-events-none';
const btnPrimary =
  'rounded-md bg-foreground text-background px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none';
const btnSm = 'rounded border px-1.5 py-0.5 text-xs hover:bg-accent';

// Boutons de la manette (mapping "standard") -> action
const PAD_MAP: Record<number, string> = {
  0: 'play', // A / croix
  2: 'restart', // X / carré
  3: 'mark', // Y / triangle
  4: 'prev', // LB / L1
  5: 'next', // RB / R1
  9: 'training', // Start / Options
  14: 'prev', // croix gauche
  15: 'next', // croix droite
};

// Une borne de segment (début ou fin), avec ses boutons ±0,5 s si elle est modifiable
function Edge({
  label,
  text,
  onNudge,
}: {
  label: string;
  text: string;
  onNudge?: (delta: number) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      {onNudge && (
        <button onClick={() => onNudge(-0.5)} className={btnSm} aria-label={`${label} : -0,5 s`}>
          -0,5
        </button>
      )}
      <span className="w-12 text-center font-mono">{text}</span>
      {onNudge && (
        <button onClick={() => onNudge(0.5)} className={btnSm} aria-label={`${label} : +0,5 s`}>
          +0,5
        </button>
      )}
    </span>
  );
}

function NumberBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
        active ? 'bg-foreground text-background' : 'bg-muted'
      }`}>
      {n}
    </span>
  );
}

type Props = {
  initialVideoId?: string | null;
  initialMarks?: number[];
  readOnly?: boolean;
  onChange?: (state: { videoId: string | null; marks: number[] }) => void;
};

export function LoopPlayer({
  initialVideoId = null,
  initialMarks = [],
  readOnly = false,
  onChange,
}: Props) {
  const [url, setUrl] = useState('');
  const [videoId, setVideoId] = useState<string | null>(initialVideoId);
  const [error, setError] = useState('');
  const [marks, setMarks] = useState<number[]>(initialMarks);
  const [duration, setDuration] = useState(0);
  const [seg, setSeg] = useState(0);
  const [looping, setLooping] = useState(true);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [training, setTraining] = useState(false);
  const [barH, setBarH] = useState(160);
  const [padName, setPadName] = useState<string | null>(null);
  const [padStandard, setPadStandard] = useState(true);

  const rootRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const firstScroll = useRef(true);
  const actions = useRef<Record<string, () => void>>({});

  // Bornes du segment courant, lues par la boucle de surveillance
  const points = [0, ...marks, duration];
  const segCount = marks.length + 1;
  const start = points[seg] ?? 0;
  const end = points[seg + 1] ?? 0;
  const bounds = useRef({ start, end, looping, hasMarks: marks.length > 0 });
  bounds.current = { start, end, looping, hasMarks: marks.length > 0 };

  // Remonte l'état vers le parent (pour la publication / le brouillon)
  useEffect(() => {
    onChange?.({ videoId, marks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, marks]);

  // Création du lecteur quand la vidéo change
  useEffect(() => {
    if (!videoId || !holderRef.current) return;
    let cancelled = false;
    const holder = holderRef.current;
    holder.innerHTML = '';
    const el = document.createElement('div');
    holder.appendChild(el);

    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      playerRef.current = new YT.Player(el, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, playsinline: 1 },
        events: {
          onReady: (e: any) => setDuration(e.target.getDuration() || 0),
          onStateChange: (e: any) => {
            setPlaying(e.data === YT.PlayerState.PLAYING);
            // Fin de vidéo dans le dernier segment : on reboucle
            const b = bounds.current;
            if (e.data === YT.PlayerState.ENDED && b.looping && b.hasMarks) {
              e.target.seekTo(b.start, true);
              e.target.playVideo();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId]);

  // Surveillance du temps de lecture (boucle + curseur)
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      const t = p.getCurrentTime();
      setNow(t);
      if (!duration) {
        const d = p.getDuration?.();
        if (d) setDuration(d);
      }
      const b = bounds.current;
      if (b.looping && b.hasMarks && b.end > 0 && t >= b.end - 0.05) {
        p.seekTo(b.start, true);
      }
    }, 100);
    return () => clearInterval(id);
  }, [duration]);

  // Manette : détection des appuis sur les boutons
  useEffect(() => {
    const prev: Record<number, boolean[]> = {};
    const id = setInterval(() => {
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(Boolean) as Gamepad[];
      setPadName(pads[0]?.id ?? null);
      setPadStandard(pads[0] ? pads[0].mapping === 'standard' : true);
      for (const gp of pads) {
        const last = prev[gp.index] ?? [];
        gp.buttons.forEach((b, i) => {
          if (b.pressed && !last[i] && PAD_MAP[i]) actions.current[PAD_MAP[i]]?.();
        });
        prev[gp.index] = gp.buttons.map((b) => b.pressed);
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  // Mode entraînement : verrouille le défilement de la page, Échap pour quitter,
  // et sort du mode si l'utilisateur quitte le plein écran du navigateur
  useEffect(() => {
    if (!training) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitTraining();
    };
    const onFs = () => {
      if (!document.fullscreenElement) setTraining(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [training]);

  // Mesure la hauteur de la barre de contrôle pour que la vidéo remplisse le reste de l'écran
  useEffect(() => {
    const el = barRef.current;
    if (!training || !el) return;
    const ro = new ResizeObserver(() => setBarH(el.offsetHeight));
    ro.observe(el);
    setBarH(el.offsetHeight);
    return () => ro.disconnect();
  }, [training]);

  // Garde le segment actif visible dans la liste
  useEffect(() => {
    if (firstScroll.current) {
      firstScroll.current = false;
      return;
    }
    const row = rowRefs.current[seg];
    if (!row) return;
    const gap = 8;
    const r = row.getBoundingClientRect();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = reduce ? 'auto' : 'smooth';

    if (training) {
      const sc = rootRef.current;
      const bar = barRef.current;
      // Tant que la vidéo est à l'écran, le segment courant est déjà dans la barre
      if (!sc || !bar || sc.scrollTop < 1) return;
      const top = bar.getBoundingClientRect().bottom + gap;
      const bottom = sc.getBoundingClientRect().bottom - gap;
      const delta = r.top < top ? r.top - top : r.bottom > bottom ? r.bottom - bottom : 0;
      if (delta !== 0) sc.scrollBy({ top: delta, behavior });
      return;
    }

    const sticky = stickyRef.current;
    if (!sticky) return;
    const top = sticky.getBoundingClientRect().bottom + gap;
    const bottom = window.innerHeight - gap;
    const delta = r.top < top ? r.top - top : r.bottom > bottom ? r.bottom - bottom : 0;
    if (delta !== 0) window.scrollBy({ top: delta, behavior });
  }, [seg]);

  function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    const id = extractVideoId(url);
    if (!id) {
      setError("Ce lien YouTube n'est pas valide.");
      return;
    }
    setError('');
    setMarks([]);
    setSeg(0);
    setDuration(0);
    setVideoId(id);
  }

  function addMark() {
    const t = Math.round((playerRef.current?.getCurrentTime() ?? 0) * 10) / 10;
    if (t <= 0 || (duration && t >= duration) || marks.includes(t)) return;
    const next = [...marks, t].sort((a, b) => a - b);
    setMarks(next);
    setSeg(next.filter((m) => m <= t).length);
  }

  function nudge(i: number, delta: number) {
    const v = Math.round((marks[i] + delta) * 10) / 10;
    const lo = i === 0 ? 0 : marks[i - 1];
    const hi = i === marks.length - 1 ? duration || Infinity : marks[i + 1];
    if (v <= lo || v >= hi) return;
    setMarks(marks.map((m, k) => (k === i ? v : m)));
  }

  function removeMark(i: number) {
    setMarks(marks.filter((_, k) => k !== i));
    setSeg((s) => Math.min(s, marks.length - 1));
  }

  function goTo(index: number) {
    const i = Math.max(0, Math.min(segCount - 1, index));
    setSeg(i);
    playerRef.current?.seekTo(points[i], true);
    playerRef.current?.playVideo();
  }

  function togglePlay() {
    const p = playerRef.current;
    if (!p) return;
    playing ? p.pauseVideo() : p.playVideo();
  }

  function enterTraining() {
    setTraining(true);
    // Plein écran du navigateur (refusé si déclenché par la manette : le mode reste plein fenêtre)
    Promise.resolve(rootRef.current?.requestFullscreen?.()).catch(() => {});
  }

  function exitTraining() {
    setTraining(false);
    if (document.fullscreenElement) Promise.resolve(document.exitFullscreen()).catch(() => {});
  }

  // Actions déclenchables par la manette (toujours à jour à chaque rendu)
  actions.current = {
    play: togglePlay,
    restart: () => goTo(seg),
    next: () => goTo(seg + 1),
    prev: () => goTo(seg - 1),
    mark: () => {
      if (!readOnly && !training) addMark();
    },
    training: () => {
      if (training) exitTraining();
      else if (marks.length > 0) enterTraining();
    },
  };

  const editable = !readOnly && !training;

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={togglePlay} className={`${btn} min-w-[5.5rem]`}>
        {playing ? 'Pause' : 'Lecture'}
      </button>
      {editable && (
        <button onClick={addMark} className={`${btnPrimary} whitespace-nowrap`}>
          Poser un timecode{' '}
          <span className="inline-block w-[7ch] text-left font-mono tabular-nums">{fmt(now)}</span>
        </button>
      )}
      {marks.length > 0 && (
        <>
          <span className="min-w-[8rem] px-1 text-sm tabular-nums">
            Segment {seg + 1}/{segCount}
          </span>
          <button onClick={() => goTo(seg - 1)} disabled={seg === 0} className={btn}>
            Précédent
          </button>
          <button onClick={() => goTo(seg)} className={btn}>
            Relancer
          </button>
          <button
            onClick={() => goTo(seg + 1)}
            disabled={seg >= segCount - 1}
            className={btnPrimary}>
            Suivant
          </button>
          <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={looping}
              onChange={(e) => setLooping(e.target.checked)}
            />
            Boucler
          </label>
        </>
      )}
      {training && (
        <button onClick={exitTraining} className={`${btn} ml-auto`}>
          Quitter
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={
        training
          ? 'fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-background'
          : 'mx-auto flex w-full max-w-3xl flex-col gap-4 p-4'
      }>
      {!readOnly && !training && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Colle un lien YouTube"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button type="submit" className={btnPrimary}>
            Charger
          </button>
        </form>
      )}
      {error && !training && <p className="text-sm text-destructive">{error}</p>}

      {videoId && (
        <>
          {/* Normal : zone collée en haut. Entraînement : "contents", la vidéo prend l'écran
              et la barre de contrôle se colle en haut quand on fait défiler la liste. */}
          <div
            ref={stickyRef}
            className={
              training
                ? 'contents'
                : 'sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b bg-background/95 px-4 pb-3 pt-2 backdrop-blur'
            }>
            <div
              className={
                training
                  ? 'w-full shrink-0 bg-black'
                  : 'mx-auto aspect-video overflow-hidden rounded-lg bg-black'
              }
              style={
                training
                  ? { height: `calc(100dvh - ${barH}px)` }
                  : { width: 'min(100%, calc(35vh * 16 / 9))' }
              }>
              <div ref={holderRef} className="h-full w-full [&_iframe]:h-full [&_iframe]:w-full" />
            </div>

            <div
              ref={barRef}
              className={
                training
                  ? 'sticky top-0 z-20 flex flex-col gap-2 border-y bg-background px-3 py-2'
                  : 'flex flex-col gap-2'
              }>
              {controls}
              {training && marks.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-foreground bg-accent px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <NumberBadge n={seg + 1} active />
                    <span className="text-xs font-medium">
                      {playing ? 'En cours de lecture' : 'Segment courant'}
                    </span>
                  </span>
                  <Edge label="Début" text={fmt(start)} />
                  <Edge label="Fin" text={end ? fmt(end) : 'fin'} />
                </div>
              )}
            </div>
          </div>

          {!training && marks.length > 0 && (
            <button
              onClick={enterTraining}
              className="w-full rounded-xl bg-foreground py-5 text-xl font-bold text-background hover:opacity-90">
              S'entraîner !
            </button>
          )}

          {!training && (
            <details className="rounded-md border px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none">
                Commandes à la manette{' '}
                <span className="text-muted-foreground">
                  ({padName ? 'manette détectée' : 'aucune manette détectée'})
                </span>
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-muted-foreground">
                  {padName
                    ? `Manette : ${padName}`
                    : 'Branche une manette puis appuie sur un de ses boutons pour que le navigateur la détecte.'}
                </p>
                {padName && !padStandard && (
                  <p className="text-destructive">
                    Cette manette n'utilise pas la disposition standard : les boutons peuvent ne pas
                    correspondre à la liste ci-dessous.
                  </p>
                )}
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <b>A</b> (bouton du bas) : lecture / pause
                  </li>
                  <li>
                    <b>X</b> (bouton de gauche) : relancer le segment
                  </li>
                  <li>
                    <b>LB</b> ou croix gauche : segment précédent
                  </li>
                  <li>
                    <b>RB</b> ou croix droite : segment suivant
                  </li>
                  <li>
                    <b>Start</b> : entrer dans le mode entraînement ou en sortir
                  </li>
                  {!readOnly && (
                    <li>
                      <b>Y</b> (bouton du haut) : poser un timecode
                    </li>
                  )}
                </ul>
                <p className="text-muted-foreground">
                  Noms de la manette Xbox. Sur une manette PlayStation : A = croix, X = carré, Y =
                  triangle, LB / RB = L1 / R1, Start = Options.
                </p>
              </div>
            </details>
          )}

          {/* Liste des segments : chaque ligne = un segment numéroté */}
          {marks.length > 0 && (
            <ol className={training ? 'flex flex-col gap-2 p-3' : 'flex flex-col gap-2'}>
              {Array.from({ length: segCount }, (_, k) => {
                const active = k === seg;
                return (
                  <li
                    key={k}
                    ref={(el) => {
                      rowRefs.current[k] = el;
                    }}
                    aria-current={active ? 'true' : undefined}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-sm ${
                      active ? 'border-foreground bg-accent' : ''
                    }`}>
                    <button
                      onClick={() => goTo(k)}
                      className="flex min-w-[9.5rem] items-center gap-2 text-left"
                      title="Lire ce segment">
                      <NumberBadge n={k + 1} active={active} />
                      {active && (
                        <span className="text-xs font-medium">
                          {playing ? 'En cours de lecture' : 'Segment courant'}
                        </span>
                      )}
                    </button>

                    <Edge
                      label="Début"
                      text={fmt(points[k])}
                      onNudge={editable && k > 0 ? (d) => nudge(k - 1, d) : undefined}
                    />
                    <Edge
                      label="Fin"
                      text={k === segCount - 1 && !duration ? 'fin' : fmt(points[k + 1])}
                      onNudge={editable && k < segCount - 1 ? (d) => nudge(k, d) : undefined}
                    />

                    {editable && k < segCount - 1 && (
                      <button
                        onClick={() => removeMark(k)}
                        className={`${btnSm} ml-auto`}
                        title="Supprime ce timecode de fin : le segment fusionne avec le suivant">
                        Supprimer la fin
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

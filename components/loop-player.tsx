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
  1: 'record', // B / rond
  2: 'restart', // X / carré
  3: 'mark', // Y / triangle
  4: 'prev', // LB / L1
  5: 'next', // RB / R1
  9: 'training', // Start / Options
  14: 'prev', // croix gauche
  15: 'next', // croix droite
};

type Phase = 'idle' | 'countdown' | 'armed' | 'recording';
type Recording = { blob: Blob; url: string; mime: string; w: number; h: number };

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) =>
    MediaRecorder.isTypeSupported(t)
  );
}

// Temps de capture conservé après la fin du segment : le danseur a un temps de réaction,
// son dernier mouvement se termine après la dernière image de la vidéo.
const CAPTURE_TAIL_MS = 0;

// Vitesse du ralenti : YouTube n'accepte que des paliers fixes (0,25 / 0,5 / 0,75 / 1…),
// 0,25 est le plus proche de ×0,3
const SLOW_RATE = 0.25;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

  // Caméra / captures
  const [cameraOn, setCameraOn] = useState(false);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [count, setCount] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Record<number, Recording>>({});
  const [viewLive, setViewLive] = useState(false);
  const [altShow, setAltShow] = useState(false);
  const [loopTick, setLoopTick] = useState(0);
  const [exporting, setExporting] = useState<{ i: number; n: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [cover, setCover] = useState(true);
  const [pos, setPos] = useState({ x: 0, y: 80 });
  const [size, setSize] = useState({ w: 320, h: 200 });
  const [slow, setSlow] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const firstScroll = useRef(true);
  const actions = useRef<Record<string, () => void>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const handleRef = useRef<{ rec: MediaRecorder; discard: boolean } | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const timersRef = useRef<number[]>([]);
  const recSegRef = useRef(0);
  const recordingsRef = useRef<Record<number, Recording>>({});
  const liveRef = useRef<HTMLVideoElement>(null);
  const replayRef = useRef<HTMLVideoElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastLoopRef = useRef(0);
  const slowPtr = useRef(false); // bouton maintenu à la souris / au doigt
  const slowPad = useRef(false); // gâchette maintenue sur la manette
  const triggerLoopRef = useRef<(p: any) => void>(() => {});
  const trainingRef = useRef(false);
  const loopHook = useRef<() => void>(() => {});
  const armedHook = useRef<() => void>(() => {});
  trainingRef.current = training;

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
        playerVars: { rel: 0, playsinline: 1, iv_load_policy: 3 },
        events: {
          onReady: (e: any) => setDuration(e.target.getDuration() || 0),
          onStateChange: (e: any) => {
            setPlaying(e.data === YT.PlayerState.PLAYING);
            // La lecture démarre après le compte à rebours : on lance l'enregistrement
            if (e.data === YT.PlayerState.PLAYING && phaseRef.current === 'armed') {
              armedHook.current();
            }
            // Fin de vidéo dans le dernier segment : on reboucle
            const b = bounds.current;
            if (
              e.data === YT.PlayerState.ENDED &&
              (b.looping || phaseRef.current === 'recording') &&
              b.hasMarks
            ) {
              triggerLoopRef.current(e.target);
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
    }, 100);
    return () => clearInterval(id);
  }, [duration]);

  // Détection de la fin de segment, plus fréquente pour que la boucle (et la capture) soit précise
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      const b = bounds.current;
      if (!((b.looping || phaseRef.current === 'recording') && b.hasMarks && b.end > 0)) return;
      if (p.getCurrentTime() >= b.end - 0.03) triggerLoopRef.current(p);
    }, 25);
    return () => clearInterval(id);
  }, []);

  // Si la fenêtre perd le focus pendant que le bouton ralenti est maintenu, on revient à la normale
  useEffect(() => {
    const release = () => {
      slowPtr.current = false;
      updateSlow();
    };
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, []);

  // Manette : détection des appuis sur les boutons
  useEffect(() => {
    const prev: Record<number, boolean[]> = {};
    const id = setInterval(() => {
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(Boolean) as Gamepad[];
      setPadName(pads[0]?.id ?? null);
      setPadStandard(pads[0] ? pads[0].mapping === 'standard' : true);
      // Gâchettes LT / RT maintenues = ralenti
      const padHeld = pads.some((gp) => gp.buttons[6]?.pressed || gp.buttons[7]?.pressed);
      if (padHeld !== slowPad.current) {
        slowPad.current = padHeld;
        updateSlow();
      }
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
    // Empêche la mise en veille de l'écran pendant l'entraînement
    let lock: any = null;
    (navigator as any).wakeLock
      ?.request('screen')
      .then((l: any) => {
        lock = l;
      })
      .catch(() => {});
    return () => {
      lock?.release?.();
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

  // Détection mobile (pointeur tactile) et orientation
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const port = window.matchMedia('(orientation: portrait)');
    const update = () => {
      setIsMobile(coarse.matches);
      setPortrait(port.matches);
    };
    update();
    coarse.addEventListener('change', update);
    port.addEventListener('change', update);
    return () => {
      coarse.removeEventListener('change', update);
      port.removeEventListener('change', update);
    };
  }, []);

  // Caméra coupée dès qu'on quitte l'entraînement
  useEffect(() => {
    if (!training) stopCamera();
  }, [training]);

  // Les captures dépendent des segments : si les timecodes changent, on repart de zéro
  useEffect(() => {
    cancelCapture();
    Object.values(recordingsRef.current).forEach((r) => URL.revokeObjectURL(r.url));
    recordingsRef.current = {};
    setRecordings({});
  }, [marks]);

  // Nettoyage au démontage
  useEffect(
    () => () => {
      stopCamera();
      Object.values(recordingsRef.current).forEach((r) => URL.revokeObjectURL(r.url));
    },
    []
  );

  // Fenêtre flottante : position initiale sur le côté droit + branchement du flux caméra
  useEffect(() => {
    if (training && cameraOn && !isMobile) {
      setPos({ x: Math.max(8, window.innerWidth - 340), y: 80 });
    }
  }, [training, cameraOn, isMobile]);

  useEffect(() => {
    const v = liveRef.current;
    if (v && streamRef.current) {
      v.srcObject = streamRef.current;
      v.play().catch(() => {});
    }
  }, [training, cameraOn, isMobile]);

  // Mode d'affichage de la caméra : Live (retour), Rec (capture en cours), Replay (relecture)
  const hasRec = !!recordings[seg];
  const mode: 'live' | 'rec' | 'replay' =
    phase === 'armed' || phase === 'recording' ? 'rec' : hasRec && !viewLive ? 'replay' : 'live';
  // Sur mobile, la capture alterne avec la vidéo YouTube au lieu d'avoir sa propre fenêtre
  const replayVisible = isMobile ? hasRec && altShow && phase === 'idle' : mode === 'replay';
  const replayUrl = recordings[seg]?.url;
  const recCount = Object.keys(recordings).length;
  const coverActive = training && isMobile && portrait && cover;

  // La relecture redémarre à chaque tour de boucle pour rester synchronisée
  useEffect(() => {
    const r = replayRef.current;
    if (!r || !replayVisible) return;
    r.currentTime = 0;
    r.play().catch(() => {});
  }, [replayUrl, replayVisible, loopTick]);

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
    cancelCapture();
    setViewLive(false);
    setAltShow(false);
    setSeg(i);
    playerRef.current?.seekTo(points[i], true);
    playerRef.current?.playVideo();
  }

  // Ralenti tant que le bouton (ou une gâchette) est maintenu ; vitesse normale au relâchement
  function updateSlow() {
    const capturing = phaseRef.current === 'armed' || phaseRef.current === 'recording';
    const on = (slowPtr.current || slowPad.current) && !capturing;
    setSlow(on);
    playerRef.current?.setPlaybackRate?.(on ? SLOW_RATE : 1);
  }

  function holdSlow(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId); // le relâchement est reçu même hors du bouton
    slowPtr.current = true;
    updateSlow();
  }

  function releaseSlow() {
    slowPtr.current = false;
    updateSlow();
  }

  function togglePlay() {
    const p = playerRef.current;
    if (!p) return;
    if (phaseRef.current !== 'idle') cancelCapture();
    playing ? p.pauseVideo() : p.playVideo();
  }

  // ---------- Caméra et captures ----------

  function setPhase(p: Phase) {
    phaseRef.current = p;
    setPhaseState(p);
    updateSlow(); // pas de ralenti pendant une capture
  }

  function addTimer(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  function clearTimers() {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!trainingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setCameraOn(true);
    } catch {
      // Refus ou pas de caméra : l'entraînement continue sans
    }
  }

  function stopCamera() {
    cancelCapture();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  function storeRecording(segIndex: number, rec: Recording) {
    const old = recordingsRef.current[segIndex];
    if (old) URL.revokeObjectURL(old.url);
    const next = { ...recordingsRef.current, [segIndex]: rec };
    recordingsRef.current = next;
    setRecordings(next);
  }

  // Annule compte à rebours / enregistrement en cours (l'ancienne capture est conservée)
  function cancelCapture() {
    clearTimers();
    setCount(null);
    const h = handleRef.current;
    if (h) {
      h.discard = true;
      try {
        if (h.rec.state !== 'inactive') h.rec.stop();
      } catch {}
      handleRef.current = null;
    }
    if (phaseRef.current !== 'idle') setPhase('idle');
  }

  // Retour au début du segment, pause, compte à rebours 3-2-1-Go, puis lecture + enregistrement
  function beginCapture() {
    const p = playerRef.current;
    if (!streamRef.current || !trainingRef.current || !p) return;
    cancelCapture();
    recSegRef.current = seg;
    p.seekTo(start, true);
    p.pauseVideo();
    setViewLive(true);
    setAltShow(false);
    setPhase('countdown');
    setCount('3');
    addTimer(() => setCount('2'), 1000);
    addTimer(() => setCount('1'), 2000);
    addTimer(goCapture, 3000);
  }

  function goCapture() {
    setCount('Go !');
    setPhase('armed');
    playerRef.current?.playVideo();
    addTimer(() => setCount(null), 800);
    // Filet de sécurité si l'événement "lecture démarrée" n'arrive pas
    addTimer(() => {
      if (phaseRef.current === 'armed') startRecorder();
    }, 2000);
  }

  function startRecorder() {
    const stream = streamRef.current;
    if (!stream || phaseRef.current !== 'armed') return;
    const mime = pickMime();
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined
      );
    } catch {
      setPhase('idle');
      return;
    }
    const handle = { rec, discard: false };
    const segIndex = recSegRef.current;
    const settings = stream.getVideoTracks()[0]?.getSettings();
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      if (handle.discard || !chunks.length) return;
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type });
      storeRecording(segIndex, {
        blob,
        url: URL.createObjectURL(blob),
        mime: type,
        w: settings?.width ?? 1280,
        h: settings?.height ?? 720,
      });
    };
    rec.start();
    handleRef.current = handle;
    setPhase('recording');
  }

  // Retour au début du segment (avec un délai de garde pour ne pas se déclencher plusieurs fois)
  function triggerLoop(p: any) {
    const t = performance.now();
    if (t - lastLoopRef.current < 400) return;
    lastLoopRef.current = t;
    p.seekTo(bounds.current.start, true);
    loopHook.current();
  }

  // Fin du segment atteinte pendant l'enregistrement : on arrête et on passe en relecture
  function finishCapture() {
    clearTimers();
    const h = handleRef.current;
    handleRef.current = null;
    if (h) {
      // On laisse tourner l'enregistreur un instant après la fin du segment
      setTimeout(() => {
        try {
          if (h.rec.state !== 'inactive') h.rec.stop();
        } catch {}
      }, CAPTURE_TAIL_MS);
    }
    setPhase('idle');
    setViewLive(false);
    setAltShow(true);
  }

  function toggleCapture() {
    if (phaseRef.current !== 'idle') cancelCapture();
    else beginCapture();
  }

  async function exportVideo() {
    const entries = Object.entries(recordingsRef.current)
      .map(([k, v]) => ({ k: Number(k), v }))
      .sort((a, b) => a.k - b.k);
    if (!entries.length || exporting || typeof MediaRecorder === 'undefined') return;
    const W = entries[0].v.w || 1280;
    const H = entries[0].v.h || 720;
    const mime = pickMime();
    try {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      const out = new MediaRecorder(
        canvas.captureStream(30),
        mime ? { mimeType: mime, videoBitsPerSecond: 3_000_000 } : undefined
      );
      const chunks: Blob[] = [];
      out.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise<void>((res) => {
        out.onstop = () => res();
      });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      out.start();
      // Les captures sont rejouées l'une après l'autre dans l'ordre des segments
      for (let i = 0; i < entries.length; i++) {
        setExporting({ i: i + 1, n: entries.length });
        await new Promise<void>((resolve) => {
          let raf = 0;
          const finish = () => {
            cancelAnimationFrame(raf);
            resolve();
          };
          const draw = () => {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);
            if (vw && vh) {
              const sc = Math.min(W / vw, H / vh);
              ctx.drawImage(video, (W - vw * sc) / 2, (H - vh * sc) / 2, vw * sc, vh * sc);
            }
            raf = requestAnimationFrame(draw);
          };
          video.onended = finish;
          video.onerror = finish;
          video.src = entries[i].v.url;
          video.play().then(draw).catch(finish);
        });
      }
      out.stop();
      await stopped;
      const type = out.mimeType || mime || 'video/webm';
      const url = URL.createObjectURL(new Blob(chunks, { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `entrainement.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      alert("L'export vidéo n'est pas pris en charge par ce navigateur.");
    } finally {
      setExporting(null);
    }
  }

  // Fenêtre flottante : déplacement et redimensionnement au pointeur.
  // setPointerCapture garantit que les mouvements sont suivis même si le curseur va très vite
  // ou sort de la fenêtre, et que le relâchement du clic est toujours reçu.
  function onFloatDown(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onFloatMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    setPos({
      x: clamp(e.clientX - d.dx, 0, window.innerWidth - 80),
      y: clamp(e.clientY - d.dy, 0, window.innerHeight - 60),
    });
  }

  function endFloatDrag() {
    dragRef.current = null;
  }

  function onResizeDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation(); // ne démarre pas un déplacement
    e.preventDefault();
    resizeRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = resizeRef.current;
    if (!r) return;
    setSize({
      w: clamp(r.w + e.clientX - r.x, 160, Math.max(160, window.innerWidth - pos.x)),
      h: clamp(r.h + e.clientY - r.y, 100, Math.max(100, window.innerHeight - pos.y)),
    });
  }

  function endResize() {
    resizeRef.current = null;
  }

  function enterTraining() {
    trainingRef.current = true;
    setTraining(true);
    startCamera();
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
    record: () => {
      if (trainingRef.current && streamRef.current) toggleCapture();
    },
    mark: () => {
      if (!readOnly && !training) addMark();
    },
    training: () => {
      if (training) exitTraining();
      else if (marks.length > 0) enterTraining();
    },
  };

  const editable = !readOnly && !training;

  armedHook.current = startRecorder;
  triggerLoopRef.current = triggerLoop;
  loopHook.current = () => {
    if (phaseRef.current === 'recording') finishCapture();
    else if (phaseRef.current === 'idle' && isMobile && recordingsRef.current[seg]) {
      setAltShow((a) => !a);
    }
    setLoopTick((t) => t + 1);
  };

  // Même élément <video> pour la relecture : dans la fenêtre flottante (desktop)
  // ou par-dessus la vidéo YouTube (mobile)
  const replayVideo = (
    <video
      ref={replayRef}
      src={replayUrl}
      muted
      playsInline
      className={
        isMobile
          ? `absolute inset-0 z-10 h-full w-full scale-x-[-1] object-cover ${replayVisible ? '' : 'hidden'}`
          : `absolute inset-0 h-full w-full scale-x-[-1] object-cover ${replayVisible ? '' : 'invisible'}`
      }
    />
  );

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={togglePlay} className={`${btn} min-w-[5.5rem]`}>
        {playing ? 'Pause' : 'Lecture'}
      </button>
      <button
        onPointerDown={holdSlow}
        onPointerUp={releaseSlow}
        onPointerCancel={releaseSlow}
        onLostPointerCapture={releaseSlow}
        onContextMenu={(e) => e.preventDefault()}
        disabled={phase === 'armed' || phase === 'recording'}
        title="Maintiens pour ralentir la vidéo, relâche pour revenir à la vitesse normale"
        className={`${slow ? btnPrimary : btn} min-w-[7.5rem] touch-none select-none whitespace-nowrap`}>
        Ralenti ×0,25
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
      {training && cameraOn && (
        <button onClick={toggleCapture} className={`${btnPrimary} min-w-[6.5rem]`}>
          {phase === 'idle' ? 'Me filmer' : 'Annuler'}
        </button>
      )}
      {recCount > 0 && (
        <button onClick={exportVideo} disabled={!!exporting} className={`${btn} min-w-[8rem]`}>
          {exporting ? `Export ${exporting.i}/${exporting.n}…` : `Exporter (${recCount})`}
        </button>
      )}
      {training && isMobile && portrait && (
        <button onClick={() => setCover((c) => !c)} className={btn}>
          {cover ? 'Ajuster' : 'Remplir'}
        </button>
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
                  ? 'relative w-full shrink-0 overflow-hidden bg-black'
                  : 'mx-auto aspect-video overflow-hidden rounded-lg bg-black'
              }
              style={
                training
                  ? ({
                      height: `calc(100dvh - ${barH}px)`,
                      containerType: coverActive ? 'size' : undefined,
                    } as React.CSSProperties)
                  : { width: 'min(100%, calc(35vh * 16 / 9))' }
              }>
              {/* Mobile en portrait : la vidéo est agrandie pour remplir l'écran (bords rognés) */}
              <div
                ref={holderRef}
                className={`[&_iframe]:h-full [&_iframe]:w-full ${coverActive ? '' : 'h-full w-full'}`}
                style={
                  coverActive
                    ? {
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: 'max(100cqw, calc(100cqh * 16 / 9))',
                        height: 'max(100cqh, calc(100cqw * 9 / 16))',
                      }
                    : undefined
                }
              />
              {training && isMobile && replayVideo}
              {training && isMobile && cameraOn && (mode === 'rec' || replayVisible) && (
                <span className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      mode === 'rec' ? 'animate-pulse bg-red-500' : 'bg-sky-400'
                    }`}
                  />
                  {mode === 'rec' ? 'Rec' : 'Replay'}
                </span>
              )}
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
                    <b>LT</b> ou <b>RT</b> (gâchettes) : maintenir pour ralentir la vidéo
                  </li>
                  <li>
                    <b>LB</b> ou croix gauche : segment précédent
                  </li>
                  <li>
                    <b>RB</b> ou croix droite : segment suivant
                  </li>
                  <li>
                    <b>B</b> (bouton de droite) : en mode entraînement avec caméra, se filmer sur le
                    segment en cours (ou annuler la capture)
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
                  Noms de la manette Xbox. Sur une manette PlayStation : A = croix, B = rond, X =
                  carré, Y = triangle, LB / RB = L1 / R1, LT / RT = L2 / R2, Start = Options.
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
                      {recordings[k] && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Filmé</span>
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

      {/* Compte à rebours au centre de l'écran */}
      {training && count && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <span
            key={count}
            className="select-none text-8xl font-black leading-none text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)] sm:text-[10rem]">
            {count}
          </span>
        </div>
      )}

      {/* Fenêtre flottante du retour caméra (desktop) : déplaçable, redimensionnable */}
      {training && cameraOn && !isMobile && (
        <div
          ref={floatRef}
          onPointerDown={onFloatDown}
          onPointerMove={onFloatMove}
          onPointerUp={endFloatDrag}
          onPointerCancel={endFloatDrag}
          onLostPointerCapture={endFloatDrag}
          style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
          className="fixed z-30 cursor-move touch-none select-none overflow-hidden rounded-lg border-2 border-white/70 bg-black shadow-2xl">
          <video
            ref={liveRef}
            muted
            playsInline
            autoPlay
            className={`absolute inset-0 h-full w-full scale-x-[-1] object-cover ${
              mode === 'replay' ? 'invisible' : ''
            }`}
          />
          {replayVideo}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => hasRec && phase === 'idle' && setViewLive((v) => !v)}
            title={hasRec ? 'Basculer entre le direct et la capture' : undefined}
            className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">
            <span
              className={`h-2 w-2 rounded-full ${
                mode === 'rec'
                  ? 'animate-pulse bg-red-500'
                  : mode === 'replay'
                    ? 'bg-sky-400'
                    : 'bg-green-500'
              }`}
            />
            {mode === 'rec' ? 'Rec' : mode === 'replay' ? 'Replay' : 'Live'}
          </button>
          {/* Poignée de redimensionnement */}
          <div
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
            className="absolute bottom-0 right-0 z-10 flex h-7 w-7 cursor-nwse-resize touch-none items-end justify-end p-1"
            title="Redimensionner">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              <path
                d="M13 3 3 13M13 8 8 13"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

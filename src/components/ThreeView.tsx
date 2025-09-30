// src/components/ThreeView.tsx
import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import FBXModel from "./FBXModel";
import SimpleGraph from "./SimpleGraph";
import GraphHoloPanel from "./GraphHoloPanel";
import { parseExcelToDataSets } from "../utils/excel";
import type { RowsBySheet } from "../utils/excel";

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

type SeriesPoint = { t?: number; value: number };
type Mode = "player" | "admin";
type Layout = "right" | "bottom";
type PanelMode = "docked" | "in3d";

type PlayerManifest = {
  player: string;
  defaultSession?: string;
  sessions: string[];
  fbx?: string;
  excel?: string;
  files?: Record<string, { fbx?: string; excel?: string }>;
};

const FPS = 120;
const isBrowser = typeof window !== "undefined";

/** Suggested players for the dropdown (you can extend via URL ?players=A,B,C) */
const DEFAULT_PLAYERS = ["Pete Alonso"];

/** Training floor dimensions */
const FLOOR_W = 10;
const FLOOR_D = 6;

/** Base-URL helper for GitHub Pages (and still fine locally/Cloudflare) */
const BASE_URL: string = import.meta.env.BASE_URL;
const joinPath = (a: string, b: string) =>
  `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`;
const withBase = (p: string) => joinPath(BASE_URL || "/", p);

/* ------------------------------------------------------------------ */
/* Training Floor (clean, understated grid)                            */
/* ------------------------------------------------------------------ */

function TrainingFloor() {
  const size = 80;           // world units (wide enough for camera)
  const majorDiv = 16;       // number of big squares across
  const minorPerMajor = 4;   // minor lines per big square
  const y = 0;

  const groupRef = React.useRef<THREE.Group>(null);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((o) => {
      const mat = (o as any).material as THREE.Material | undefined;
      if (mat && "opacity" in mat) {
        (mat as any).transparent = true;
        (mat as any).opacity = 0.9;
        (mat as any).depthWrite = false;
      }
      o.frustumCulled = false;
    });
  }, []);

  return (
    <group ref={groupRef} name="FloorGrid">
      {/* Major grid */}
      <gridHelper
        args={[size, majorDiv, 0xffffff, 0x9ca3af]}
        position={[0, y - 0.0005, 0]}
        rotation={[0, 0, 0]}
      />
      {/* Minor grid */}
      <gridHelper
        args={[size, majorDiv * minorPerMajor, 0x6b7280, 0x374151]}
        position={[0, y - 0.0006, 0]}
        rotation={[0, 0, 0]}
      />
      {/* Tight contact shadows for grounding */}
      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.3}
        scale={Math.max(FLOOR_W, FLOOR_D) + 1.6}
        blur={2.6}
        far={10}
        resolution={1024}
        frames={1}
      />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function Scene({
  fbxUrl,
  time,
  onReadyDuration,
}: {
  fbxUrl: string | null;
  time: number;
  onReadyDuration: (dur: number) => void;
}) {
  const axes = useMemo(() => new THREE.AxesHelper(1.5), []);
  return (
    <>
      <hemisphereLight intensity={0.7} groundColor="#0d0f13" />
      <ambientLight intensity={0.25} />
      <directionalLight position={[6, 10, 6]} intensity={1.05} color="#ffd1a3" />

      <TrainingFloor />
      <primitive object={axes} position={[0, 0.01, 0]} />

      {fbxUrl && (
        <FBXModel
          url={fbxUrl}
          scale={0.01}
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          time={time}
          onReadyDuration={onReadyDuration}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function ThreeView() {
  /* URL/setup */
  const params = isBrowser ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialMode: Mode = params.get("mode") === "admin" ? "admin" : "player";
  const [mode] = useState<Mode>(initialMode);
  const isPlayer = mode === "player";

  // Player locking via URL
  const paramPlayerRaw = params.get("player");
  const decodedParamPlayer =
    paramPlayerRaw ? decodeURIComponent(paramPlayerRaw.replace(/\+/g, " ")) : null;
  const initialPlayer = decodedParamPlayer || DEFAULT_PLAYERS[0];
  const isPlayerLocked = params.get("lock") === "1" || (initialMode === "player" && !!paramPlayerRaw);

  // Optional list of players from ?players=A,B,C (only used if NOT locked)
  const playersFromUrl =
    (params.get("players")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) as string[];
  const initialPlayers = useMemo(() => {
    if (isPlayerLocked) return [initialPlayer];
    const base = [...DEFAULT_PLAYERS];
    for (const p of playersFromUrl) if (!base.includes(p)) base.push(p);
    if (!base.includes(initialPlayer)) base.unshift(initialPlayer);
    return base;
  }, [playersFromUrl, isPlayerLocked, initialPlayer]);

  const urlSession = params.get("session") ?? null;

  const [playerName, setPlayerName] = useState<string>(initialPlayer);
  const [session, setSession] = useState<string | null>(urlSession);
  const [players, setPlayers] = useState<string[]>(initialPlayers);

  // keep playerName in sync with URL when locked
  useEffect(() => {
    if (!isPlayerLocked || !paramPlayerRaw) return;
    const decoded = decodeURIComponent(paramPlayerRaw.replace(/\+/g, " "));
    if (decoded !== playerName) setPlayerName(decoded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlayerLocked, paramPlayerRaw]);

  /* Compact/mobile flags & dvh fallback */
  const [isCompact, setIsCompact] = useState<boolean>(() =>
    isBrowser ? window.matchMedia("(max-width: 900px), (max-height: 700px)").matches : false
  );
  useEffect(() => {
    if (!isBrowser) return;
    const mq = window.matchMedia("(max-width: 900px), (max-height: 700px)");
    const onChange = () => setIsCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Set a CSS var for dvh (iPad toolbars) and cap DPR a bit for tablets
  const [dprMax, setDprMax] = useState(1.75);
  useEffect(() => {
    if (!isBrowser) return;
    const setDvh = () => {
      document.documentElement.style.setProperty("--app-dvh", `${window.innerHeight}px`);
    };
    setDvh();
    window.addEventListener("resize", setDvh);
    setDprMax(Math.min(1.75, window.devicePixelRatio || 1));
    return () => window.removeEventListener("resize", setDvh);
  }, []);

  /* Playback */
  const [fbxUrl, setFbxUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [snapFrames, setSnapFrames] = useState(true);

  /* Data (multi-sheet) */
  const [rowsBySheet, setRowsBySheet] = useState<RowsBySheet | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string | null>(null);

  const [rows, setRows] = useState<any[] | null>(null);
  const [channels, setChannels] = useState<string[]>([]);

  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);

  const [selectedChannelB, setSelectedChannelB] = useState<string | null>(null);
  const [seriesB, setSeriesB] = useState<SeriesPoint[] | null>(null);

  const [jsonDuration, setJsonDuration] = useState(0);

  /* Layout + panels */
  const [graphDock, setGraphDock] = useState<Layout>("bottom");
  const [panelMode, setPanelMode] = useState<PanelMode>("docked");

  // Player-editable visibility (persisted)
  const storedShowMain = isBrowser ? localStorage.getItem("seq_showMainGraph") : null;
  const storedShowSecond =
    isBrowser ? localStorage.getItem("seq_showSecondGraph") ?? localStorage.getItem("seq_showMiniGraph") : null;

  const [showMainGraph, setShowMainGraph] = useState<boolean>(storedShowMain ? storedShowMain === "1" : true);
  const [showSecond, setShowSecond] = useState<boolean>(storedShowSecond ? storedShowSecond === "1" : true);

  useEffect(() => {
    if (isBrowser) localStorage.setItem("seq_showMainGraph", showMainGraph ? "1" : "0");
  }, [showMainGraph]);
  useEffect(() => {
    if (!isBrowser) return;
    localStorage.setItem("seq_showSecondGraph", showSecond ? "1" : "0");
    localStorage.removeItem("seq_showMiniGraph");
  }, [showSecond]);

  // 3D panel positions
  const [posMain, setPosMain] = useState<[number, number, number]>([3.8, 0.02, -2.6]);
  const [posSecond, setPosSecond] = useState<[number, number, number]>([1.0, 0.02, -4.2]);

  /* Graph dock sizing */
  const requestedGraphCount = (showMainGraph ? 1 : 0) + (showSecond ? 1 : 0);
  const dockPct = requestedGraphCount === 2 ? 0.3 : requestedGraphCount === 1 ? 0.2 : 0;

  const [dockPx, setDockPx] = useState(() =>
    Math.round((isBrowser ? window.innerHeight : 900) * dockPct)
  );
  useEffect(() => {
    if (!isBrowser) return;
    setDockPx(Math.round(window.innerHeight * dockPct));
    const onResize = () => setDockPx(Math.round(window.innerHeight * dockPct));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [dockPct]);

  /* Player manifest loader */
  const [manifest, setManifest] = useState<PlayerManifest | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadManifest(p: string) {
      try {
        const url = withBase(`data/${encodeURIComponent(p)}/index.json?ts=${Date.now()}`);
        const m: PlayerManifest = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`manifest ${r.status}`);
          return r.json();
        });
        if (cancelled) return;

        setManifest(m);
        setSessions(m.sessions ?? []);
        setSession((prev) =>
          prev && m.sessions?.includes(prev) ? prev : m.defaultSession ?? m.sessions?.[0] ?? null
        );

        setPlayers((list) => (isPlayerLocked ? [p] : list.includes(p) ? list : [...list, p]));
      } catch (e) {
        console.error("Manifest load failed:", e);
        setManifest(null);
        setSessions([]);
        setSession(null);
      }
    }

    loadManifest(playerName);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerName, isPlayerLocked]);

  /* Load session's FBX + Excel using manifest */
  useEffect(() => {
    if (!manifest || !session) return;

    const fileFBX = manifest.files?.[session]?.fbx ?? manifest.fbx ?? "EXPORT.fbx";
    const fileExcel = manifest.files?.[session]?.excel ?? manifest.excel ?? "Kinematic_Data (1).xlsx";

    const fbxPath = withBase(
      `data/${encodeURIComponent(playerName)}/${session}/${encodeURIComponent(fileFBX)}`
    );
    const excelPath = withBase(
      `data/${encodeURIComponent(playerName)}/${session}/${encodeURIComponent(fileExcel)}`
    );

    // Update URL (player/session/lock) for shareability
    if (isBrowser) {
      const sp = new URLSearchParams(window.location.search);
      sp.set("mode", isPlayer ? "player" : "admin");
      sp.set("player", playerName);
      sp.set("session", session);
      if (isPlayerLocked) sp.set("lock", "1"); else sp.delete("lock");
      const newUrl = `${window.location.pathname}?${sp.toString()}`;
      if (newUrl !== window.location.href) window.history.replaceState({}, "", newUrl);
    }

    setFbxUrl(fbxPath);
    setPlaying(true);
    setTime(0);

    (async () => {
      try {
        const blob = await fetch(excelPath).then((r) => {
          if (!r.ok) throw new Error(`excel ${r.status}`);
          return r.blob();
        });
        const sets = await parseExcelToDataSets(blob as any, FPS);
        const names = Object.keys(sets);
        if (!names.length) throw new Error("No usable sheets found.");

        const preferred =
          names.find((n) => /joint.*position/i.test(n)) ??
          names.find((n) => /baseball.*data/i.test(n)) ??
          names[0];

        setRowsBySheet(sets);
        setSheetNames(names);
        setSheet(preferred);
        setRows(sets[preferred]);
      } catch (err) {
        console.error("Excel load failed:", err);
        setRowsBySheet(null);
        setSheetNames([]);
        setSheet(null);
        setRows(null);
      }
    })();
  }, [manifest, session, playerName, isPlayer, isPlayerLocked]);

  /* Clean blob URLs */
  useEffect(() => {
    return () => {
      if (fbxUrl?.startsWith("blob:")) URL.revokeObjectURL(fbxUrl);
    };
  }, [fbxUrl]);

  /* Admin uploads */
  function handleFbxFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (mode !== "admin") return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (fbxUrl?.startsWith("blob:")) URL.revokeObjectURL(fbxUrl);
    setFbxUrl(URL.createObjectURL(file));
    setPlaying(true);
    setTime(0);
  }

  async function handleJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (mode !== "admin") return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr = normalizeToArray(parsed) ?? [];
      const sets: RowsBySheet = { Data: arr };
      setRowsBySheet(sets);
      setSheetNames(["Data"]);
      setSheet("Data");
      setRows(arr);
    } catch (err: any) {
      console.error("JSON load error:", err);
      alert(`Couldn't read that JSON.\n\n${err?.message ?? err}`);
    }
  }

  async function handleExcelFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (mode !== "admin") return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const sets = await parseExcelToDataSets(file, FPS);
      const names = Object.keys(sets);
      if (!names.length) throw new Error("No usable sheets found.");

      const preferred =
        names.find((n) => /joint.*position/i.test(n)) ??
        names.find((n) => /baseball.*data/i.test(n)) ??
        names[0];

      setRowsBySheet(sets);
      setSheetNames(names);
      setSheet(preferred);
      setRows(sets[preferred]);
      setPlaying(true);
      setTime(0);
    } catch (err: any) {
      console.error("Excel load error:", err);
      alert(`Couldn't read that Excel file.\n\n${err?.message ?? err}`);
    }
  }

  function exportCurrentJSON() {
    if (!rows || rows.length === 0) return;
    const blob = new Blob([JSON.stringify(rows)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(sheet ?? "data").replace(/\s+/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
    a.remove();
  }

  /* Helpers */
  function normalizeToArray(obj: any): any[] | null {
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === "object") {
      for (const key of ["data", "frames", "samples", "points", "series"]) {
        if (Array.isArray((obj as any)[key])) return (obj as any)[key];
      }
    }
    return null;
  }

  function prettyLabel(k: string): string {
    const parts = k.split("/").filter(Boolean);
    const tail = parts.slice(-2).join(" / ");
    return (tail || k).replace(/_/g, " ");
  }

  function listNumericChannels(data: Array<Record<string, unknown>>): string[] {
    const set = new Set<string>();
    for (const d of data) {
      if (!d || typeof d !== "object") continue;
      for (const k of Object.keys(d)) {
        if (k === "t" || k === "time" || k === "frame") continue;
        const v = (d as any)[k];
        if (typeof v === "number" && Number.isFinite(v)) set.add(k);
      }
    }
    return Array.from(set).sort();
  }

  function pickPreferredChannel(list: string[]): string | null {
    return (
      list.find((k) => /Wrist.*Velocity/i.test(k)) ??
      list.find((k) => /Velocity/i.test(k)) ??
      list.find((k) => /Rotation/i.test(k)) ??
      list[0] ??
      null
    );
  }

  function buildSeries(
    data: Array<Record<string, unknown>>,
    channel: string | null
  ): { pts: SeriesPoint[]; dur: number } {
    if (!data || data.length === 0 || !channel) return { pts: [], dur: 0 };

    const hasT = data.some((d) => typeof (d as any)?.t === "number");
    const hasTime = data.some((d) => typeof (d as any)?.time === "number");
    const tKey: "t" | "time" | null = hasT ? "t" : hasTime ? "time" : null;

    const n = data.length;
    const pts: SeriesPoint[] = [];

    for (let i = 0; i < n; i++) {
      const row = data[i] as any;
      const rawV = row?.[channel];
      if (typeof rawV !== "number" || !Number.isFinite(rawV)) continue;

      let t: number;
      if (tKey) {
        const tv = Number(row[tKey]);
        if (!Number.isFinite(tv)) continue;
        t = tv;
      } else {
        t = n > 1 ? i / (n - 1) : 0;
      }
      pts.push({ t, value: rawV });
    }

    if (pts.length === 0) return { pts: [], dur: 0 };

    const t0 = pts[0].t ?? 0;
    const t1 = pts[pts.length - 1].t ?? 0;
    const dur = Math.max(0, t1 - t0);

    const normalized: SeriesPoint[] = pts.map((p) => ({
      t: (p.t ?? 0) - t0,
      value: p.value,
    }));

    return { pts: normalized, dur };
  }

  /* Recompute sheet/channels/series when data changes */
  useEffect(() => {
    if (!rowsBySheet || !sheet) return;
    const newRows = rowsBySheet[sheet];
    setRows(newRows);

    const chs = listNumericChannels(newRows);
    setChannels(chs);

    setSelectedChannel((prev) => (prev && chs.includes(prev) ? prev : pickPreferredChannel(chs)));
    setSelectedChannelB((prev) => {
      if (prev && chs.includes(prev)) return prev;
      const first = pickPreferredChannel(chs);
      const second = chs.find((k) => k !== first) ?? first ?? null;
      return second;
    });
  }, [rowsBySheet, sheet]);

  useEffect(() => {
    if (!rows || !selectedChannel) {
      setSeries(null);
      setJsonDuration(0);
      return;
    }
    const { pts, dur } = buildSeries(rows, selectedChannel);
    setSeries(pts);
    setJsonDuration(dur);
  }, [rows, selectedChannel]);

  useEffect(() => {
    if (!rows || !selectedChannelB) {
      setSeriesB(null);
      return;
    }
    const { pts } = buildSeries(rows, selectedChannelB);
    setSeriesB(pts);
  }, [rows, selectedChannelB]);

  /* FBX duration callback */
  const onReadyDuration = useCallback((dur: number) => {
    setDuration(dur);
    setTime((t) => (dur > 0 ? (t % dur + dur) % dur : 0));
  }, []);

  /* Playback loop (smooth with snap-to-frames accumulator) */
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const subFrameAccRef = useRef<number>(0);

  const cancelLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = null;
  }, []);

  useEffect(() => {
    subFrameAccRef.current = 0;
  }, [speed, snapFrames, playing, duration]);

  const startLoop = useCallback(() => {
    cancelLoop();

    const loop = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dtRaw = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      const dt = Math.min(Math.max(dtRaw, 0), 0.05);

      setTime((prev) => {
        if (!playing || duration <= 0) return prev;

        let s = Math.min(2, Math.max(0.1, speed));
        const delta = dt * s;

        if (!snapFrames) {
          let next = prev + delta;
          if (duration > 0) next = ((next % duration) + duration) % duration;
          return next;
        }

        const step = 1 / FPS;
        let acc = subFrameAccRef.current + delta;
        const frames = Math.floor(acc / step);
        subFrameAccRef.current = acc - frames * step;

        if (frames <= 0) return prev;

        let next = prev + frames * step;
        if (duration > 0) {
          next = ((next % duration) + duration) % duration;
          next = Math.min(Math.max(0, next), Math.max(0, duration - step / 2));
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [cancelLoop, playing, duration, speed, snapFrames]);

  useEffect(() => {
    startLoop();
    return cancelLoop;
  }, [startLoop, cancelLoop]);

  /* Seek from graphs */
  const handleGraphSeek = useCallback(
    (tJson: number) => {
      if (duration > 0 && jsonDuration > 0) {
        let t = (tJson / jsonDuration) * duration;
        if (snapFrames) t = Math.round(t * FPS) / FPS;
        setTime(Math.max(0, Math.min(duration, t)));
      } else if (duration > 0) {
        let t = Math.max(0, Math.min(duration, tJson));
        if (snapFrames) t = Math.round(t * FPS) / FPS;
        setTime(t);
      }
    },
    [duration, jsonDuration, snapFrames]
  );

  const fmt = (s: number) => `${s.toFixed(2)}s`;

  /* UI sizing */
  const PANEL_PAD_TOP = 12;
  const PANEL_PAD_BOTTOM = 34;
  const ROW_GAP = 14;
  const EXTRA_CHROME = 12;

  const availableGraphs = (series ? 1 : 0) + (seriesB ? 1 : 0);
  const activeGraphCount = Math.min(requestedGraphCount, availableGraphs);

  const shouldShowBottomDock =
    panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0;

  const dockHeightPx = shouldShowBottomDock ? dockPx : 0;

  const innerChrome = PANEL_PAD_TOP + PANEL_PAD_BOTTOM + EXTRA_CHROME;
  const graphRowsForLayout = requestedGraphCount > 1 ? 2 : 1;
  const computedSlot = Math.floor(
    (dockHeightPx - innerChrome - (graphRowsForLayout > 1 ? ROW_GAP : 0)) / graphRowsForLayout
  );
  const perGraphHeight = Math.max(isCompact ? 100 : 120, computedSlot);

  /* Render */
  return (
    <div
      className="app-root"
      style={{
        width: "100vw",
        height: "var(--app-dvh, 100dvh)",
        position: "relative",
        overflow: "hidden",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {/* Header: 3 clusters that wrap cleanly (Option A) */}
      <div className={`toolbar ${isPlayer ? "is-player" : "is-admin"}`}>
        {/* LEFT cluster: brand + identity */}
        <div className="cluster left" style={{ gridArea: "left" }}>
          <div className="brand" aria-label="Sequence">
            <img src={withBase("Logo.png")} alt="Sequence logo" />
            <span className="name">SEQUENCE</span>
          </div>

          {/* Player (pill when locked; select otherwise) */}
          <div className="ctrl">
            <span className="label">Player</span>
            {isPlayerLocked ? (
              <span className="pill" title={playerName} aria-label="Player">{playerName}</span>
            ) : (
              <select className="select" value={playerName} onChange={(e) => setPlayerName(e.target.value)} title={playerName}>
                {players.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
          </div>

          {/* Session picker */}
          <div className="ctrl">
            <span className="label">Session</span>
            <select
              className="select"
              value={session ?? ""}
              onChange={(e) => setSession(e.target.value)}
              title={session ?? undefined}
              disabled={!sessions.length}
            >
              {sessions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* MIDDLE cluster: transport + sliders */}
        <div className="cluster middle" style={{ gridArea: "middle" }}>
          <div className="ctrl grow">
            <span className="label">Time</span>
            <input
              className="slider"
              type="range"
              min={0}
              max={Math.max(0.001, duration || 0.001)}
              step={snapFrames ? 1 / FPS : Math.max(0.001, (duration || 1) / 1000)}
              value={Math.min(time, duration || 0)}
              onChange={(e) => {
                const t = parseFloat(e.target.value);
                setTime(snapFrames ? Math.round(t * FPS) / FPS : t);
              }}
              disabled={duration <= 0}
            />
          </div>

          <div className="ctrl grow">
            <span className="label">Speed</span>
            <input
              className="slider"
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              disabled={duration <= 0}
            />
            <span className="small">{speed.toFixed(1)}x</span>
          </div>

          <div className="ctrl">
            <button className="btn primary" onClick={() => setPlaying((p) => !p)} disabled={duration <= 0}>
              {playing ? "Pause" : "Play"}
            </button>
            <button className="btn" onClick={() => setTime(0)} disabled={duration <= 0}>
              Reset
            </button>
            {mode === "admin" && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={snapFrames}
                  onChange={(e) => setSnapFrames(e.target.checked)}
                />
                <span>Snap</span>
              </label>
            )}
            {mode === "admin" && (
              <div className="small" style={{ marginLeft: 6 }}>{`${fmt(time)} / ${fmt(duration || 0)} • ${FPS} fps`}</div>
            )}
          </div>
        </div>

        {/* RIGHT cluster: data + visibility */}
        <div className="cluster right" style={{ gridArea: "right" }}>
          {/* Sheet picker (when multiple) */}
          {sheetNames.length > 0 && (
            <div className="ctrl">
              <span className="label">Sheet</span>
              <select
                className="select"
                value={sheet ?? ""}
                onChange={(e) => setSheet(e.target.value)}
                title={sheet ?? undefined}
              >
                {sheetNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}

          {/* Channels (after Excel is loaded) */}
          {channels.length > 0 && (
            <>
              <div className="ctrl">
                <span className="label">Metric A</span>
                <select
                  className="select"
                  value={selectedChannel ?? ""}
                  onChange={(e) => setSelectedChannel(e.target.value)}
                  title={selectedChannel ?? undefined}
                >
                  {channels.map((k) => (
                    <option key={k} value={k}>{k.split("/").slice(-2).join(" / ").replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>

              <div className="ctrl">
                <span className="label">Metric B</span>
                <select
                  className="select"
                  value={selectedChannelB ?? ""}
                  onChange={(e) => setSelectedChannelB(e.target.value)}
                  title={selectedChannelB ?? undefined}
                >
                  {channels.map((k) => (
                    <option key={k} value={k}>{k.split("/").slice(-2).join(" / ").replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Visibility toggles */}
          <label className="toggle">
            <input type="checkbox" checked={showMainGraph} onChange={(e) => setShowMainGraph(e.target.checked)} />
            <span>Primary</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showSecond} onChange={(e) => setShowSecond(e.target.checked)} />
            <span>Secondary</span>
          </label>

          {/* Admin-only: layout mode (kept, but subtle) */}
          {mode === "admin" && (
            <>
              <div className="ctrl">
                <span className="label">Panels</span>
                <select className="select" value={panelMode} onChange={(e) => setPanelMode(e.target.value as PanelMode)}>
                  <option value="docked">Docked</option>
                  <option value="in3d">In-3D</option>
                </select>
              </div>
              <div className="ctrl">
                <span className="label">Dock</span>
                <select className="select" value={graphDock} onChange={(e) => setGraphDock(e.target.value as Layout)}>
                  <option value="bottom">Bottom</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <button className="btn ghost" onClick={exportCurrentJSON} disabled={!rows || rows.length === 0}>
                Export JSON
              </button>
              <label className="btn" style={{ cursor: "pointer" }}>
                Upload .fbx
                <input type="file" accept=".fbx" onChange={handleFbxFile} style={{ display: "none" }} />
              </label>
              <label className="btn" style={{ cursor: "pointer" }}>
                Upload JSON
                <input type="file" accept=".json,application/json" onChange={handleJsonFile} style={{ display: "none" }} />
              </label>
              <label className="btn" style={{ cursor: "pointer" }}>
                Upload Excel
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFile} style={{ display: "none" }} />
              </label>
            </>
          )}
        </div>
      </div>

      {/* 3D + (optional) hologram panels */}
      <div
        className="canvas-wrap"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top:
            panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0
              ? 0
              : 0,
          bottom: panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0 ? dockPx : 0,
          touchAction: "none",
        }}
      >
        <Canvas
          key={`${playerName}:${session ?? "none"}`}
          dpr={[1, dprMax]}
          camera={{ position: [4, 3, 6], fov: 45 }}
          gl={{ antialias: true, powerPreference: isCompact ? "low-power" : "high-performance" }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.0;
            gl.shadowMap.enabled = false;
          }}
        >
          <Scene fbxUrl={fbxUrl} time={time} onReadyDuration={onReadyDuration} />
          <OrbitControls enableDamping dampingFactor={0.08} />
          {/* In-3D graph panels */}
          {panelMode === "in3d" && showMainGraph && series && selectedChannel && (
            <GraphHoloPanel
              title={`Signal • ${sheet ? sheet + " • " : ""}${prettyLabel(selectedChannel)}`}
              position={posMain}
              setPosition={setPosMain}
              draggable={mode === "admin"}
            >
              <SimpleGraph
                data={series}
                time={time}
                jsonDuration={jsonDuration || 0}
                fbxDuration={duration || 0}
                height={200}
                title=""
                yLabel="Value"
                onSeek={handleGraphSeek}
              />
            </GraphHoloPanel>
          )}
          {panelMode === "in3d" && showSecond && seriesB && selectedChannelB && (
            <GraphHoloPanel
              title={`Signal • ${sheet ? sheet + " • " : ""}${prettyLabel(selectedChannelB)}`}
              position={posSecond}
              setPosition={setPosSecond}
              draggable={mode === "admin"}
            >
              <SimpleGraph
                data={seriesB}
                time={time}
                jsonDuration={jsonDuration || 0}
                fbxDuration={duration || 0}
                height={200}
                title=""
                yLabel="Value"
                onSeek={handleGraphSeek}
              />
            </GraphHoloPanel>
          )}
        </Canvas>
      </div>

      {/* Docked graphs (bottom) */}
      {panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0 && (
        <div
          className="panel-wrap"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: dockPx,
            padding: "12px 12px calc(14px + env(safe-area-inset-bottom, 0px))",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          {activeGraphCount > 0 ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {showMainGraph && series && selectedChannel && (
                <SimpleGraph
                  data={series}
                  time={time}
                  jsonDuration={jsonDuration || 0}
                  fbxDuration={duration || 0}
                  height={perGraphHeight}
                  title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannel)}`}
                  yLabel="Value"
                  onSeek={handleGraphSeek}
                />
              )}
              {showSecond && seriesB && selectedChannelB && (
                <SimpleGraph
                  data={seriesB}
                  time={time}
                  jsonDuration={jsonDuration || 0}
                  fbxDuration={duration || 0}
                  height={perGraphHeight}
                  title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannelB)}`}
                  yLabel="Value"
                  onSeek={handleGraphSeek}
                />
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Right-docked graphs */}
      {panelMode === "docked" && graphDock === "right" && requestedGraphCount > 0 && (
        <div
          className="panel-wrap"
          style={{
            position: "absolute",
            top: 94,
            right: 12,
            bottom: 12,
            width: isCompact
              ? Math.min(380, Math.round((isBrowser ? window.innerWidth : 1200) * 0.55))
              : 420,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              overflowY: "auto",
            }}
          >
            {showMainGraph && series && selectedChannel && (
              <SimpleGraph
                data={series}
                time={time}
                jsonDuration={jsonDuration || 0}
                fbxDuration={duration || 0}
                height={isCompact ? 160 : 180}
                title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannel)}`}
                yLabel="Value"
                onSeek={handleGraphSeek}
              />
            )}
            {showSecond && seriesB && selectedChannelB && (
              <SimpleGraph
                data={seriesB}
                time={time}
                jsonDuration={jsonDuration || 0}
                fbxDuration={duration || 0}
                height={isCompact ? 160 : 180}
                title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannelB)}`}
                yLabel="Value"
                onSeek={handleGraphSeek}
              />
            )}
          </div>
        </div>
      )}

      {/* Theme & polish */}
      <style>{`
        .toolbar, .panel-wrap, .select, .btn {
          font-family: Inter, ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        }
        :root {
          --bg-0: #0b0e12;
          --bg-1: #0f141a;
          --panel: rgba(14,18,23,0.66);
          --panel-strong: rgba(14,18,23,0.78);
          --border: rgba(255,255,255,0.08);
          --border-strong: rgba(255,255,255,0.14);
          --text: #e6edf7;
          --muted: #cfd6e2;
          --accent: #e5812b;
          --accent-deep: #cf6a14;
          --glow: rgba(229,129,43,0.35);
          --shadow: 0 12px 40px rgba(0,0,0,0.42);
        }

        /* Header becomes a real grid (never overflows) */
        .toolbar {
          position: absolute;
          left: 12px; right: 12px; top: 12px;
          display: grid;
          grid-template-areas: "left middle right";
          grid-template-columns: auto 1fr auto;
          gap: 10px 14px;
          align-items: center;
          padding: 12px 14px;
          border-radius: 14px;
          background:
            radial-gradient(900px 140px at 10% -60%, rgba(229,129,43,0.08), transparent 65%),
            linear-gradient(180deg, var(--panel-strong), rgba(10,13,17,0.56));
          backdrop-filter: saturate(1.1) blur(8px);
          border: 1px solid var(--border);
          box-shadow: var(--shadow), inset 0 1px rgba(255,255,255,0.05);
          z-index: 10;
          pointer-events: auto;
          min-height: 62px;
        }

        /* Breakpoint: two-row layout */
        @media (min-width: 900px) and (max-width: 1399px) {
          .toolbar {
            grid-template-areas:
              "left right"
              "middle middle";
            grid-template-columns: 1fr auto;
          }
        }

        /* Narrowest: stacks cleanly */
        @media (max-width: 899px) {
          .toolbar {
            grid-template-areas:
              "left"
              "middle"
              "right";
            grid-template-columns: 1fr;
          }
        }

        .cluster { display: flex; flex-wrap: wrap; gap: 8px 10px; min-width: 0; }
        .cluster.middle { align-items: center; }

        .brand { display: flex; align-items: center; gap: 10px; margin-right: 6px; }
        .brand img {
          width: 42px; height: 42px; object-fit: contain;
          border-radius: 50%;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.10), 0 6px 16px rgba(0,0,0,0.35);
        }
        .brand .name {
          font-weight: 800; letter-spacing: 0.06em; color: var(--text);
          font-size: 20px; text-shadow: 0 1px 0 rgba(0,0,0,0.35);
        }

        .ctrl { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .ctrl.grow { flex: 1 1 220px; min-width: 140px; }

        .label { font-size: 12px; color: var(--muted); opacity: 0.9; white-space: nowrap; }
        .small { font-size: 12px; color: var(--muted); opacity: 0.85; white-space: nowrap; }

        .select {
          appearance: none;
          background: linear-gradient(180deg, #12171e, #0f141a);
          color: var(--text);
          border: 1px solid var(--border-strong);
          border-radius: 10px;
          padding: 6px 28px 6px 10px;
          font-size: 12px;
          outline: none;
          height: 30px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
          transition: border-color .18s ease, box-shadow .18s ease, transform .06s ease;
          background-image:
            linear-gradient(180deg, transparent 0 50%, rgba(255,255,255,0.02) 50% 100%),
            radial-gradient(circle at right 12px center, var(--accent) 0 2px, transparent 3px);
          background-repeat: no-repeat;
          min-width: 140px;
        }

        .btn {
          background: linear-gradient(180deg, #1b222c, #141a22);
          color: #d7dde6; border: 1px solid var(--border-strong); border-radius: 11px;
          height: 30px; padding: 0 12px; font-size: 12px;
          display: inline-flex; align-items: center; gap: 6px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
          white-space: nowrap;
        }
        .btn.primary {
          background: linear-gradient(180deg, var(--accent), var(--accent-deep));
          color: #0b0e12; border-color: rgba(255,180,120,0.9);
          font-weight: 700; box-shadow: 0 6px 20px var(--glow);
        }
        .btn.ghost { background: linear-gradient(180deg, #131921, #0e141b); }

        .slider {
          -webkit-appearance: none; width: 100%; height: 6px; border-radius: 999px;
          background: linear-gradient(90deg, rgba(229,129,43,0.32), rgba(207,106,20,0.18));
          box-shadow: inset 0 1px 1px rgba(255,255,255,0.06), 0 0 0 1px var(--border);
          outline: none;
          flex: 1 1 160px; min-width: 0;
        }

        .toggle { display:flex; align-items:center; gap:6px; color: var(--muted); font-size:12px; white-space: nowrap; }
        .toggle input { accent-color: var(--accent); }

        .pill {
          display:inline-flex; align-items:center;
          height:30px; padding:0 10px; border-radius:10px;
          background: linear-gradient(180deg, #12171e, #0f141a);
          color: var(--text); border:1px solid var(--border-strong);
          font-size:12px;
        }

        .panel-wrap {
          pointer-events: auto; border-radius: 14px;
          background: linear-gradient(180deg, rgba(14,18,23,0.66), rgba(10,13,17,0.58));
          border: 1px solid var(--border);
          box-shadow: var(--shadow), inset 0 1px rgba(255,255,255,0.04);
        }

        @media (max-width: 900px), (max-height: 700px) {
          .brand .name { display: none; }
          .select { min-width: 120px; }
          .ctrl.grow { flex-basis: 180px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .btn, .select, .slider, .toolbar { transition: none !important; }
        }
      `}</style>
    </div>
  );
}

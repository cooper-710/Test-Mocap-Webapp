// src/components/ThreeView.tsx
import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
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

/** Training floor size (visual only) */
const FLOOR_W = 10;
const FLOOR_D = 6;

/** Base-URL helper for GitHub Pages (and still fine locally/Cloudflare) */
const BASE_URL: string = import.meta.env.BASE_URL;
const joinPath = (a: string, b: string) =>
  `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`;
const withBase = (p: string) => joinPath(BASE_URL || "/", p);

/** Desired opening camera pose (your “Photo 2” look) */
const HOME_CAM = {
  pos: [3.6, 2.5, 5.4] as [number, number, number],
  target: [0, 1.0, 0] as [number, number, number],
  fov: 42,
};

/* ------------------------------------------------------------------ */
/* Adaptive Lighting Rig                                               */
/* ------------------------------------------------------------------ */

function AdaptiveLightRig({ muted = false }: { muted?: boolean }) {
  const { camera, scene } = useThree();
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.DirectionalLight>(null);
  const keyTarget = useRef<THREE.Object3D>(null);
  const fillTarget = useRef<THREE.Object3D>(null);
  const rimTarget = useRef<THREE.Object3D>(null);

  useFrame(() => {
    const aimY = 1.0;
    const subject = new THREE.Vector3(0, aimY, 0);
    const toCam = camera.position.clone().sub(subject).normalize();

    keyTarget.current!.position.set(0, aimY, 0);
    fillTarget.current!.position.set(0, aimY, 0);
    rimTarget.current!.position.set(0, aimY, 0);

    const keyPos = toCam.clone().multiplyScalar(6);
    keyPos.y = 3.0;
    keyRef.current!.position.copy(keyPos);

    const fillPos = toCam.clone().multiplyScalar(-5);
    fillPos.y = 2.2;
    fillRef.current!.position.copy(fillPos);

    const rimPos = new THREE.Vector3(-toCam.z, 0, toCam.x)
      .normalize()
      .multiplyScalar(5.2);
    rimPos.y = 3.2;
    rimRef.current!.position.copy(rimPos);

    keyRef.current!.target = keyTarget.current!;
    fillRef.current!.target = fillTarget.current!;
    rimRef.current!.target = rimTarget.current!;
    keyRef.current!.target.updateMatrixWorld();
    fillRef.current!.target.updateMatrixWorld();
    rimRef.current!.target.updateMatrixWorld();

    // Brighter adaptive exposure with distance comp
    const dist = camera.position.length();
    const base = 1.12;
    const expo = THREE.MathUtils.clamp(base + (7 - dist) * 0.06, 1.02, 1.34);
    // @ts-expect-error
    scene.toneMappingExposure = expo;
  });

  return (
    <group>
      <hemisphereLight
        intensity={0.5}
        color={"#dadde2"}
        groundColor={muted ? "#0a0c10" : "#0d0f13"}
      />
      <ambientLight intensity={0.2} />

      {/* Warm spot pool at origin — brighter & wider */}
      <spotLight
        color={"#ffdfbf"}
        intensity={2.0}
        position={[0, 6.4, 0]}
        angle={Math.PI * 0.32}
        penumbra={0.75}
        distance={26}
        castShadow={false}
      />

      {/* Subtle warm fill near torso for mid-tones */}
      <pointLight color={"#ffe9cf"} intensity={0.6} distance={3.8} position={[0, 1.2, 0]} />

      {/* Key / Fill / Rim */}
      <directionalLight ref={keyRef} color={"#ffd8b8"} intensity={1.5} castShadow={false}>
        <object3D ref={keyTarget} />
      </directionalLight>

      <directionalLight ref={fillRef} color={"#e6e9ee"} intensity={0.42} castShadow={false}>
        <object3D ref={fillTarget} />
      </directionalLight>

      <directionalLight ref={rimRef} color={"#a7c7ff"} intensity={0.95} castShadow={false}>
        <object3D ref={rimTarget} />
      </directionalLight>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Training Floor (grid unchanged visually)                            */
/* ------------------------------------------------------------------ */

function TrainingFloor({ muted = false }: { muted?: boolean }) {
  const size = 80;
  const majorDiv = 16;
  const minorPerMajor = 4;

  // Your current tuning
  const majorColor = new THREE.Color(1, 1, 1).multiplyScalar(0.45);
  const minorColor = new THREE.Color(1, 1, 1).multiplyScalar(muted ? 0.1 : 0.16);

  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((o) => {
      const mat = (o as any).material as THREE.Material | undefined;
      if (mat && "opacity" in mat) {
        (mat as any).transparent = true;
        (mat as any).opacity = 0.5;
        (mat as any).depthWrite = false;
      }
      o.frustumCulled = false;
    });
  }, []);

  return (
    <group ref={groupRef} name="FloorGrid">
      <gridHelper
        args={[size, majorDiv, majorColor, majorColor]}
        position={[0, -0.00055, 0]}
        rotation={[0, 0, 0]}
      />
      <gridHelper
        args={[size, majorDiv * minorPerMajor, minorColor, minorColor]}
        position={[0, -0.0006, 0]}
        rotation={[0, 0, 0]}
      />
      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.28}
        scale={Math.max(FLOOR_W, FLOOR_D) + 1.6}
        blur={2.4}
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
  mutedGrid,
}: {
  fbxUrl: string | null;
  time: number;
  onReadyDuration: (dur: number) => void;
  mutedGrid: boolean;
}) {
  const axes = useMemo(() => new THREE.AxesHelper(1.5), []);
  return (
    <>
      <AdaptiveLightRig muted={mutedGrid} />
      <TrainingFloor muted={mutedGrid} />
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
  const decodedParamPlayer = paramPlayerRaw ? decodeURIComponent(paramPlayerRaw.replace(/\+/g, " ")) : null;
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

  useEffect(() => {
    if (!isPlayerLocked || !paramPlayerRaw) return;
    const decoded = decodeURIComponent(paramPlayerRaw.replace(/\+/g, " "));
    if (decoded !== playerName) setPlayerName(decoded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlayerLocked, paramPlayerRaw]);

  /* Compact/mobile */
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

  // Studio: presentation mode (tight header + single metric)
  const [studio, setStudio] = useState<boolean>(false);

  // Player-editable visibility (persisted)
  const storedShowMain = isBrowser ? localStorage.getItem("seq_showMainGraph") : null;
  const storedShowSecond =
    isBrowser
      ? localStorage.getItem("seq_showSecondGraph") ?? localStorage.getItem("seq_showMiniGraph")
      : null;

  const [showMainGraph, setShowMainGraph] = useState<boolean>(storedShowMain ? storedShowMain === "1" : true);
  const [showSecond, setShowSecond] = useState<boolean>(storedShowSecond ? storedShowSecond === "1" : true);

  // Studio hides secondary automatically (does not overwrite preference)
  useEffect(() => {
    if (studio) setShowSecond(false);
  }, [studio]);

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

  /* Graph dock sizing (no vertical/horizontal overflow) */
  const requestedGraphCount = (showMainGraph ? 1 : 0) + (showSecond ? 1 : 0);
  const dockPct = requestedGraphCount === 2 ? 0.3 : requestedGraphCount === 1 ? 0.2 : 0;

  // constants used to compute available room and split heights
  const PANEL_PAD_TOP = 12;
  const PANEL_PAD_BOTTOM = 34; // includes visual bottom padding in the dock
  const ROW_GAP = 14;
  const EXTRA_CHROME = 12;

  // Your chosen minimums
  const MIN_GRAPH_PX = isCompact ? 110 : 130;

  const [dockPx, setDockPx] = useState(() => {
    const base = Math.round((isBrowser ? window.innerHeight : 900) * dockPct);
    const rows = requestedGraphCount > 1 ? 2 : 1;
    const innerChrome =
      PANEL_PAD_TOP + PANEL_PAD_BOTTOM + EXTRA_CHROME + (rows > 1 ? ROW_GAP : 0);
    const needed = rows * MIN_GRAPH_PX + innerChrome;
    return Math.max(base, needed);
  });

  useEffect(() => {
    if (!isBrowser) return;
    const compute = () => {
      const base = Math.round(window.innerHeight * dockPct);
      const rows = requestedGraphCount > 1 ? 2 : 1;
      const innerChrome =
        PANEL_PAD_TOP + PANEL_PAD_BOTTOM + EXTRA_CHROME + (rows > 1 ? ROW_GAP : 0);
      const needed = rows * MIN_GRAPH_PX + innerChrome;
      setDockPx(Math.max(base, needed));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [dockPct, requestedGraphCount, MIN_GRAPH_PX]);

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
    const fileExcel =
      manifest.files?.[session]?.excel ?? manifest.excel ?? "Kinematic_Data (1).xlsx";

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
      if (isPlayerLocked) sp.set("lock", "1");
      else sp.delete("lock");
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

  /* Seek from graphs (map JSON time → FBX time) */
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

  /* Controls + Camera refs for shortcuts and home view */
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const applyHomeView = useCallback(() => {
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || !ctrls) return;

    cam.position.set(...HOME_CAM.pos);
    cam.fov = HOME_CAM.fov;
    cam.updateProjectionMatrix();

    ctrls.target.set(...HOME_CAM.target);
    ctrls.update();
  }, []);

  const [controlsMounted, setControlsMounted] = useState(false);
  const setControlsRef = useCallback((el: any) => {
    controlsRef.current = el;
    setControlsMounted(!!el);
  }, []);

  // Once OrbitControls is mounted, set home
  useEffect(() => {
    if (controlsMounted) applyHomeView();
  }, [controlsMounted, applyHomeView]);

  // Re-apply home when dataset changes
  useEffect(() => {
    applyHomeView();
  }, [playerName, session, applyHomeView]);

  /* Keyboard shortcuts (space, arrows, up/down, F, G) */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) return;

      const key = e.key.toLowerCase();
      const step = 1 / FPS;

      if (key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (key === "arrowright") {
        e.preventDefault();
        if (duration > 0)
          setTime((t) =>
            Math.min(duration, snapFrames ? Math.round((t + step) * FPS) / FPS : t + step)
          );
      } else if (key === "arrowleft") {
        e.preventDefault();
        if (duration > 0)
          setTime((t) =>
            Math.max(0, snapFrames ? Math.round((t - step) * FPS) / FPS : t - step)
          );
      } else if (key === "arrowup") {
        e.preventDefault();
        setSpeed((s) => Math.min(2, Math.max(0.1, Math.round((s + 0.1) * 10) / 10)));
      } else if (key === "arrowdown") {
        e.preventDefault();
        setSpeed((s) => Math.min(2, Math.max(0.1, Math.round((s - 0.1) * 10) / 10)));
      } else if (key === "f") {
        e.preventDefault();
        applyHomeView();
      } else if (key === "g") {
        e.preventDefault();
        setShowSecond((v) => !v);
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [duration, snapFrames, applyHomeView]);

  /* Render */
  const toolbarVars = (isPlayer
    ? ({ ["--brand-img" as any]: "56px", ["--brand-text" as any]: "24px" })
    : ({ ["--brand-img" as any]: "28px", ["--brand-text" as any]: "18px" })) as React.CSSProperties;

  const availableGraphs = (series ? 1 : 0) + (seriesB ? 1 : 0);
  const activeGraphCount = Math.min(requestedGraphCount, availableGraphs);
  const shouldShowBottomDock =
    panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0;
  const dockHeightPx = shouldShowBottomDock ? dockPx : 0;

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      {/* Top bar */}
      <div className={`toolbar ${isPlayer ? "is-player" : "is-admin"} ${studio ? "studio" : ""}`} style={toolbarVars}>
        <div className="brand" aria-label="Sequence">
          <img src={withBase("Logo.png")} alt="Sequence logo" />
          <span className="name">SEQUENCE</span>
        </div>

        {/* Player (pill when locked; select otherwise) */}
        <div className="ctrl">
          <span className="label">Player</span>
          {isPlayerLocked ? (
            <span className="pill" title={playerName} aria-label="Player">
              {playerName}
            </span>
          ) : (
            <select className="select" value={playerName} onChange={(e) => setPlayerName(e.target.value)} title={playerName}>
              {players.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
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
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Timeline + Speed */}
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
            style={{ width: isCompact ? 180 : isPlayer ? 360 : 320 }}
          />
        </div>
        <div className="ctrl">
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
            style={{ width: isCompact ? 140 : 180 }}
          />
          <span className="small">{speed.toFixed(1)}x</span>
        </div>

        {/* Transport */}
        <button className="btn primary" onClick={() => setPlaying((p) => !p)} disabled={duration <= 0}>
          {playing ? "Pause" : "Play"}
        </button>
        <button className="btn" onClick={() => setTime(0)} disabled={duration <= 0}>
          Reset
        </button>

        {/* Sheet + Metrics */}
        <div className="ctrl">
          <span className="label">Sheet</span>
          <select
            className="select"
            value={sheet ?? ""}
            onChange={(e) => setSheet(e.target.value)}
            title={sheet ?? undefined}
          >
            {sheetNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

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
                  <option key={k} value={k}>
                    {k.split("/").slice(-2).join(" / ").replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {!studio && (
              <div className="ctrl">
                <span className="label">Metric B</span>
                <select
                  className="select"
                  value={selectedChannelB ?? ""}
                  onChange={(e) => setSelectedChannelB(e.target.value)}
                  title={selectedChannelB ?? undefined}
                >
                  {channels.map((k) => (
                    <option key={k} value={k}>
                      {k.split("/").slice(-2).join(" / ").replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {/* Graph toggles */}
        <label className="toggle">
          <input type="checkbox" checked={showMainGraph} onChange={(e) => setShowMainGraph(e.target.checked)} />
          <span>Primary</span>
        </label>
        {!studio && (
          <label className="toggle">
            <input type="checkbox" checked={showSecond} onChange={(e) => setShowSecond(e.target.checked)} />
            <span>Secondary</span>
          </label>
        )}

        {/* Admin-only layout & snap */}
        {mode === "admin" && (
          <>
            <div className="ctrl">
              <span className="label">Layout</span>
              <select className="select" value={graphDock} onChange={(e) => setGraphDock(e.target.value as Layout)}>
                <option value="right">Right (stacked)</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>

            <div className="ctrl">
              <span className="label">Panels</span>
              <select className="select" value={panelMode} onChange={(e) => setPanelMode(e.target.value as PanelMode)}>
                <option value="docked">Docked UI</option>
                <option value="in3d">In-3D (holograms)</option>
              </select>
            </div>

            <label className="toggle">
              <input type="checkbox" checked={snapFrames} onChange={(e) => setSnapFrames(e.target.checked)} />
              <span>Snap</span>
            </label>

            <label className="toggle">
              <input type="checkbox" checked={studio} onChange={(e) => setStudio(e.target.checked)} />
              <span>Studio</span>
            </label>

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
            <button className="btn ghost" onClick={exportCurrentJSON} disabled={!rows || rows.length === 0}>
              Export JSON
            </button>
          </>
        )}
      </div>

      {/* 3D + (optional) hologram panels */}
      <Canvas
        key={`${playerName}:${session ?? "none"}`}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          touchAction: "none",
          bottom:
            panelMode === "docked" && graphDock === "bottom" && requestedGraphCount > 0
              ? dockPx
              : 0,
        }}
        dpr={isCompact ? [1, 1.25] : [1, 2]}
        camera={{ position: [...HOME_CAM.pos], fov: HOME_CAM.fov }}
        gl={{ antialias: true, powerPreference: isCompact ? "low-power" : "high-performance" }}
        onCreated={({ gl, camera, scene }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
          // @ts-expect-error
          gl.physicallyCorrectLights = true;
          gl.shadowMap.enabled = false;
          cameraRef.current = camera as THREE.PerspectiveCamera;

          scene.fog = new THREE.FogExp2("#0b0e12", 0.055);
          // @ts-expect-error
          scene.toneMappingExposure = 1.12;

          // Ensure home view once everything is mounted
          requestAnimationFrame(() => applyHomeView());
        }}
      >
        <Scene
          fbxUrl={fbxUrl}
          time={time}
          onReadyDuration={onReadyDuration}
          mutedGrid={studio}
        />

        {/* allow low angles so you can look UP at the figure */}
        <OrbitControls
          ref={setControlsRef}
          enableDamping
          dampingFactor={0.06}
          minDistance={2}
          maxDistance={12}
          minPolarAngle={0.06}
          maxPolarAngle={Math.PI * 0.92}
          target={[...HOME_CAM.target]}
        />

        {/* In-3D graph panels */}
        {panelMode === "in3d" && showMainGraph && series && selectedChannel && (
          <GraphHoloPanel
            title={`Signal • ${sheet ? sheet + " • " : ""}${prettyLabel(selectedChannel)}`}
            position={[...posMain]}
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

        {panelMode === "in3d" && !studio && showSecond && seriesB && selectedChannelB && (
          <GraphHoloPanel
            title={`Signal • ${sheet ? sheet + " • " : ""}${prettyLabel(selectedChannelB)}`}
            position={[...posSecond]}
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

      {/* Docked graphs (bottom) – zero-scroll, exact split, min-height protected */}
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
            minWidth: 0,
          }}
        >
          {activeGraphCount > 0 ? (
            <div
              style={{
                height: "100%",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: ROW_GAP,
                overflow: "hidden",
                minWidth: 0,
              }}
            >
              {showMainGraph && series && selectedChannel && (
                <SimpleGraph
                  data={series}
                  time={time}
                  jsonDuration={jsonDuration || 0}
                  fbxDuration={duration || 0}
                  height={
                    Math.floor(
                      (dockPx -
                        (PANEL_PAD_TOP + PANEL_PAD_BOTTOM + EXTRA_CHROME) -
                        ((requestedGraphCount - 1) * ROW_GAP)) / (requestedGraphCount > 1 ? 2 : 1)
                    ) - 1
                  }
                  title={`Signal · ${sheet ? sheet + " · " : ""}${prettyLabel(selectedChannel)}`}
                  yLabel="Value"
                  onSeek={handleGraphSeek}
                />
              )}
              {!studio && showSecond && seriesB && selectedChannelB && (
                <SimpleGraph
                  data={seriesB}
                  time={time}
                  jsonDuration={jsonDuration || 0}
                  fbxDuration={duration || 0}
                  height={
                    Math.floor(
                      (dockPx -
                        (PANEL_PAD_TOP + PANEL_PAD_BOTTOM + EXTRA_CHROME) -
                        ((requestedGraphCount - 1) * ROW_GAP)) / (requestedGraphCount > 1 ? 2 : 1)
                    ) - 1
                  }
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
            top: isCompact ? 86 : 90,
            right: 12,
            bottom: 12,
            width: isCompact
              ? Math.min(380, Math.round((isBrowser ? window.innerWidth : 1200) * 0.55))
              : 420,
            overflow: "hidden",
            minWidth: 0,
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
            {!studio && showSecond && seriesB && selectedChannelB && (
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

      {/* Theme & polish (neutral graphite — no blue tint) */}
      <style>{`
        .toolbar, .panel-wrap, .select, .btn {
          font-family: Inter, ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        }
        :root {
          --bg-0: #0b0e12;
          --bg-1: #0e1116;
          --panel: rgba(12,14,18,0.66);
          --border: rgba(255,255,255,0.06);
          --border-strong: rgba(255,255,255,0.12);
          --text: #e6edf7;
          --muted: #cfd6e2;
          --accent: #e5812b;
          --accent-deep: #cf6a14;
          --glow: rgba(229,129,43,0.35);
          --shadow: 0 12px 40px rgba(0,0,0,0.45);
        }

        .toolbar {
          position: absolute;
          left: 12px; right: 12px;
          top: calc(12px + env(safe-area-inset-top, 0px));
          display: flex; flex-wrap: wrap; align-items: center;
          gap: 10px; row-gap: 10px; padding: 10px 12px;
          border-radius: 14px;
          background:
            radial-gradient(900px 140px at 10% -60%, rgba(229,129,43,0.06), transparent 65%),
            linear-gradient(180deg, rgba(18,22,28,0.76), rgba(11,14,18,0.60));
          backdrop-filter: saturate(1.1) blur(10px);
          border: 1px solid var(--border);
          box-shadow: 0 10px 28px rgba(0,0,0,0.35), inset 0 1px rgba(255,255,255,0.04);
          z-index: 10; pointer-events: auto; min-height: 58px;
        }
        .toolbar.studio { padding: 8px 10px; }

        .brand { display: flex; align-items: center; gap: 10px; margin-right: 8px; }
        .brand img {
          width: var(--brand-img); height: var(--brand-img); object-fit: contain;
          border-radius: 50%;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.12), 0 6px 18px rgba(0,0,0,0.35);
        }
        .brand .name {
          font-weight: 800; letter-spacing: 0.06em; color: var(--text);
          font-size: var(--brand-text); text-shadow: 0 1px 0 rgba(0,0,0,0.35);
        }

        .ctrl { display: flex; align-items: center; gap: 6px; }
        .ctrl.grow { min-width: 320px; }
        .label { font-size: 12px; color: var(--muted); opacity: 0.9; }
        .small { font-size: 12px; color: var(--muted); opacity: 0.85; }

        .select {
          appearance: none;
          background: linear-gradient(180deg, #121418, #0e1116);
          color: var(--text);
          border: 1px solid var(--border-strong);
          border-radius: 10px;
          padding: 6px 28px 6px 10px;
          font-size: 12px;
          outline: none;
          height: 30px;
          min-width: 160px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
          transition: border-color .18s ease, box-shadow .18s ease;
          background-image:
            linear-gradient(180deg, transparent 0 50%, rgba(255,255,255,0.02) 50% 100%),
            radial-gradient(circle at right 12px center, var(--accent) 0 2px, transparent 3px);
          background-repeat: no-repeat;
        }

        .btn {
          background: linear-gradient(180deg, #1a1f26, #12161b);
          color: #d7dde6; border: 1px solid var(--border-strong); border-radius: 10px;
          height: 30px; padding: 0 12px; font-size: 12px;
          display: inline-flex; align-items: center; gap: 6px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
          transition: filter .12s ease, box-shadow .12s ease;
        }
        .btn:hover { filter: brightness(1.05); }
        .btn.primary {
          background: linear-gradient(180deg, var(--accent), var(--accent-deep));
          color: #0b0e12; border-color: rgba(255,180,120,0.9);
          font-weight: 700; box-shadow: 0 6px 18px var(--glow);
        }

        .slider {
          -webkit-appearance: none; width: 180px; height: 6px; border-radius: 999px;
          background: linear-gradient(90deg, rgba(229,129,43,0.32), rgba(207,106,20,0.22));
          box-shadow: inset 0 1px 1px rgba(255,255,255,0.05), 0 0 0 1px var(--border);
          outline: none;
        }

        .toggle { display:flex; align-items:center; gap:6px; color: var(--muted); font-size:12px; }
        .toggle input { accent-color: var(--accent); }

        .pill {
          display:inline-flex; align-items:center;
          height:30px; padding:0 10px; border-radius:10px;
          background: linear-gradient(180deg, #121418, #0e1116);
          color: var(--text); border:1px solid var(--border-strong);
          font-size:12px;
        }

        .panel-wrap {
          pointer-events: auto; border-radius: 14px;
          background: linear-gradient(180deg, rgba(13,16,20,0.66), rgba(10,13,16,0.56));
          border: 1px solid var(--border);
          box-shadow: var(--shadow), inset 0 1px rgba(255,255,255,0.04);
        }

        @media (max-width: 900px), (max-height: 700px) {
          .toolbar { gap: 8px; padding: 8px 10px; }
          .brand .name { display: none; }
          .ctrl.grow { min-width: 200px; }
          .btn { height: 28px; font-size: 12px; padding: 0 10px; }
          .select { height: 28px; font-size: 12px; min-width: 140px; }
          .small { font-size: 11px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .btn, .select, .slider, .toolbar { transition: none !important; }
        }
      `}</style>
    </div>
  );
}

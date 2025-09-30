// scripts/gen-manifests.mjs
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "public", "data");

function isDateLike(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function byDate(a, b) {
  if (isDateLike(a) && isDateLike(b)) return a.localeCompare(b);
  return a.localeCompare(b);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
async function listDirs(dir) {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    return ents.filter(e => e.isDirectory()).map(e => e.name);
  } catch { return []; }
}
async function listFiles(dir) {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    return ents.filter(e => e.isFile()).map(e => e.name);
  } catch { return []; }
}

function pickFBX(files) {
  const fbx = files.filter(f => /\.fbx$/i.test(f));
  const exact = fbx.find(f => /^export\.fbx$/i.test(f));
  return exact || fbx[0] || null;
}
function pickExcel(files) {
  const x = files.filter(f => /\.(xlsx|xls|csv)$/i.test(f));
  const pref = x.find(f => /Kinematic.*Data/i.test(f)) || x.find(f => /Baseball.*Data/i.test(f));
  return pref || x[0] || null;
}

async function buildManifestForPlayer(playerDirName) {
  const playerPath = path.join(DATA_DIR, playerDirName);
  const sessionDirs = (await listDirs(playerPath)).sort(byDate);

  if (sessionDirs.length === 0) {
    return {
      manifest: {
        player: playerDirName,
        sessions: [],
        defaultSession: null,
        fbx: "EXPORT.fbx",
        excel: "Kinematic_Data (1).xlsx",
      },
      path: path.join(playerPath, "index.json"),
    };
  }

  const filesPerSession = {};
  const firstFiles = { fbx: null, excel: null };

  for (const session of sessionDirs) {
    const sp = path.join(playerPath, session);
    const files = await listFiles(sp);
    const fbx = pickFBX(files);
    const excel = pickExcel(files);

    if (!firstFiles.fbx && fbx) firstFiles.fbx = fbx;
    if (!firstFiles.excel && excel) firstFiles.excel = excel;

    filesPerSession[session] = { fbx, excel };
  }

  const defaultFBX = firstFiles.fbx || "EXPORT.fbx";
  const defaultExcel = firstFiles.excel || "Kinematic_Data (1).xlsx";

  const overrides = {};
  for (const s of sessionDirs) {
    const { fbx, excel } = filesPerSession[s];
    const o = {};
    if (fbx && fbx !== defaultFBX) o.fbx = fbx;
    if (excel && excel !== defaultExcel) o.excel = excel;
    if (Object.keys(o).length) overrides[s] = o;
  }

  const manifest = {
    player: playerDirName,
    sessions: sessionDirs,
    defaultSession: sessionDirs[sessionDirs.length - 1] ?? null,
    fbx: defaultFBX,
    excel: defaultExcel,
    ...(Object.keys(overrides).length ? { files: overrides } : {}),
  };

  return { manifest, path: path.join(playerPath, "index.json") };
}

async function writeJSON(fp, obj) {
  const json = JSON.stringify(obj, null, 2) + "\n";
  await ensureDir(path.dirname(fp));
  await fs.writeFile(fp, json, "utf8");
}

async function main() {
  const players = await listDirs(DATA_DIR);
  const playersList = [];

  for (const p of players) {
    const { manifest, path: outPath } = await buildManifestForPlayer(p);
    await writeJSON(outPath, manifest);
    playersList.push({ player: manifest.player, defaultSession: manifest.defaultSession });
    console.log("Wrote", path.relative(ROOT, outPath));
  }

  await writeJSON(path.join(DATA_DIR, "players.json"), playersList);
  console.log("Wrote public/data/players.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

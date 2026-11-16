// Prototype étape 0 : semaine type, grille de 15 min, HiGHS WebAssembly.
// Usage : node bench.mjs [salles demandes limite_secondes]
import highsLoader from "highs";

const DAYS = 7;
const UNITS_PER_DAY = 56; // 08:00-22:00 en pas de 15 min
const T = DAYS * UNITS_PER_DAY;

// Générateur pseudo-aléatoire reproductible
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function makeInstance(nRooms, nDemands, seed = 1) {
  const r = rng(seed);
  const types = ["basket", "gym", "salle"];
  const rooms = Array.from({ length: nRooms }, (_, i) => ({
    id: i,
    type: types[Math.floor(r() * types.length)],
    cap: 20 + Math.floor(r() * 80),
    // jours ouverts : 5 à 7 jours, plage de 8h à 22h simplifiée
    days: Array.from({ length: DAYS }, (_, d) => d).filter(() => r() < 0.85),
  }));
  const demands = Array.from({ length: nDemands }, (_, i) => {
    const need = r() < 0.5 ? types[Math.floor(r() * types.length)] : null; // null = n'importe quelle salle
    return {
      id: i,
      need,
      size: 8 + Math.floor(r() * 40),
      dur: 4 + Math.floor(r() * 9), // 1 h à 3 h
      sessions: 1 + Math.floor(r() * 3),
      prio: 1 + Math.floor(r() * 3),
    };
  });
  return { rooms, demands };
}

function buildLP({ rooms, demands }) {
  const vars = []; // {name, dem, room, start}
  const cover = new Map(); // "room,t" -> noms de variables
  const perDemand = new Map();
  const perDemandDay = new Map();
  for (const d of demands) {
    for (const room of rooms) {
      if (d.need && room.type !== d.need) continue;
      if (room.cap < d.size) continue;
      for (const day of room.days) {
        for (let s = 0; s + d.dur <= UNITS_PER_DAY; s++) {
          const start = day * UNITS_PER_DAY + s;
          const name = `x_${d.id}_${room.id}_${start}`;
          vars.push({ name, dem: d, room, start });
          for (let t = start; t < start + d.dur; t++) {
            const k = `${room.id},${t}`;
            if (!cover.has(k)) cover.set(k, []);
            cover.get(k).push(name);
          }
          (perDemand.get(d.id) ?? perDemand.set(d.id, []).get(d.id)).push(name);
          const dk = `${d.id},${day}`;
          (perDemandDay.get(dk) ?? perDemandDay.set(dk, []).get(dk)).push(name);
        }
      }
    }
  }
  const lines = ["Maximize", " obj: " + (vars.map(v => `${v.dem.prio * v.dem.dur} ${v.name}`).join(" + ") || "0")];
  lines.push("Subject To");
  let c = 0;
  for (const names of cover.values()) {
    if (names.length > 1) lines.push(` c${c++}: ${names.join(" + ")} <= 1`);
  }
  for (const [id, names] of perDemand) {
    const d = demands[id];
    lines.push(` n${id}: ${names.join(" + ")} <= ${d.sessions}`);
  }
  for (const [k, names] of perDemandDay) {
    if (names.length > 1) lines.push(` j${c++}: ${names.join(" + ")} <= 1`);
  }
  lines.push("Binary", " " + vars.map(v => v.name).join(" "));
  lines.push("End");
  return { lp: lines.join("\n"), nVars: vars.length, nCons: c + perDemand.size };
}

const [nRooms = 10, nDemands = 20, limit = 60] = process.argv.slice(2).map(Number);
const inst = makeInstance(nRooms, nDemands);
const t0 = performance.now();
const { lp, nVars, nCons } = buildLP(inst);
const tBuild = performance.now() - t0;

const highs = await highsLoader();
const t1 = performance.now();
const res = highs.solve(lp, { time_limit: limit, mip_rel_gap: 0.02 });
const tSolve = performance.now() - t1;

let placed = 0;
for (const [name, col] of Object.entries(res.Columns ?? {})) {
  if (col.Primal > 0.5) placed++;
}
const wanted = inst.demands.reduce((a, d) => a + d.sessions, 0);
console.log(JSON.stringify({
  salles: nRooms, demandes: nDemands, variables: nVars, contraintes: nCons,
  lpKo: Math.round(lp.length / 1024),
  buildMs: Math.round(tBuild), solveMs: Math.round(tSolve),
  statut: res.Status, objectif: res.ObjectiveValue,
  seancesPlacees: placed, seancesDemandees: wanted,
}));

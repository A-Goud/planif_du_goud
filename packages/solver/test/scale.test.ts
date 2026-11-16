import { describe, expect, it } from "vitest";
import { spaceSchema } from "@planif/core";
import { solvePeriod } from "../src/index.js";

/** Mesure de taille : lancée seulement avec BENCH=1 (npm run bench). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function instance(nRooms: number, nDemands: number) {
  const r = rng(7);
  const types = ["basket", "gym", "salle"];
  const acts = ["basket", "danse", "yoga", "judo"];
  return spaceSchema.parse({
    id: "s",
    name: "Bench",
    requesters: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, name: `Asso ${i}` })),
    periods: [{ id: "p", name: "P", start: "2026-09-01", end: "2026-10-16" }],
    resources: Array.from({ length: nRooms }, (_, i) => ({
      id: `r${i}`,
      name: `Salle ${i}`,
      type: types[Math.floor(r() * types.length)],
      capacity: 20 + Math.floor(r() * 80),
      compatibleGroups: i % 4 === 0 ? [["danse", "yoga"]] : [],
      weekly: [{ days: [0, 1, 2, 3, 4, 5], start: "08:00", end: "22:00" }],
    })),
    demands: Array.from({ length: nDemands }, (_, i) => ({
      id: `d${i}`,
      requesterId: `q${i % 20}`,
      label: `Demande ${i}`,
      activity: acts[Math.floor(r() * acts.length)],
      size: 8 + Math.floor(r() * 40),
      durationUnits: 4 + Math.floor(r() * 9),
      sessions: 1 + Math.floor(r() * 3),
      everyKWeeks: r() < 0.15 ? 2 : 1,
      shareable: r() < 0.3,
      priority: 1 + Math.floor(r() * 5),
      place: r() < 0.5 ? { kind: "type", resourceType: types[Math.floor(r() * types.length)] } : { kind: "any" },
    })),
  });
}

describe.skipIf(!process.env.BENCH)("taille", () => {
  for (const [rooms, demands, step] of [
    [10, 20, 4],
    [20, 40, 4],
    [20, 40, 2],
    [30, 60, 4],
  ] as const) {
    it(`${rooms} salles, ${demands} demandes, pas de ${step * 15} min`, async () => {
      const t0 = performance.now();
      const r = await solvePeriod(instance(rooms, demands), {
        periodId: "p",
        startStep: step,
        solverOptions: { timeLimitSec: 60, gap: 0.02 },
      });
      console.log(
        JSON.stringify({
          rooms, demands, pasMinutes: step * 15, cycle: r.planning.cycleWeeks, status: r.status,
          variables: r.stats.variables, lignes: r.stats.rows,
          solveMs: r.stats.millis, totalMs: Math.round(performance.now() - t0),
          nonSatisfaites: r.unsatisfied.length, sur: r.outcomes.length,
        }),
      );
      expect(["optimal", "feasible"]).toContain(r.status);
    }, 120_000);
  }
});

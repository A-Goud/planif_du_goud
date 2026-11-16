import { describe, expect, it } from "vitest";
import { spaceSchema } from "@planif/core";
import { HighsWasmSolver, buildProblem } from "@planif/solver";
import { findNativeHighs, nativeEngine } from "../src/native.js";

/**
 * Compare HiGHS natif et HiGHS WebAssembly sur de vrais problèmes.
 * S'exécute seulement si HIGHS_BIN pointe vers un exécutable HiGHS (sinon ignoré).
 */
const bin = process.env.HIGHS_BIN ? findNativeHighs(process.env.HIGHS_BIN) : null;

function instance() {
  let seed = 99;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return spaceSchema.parse({
    id: "s", name: "Réel",
    requesters: Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, name: `Asso ${i}` })),
    periods: [{ id: "p", name: "P", start: "2026-09-01", end: "2026-10-16" }],
    resources: Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, name: `Salle ${i}`, type: "salle", capacity: 40, weekly: [{ days: [0, 1, 2, 3, 4], start: "17:00", end: "22:00" }] })),
    demands: Array.from({ length: 24 }, (_, i) => ({
      id: `d${i}`, requesterId: `q${i % 8}`, label: `D${i}`, size: 10,
      durationUnits: 4 + Math.floor(rnd() * 5), sessions: 1 + Math.floor(rnd() * 3), priority: 1 + Math.floor(rnd() * 5),
    })),
    plannings: [],
  });
}

describe.skipIf(!bin)("HiGHS natif (exécutable réel)", () => {
  it("trouve le même optimum que le WebAssembly", async () => {
    const problem = buildProblem(instance(), { periodId: "p", startStep: 2 });
    const options = { timeLimitSec: 60, gap: 0 };
    const wasm = await new HighsWasmSolver().solve(problem.model, options);
    const native = await nativeEngine(bin!).solve(problem.model, options, new AbortController().signal);
    expect(native.status).toBe("optimal");
    expect(wasm.status).toBe("optimal");
    expect(native.objective).toBeCloseTo(wasm.objective, 3);
    expect(native.values).toHaveLength(problem.model.variableCount);
  });
  it("s'arrête quand on annule", async () => {
    const ctl = new AbortController();
    const problem = buildProblem(instance(), { periodId: "p", startStep: 1 });
    const run = nativeEngine(bin!).solve(problem.model, { timeLimitSec: 120, gap: 0 }, ctl.signal);
    ctl.abort();
    await expect(run).rejects.toBeDefined();
  });
});

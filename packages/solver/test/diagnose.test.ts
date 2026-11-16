import { describe, expect, it } from "vitest";
import { spaceSchema, type Space } from "@planif/core";
import { diagnosePeriod, solvePeriod } from "../src/index.js";

type Input = Parameters<typeof spaceSchema.parse>[0];

function space(partial: { resources: unknown[]; demands: unknown[] }): Space {
  return spaceSchema.parse({
    id: "s",
    name: "Test",
    requesters: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
    periods: [{ id: "p", name: "P", start: "2026-09-01", end: "2026-10-16" }],
    plannings: [],
    ...partial,
  } as Input);
}

const room = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "salle",
  capacity: 30,
  weekly: [{ days: [0], start: "17:00", end: "19:00" }],
  ...extra,
});

const demand = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  requesterId: "a",
  label: id,
  durationUnits: 4,
  sessions: 1,
  ...extra,
});

const options = { periodId: "p", startStep: 4, solverOptions: { timeLimitSec: 30 } };

/** Calcule un planning, l'enregistre dans l'espace, puis lance le diagnostic. */
async function run(s: Space) {
  const outcome = await solvePeriod(s, options);
  const withPlanning: Space = { ...s, plannings: [outcome.planning] };
  return { outcome, withPlanning, result: await diagnosePeriod(withPlanning, { ...options, baseline: outcome }) };
}

describe("diagnostic", () => {
  it("ne dit rien quand tout est satisfait", async () => {
    const { result } = await run(space({ resources: [room("r1")], demands: [demand("d1")] }));
    expect(result.diagnoses).toHaveLength(0);
  });

  it("explique une salle trop petite", async () => {
    const { result } = await run(space({ resources: [room("r1", { capacity: 10 })], demands: [demand("d1", { size: 25 })] }));
    expect(result.diagnoses[0]!.causes.join(" ")).toMatch(/trop petite/);
  });

  it("explique une salle sans plage assez longue", async () => {
    const { result } = await run(space({ resources: [room("r1")], demands: [demand("d1", { durationUnits: 12 })] }));
    expect(result.diagnoses[0]!.causes.join(" ")).toMatch(/aucune plage libre de 3 h/);
  });

  it("nomme les demandeurs qui occupent la salle et propose de raccourcir la séance", async () => {
    const { result } = await run(
      space({
        resources: [room("r1")], // 2 h d'ouverture
        demands: [
          demand("haute", { priority: 5, durationUnits: 4, requesterId: "b" }), // 1 h
          demand("basse", { priority: 1, durationUnits: 8 }), // 2 h : ne tient pas avec l'autre
        ],
      }),
    );
    const d = result.diagnoses.find((x) => x.demandId === "basse")!;
    expect(d).toBeDefined();
    expect(d.causes.join(" ")).toMatch(/Beta/);
    const shorter = d.suggestions.find((s) => s.kind === "duration");
    expect(shorter).toBeDefined();
    expect(shorter!.demandPatch).toEqual({ durationUnits: 4 });
    expect(shorter!.placedAfter).toBe(1);
    expect(shorter!.collateral).toHaveLength(0);
  });

  it("propose d'accepter une autre salle", async () => {
    const { result } = await run(
      space({
        resources: [room("r1"), room("r2")],
        demands: [
          demand("haute", { priority: 5, durationUnits: 8, requesterId: "b", place: { kind: "resource", resourceId: "r1" } }),
          demand("basse", { priority: 1, durationUnits: 8, place: { kind: "resource", resourceId: "r1" } }),
        ],
      }),
    );
    const d = result.diagnoses[0]!;
    expect(d.demandId).toBe("basse");
    const any = d.suggestions.find((s) => s.kind === "place");
    expect(any?.placedAfter).toBe(1);
  });

  it("propose de libérer des séances verrouillées", async () => {
    const s = space({
      resources: [room("r1")],
      demands: [demand("verrou", { durationUnits: 8, requesterId: "b", priority: 1 }), demand("autre", { durationUnits: 8, priority: 5 })],
    });
    const locked: Space = {
      ...s,
      plannings: [
        {
          periodId: "p",
          cycleWeeks: 1,
          blocked: [],
          assignments: [{ demandId: "verrou", resourceId: "r1", day: 0, start: "17:00", cycleWeek: 0, locked: true }],
        },
      ],
    };
    const outcome = await solvePeriod(locked, options);
    const withPlanning: Space = { ...locked, plannings: [outcome.planning] };
    const result = await diagnosePeriod(withPlanning, { ...options, baseline: outcome });
    const d = result.diagnoses.find((x) => x.demandId === "autre")!;
    const unlock = d.suggestions.find((x) => x.kind === "unlock");
    expect(unlock?.placedAfter).toBe(1);
    expect(unlock?.collateral.map((c) => c.demandId)).toEqual(["verrou"]);
  });
});

describe("estimation de la taille", () => {
  it("correspond au nombre de variables construites", async () => {
    const { estimateVariables, buildProblem } = await import("../src/index.js");
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0, 1, 2], start: "17:00", end: "22:00" }] }), room("r2", { capacity: 10 })],
      demands: [demand("d1", { size: 20 }), demand("d2", { everyKWeeks: 2, durationUnits: 6 })],
    });
    for (const step of [1, 2, 4]) {
      expect(estimateVariables(s, "p", step)).toBe(buildProblem(s, { periodId: "p", startStep: step }).sessions.length);
    }
  });
});

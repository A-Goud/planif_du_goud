import { describe, expect, it } from "vitest";
import { parseTime, spaceSchema, type Space } from "@planif/core";
import { solvePeriod, type SolveOutcome } from "../src/index.js";

type Input = Parameters<typeof spaceSchema.parse>[0];

/** Construit un espace valide à partir d'un squelette partiel. */
function space(partial: {
  resources: unknown[];
  demands: unknown[];
  plannings?: unknown[];
}): Space {
  const input = {
    id: "s",
    name: "Test",
    requesters: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    periods: [{ id: "p", name: "P", start: "2026-09-01", end: "2026-10-16" }],
    plannings: [],
    ...partial,
  } as Input;
  return spaceSchema.parse(input);
}

const room = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "salle",
  capacity: 30,
  weekly: [{ days: [0, 1, 2, 3, 4], start: "17:00", end: "22:00" }],
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

const solve = (s: Space, extra: Record<string, unknown> = {}) =>
  solvePeriod(s, { periodId: "p", startStep: 4, solverOptions: { timeLimitSec: 30 }, ...extra });

const placed = (r: SolveOutcome, id: string) => r.planning.assignments.filter((a) => a.demandId === id);

describe("contraintes dures", () => {
  it("ne chevauche pas deux demandes dans une même salle", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] })],
      demands: [demand("d1"), demand("d2")], // 1 h chacune, salle ouverte 2 h
    });
    const r = await solve(s);
    expect(r.status).toBe("optimal");
    expect(r.unsatisfied).toHaveLength(0);
    const starts = r.planning.assignments.map((a) => parseTime(a.start)).sort((a, b) => a - b);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(4);
  });

  it("respecte la capacité et les activités permises", async () => {
    const s = space({
      resources: [
        room("petite", { capacity: 20 }),
        room("grande", { capacity: 60, activities: ["basket"] }),
      ],
      demands: [demand("d1", { size: 40, activity: "basket" })],
    });
    const r = await solve(s);
    expect(placed(r, "d1")[0]?.resourceId).toBe("grande");

    const refus = space({
      resources: [room("grande", { capacity: 60, activities: ["danse"] })],
      demands: [demand("d1", { size: 40, activity: "basket" })],
    });
    const r2 = await solve(refus);
    expect(r2.unsatisfied.map((o) => o.demandId)).toEqual(["d1"]);
  });

  it("respecte l'exigence de lieu (ressource précise, type de salle)", async () => {
    const s = space({
      resources: [room("r1", { type: "salle" }), room("gym", { type: "gymnase" }), room("r3", { type: "salle" })],
      demands: [
        demand("precise", { place: { kind: "resource", resourceId: "r3" } }),
        demand("type", { place: { kind: "type", resourceType: "gymnase" } }),
      ],
    });
    const r = await solve(s);
    expect(placed(r, "precise")[0]?.resourceId).toBe("r3");
    expect(placed(r, "type")[0]?.resourceId).toBe("gym");
  });

  it("reste dans les horaires de disponibilité", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [2], start: "18:00", end: "19:00" }] })],
      demands: [demand("d1")],
    });
    const r = await solve(s);
    const a = placed(r, "d1")[0]!;
    expect(a.day).toBe(2);
    expect(a.start).toBe("18:00");
  });

  it("n'utilise pas un créneau bloqué", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] })],
      demands: [demand("d1")],
      plannings: [
        { periodId: "p", blocked: [{ resourceId: "r1", day: 0, range: { start: "17:00", end: "18:00" } }] },
      ],
    });
    const r = await solve(s);
    expect(placed(r, "d1")[0]?.start).toBe("18:00");
  });

  it("garde une séance verrouillée et place les autres autour", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] })],
      demands: [demand("d1"), demand("d2")],
      plannings: [
        {
          periodId: "p",
          assignments: [{ demandId: "d1", resourceId: "r1", day: 0, start: "17:00", locked: true }],
        },
      ],
    });
    const r = await solve(s);
    expect(placed(r, "d1")[0]).toMatchObject({ start: "17:00", locked: true });
    expect(placed(r, "d2")[0]?.start).toBe("18:00");
  });

  it("signale une séance verrouillée impossible", async () => {
    const s = space({
      resources: [room("r1")],
      demands: [demand("d1")],
      plannings: [
        { periodId: "p", assignments: [{ demandId: "d1", resourceId: "r1", day: 6, start: "10:00", locked: true }] },
      ],
    });
    const r = await solve(s);
    expect(r.warnings.some((w) => w.includes("verrouillée impossible"))).toBe(true);
  });

  it("empêche un coach d'être à deux endroits à la fois", async () => {
    const s = space({
      resources: [
        room("r1", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] }),
        room("r2", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] }),
        { id: "coach", name: "Coach", type: "coach", weekly: [{ days: [0], start: "17:00", end: "19:00" }] },
      ],
      demands: [
        demand("d1", { needsResourceIds: ["coach"] }),
        demand("d2", { needsResourceIds: ["coach"] }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied).toHaveLength(0);
    const [x, y] = r.planning.assignments.map((a) => parseTime(a.start)).sort((a, b) => a - b);
    expect(y! - x!).toBeGreaterThanOrEqual(4);
  });
});

describe("coachs", () => {
  const coach = (weekly: unknown[]) => ({ id: "coach", name: "Coach", type: "coach", weekly });

  it("ne place la séance que pendant la disponibilité du coach", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0, 1], start: "17:00", end: "22:00" }] }), coach([{ days: [1], start: "20:00", end: "22:00" }])],
      demands: [demand("d1", { needsResourceIds: ["coach"], durationUnits: 4 })],
    });
    const r = await solve(s);
    const [a] = placed(r, "d1");
    expect(a).toBeDefined();
    expect(a!.day).toBe(1);
    expect(parseTime(a!.start)).toBeGreaterThanOrEqual(parseTime("20:00"));
  });

  it("refuse une séance si le coach n'est jamais disponible assez longtemps", async () => {
    const s = space({
      resources: [room("r1"), coach([{ days: [0], start: "18:00", end: "18:30" }])],
      demands: [demand("d1", { needsResourceIds: ["coach"], durationUnits: 4 })],
    });
    const r = await solve(s);
    expect(r.unsatisfied.map((o) => o.demandId)).toEqual(["d1"]);
  });

  it("un coach partagé entre une séance hebdomadaire et une séance toutes les 2 semaines", async () => {
    const s = space({
      resources: [
        room("r1", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] }),
        room("r2", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] }),
        coach([{ days: [0], start: "17:00", end: "19:00" }]),
      ],
      demands: [
        demand("hebdo", { needsResourceIds: ["coach"], durationUnits: 4 }),
        demand("quinzaine", { needsResourceIds: ["coach"], durationUnits: 4, everyKWeeks: 2, requesterId: "b" }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied).toHaveLength(0);
    const h = placed(r, "hebdo")[0]!;
    const q = placed(r, "quinzaine")[0]!;
    // même jour : les deux séances ne doivent pas se chevaucher (la séance hebdomadaire est présente aux deux semaines)
    expect(Math.abs(parseTime(h.start) - parseTime(q.start))).toBeGreaterThanOrEqual(4);
  });

  it("respecte les créneaux bloqués du coach", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] }), coach([{ days: [0], start: "17:00", end: "19:00" }])],
      demands: [demand("d1", { needsResourceIds: ["coach"], durationUnits: 4 })],
      plannings: [{ periodId: "p", cycleWeeks: 1, assignments: [], blocked: [{ resourceId: "coach", day: 0, range: { start: "17:00", end: "18:00" } }] }],
    });
    const r = await solve(s);
    expect(parseTime(placed(r, "d1")[0]!.start)).toBe(parseTime("18:00"));
  });
});

describe("demandes souples", () => {
  it("sacrifie la demande de plus faible priorité quand tout ne tient pas", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] })],
      demands: [
        demand("basse", { priority: 1 }),
        demand("haute", { priority: 5 }),
        demand("moyenne", { priority: 3 }),
      ],
    });
    const r = await solve(s);
    expect(r.status).toBe("optimal");
    expect(r.unsatisfied.map((o) => o.demandId)).toEqual(["basse"]);
  });

  it("place au moins le minimum quand tout ne tient pas, et le dit", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0], start: "17:00", end: "18:00" }] })],
      demands: [demand("d1", { sessions: 3, minSessions: 1 })],
    });
    const r = await solve(s);
    const o = r.outcomes[0]!;
    expect(o.placed).toBe(1);
    expect(o.meetsMinimum).toBe(true);
    expect(o.satisfied).toBe(false);
  });

  it("utilise une salle alternative en dernier recours", async () => {
    const s = space({
      resources: [
        room("voulue", { weekly: [{ days: [0], start: "17:00", end: "18:00" }] }),
        room("secours"),
      ],
      demands: [
        demand("d1", { priority: 5, place: { kind: "resource", resourceId: "voulue" } }),
        demand("d2", {
          place: { kind: "resource", resourceId: "voulue" },
          alternatives: { resourceIds: ["secours"] },
        }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied).toHaveLength(0);
    expect(placed(r, "d1")[0]?.resourceId).toBe("voulue");
    expect(placed(r, "d2")[0]?.resourceId).toBe("secours");
  });

  it("préfère les jours souhaités", async () => {
    const s = space({
      resources: [room("r1")],
      demands: [demand("d1", { preferredDays: [3] })],
    });
    const r = await solve(s);
    expect(placed(r, "d1")[0]?.day).toBe(3);
  });

  it("reconduit le créneau de référence (stabilité)", async () => {
    const s = space({ resources: [room("r1")], demands: [demand("d1")] });
    const reference = {
      periodId: "avant",
      cycleWeeks: 1,
      blocked: [],
      assignments: [{ demandId: "d1", resourceId: "r1", day: 2, start: "20:00", cycleWeek: 0, locked: false }],
    };
    const r = await solve(s, { reference });
    expect(placed(r, "d1")[0]).toMatchObject({ day: 2, start: "20:00" });
  });

  it("ignore la référence quand la stabilité est désactivée", async () => {
    const s = space({
      resources: [room("r1")],
      demands: [demand("d1", { stability: "ignored", preferredDays: [4] })],
    });
    const reference = {
      periodId: "avant",
      cycleWeeks: 1,
      blocked: [],
      assignments: [{ demandId: "d1", resourceId: "r1", day: 2, start: "20:00", cycleWeek: 0, locked: false }],
    };
    const r = await solve(s, { reference });
    expect(placed(r, "d1")[0]?.day).toBe(4);
  });
});

describe("partage de salle", () => {
  const gym = (extra: Record<string, unknown> = {}) =>
    room("gym", {
      capacity: 40,
      weekly: [{ days: [0], start: "17:00", end: "18:00" }],
      compatibleGroups: [["badminton", "escalade", "ping-pong"]],
      ...extra,
    });

  it("fait cohabiter des activités d'un même groupe", async () => {
    const s = space({
      resources: [gym()],
      demands: [
        demand("bad", { activity: "badminton", size: 10, shareable: true }),
        demand("esc", { activity: "escalade", size: 10, shareable: true }),
        demand("pp", { activity: "ping-pong", size: 10, shareable: true }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied).toHaveLength(0);
  });

  it("refuse deux activités qui ne sont pas dans un même groupe", async () => {
    const s = space({
      resources: [gym({ compatibleGroups: [["badminton", "escalade"], ["escalade", "ping-pong"]] })],
      demands: [
        demand("bad", { activity: "badminton", size: 10, shareable: true }),
        demand("pp", { activity: "ping-pong", size: 10, shareable: true }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied).toHaveLength(1);
  });

  it("refuse deux séances de la même activité simultanées", async () => {
    const s = space({
      resources: [gym()],
      demands: [
        demand("bad1", { activity: "badminton", size: 10, shareable: true }),
        demand("bad2", { activity: "badminton", size: 10, shareable: true }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied).toHaveLength(1);
  });

  it("applique la capacité à l'effectif cumulé", async () => {
    const s = space({
      resources: [gym({ capacity: 30 })],
      demands: [
        demand("bad", { activity: "badminton", size: 20, shareable: true }),
        demand("esc", { activity: "escalade", size: 20, shareable: true }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied).toHaveLength(1);
  });

  it("n'admet pas une demande non partageable avec d'autres", async () => {
    const s = space({
      resources: [gym()],
      demands: [
        demand("bad", { activity: "badminton", size: 10, shareable: true }),
        demand("seul", { activity: "escalade", size: 10, shareable: false }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied).toHaveLength(1);
  });
});

describe("cycles de deux semaines", () => {
  const oneSlot = () =>
    room("r1", { weekly: [{ days: [0], start: "17:00", end: "18:00" }] });

  it("fait alterner deux demandes bimensuelles sur le même créneau", async () => {
    const s = space({
      resources: [oneSlot()],
      demands: [
        demand("d1", { requesterId: "a", everyKWeeks: 2 }),
        demand("d2", { requesterId: "b", everyKWeeks: 2 }),
      ],
    });
    const r = await solve(s);
    expect(r.planning.cycleWeeks).toBe(2);
    expect(r.unsatisfied).toHaveLength(0);
    const offsets = r.planning.assignments.map((a) => a.cycleWeek).sort();
    expect(offsets).toEqual([0, 1]);
  });

  it("empêche une demande hebdomadaire de partager un créneau avec une bimensuelle", async () => {
    const s = space({
      resources: [oneSlot()],
      demands: [
        demand("hebdo", { priority: 5 }),
        demand("bimensuelle", { everyKWeeks: 2 }),
      ],
    });
    const r = await solve(s);
    expect(r.unsatisfied.map((o) => o.demandId)).toEqual(["bimensuelle"]);
  });
});

describe("périodes", () => {
  it("ne retient que les demandes de la période", async () => {
    const s = space({
      resources: [room("r1")],
      demands: [demand("toujours"), demand("ailleurs", { periodIds: [] })],
    });
    const r = await solve(s);
    expect(r.outcomes.map((o) => o.demandId).sort()).toEqual(["ailleurs", "toujours"]);
  });

  it("rejette une période inconnue", async () => {
    const s = space({ resources: [room("r1")], demands: [demand("d1")] });
    await expect(solvePeriod(s, { periodId: "nulle" })).rejects.toThrow(/inconnue/);
  });
});

describe("résolution partielle et stabilité globale", () => {
  const frozenPlanning = {
    periodId: "p",
    assignments: [{ demandId: "d1", resourceId: "r1", day: 2, start: "20:00", locked: false }],
  };

  it("garde l'existant quand on le gèle, et déplace sinon", async () => {
    const s = space({
      resources: [room("r1")],
      demands: [demand("d1", { preferredDays: [4] })],
      plannings: [frozenPlanning],
    });
    const libre = await solve(s);
    expect(placed(libre, "d1")[0]?.day).toBe(4);
    const gele = await solve(s, { freezeExisting: true });
    expect(placed(gele, "d1")[0]).toMatchObject({ day: 2, start: "20:00", locked: false });
  });

  it("n'ajoute que les nouvelles demandes autour de l'existant gelé", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0], start: "17:00", end: "19:00" }] })],
      demands: [demand("d1"), demand("nouvelle")],
      plannings: [{ periodId: "p", assignments: [{ demandId: "d1", resourceId: "r1", day: 0, start: "18:00" }] }],
    });
    const r = await solve(s, { freezeExisting: true });
    expect(placed(r, "d1")[0]?.start).toBe("18:00");
    expect(placed(r, "nouvelle")[0]?.start).toBe("17:00");
  });

  it("applique un mode de stabilité global par-dessus celui des demandes", async () => {
    const s = space({
      resources: [room("r1")],
      demands: [demand("d1", { stability: "ignored", preferredDays: [4] })],
    });
    const reference = {
      periodId: "avant", cycleWeeks: 1, blocked: [],
      assignments: [{ demandId: "d1", resourceId: "r1", day: 2, start: "20:00", cycleWeek: 0, locked: false }],
    };
    const sansRien = await solve(s, { reference });
    expect(placed(sansRien, "d1")[0]?.day).toBe(4);
    const impose = await solve(s, { reference, stabilityOverride: "imposed" });
    expect(placed(impose, "d1")[0]).toMatchObject({ day: 2, start: "20:00" });
  });

  it("la stabilité imposée l'emporte sur les préférences mais pas sur les contraintes dures", async () => {
    const s = space({
      resources: [room("r1", { weekly: [{ days: [0], start: "17:00", end: "18:00" }] })],
      demands: [demand("d1", { stability: "imposed" })],
    });
    const reference = {
      periodId: "avant", cycleWeeks: 1, blocked: [],
      assignments: [{ demandId: "d1", resourceId: "r1", day: 3, start: "20:00", cycleWeek: 0, locked: false }], // salle fermée ce jour-là
    };
    const r = await solve(s, { reference });
    expect(placed(r, "d1")[0]).toMatchObject({ day: 0, start: "17:00" });
  });
});

describe("délégation : un niveau alimente le suivant", () => {
  it("l'association répartit ses sections dans les créneaux reçus, rien en dehors", async () => {
    const { buildDelegation } = await import("@planif/core");
    // Niveau 1 : la mairie donne à "a" deux créneaux d'1 h dans r1.
    const town = space({
      resources: [room("r1", { weekly: [{ days: [0, 1, 2], start: "17:00", end: "22:00" }] })],
      demands: [demand("d1", { sessions: 2, durationUnits: 4 })],
    });
    const level1 = await solve(town);
    expect(level1.unsatisfied).toHaveLength(0);
    const withPlan: Space = { ...town, plannings: [level1.planning] };
    const { space: club } = buildDelegation(withPlan, { requesterId: "a", periodIds: ["p"] });

    // Niveau 2 : l'association a trois sections qui veulent chacune 1 h ; seuls 2 créneaux existent.
    const level2Input = spaceSchema.parse({
      ...club,
      requesters: [{ id: "s1", name: "S1" }, { id: "s2", name: "S2" }, { id: "s3", name: "S3" }],
      demands: ["s1", "s2", "s3"].map((id) => demand(id, { requesterId: id, priority: id === "s3" ? 1 : 3 })),
    });
    const level2 = await solve(level2Input);
    expect(level2.unsatisfied.map((o) => o.demandId)).toEqual(["s3"]); // la moins prioritaire est sacrifiée
    // chaque séance placée est dans un créneau obtenu au niveau 1
    const granted = level1.planning.assignments.map((a) => `${a.day}|${a.start}`);
    for (const a of level2.planning.assignments) expect(granted).toContain(`${a.day}|${a.start}`);
  });
});

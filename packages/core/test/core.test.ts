import { describe, expect, it } from "vitest";
import {
  CURRENT_VERSION,
  exportSpace,
  formatTime,
  importSpace,
  isValidDate,
  parseEndTime,
  parseTime,
  spaceSchema,
  weekday,
  type Space,
} from "../src/index.js";

/** Mairie fictive : une salle de basket, une salle polyvalente, une demande de chaque type. */
function sample(): Space {
  return spaceSchema.parse({
    id: "mairie",
    name: "Mairie de Démo",
    resources: [
      {
        id: "gym",
        name: "Gymnase",
        type: "salle",
        capacity: 60,
        activities: ["basket", "badminton", "escalade", "ping-pong"],
        compatibleGroups: [["badminton", "escalade", "ping-pong"]],
        weekly: [{ days: [0, 1, 2, 3, 4], start: "17:00", end: "22:00" }],
        exceptions: [{ date: "2026-12-25", closed: true, reason: "Noël" }],
      },
      {
        id: "salle1",
        name: "Salle polyvalente",
        type: "salle",
        capacity: 30,
        weekly: [{ days: [0, 1, 2, 3, 4, 5], start: "08:00", end: "22:00" }],
      },
    ],
    requesters: [
      { id: "basket", name: "Basket club" },
      { id: "basket-u13", name: "Basket U13", parentId: "basket" },
    ],
    demands: [
      {
        id: "d1",
        requesterId: "basket",
        label: "Entraînement seniors",
        activity: "basket",
        size: 20,
        durationUnits: 6,
        sessions: 2,
        minSessions: 1,
        place: { kind: "resource", resourceId: "gym" },
        priority: 5,
      },
      {
        id: "d2",
        requesterId: "basket",
        label: "Réunion bureau",
        durationUnits: 4,
        sessions: 1,
        everyKWeeks: 2,
        shareable: true,
      },
    ],
    periods: [
      { id: "p1", name: "Sept-Oct", start: "2026-09-01", end: "2026-10-16" },
      { id: "p2", name: "Nov-Déc", start: "2026-11-02", end: "2026-12-18" },
    ],
    closures: [{ start: "2026-10-17", end: "2026-11-01", label: "Vacances de la Toussaint" }],
    plannings: [
      {
        periodId: "p1",
        cycleWeeks: 2,
        assignments: [{ demandId: "d1", resourceId: "gym", day: 1, start: "18:00", locked: true }],
        blocked: [{ resourceId: "gym", day: 4, range: { start: "20:00", end: "22:00" }, reason: "Entretien" }],
      },
    ],
  });
}

describe("temps", () => {
  it("convertit les heures en unités de 15 min et inversement", () => {
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("18:30")).toBe(74);
    expect(formatTime(74)).toBe("18:30");
    expect(parseEndTime("24:00")).toBe(96);
    expect(formatTime(96)).toBe("24:00");
  });
  it("refuse les heures qui ne sont pas des multiples de 15 min", () => {
    expect(() => parseTime("18:10")).toThrow(/15 minutes/);
    expect(() => parseTime("25:00")).toThrow();
    expect(() => parseTime("abc")).toThrow();
  });
  it("valide les dates et calcule le jour de la semaine", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(weekday("2026-11-16")).toBe(0); // lundi
    expect(weekday("2026-11-22")).toBe(6); // dimanche
  });
});

describe("modèle", () => {
  it("applique les valeurs par défaut", () => {
    const s = sample();
    const d2 = s.demands.find((d) => d.id === "d2")!;
    expect(d2.priority).toBe(3);
    expect(d2.stability).toBe("preferred");
    expect(d2.place).toEqual({ kind: "any" });
  });
  it("refuse une demande liée à un demandeur inconnu", () => {
    const s = sample();
    s.demands[0]!.requesterId = "fantome";
    const r = spaceSchema.safeParse(s);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toContain("demandeur inconnu");
  });
  it("refuse un minimum supérieur au nombre de séances", () => {
    const s = sample();
    s.demands[0]!.minSessions = 5;
    expect(spaceSchema.safeParse(s).success).toBe(false);
  });
  it("refuse des périodes qui se chevauchent", () => {
    const s = sample();
    s.periods[1]!.start = "2026-10-10";
    expect(spaceSchema.safeParse(s).success).toBe(false);
  });
  it("refuse les identifiants en double", () => {
    const s = sample();
    s.resources[1]!.id = "gym";
    expect(spaceSchema.safeParse(s).success).toBe(false);
  });
  it("refuse une séance hors du motif du cycle", () => {
    const s = sample();
    s.plannings[0]!.assignments[0]!.cycleWeek = 2; // cycle de 2 semaines : 0 ou 1
    expect(spaceSchema.safeParse(s).success).toBe(false);
  });
  it("refuse un groupe compatible d'une seule activité", () => {
    const s = sample();
    s.resources[0]!.compatibleGroups = [["basket"]];
    expect(spaceSchema.safeParse(s).success).toBe(false);
  });
});

describe("fichiers", () => {
  it("fait un aller-retour sans perte", () => {
    const s = sample();
    const result = importSpace(exportSpace(s));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.space).toEqual(s);
  });
  it("signale un fichier abîmé", () => {
    const text = exportSpace(sample());
    const result = importSpace(text.slice(0, text.length / 2));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors[0]).toMatch(/pas du JSON valide/);
  });
  it("refuse un fichier d'une autre application", () => {
    const result = importSpace(JSON.stringify({ hello: "monde" }));
    expect(result.ok).toBe(false);
  });
  it("refuse un fichier d'une version plus récente", () => {
    const file = JSON.parse(exportSpace(sample()));
    file.version = CURRENT_VERSION + 1;
    const result = importSpace(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/plus récente/);
  });
  it("décrit les incohérences du contenu avec leur emplacement", () => {
    const file = JSON.parse(exportSpace(sample()));
    file.space.demands[0].requesterId = "fantome";
    file.space.resources[0].weekly[0].start = "17:10";
    const result = importSpace(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("demands.0.requesterId"))).toBe(true);
      expect(result.errors.some((e) => e.includes("resources.0.weekly.0.start"))).toBe(true);
    }
  });
});

describe("nettoyage des références orphelines", () => {
  it("retire des plannings ce qui référence une salle ou une demande supprimée", async () => {
    const { pruneOrphans } = await import("../src/index.js");
    const s = sample();
    const withoutGym: Space = { ...s, resources: s.resources.filter((r) => r.id !== "gym") };
    expect(spaceSchema.safeParse(withoutGym).success).toBe(false); // références cassées
    const cleaned = pruneOrphans(withoutGym);
    expect(cleaned.plannings[0]!.assignments).toHaveLength(0);
    expect(cleaned.plannings[0]!.blocked).toHaveLength(0);
    // La demande d1 vise toujours la salle supprimée : l'erreur reste signalée.
    const result = spaceSchema.safeParse(cleaned);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain("plannings");
  });
  it("retire les plannings d'une période supprimée", async () => {
    const { pruneOrphans } = await import("../src/index.js");
    const s = sample();
    const cleaned = pruneOrphans({ ...s, periods: s.periods.filter((p) => p.id !== "p1") });
    expect(cleaned.plannings).toHaveLength(0);
    expect(spaceSchema.safeParse(cleaned).success).toBe(true);
  });
});

describe("calendrier daté", () => {
  it("projette le motif sur les dates, avec rythme de 2 semaines", async () => {
    const { projectPeriod } = await import("../src/index.js");
    const s = sample();
    // d2 : une séance toutes les 2 semaines, placée en semaine 0 du cycle, le mercredi (jour 2)
    s.plannings[0]!.assignments.push({ demandId: "d2", resourceId: "salle1", day: 2, start: "10:00", cycleWeek: 0, locked: false });
    const dated = projectPeriod(s, "p1").filter((x) => x.demandId === "d2");
    // p1 : 2026-09-01 (mardi) → 2026-10-16 ; mercredis des semaines 0, 2, 4, 6 : 9/2, 9/16, 9/30, 10/14
    expect(dated.map((x) => x.date)).toEqual(["2026-09-02", "2026-09-16", "2026-09-30", "2026-10-14"]);
    expect(dated[0]).toMatchObject({ start: "10:00", end: "11:00" });
  });
  it("marque annulées les séances pendant une fermeture ou une exception de salle", async () => {
    const { projectPeriod } = await import("../src/index.js");
    const s = sample();
    s.closures = [{ start: "2026-09-08", end: "2026-09-14", label: "Vacances" }];
    s.resources[0]!.exceptions = [{ date: "2026-09-22", closed: true, reason: "Élections" }];
    const dated = projectPeriod(s, "p1").filter((x) => x.demandId === "d1"); // mardis au gymnase
    const cancelled = dated.filter((x) => x.cancelled);
    expect(cancelled.map((x) => x.date)).toEqual(["2026-09-08", "2026-09-22"]);
    expect(cancelled[0]!.cancelled).toBe("Vacances");
    expect(cancelled[1]!.cancelled).toMatch(/Élections/);
  });
  it("annule la séance quand un coach nécessaire est indisponible ce jour-là", async () => {
    const { projectPeriod } = await import("../src/index.js");
    const s = sample();
    s.resources.push({ id: "coach", name: "Léa", type: "coach", activities: [], compatibleGroups: [], weekly: [], exceptions: [{ date: "2026-09-08", closed: true, reason: "Malade" }] });
    s.demands[0]!.needsResourceIds = ["coach"];
    const dated = projectPeriod(s, "p1").filter((x) => x.demandId === "d1");
    expect(dated.find((x) => x.date === "2026-09-08")?.cancelled).toBe("Léa indisponible : Malade");
  });
  it("propose des périodes entre les fermetures", async () => {
    const { suggestPeriods } = await import("../src/index.js");
    const out = suggestPeriods("2026-09-01", "2026-12-18", [
      { start: "2026-10-17", end: "2026-11-01", label: "Toussaint" },
    ]);
    expect(out[0]).toMatchObject({ start: "2026-09-01" });
    expect(out.some((p) => p.start === "2026-11-02")).toBe(true);
    expect(out[out.length - 1]!.end).toBe("2026-12-18");
    // aucune proposition ne recouvre une fermeture
    expect(out.every((p) => p.end < "2026-10-17" || p.start > "2026-11-01")).toBe(true);
  });
});

describe("délégation", () => {
  it("transforme les créneaux obtenus en horaires d'ouverture d'un nouvel espace", async () => {
    const { buildDelegation, importSpace, exportSpace } = await import("../src/index.js");
    const s = sample();
    s.plannings = [
      {
        periodId: "p1",
        cycleWeeks: 2,
        blocked: [],
        assignments: [
          { demandId: "d1", resourceId: "gym", day: 1, start: "18:00", cycleWeek: 0, locked: false },
          { demandId: "d1", resourceId: "gym", day: 3, start: "19:30", cycleWeek: 0, locked: false },
          { demandId: "d2", resourceId: "salle1", day: 2, start: "10:00", cycleWeek: 0, locked: false },
        ],
      },
    ];
    const r = buildDelegation(s, { requesterId: "basket", periodIds: ["p1"] });
    expect(r.sessionCount).toBe(2);
    expect(r.warnings.join(" ")).toMatch(/rythme/); // d2 : toutes les 2 semaines
    expect(r.space.resources.map((x) => x.id)).toEqual(["gym"]);
    // d1 : 1 h 30 mardi 18:00 et jeudi 19:30, deux horaires distincts
    expect(r.space.resources[0]!.weekly).toEqual([
      { days: [1], start: "18:00", end: "19:30", periodIds: [] },
      { days: [3], start: "19:30", end: "21:00", periodIds: [] },
    ]);
    expect(r.space.periods.map((p) => p.id)).toEqual(["p1"]);
    // c'est un fichier ordinaire
    const back = importSpace(exportSpace(r.space));
    expect(back.ok).toBe(true);
  });
  it("inclut les sections et fusionne les séances contiguës ; limite par période", async () => {
    const { buildDelegation } = await import("../src/index.js");
    const s = sample();
    s.demands.push({ ...s.demands[0]!, id: "d3", requesterId: "basket-u13", label: "U13", sessions: 1, minSessions: undefined });
    s.plannings = [
      {
        periodId: "p1", cycleWeeks: 1, blocked: [],
        assignments: [
          { demandId: "d1", resourceId: "gym", day: 1, start: "18:00", cycleWeek: 0, locked: false },
          { demandId: "d3", resourceId: "gym", day: 1, start: "19:30", cycleWeek: 0, locked: false },
        ],
      },
      {
        periodId: "p2", cycleWeeks: 1, blocked: [],
        assignments: [{ demandId: "d1", resourceId: "gym", day: 2, start: "18:00", cycleWeek: 0, locked: false }],
      },
    ];
    const r = buildDelegation(s, { requesterId: "basket", periodIds: ["p1", "p2"] });
    const rules = r.space.resources[0]!.weekly;
    expect(rules).toContainEqual({ days: [1], start: "18:00", end: "21:00", periodIds: ["p1"] }); // 2 séances contiguës fusionnées
    expect(rules).toContainEqual({ days: [2], start: "18:00", end: "19:30", periodIds: ["p2"] });
  });
  it("refuse une règle qui vise une période inconnue", () => {
    const s = sample();
    s.resources[1]!.weekly[0]!.periodIds = ["fantome"];
    expect(spaceSchema.safeParse(s).success).toBe(false);
  });
});

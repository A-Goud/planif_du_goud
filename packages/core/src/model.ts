import { z } from "zod";
import { isValidDate, parseEndTime, parseTime } from "./time.js";

// ---------------------------------------------------------------- briques

const id = z.string().min(1);
const name = z.string().trim().min(1);
const date = z.string().refine(isValidDate, "date invalide (attendu AAAA-MM-JJ)");

const startTime = z.string().refine(
  (s) => {
    try { parseTime(s); return true; } catch { return false; }
  },
  "heure invalide (HH:MM, multiple de 15 min)",
);
const endTime = z.string().refine(
  (s) => {
    try { parseEndTime(s); return true; } catch { return false; }
  },
  "heure invalide (HH:MM, multiple de 15 min, ou 24:00)",
);

/** Jour de la semaine : 0 = lundi ... 6 = dimanche. */
const weekday = z.number().int().min(0).max(6);

/** Vrai si la fin suit le début. Ignore les heures invalides (déjà signalées par leurs propres règles). */
function endAfterStart(r: { start: string; end: string }): boolean {
  try {
    return parseEndTime(r.end) > parseTime(r.start);
  } catch {
    return true;
  }
}

const timeRange = z
  .object({ start: startTime, end: endTime })
  .refine(endAfterStart, "la fin doit suivre le début");

// ---------------------------------------------------------------- ressources

/** Règle hebdomadaire : ouvert ces jours-là, entre ces heures (éventuellement pour certaines périodes seulement). */
export const weeklyRuleSchema = z
  .object({
    days: z.array(weekday).min(1),
    start: startTime,
    end: endTime,
    /** Périodes concernées. Vide = toutes les périodes. */
    periodIds: z.array(id).default([]),
  })
  .refine(endAfterStart, "la fin doit suivre le début");

/** Exception datée : fermé toute la journée, ou ouvert sur une plage particulière. */
export const exceptionSchema = z.object({
  date,
  closed: z.boolean().default(true),
  range: timeRange.optional(),
  reason: z.string().optional(),
});

export const resourceSchema = z.object({
  id,
  name,
  /** Type libre : "salle", "coach", ... */
  type: name,
  /** Capacité maximale (effectif cumulé). Absente pour un coach. */
  capacity: z.number().int().positive().optional(),
  /** Types d'activité acceptés. Vide = tout est accepté. */
  activities: z.array(name).default([]),
  /**
   * Groupes compatibles : activités qui peuvent avoir lieu en même temps.
   * Tout sous-ensemble d'un groupe est permis ; une activité seule l'est toujours.
   */
  compatibleGroups: z.array(z.array(name).min(2)).default([]),
  weekly: z.array(weeklyRuleSchema).default([]),
  exceptions: z.array(exceptionSchema).default([]),
});

// ---------------------------------------------------------------- demandeurs et demandes

export const requesterSchema = z.object({
  id,
  name,
  /** Pour une section : l'association qui la contient. */
  parentId: id.optional(),
});

/** Où la demande doit être placée. */
export const placeRequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }),
  z.object({ kind: z.literal("type"), resourceType: name }),
  z.object({ kind: z.literal("resource"), resourceId: id }),
]);

export const stabilityModeSchema = z.enum(["ignored", "preferred", "imposed"]);

export const demandSchema = z.object({
  id,
  requesterId: id,
  label: name,
  activity: name.optional(),
  /** Effectif concerné. */
  size: z.number().int().nonnegative().default(0),
  /** Durée d'une séance, en unités de 15 minutes. */
  durationUnits: z.number().int().positive(),
  /** Séances souhaitées par cycle. */
  sessions: z.number().int().positive(),
  /** Minimum acceptable (défaut : toutes les séances). */
  minSessions: z.number().int().positive().optional(),
  /** Une séance toutes les k semaines (1 ou 2 en pratique). */
  everyKWeeks: z.number().int().min(1).max(4).default(1),
  place: placeRequirementSchema.default({ kind: "any" }),
  /** Autorise le partage de la salle avec d'autres demandes compatibles. */
  shareable: z.boolean().default(false),
  /** Priorité saisie par l'agent : 1 (basse) à 5 (haute). */
  priority: z.number().int().min(1).max(5).default(3),
  /** Autres lieux / durées acceptés si le souhait principal échoue. */
  alternatives: z
    .object({
      resourceIds: z.array(id).default([]),
      resourceTypes: z.array(name).default([]),
      minDurationUnits: z.number().int().positive().optional(),
    })
    .optional(),
  /** Préférences horaires (souples). */
  preferredDays: z.array(weekday).default([]),
  preferredRange: timeRange.optional(),
  /** Stabilité d'une période à l'autre. */
  stability: stabilityModeSchema.default("preferred"),
  /** Ressources supplémentaires nécessaires (coachs). */
  needsResourceIds: z.array(id).default([]),
  /** Périodes concernées. Vide = toutes les périodes. */
  periodIds: z.array(id).default([]),
});

// ---------------------------------------------------------------- calendrier

export const periodSchema = z
  .object({ id, name, start: date, end: date })
  .refine((p) => p.end >= p.start, "la fin doit suivre le début");

export const closureSchema = z
  .object({ start: date, end: date, label: name })
  .refine((c) => c.end >= c.start, "la fin doit suivre le début");

// ---------------------------------------------------------------- plannings

/** Une séance placée dans le motif d'une période. */
export const assignmentSchema = z.object({
  demandId: id,
  resourceId: id,
  day: weekday,
  start: startTime,
  /**
   * Décalage de la séance dans son rythme : la séance a lieu aux semaines
   * `cycleWeek`, `cycleWeek + k`, ... du cycle, où k = `everyKWeeks` de la demande.
   * Toujours 0 pour une demande hebdomadaire.
   */
  cycleWeek: z.number().int().min(0).max(3).default(0),
  locked: z.boolean().default(false),
});

/** Créneau bloqué par l'agent : rien ne peut y être placé. */
export const blockedSlotSchema = z.object({
  resourceId: id,
  day: weekday,
  range: timeRange,
  cycleWeek: z.number().int().min(0).max(3).optional(),
  reason: z.string().optional(),
});

export const planningSchema = z.object({
  periodId: id,
  assignments: z.array(assignmentSchema).default([]),
  blocked: z.array(blockedSlotSchema).default([]),
  /** Nombre de semaines du motif (1 ou 2 en pratique). */
  cycleWeeks: z.number().int().min(1).max(4).default(1),
});

// ---------------------------------------------------------------- espace

export const spaceSchema = z
  .object({
    id,
    name,
    resources: z.array(resourceSchema).default([]),
    requesters: z.array(requesterSchema).default([]),
    demands: z.array(demandSchema).default([]),
    periods: z.array(periodSchema).default([]),
    closures: z.array(closureSchema).default([]),
    plannings: z.array(planningSchema).default([]),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    const unique = (label: string, key: keyof typeof s, ids: string[]) => {
      const seen = new Set<string>();
      ids.forEach((v, i) => {
        if (seen.has(v)) issue([key, i, "id"], `${label} en double : « ${v} »`);
        seen.add(v);
      });
    };
    unique("ressource", "resources", s.resources.map((r) => r.id));
    unique("demandeur", "requesters", s.requesters.map((r) => r.id));
    unique("demande", "demands", s.demands.map((d) => d.id));
    unique("période", "periods", s.periods.map((p) => p.id));

    const resourceIds = new Set(s.resources.map((r) => r.id));
    const requesterIds = new Set(s.requesters.map((r) => r.id));
    const demandIds = new Set(s.demands.map((d) => d.id));
    const periodIds = new Set(s.periods.map((p) => p.id));

    s.resources.forEach((r, i) => {
      r.weekly.forEach((w, j) => {
        w.periodIds.forEach((pid) => {
          if (!periodIds.has(pid)) issue(["resources", i, "weekly", j, "periodIds"], `période inconnue : « ${pid} »`);
        });
      });
    });

    s.requesters.forEach((r, i) => {
      if (r.parentId && !requesterIds.has(r.parentId)) {
        issue(["requesters", i, "parentId"], `demandeur parent inconnu : « ${r.parentId} »`);
      }
      if (r.parentId === r.id) issue(["requesters", i, "parentId"], "un demandeur ne peut pas être son propre parent");
    });

    s.demands.forEach((d, i) => {
      if (!requesterIds.has(d.requesterId)) {
        issue(["demands", i, "requesterId"], `demandeur inconnu : « ${d.requesterId} »`);
      }
      if (d.place.kind === "resource" && !resourceIds.has(d.place.resourceId)) {
        issue(["demands", i, "place"], `ressource inconnue : « ${d.place.resourceId} »`);
      }
      if (d.minSessions !== undefined && d.minSessions > d.sessions) {
        issue(["demands", i, "minSessions"], "le minimum dépasse le nombre de séances souhaitées");
      }
      d.needsResourceIds.forEach((rid) => {
        if (!resourceIds.has(rid)) issue(["demands", i, "needsResourceIds"], `ressource inconnue : « ${rid} »`);
      });
      d.periodIds.forEach((pid) => {
        if (!periodIds.has(pid)) issue(["demands", i, "periodIds"], `période inconnue : « ${pid} »`);
      });
      d.alternatives?.resourceIds.forEach((rid) => {
        if (!resourceIds.has(rid)) issue(["demands", i, "alternatives"], `ressource inconnue : « ${rid} »`);
      });
    });

    const sortedPeriods = [...s.periods].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sortedPeriods.length; i++) {
      const prev = sortedPeriods[i - 1]!;
      const cur = sortedPeriods[i]!;
      if (cur.start <= prev.end) {
        issue(["periods"], `les périodes « ${prev.name} » et « ${cur.name} » se chevauchent`);
      }
    }

    s.plannings.forEach((p, i) => {
      if (!periodIds.has(p.periodId)) issue(["plannings", i, "periodId"], `période inconnue : « ${p.periodId} »`);
      p.assignments.forEach((a, j) => {
        if (!demandIds.has(a.demandId)) issue(["plannings", i, "assignments", j], `demande inconnue : « ${a.demandId} »`);
        if (!resourceIds.has(a.resourceId)) issue(["plannings", i, "assignments", j], `ressource inconnue : « ${a.resourceId} »`);
        if (a.cycleWeek >= p.cycleWeeks) issue(["plannings", i, "assignments", j], "semaine du cycle hors du motif");
      });
      p.blocked.forEach((b, j) => {
        if (!resourceIds.has(b.resourceId)) issue(["plannings", i, "blocked", j], `ressource inconnue : « ${b.resourceId} »`);
      });
    });
  });

export type WeeklyRule = z.infer<typeof weeklyRuleSchema>;
export type Resource = z.infer<typeof resourceSchema>;
export type Requester = z.infer<typeof requesterSchema>;
export type Demand = z.infer<typeof demandSchema>;
export type Period = z.infer<typeof periodSchema>;
export type Closure = z.infer<typeof closureSchema>;
export type Planning = z.infer<typeof planningSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type BlockedSlot = z.infer<typeof blockedSlotSchema>;
export type Space = z.infer<typeof spaceSchema>;

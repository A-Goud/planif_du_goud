import { formatTime, parseTime } from "./time.js";
import { spaceSchema, type Resource, type Space, type WeeklyRule } from "./model.js";

export interface DelegationOptions {
  /** Demandeur concerné : ses sections sont incluses. */
  requesterId: string;
  /** Périodes à transmettre. */
  periodIds: string[];
}

export interface DelegationResult {
  /** Nouvel espace : les créneaux obtenus deviennent les horaires d'ouverture des salles. */
  space: Space;
  /** Nombre de séances transmises. */
  sessionCount: number;
  warnings: string[];
}

/** Le demandeur et toutes ses sections, à tout niveau. */
export function requesterAndDescendants(space: Space, requesterId: string): Set<string> {
  const ids = new Set([requesterId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of space.requesters) {
      if (r.parentId && ids.has(r.parentId) && !ids.has(r.id)) {
        ids.add(r.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Délégation : les créneaux obtenus par un demandeur deviennent les ressources d'un nouvel espace,
 * que l'association peut ouvrir pour répartir ses propres sections et coachs. Le fichier produit est
 * un fichier ordinaire de l'application.
 */
export function buildDelegation(space: Space, options: DelegationOptions): DelegationResult {
  const requester = space.requesters.find((r) => r.id === options.requesterId);
  if (!requester) throw new Error(`Demandeur inconnu : « ${options.requesterId} »`);
  const owners = requesterAndDescendants(space, requester.id);
  const demands = new Map(space.demands.filter((d) => owners.has(d.requesterId)).map((d) => [d.id, d]));
  const periods = space.periods.filter((p) => options.periodIds.includes(p.id));
  const warnings: string[] = [];

  // (salle, période, jour) -> intervalles [début, fin) en unités de 15 min
  const raw = new Map<string, [number, number][]>();
  let sessionCount = 0;
  let skipped = 0;
  for (const period of periods) {
    const planning = space.plannings.find((p) => p.periodId === period.id);
    for (const a of planning?.assignments ?? []) {
      const d = demands.get(a.demandId);
      if (!d) continue;
      if (d.everyKWeeks > 1) {
        skipped++;
        continue;
      }
      const s = parseTime(a.start);
      const key = `${a.resourceId}|${period.id}|${a.day}`;
      const list = raw.get(key);
      if (list) list.push([s, s + d.durationUnits]);
      else raw.set(key, [[s, s + d.durationUnits]]);
      sessionCount++;
    }
  }
  if (skipped > 0) {
    warnings.push(
      `${skipped} séance(s) à rythme de plusieurs semaines n'ont pas été transmises : un créneau qui n'existe qu'une semaine sur deux ne peut pas encore être décrit dans le fichier.`,
    );
  }
  for (const period of periods) {
    if (!space.plannings.some((p) => p.periodId === period.id && p.assignments.length > 0)) {
      warnings.push(`La période « ${period.name} » n'a pas de planning : aucun créneau transmis pour elle.`);
    }
  }

  // Fusion des intervalles qui se touchent
  type Slot = { resourceId: string; periodId: string; day: number; start: number; end: number };
  const slots: Slot[] = [];
  for (const [key, list] of raw) {
    const [resourceId, periodId, day] = key.split("|") as [string, string, string];
    const sorted = [...list].sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const [s, e] of sorted) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    for (const [s, e] of merged) slots.push({ resourceId, periodId, day: Number(day), start: s, end: e });
  }

  // Regroupement : mêmes horaires -> jours réunis, puis mêmes jours -> périodes réunies
  const byResource = new Map<string, WeeklyRule[]>();
  const resourceIds = [...new Set(slots.map((s) => s.resourceId))];
  for (const resourceId of resourceIds) {
    const mine = slots.filter((s) => s.resourceId === resourceId);
    const perPeriodHours = new Map<string, Set<number>>(); // période|début|fin -> jours
    for (const s of mine) {
      const k = `${s.periodId}|${s.start}|${s.end}`;
      const set = perPeriodHours.get(k);
      if (set) set.add(s.day);
      else perPeriodHours.set(k, new Set([s.day]));
    }
    const perDays = new Map<string, { days: number[]; start: number; end: number; periods: Set<string> }>();
    for (const [k, days] of perPeriodHours) {
      const [periodId, start, end] = k.split("|") as [string, string, string];
      const sortedDays = [...days].sort((a, b) => a - b);
      const k2 = `${sortedDays.join(",")}|${start}|${end}`;
      const entry = perDays.get(k2);
      if (entry) entry.periods.add(periodId);
      else perDays.set(k2, { days: sortedDays, start: Number(start), end: Number(end), periods: new Set([periodId]) });
    }
    const all = new Set(periods.map((p) => p.id));
    byResource.set(
      resourceId,
      [...perDays.values()].map((e) => ({
        days: e.days,
        start: formatTime(e.start),
        end: e.end >= 96 ? "24:00" : formatTime(e.end),
        periodIds: e.periods.size === all.size ? [] : [...e.periods].sort(),
      })),
    );
  }

  const resources: Resource[] = [];
  for (const [resourceId, weekly] of byResource) {
    const room = space.resources.find((r) => r.id === resourceId);
    if (!room) continue;
    resources.push({ ...room, weekly });
  }

  const delegated = spaceSchema.parse({
    id: `${space.id}-${requester.id}`,
    name: `${requester.name} — créneaux obtenus (${space.name})`,
    resources,
    requesters: [],
    demands: [],
    periods,
    closures: space.closures,
    plannings: [],
  });
  return { space: delegated, sessionCount, warnings };
}

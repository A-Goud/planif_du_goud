import { demandsOfPeriod, periodCycleWeeks } from "./cycle.js";
import type { Closure, Period, Space } from "./model.js";
import { formatTime, parseEndTime, parseTime, weekday } from "./time.js";

const DAY_MS = 86_400_000;

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  return fromMs(toMs(date) + n * DAY_MS);
}

/** Nombre de jours entre deux dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/** Lundi de la semaine qui contient la date. */
export function mondayOf(date: string): string {
  return addDays(date, -weekday(date));
}

/** Une séance du motif, projetée sur une date réelle. */
export interface DatedSession {
  date: string;
  /** Début et fin, "HH:MM". */
  start: string;
  end: string;
  demandId: string;
  resourceId: string;
  /** Raison de l'annulation (fermeture, exception de la salle) ; absente si la séance a lieu. */
  cancelled?: string;
}

/**
 * Projette le planning d'une période sur les dates : le motif de 1 ou 2 semaines est répété
 * du début à la fin de la période. Les séances tombant pendant une fermeture générale ou une
 * fermeture exceptionnelle de la salle sont conservées mais marquées comme annulées.
 */
export function projectPeriod(space: Space, periodId: string): DatedSession[] {
  const period = space.periods.find((p) => p.id === periodId);
  const planning = space.plannings.find((p) => p.periodId === periodId);
  if (!period || !planning) return [];
  const demands = new Map(demandsOfPeriod(space, periodId).map((d) => [d.id, d]));
  const cycle = Math.max(planning.cycleWeeks, periodCycleWeeks(space, periodId), 1);
  const resources = new Map(space.resources.map((r) => [r.id, r]));
  const monday = mondayOf(period.start);
  const out: DatedSession[] = [];

  for (let date = period.start; date <= period.end; date = addDays(date, 1)) {
    const day = weekday(date);
    const week = Math.floor(daysBetween(monday, date) / 7);
    const cycleWeek = week % cycle;
    const closure = space.closures.find((c) => c.start <= date && date <= c.end);
    for (const a of planning.assignments) {
      const d = demands.get(a.demandId);
      if (!d || a.day !== day) continue;
      if (cycleWeek < a.cycleWeek || (cycleWeek - a.cycleWeek) % d.everyKWeeks !== 0) continue;
      const s = parseTime(a.start);
      const e = s + d.durationUnits;
      let cancelled: string | undefined;
      if (closure) cancelled = closure.label;
      else {
        // la salle, puis les coachs nécessaires
        for (const id of [a.resourceId, ...d.needsResourceIds]) {
          const res = resources.get(id);
          for (const x of res?.exceptions ?? []) {
            if (x.date !== date || !x.closed) continue;
            const hit = !x.range || (s < parseEndTime(x.range.end) && parseTime(x.range.start) < e);
            if (hit) {
              cancelled = `${res?.name} indisponible${x.reason ? " : " + x.reason : ""}`;
              break;
            }
          }
          if (cancelled) break;
        }
      }
      out.push({ date, start: formatTime(s), end: formatTime(e), demandId: a.demandId, resourceId: a.resourceId, ...(cancelled ? { cancelled } : {}) });
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.start.localeCompare(y.start));
}

/**
 * Propose des périodes : les tranches de l'année entre deux fermetures générales (vacances),
 * découpées en morceaux d'environ `targetWeeks` semaines. L'agent garde la main : ce ne sont
 * que des propositions.
 */
export function suggestPeriods(rangeStart: string, rangeEnd: string, closures: Closure[], targetWeeks = 6): Omit<Period, "id">[] {
  const sorted = [...closures].filter((c) => c.end >= rangeStart && c.start <= rangeEnd).sort((a, b) => a.start.localeCompare(b.start));
  const stretches: [string, string, string][] = []; // début, fin, nom du repère précédent
  let cursor = rangeStart;
  for (const c of sorted) {
    if (c.start > cursor) stretches.push([cursor, addDays(c.start, -1), ""]);
    if (addDays(c.end, 1) > cursor) cursor = addDays(c.end, 1);
  }
  if (cursor <= rangeEnd) stretches.push([cursor, rangeEnd, ""]);

  const out: Omit<Period, "id">[] = [];
  for (const [start, end] of stretches) {
    const days = daysBetween(start, end) + 1;
    const weeks = Math.max(1, Math.round(days / 7));
    const parts = Math.max(1, Math.round(weeks / targetWeeks));
    const each = Math.ceil(days / parts);
    for (let i = 0; i < parts; i++) {
      const s = addDays(start, i * each);
      if (s > end) break;
      const e = i === parts - 1 ? end : addDays(s, each - 1);
      out.push({ name: `${s} → ${e}`, start: s, end: e });
    }
  }
  return out;
}

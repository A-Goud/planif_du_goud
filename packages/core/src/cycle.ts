import type { Demand, Resource, Space, WeeklyRule } from "./model.js";

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Longueur du motif d'une période : plus petit commun multiple des rythmes des demandes (1 si aucune). */
export function cycleLength(demands: Pick<Demand, "everyKWeeks">[]): number {
  return demands.reduce((l, d) => (l * d.everyKWeeks) / gcd(l, d.everyKWeeks), 1);
}

/** Demandes concernées par une période (une demande sans période vaut pour toutes). */
export function demandsOfPeriod(space: Space, periodId: string): Demand[] {
  return space.demands.filter((d) => d.periodIds.length === 0 || d.periodIds.includes(periodId));
}

/** Règles d'ouverture d'une ressource qui valent pour une période (sans période : toutes les règles). */
export function weeklyRulesFor(resource: Resource, periodId?: string): WeeklyRule[] {
  return resource.weekly.filter((r) => r.periodIds.length === 0 || periodId === undefined || r.periodIds.includes(periodId));
}

/** Une règle d'ouverture vaut-elle cette semaine (comptée depuis le début de la période) ? */
export function ruleAppliesInWeek(rule: Pick<WeeklyRule, "everyKWeeks" | "weekOffset">, week: number): boolean {
  return rule.everyKWeeks === 1 || (week >= rule.weekOffset && (week - rule.weekOffset) % rule.everyKWeeks === 0);
}

/**
 * Longueur du motif d'une période : plus petit commun multiple des rythmes des demandes
 * et des rythmes des horaires d'ouverture des ressources (1 si tout est hebdomadaire).
 */
export function periodCycleWeeks(space: Space, periodId: string): number {
  const rhythms: { everyKWeeks: number }[] = demandsOfPeriod(space, periodId).map((d) => ({ everyKWeeks: d.everyKWeeks }));
  for (const r of space.resources) for (const w of weeklyRulesFor(r, periodId)) rhythms.push({ everyKWeeks: w.everyKWeeks });
  return cycleLength(rhythms);
}

import { DAYS_PER_WEEK, UNITS_PER_DAY, demandsOfPeriod, type Resource, type Space } from "@planif/core";
import { openIntervals } from "./problem.js";

/** Au-delà, le solveur du navigateur devient lent ou manque de mémoire : le compagnon est recommandé. */
export const COMPANION_RECOMMENDED_ABOVE = 20_000;

/**
 * Nombre approximatif de séances candidates (variables) d'un calcul, sans construire le modèle.
 * Ignore les créneaux bloqués et la disponibilité des coachs : c'est un majorant proche.
 */
export function estimateVariables(space: Space, periodId: string, startStepUnits: number): number {
  const step = Math.max(1, startStepUnits);
  let total = 0;
  for (const d of demandsOfPeriod(space, periodId)) {
    const places = new Map<string, Resource>();
    const isPlace = (r: Resource) => r.capacity !== undefined;
    for (const r of space.resources) {
      const primary = d.place.kind === "any" ? isPlace(r) : d.place.kind === "type" ? r.type === d.place.resourceType : r.id === d.place.resourceId;
      const alt = d.alternatives && (d.alternatives.resourceIds.includes(r.id) || d.alternatives.resourceTypes.includes(r.type));
      if (primary || alt) places.set(r.id, r);
    }
    for (const room of places.values()) {
      if (room.capacity !== undefined && room.capacity < d.size) continue;
      if (d.activity && room.activities.length > 0 && !room.activities.includes(d.activity)) continue;
      let starts = 0;
      for (let day = 0; day < DAYS_PER_WEEK; day++) {
        for (const [a, b] of openIntervals(room, day, periodId)) {
          const last = Math.min(b, UNITS_PER_DAY) - d.durationUnits;
          // les débuts possibles sont les multiples du pas depuis minuit
          const n = Math.floor(last / step) - Math.ceil(a / step) + 1;
          if (n > 0) starts += n;
        }
      }
      total += starts * d.everyKWeeks;
    }
  }
  return total;
}

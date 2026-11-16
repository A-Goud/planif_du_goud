import {
  DAYS_PER_WEEK,
  UNITS_PER_DAY,
  demandsOfPeriod,
  parseEndTime,
  parseTime,
  type Demand,
  type Planning,
  type Resource,
  type Space,
} from "@planif/core";
import { openIntervals } from "./problem.js";
import { solvePeriod, type SolveOptions, type SolveOutcome } from "./solve.js";

/** Ce que l'agent peut décider d'appliquer : une modification de la demande, ou la libération des verrous. */
export interface Relaxation {
  kind: "duration" | "place" | "shareable" | "unlock";
  description: string;
  /** Modification à appliquer à la demande (si l'agent accepte). */
  demandPatch?: Partial<Demand>;
  /** Libérer les séances verrouillées des autres demandes. */
  unlockOthers?: boolean;
  /** Séances placées pour cette demande si la modification est appliquée. */
  placedAfter: number;
  /** Séances perdues par d'autres demandes (par rapport au calcul actuel). */
  collateral: { demandId: string; label: string; lost: number }[];
}

export interface Diagnosis {
  demandId: string;
  label: string;
  wanted: number;
  placed: number;
  /** Raisons constatées, en français. */
  causes: string[];
  /** Modifications testées qui débloqueraient (au moins en partie) la demande, les meilleures d'abord. */
  suggestions: Relaxation[];
}

export interface DiagnoseOptions extends Omit<SolveOptions, "periodId"> {
  periodId: string;
  /** Résultat du dernier calcul, s'il est connu : évite d'en refaire un. */
  baseline?: SolveOutcome;
  /** Nombre maximal de demandes analysées (les plus prioritaires d'abord). */
  maxDemands?: number;
  /** Temps maximal de chaque calcul d'essai, en secondes. */
  relaxTimeLimitSec?: number;
}

export interface DiagnoseResult {
  diagnoses: Diagnosis[];
  /** Demandes non satisfaites qui n'ont pas été analysées (limite atteinte). */
  skipped: string[];
}

function duration(units: number): string {
  const minutes = units * 15;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`) : `${m} min`;
}

/** Existe-t-il une plage libre de cette durée dans la semaine, hors créneaux bloqués ? */
function hasWindow(resource: Resource, units: number, planning: Planning | undefined, k: number, cycleWeeks: number, periodId?: string): boolean {
  for (let offset = 0; offset < k; offset++) {
    const weeks: number[] = [];
    for (let w = offset; w < Math.max(cycleWeeks, 1); w += k) weeks.push(w);
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      for (const [a, b] of openIntervals(resource, day, periodId)) {
        for (let s = a; s + units <= Math.min(b, UNITS_PER_DAY); s++) {
          const e = s + units;
          const hit = (planning?.blocked ?? []).some(
            (bl) =>
              bl.resourceId === resource.id &&
              bl.day === day &&
              (bl.cycleWeek === undefined || weeks.includes(bl.cycleWeek)) &&
              s < parseEndTime(bl.range.end) &&
              parseTime(bl.range.start) < e,
          );
          if (!hit) return true;
        }
      }
    }
  }
  return false;
}

/** Salles candidates (lieu demandé), sans filtrer sur la capacité ni l'activité. */
function primaryPlaces(space: Space, d: Demand): Resource[] {
  return space.resources.filter((r) => {
    if (d.place.kind === "any") return r.capacity !== undefined;
    if (d.place.kind === "type") return r.type === d.place.resourceType;
    return r.id === d.place.resourceId;
  });
}

/** Raisons constatées sans calcul, à partir des données et du planning actuel. */
export function explainDemand(space: Space, d: Demand, planning: Planning | undefined, periodId?: string): string[] {
  const causes: string[] = [];
  const candidates = primaryPlaces(space, d);
  if (candidates.length === 0) {
    causes.push("Aucune salle ne correspond au lieu demandé.");
    return causes;
  }
  const usable: Resource[] = [];
  for (const r of candidates) {
    if (r.capacity !== undefined && r.capacity < d.size) {
      causes.push(`« ${r.name} » est trop petite (capacité ${r.capacity}, ${d.size} personnes).`);
    } else if (d.activity && r.activities.length > 0 && !r.activities.includes(d.activity)) {
      causes.push(`« ${r.name} » n'accueille pas l'activité « ${d.activity} ».`);
    } else usable.push(r);
  }
  if (usable.length === 0) {
    causes.push("Aucune des salles demandées ne convient (capacité ou activité).");
    return causes;
  }
  const cycle = planning?.cycleWeeks ?? 1;
  const withWindow = usable.filter((r) => hasWindow(r, d.durationUnits, planning, d.everyKWeeks, cycle, periodId));
  for (const r of usable) {
    if (!withWindow.includes(r)) causes.push(`« ${r.name} » n'a aucune plage libre de ${duration(d.durationUnits)} (horaires ou créneaux bloqués).`);
  }
  if (withWindow.length === 0) return causes;

  for (const id of d.needsResourceIds) {
    const c = space.resources.find((r) => r.id === id);
    if (c && !hasWindow(c, d.durationUnits, planning, d.everyKWeeks, cycle, periodId)) {
      causes.push(`« ${c.name} » n'est jamais disponible ${duration(d.durationUnits)} d'affilée.`);
    }
  }

  // Qui occupe les salles possibles ?
  const ids = new Set(withWindow.map((r) => r.id));
  const byRequester = new Map<string, number>();
  const demandsById = new Map(space.demands.map((x) => [x.id, x]));
  for (const a of planning?.assignments ?? []) {
    if (a.demandId === d.id || !ids.has(a.resourceId)) continue;
    const other = demandsById.get(a.demandId);
    const name = space.requesters.find((q) => q.id === other?.requesterId)?.name ?? "?";
    byRequester.set(name, (byRequester.get(name) ?? 0) + 1);
  }
  const names = withWindow.map((r) => `« ${r.name} »`).join(", ");
  if (byRequester.size > 0) {
    const list = [...byRequester].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`).join(", ");
    causes.push(`Les salles possibles (${names}) sont occupées par : ${list}.`);
  } else {
    causes.push(`Les salles possibles (${names}) sont libres dans le planning actuel : l'obstacle vient des contraintes combinées (séances verrouillées, coach, minimum des autres demandes).`);
  }
  return causes;
}

/** Variantes testées pour une demande. */
function candidateRelaxations(space: Space, d: Demand, planning: Planning | undefined): Omit<Relaxation, "placedAfter" | "collateral">[] {
  const out: Omit<Relaxation, "placedAfter" | "collateral">[] = [];
  for (const cut of [2, 4]) {
    const shorter = d.durationUnits - cut;
    if (shorter >= 2) {
      out.push({
        kind: "duration",
        description: `Réduire la durée de ${duration(d.durationUnits)} à ${duration(shorter)}`,
        demandPatch: { durationUnits: shorter },
      });
    }
  }
  if (d.place.kind !== "any") {
    out.push({ kind: "place", description: "Accepter n'importe quelle salle", demandPatch: { place: { kind: "any" } } });
  }
  if (!d.shareable && d.activity && space.resources.some((r) => r.compatibleGroups.some((g) => g.includes(d.activity as string)))) {
    out.push({
      kind: "shareable",
      description: "Accepter de partager la salle avec des activités compatibles",
      demandPatch: { shareable: true },
    });
  }
  if ((planning?.assignments ?? []).some((a) => a.locked && a.demandId !== d.id)) {
    out.push({ kind: "unlock", description: "Libérer les séances verrouillées des autres demandes", unlockOthers: true });
  }
  return out;
}

function countByDemand(outcome: SolveOutcome): Map<string, number> {
  return new Map(outcome.outcomes.map((o) => [o.demandId, o.placed]));
}

/**
 * Explique pourquoi des demandes ne sont pas satisfaites et teste, une modification à la fois,
 * ce qui les débloquerait. Rien n'est appliqué : l'agent décide.
 */
export async function diagnosePeriod(space: Space, options: DiagnoseOptions): Promise<DiagnoseResult> {
  const planning = space.plannings.find((p) => p.periodId === options.periodId);
  const demands = demandsOfPeriod(space, options.periodId);
  const placedNow = new Map<string, number>();
  for (const a of planning?.assignments ?? []) placedNow.set(a.demandId, (placedNow.get(a.demandId) ?? 0) + 1);

  const unsatisfied = demands
    .filter((d) => (placedNow.get(d.id) ?? 0) < d.sessions)
    .sort((a, b) => {
      const belowA = (placedNow.get(a.id) ?? 0) < (a.minSessions ?? a.sessions) ? 1 : 0;
      const belowB = (placedNow.get(b.id) ?? 0) < (b.minSessions ?? b.sessions) ? 1 : 0;
      return belowB - belowA || b.priority - a.priority;
    });
  const analysed = unsatisfied.slice(0, options.maxDemands ?? 6);
  const skipped = unsatisfied.slice(analysed.length).map((d) => d.id);
  if (analysed.length === 0) return { diagnoses: [], skipped };

  const { baseline: given, maxDemands: _m, relaxTimeLimitSec, ...solveOptions } = options;
  void _m;
  const trial: SolveOptions = {
    ...solveOptions,
    solverOptions: { ...solveOptions.solverOptions, timeLimitSec: Math.min(solveOptions.solverOptions?.timeLimitSec ?? 10, relaxTimeLimitSec ?? 10) },
  };
  const baseline = given ?? (await solvePeriod(space, trial));
  const baseCounts = countByDemand(baseline);

  const diagnoses: Diagnosis[] = [];
  for (const d of analysed) {
    const causes = explainDemand(space, d, planning, options.periodId);
    const basePlaced = baseCounts.get(d.id) ?? 0;
    const suggestions: Relaxation[] = [];
    if (basePlaced >= d.sessions) {
      causes.push("Un nouveau calcul placerait pourtant toutes les séances de cette demande : le planning affiché a peut-être été modifié à la main.");
    } else {
      for (const r of candidateRelaxations(space, d, planning)) {
        const variant: Space = {
          ...space,
          demands: r.demandPatch ? space.demands.map((x) => (x.id === d.id ? { ...x, ...r.demandPatch } : x)) : space.demands,
          plannings: r.unlockOthers
            ? space.plannings.map((p) =>
                p.periodId === options.periodId ? { ...p, assignments: p.assignments.map((a) => (a.demandId === d.id ? a : { ...a, locked: false })) } : p,
              )
            : space.plannings,
        };
        const result = await solvePeriod(variant, { ...trial, freezeExisting: r.unlockOthers ? false : trial.freezeExisting });
        if (result.status !== "optimal" && result.status !== "feasible") continue;
        const after = countByDemand(result);
        const placedAfter = after.get(d.id) ?? 0;
        if (placedAfter <= basePlaced) continue;
        const collateral = demands
          .filter((x) => x.id !== d.id)
          .flatMap((x) => {
            const lost = (baseCounts.get(x.id) ?? 0) - (after.get(x.id) ?? 0);
            return lost > 0 ? [{ demandId: x.id, label: x.label, lost }] : [];
          });
        suggestions.push({ ...r, placedAfter, collateral });
      }
      suggestions.sort((a, b) => {
        const fullA = a.placedAfter >= d.sessions ? 1 : 0;
        const fullB = b.placedAfter >= d.sessions ? 1 : 0;
        const lostA = a.collateral.reduce((n, c) => n + c.lost, 0);
        const lostB = b.collateral.reduce((n, c) => n + c.lost, 0);
        return fullB - fullA || lostA - lostB || b.placedAfter - a.placedAfter;
      });
    }
    diagnoses.push({ demandId: d.id, label: d.label, wanted: d.sessions, placed: placedNow.get(d.id) ?? 0, causes, suggestions });
  }
  return { diagnoses, skipped };
}

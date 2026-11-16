import {
  DAYS_PER_WEEK,
  UNITS_PER_DAY,
  periodCycleWeeks,
  ruleAppliesInWeek,
  demandsOfPeriod,
  parseEndTime,
  parseTime,
  weeklyRulesFor,
  type Demand,
  type Planning,
  type Resource,
  type Space,
} from "@planif/core";
import { MilpModel } from "./milp.js";

/**
 * Poids des objectifs. Ordre de grandeur voulu : satisfaire une demande (1 000 × priorité)
 * l'emporte sur conserver un créneau (100), qui l'emporte sur une préférence (10).
 * Le minimum garanti d'une demande pèse 5 fois plus. L'équité (0 à 1) fait décroître la valeur des séances
 * successives d'une même demande : la 1re compte pleinement, la dernière (1 - équité) fois sa valeur, si bien que
 * deux demandes de même priorité se partagent les manques plutôt que l'une reçoit tout et l'autre rien. La stabilité « imposée » l'emporte sur tout
 * sauf sur les contraintes dures.
 */
export interface Weights {
  satisfaction: number;
  minimumBonus: number;
  stability: number;
  stabilityImposed: number;
  preference: number;
  alternativePenalty: number;
  equity: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  satisfaction: 1000,
  minimumBonus: 5000,
  stability: 100,
  stabilityImposed: 100_000,
  preference: 10,
  alternativePenalty: 300,
  equity: 0.3,
};

export interface ProblemOptions {
  periodId: string;
  /** Planning de référence (période ou année précédente) pour la stabilité. */
  reference?: Planning;
  weights?: Partial<Weights>;
  /** Pas des débuts de séance, en unités de 15 min (1 = tous les quarts d'heure). */
  startStep?: number;
  /** Remplace le mode de stabilité de toutes les demandes (réglage global). */
  stabilityOverride?: "ignored" | "preferred" | "imposed";
  /**
   * Traite toutes les séances déjà placées comme verrouillées : seul le reste est calculé
   * (résolution partielle après l'ajout d'une salle ou d'une demande).
   */
  freezeExisting?: boolean;
}

/** Une séance candidate : la variable vaut 1 si la séance est placée là. */
export interface SessionVar {
  v: number;
  demandId: string;
  resourceId: string;
  day: number;
  /** Début, en unités de 15 min depuis minuit. */
  start: number;
  duration: number;
  offset: number;
  alternative: boolean;
}

export interface Problem {
  model: MilpModel;
  sessions: SessionVar[];
  demands: Demand[];
  cycleWeeks: number;
  /** Séances verrouillées qui n'ont pu être prises en compte (hors disponibilité, etc.). */
  lockedMissing: string[];
  warnings: string[];
}

interface Entry {
  v: number;
  /** Index absolu dans le cycle (semaine, jour, unité). */
  s: number;
  e: number;
  size: number;
  activity: string | undefined;
  shared: boolean;
}

const UNITS_PER_WEEK = DAYS_PER_WEEK * UNITS_PER_DAY;

const sessionKey = (demand: string, resource: string, day: number, start: number, offset: number) =>
  `${demand}|${resource}|${day}|${start}|${offset}`;

/** Intervalles ouverts [début, fin) d'une ressource un jour donné, fusionnés. */
/**
 * `week` : semaine du cycle (comptée depuis le début de la période). Sans elle, réunit toutes les semaines.
 */
export function openIntervals(resource: Resource, day: number, periodId?: string, week?: number): [number, number][] {
  const raw = weeklyRulesFor(resource, periodId)
    .filter((r) => week === undefined || ruleAppliesInWeek(r, week))
    .filter((r) => r.days.includes(day))
    .map((r): [number, number] => [parseTime(r.start), parseEndTime(r.end)])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of raw) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function buildProblem(space: Space, options: ProblemOptions): Problem {
  const period = space.periods.find((p) => p.id === options.periodId);
  if (!period) throw new Error(`Période inconnue : « ${options.periodId} »`);

  const weights: Weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const step = Math.max(1, options.startStep ?? 1);
  const warnings: string[] = [];
  const planning = space.plannings.find((p) => p.periodId === options.periodId);
  const demands = demandsOfPeriod(space, options.periodId);
  const cycleWeeks = periodCycleWeeks(space, options.periodId);
  const resourcesById = new Map(space.resources.map((r) => [r.id, r]));

  // Disponibilités hebdomadaires précalculées
  // [semaine du cycle][jour] -> plages ouvertes
  const open = new Map<string, [number, number][][][]>();
  for (const r of space.resources) {
    open.set(
      r.id,
      Array.from({ length: cycleWeeks }, (_, w) => Array.from({ length: DAYS_PER_WEEK }, (_, d) => openIntervals(r, d, options.periodId, w))),
    );
    if (r.weekly.length === 0) warnings.push(`La ressource « ${r.name} » n'a aucun horaire : elle n'est jamais disponible.`);
  }
  for (const r of space.resources) {
    if (r.exceptions.length) {
      warnings.push(`Les exceptions datées de « ${r.name} » ne changent pas le motif de la semaine : les séances tombant ces jours-là sont signalées comme annulées dans le calendrier daté.`);
      break;
    }
  }

  const blocked = planning?.blocked ?? [];
  const isFree = (resourceId: string, day: number, s: number, e: number, weeks: number[]): boolean => {
    // la ressource doit être ouverte pendant toutes les semaines où la séance a lieu
    for (const w of weeks) {
      const intervals = open.get(resourceId)?.[w]?.[day] ?? [];
      if (!intervals.some(([a, b]) => s >= a && e <= b)) return false;
    }
    for (const b of blocked) {
      if (b.resourceId !== resourceId || b.day !== day) continue;
      if (b.cycleWeek !== undefined && !weeks.includes(b.cycleWeek)) continue;
      if (s < parseEndTime(b.range.end) && parseTime(b.range.start) < e) return false;
    }
    return true;
  };

  // Séances de référence (stabilité)
  const referenceKeys = new Set(
    (options.reference?.assignments ?? []).map((a) => sessionKey(a.demandId, a.resourceId, a.day, parseTime(a.start), a.cycleWeek)),
  );

  const model = new MilpModel();
  const sessions: SessionVar[] = [];
  const byKey = new Map<string, SessionVar>();
  const entries = new Map<string, Entry[]>(); // par ressource
  const addEntry = (resourceId: string, entry: Entry) => {
    const list = entries.get(resourceId);
    if (list) list.push(entry);
    else entries.set(resourceId, [entry]);
  };

  for (const d of demands) {
    const sessionVars: number[] = [];
    const equity = weights.equity > 0 && d.sessions > 1;
    const perSlot = new Map<string, number[]>(); // (décalage, jour) -> variables

    // Lieux candidats : principaux, puis alternatives
    const places = new Map<string, boolean>(); // id -> alternatif ?
    const isPlace = (r: Resource) => r.capacity !== undefined;
    const primary = space.resources.filter((r) => {
      if (d.place.kind === "any") return isPlace(r);
      if (d.place.kind === "type") return r.type === d.place.resourceType;
      return r.id === d.place.resourceId;
    });
    primary.forEach((r) => places.set(r.id, false));
    if (d.alternatives) {
      for (const r of space.resources) {
        if (places.has(r.id)) continue;
        if (d.alternatives.resourceIds.includes(r.id) || d.alternatives.resourceTypes.includes(r.type)) {
          places.set(r.id, true);
        }
      }
    }

    const coaches = d.needsResourceIds.flatMap((id) => {
      const c = resourcesById.get(id);
      return c ? [c] : [];
    });

    const duration = d.durationUnits;
    const k = d.everyKWeeks;

    for (const [placeId, alternative] of places) {
      const room = resourcesById.get(placeId);
      if (!room) continue;
      if (room.capacity !== undefined && room.capacity < d.size) continue;
      if (d.activity && room.activities.length > 0 && !room.activities.includes(d.activity)) continue;
      const shared =
        d.shareable && d.activity !== undefined && room.compatibleGroups.some((g) => g.includes(d.activity as string));

      for (let offset = 0; offset < k; offset++) {
        const weeks: number[] = [];
        for (let w = offset; w < cycleWeeks; w += k) weeks.push(w);

        for (let day = 0; day < DAYS_PER_WEEK; day++) {
          for (let start = 0; start + duration <= UNITS_PER_DAY; start += step) {
            const end = start + duration;
            if (!isFree(room.id, day, start, end, weeks)) continue;
            if (!coaches.every((c) => isFree(c.id, day, start, end, weeks))) continue;

            const v = model.addBinary();
            const sv: SessionVar = { v, demandId: d.id, resourceId: room.id, day, start, duration, offset, alternative };
            sessions.push(sv);
            byKey.set(sessionKey(d.id, room.id, day, start, offset), sv);
            sessionVars.push(v);
            const slot = `${offset},${day}`;
            const list = perSlot.get(slot);
            if (list) list.push(v);
            else perSlot.set(slot, [v]);

            for (const w of weeks) {
              const base = w * UNITS_PER_WEEK + day * UNITS_PER_DAY;
              addEntry(room.id, { v, s: base + start, e: base + end, size: d.size, activity: d.activity, shared });
              for (const c of coaches) {
                addEntry(c.id, { v, s: base + start, e: base + end, size: 0, activity: undefined, shared: false });
              }
            }

            // Objectif
            // avec l'équité, la valeur de la satisfaction est portée par les variables de palier (plus bas)
            let gain = equity ? 0 : weights.satisfaction * d.priority;
            if (alternative) gain -= weights.alternativePenalty;
            if (d.preferredDays.length > 0 && d.preferredDays.includes(day)) gain += weights.preference;
            if (d.preferredRange && start >= parseTime(d.preferredRange.start) && end <= parseEndTime(d.preferredRange.end)) {
              gain += weights.preference;
            }
            const stability = options.stabilityOverride ?? d.stability;
            if (stability !== "ignored" && referenceKeys.has(sessionKey(d.id, room.id, day, start, offset))) {
              gain += stability === "imposed" ? weights.stabilityImposed : weights.stability;
            }
            model.addObjective(v, gain);
          }
        }
      }
    }

    // Nombre de séances : au plus celui demandé, minimum garanti récompensé
    if (sessionVars.length > 0) {
      model.addRow(sessionVars.map((v) => [v, 1] as const), "<=", d.sessions);
      if (equity) {
        // paliers : la k-ième séance placée vaut de moins en moins (le solveur remplit les premiers paliers d'abord)
        const tiers = Array.from({ length: d.sessions }, (_, k) => {
          const u = model.addContinuous(1);
          model.addObjective(u, weights.satisfaction * d.priority * (1 - (weights.equity * k) / d.sessions));
          return u;
        });
        model.addRow([...sessionVars.map((v) => [v, 1] as const), ...tiers.map((u) => [u, -1] as const)], "=", 0);
      }
      const minimum = d.minSessions ?? d.sessions;
      const a = model.addContinuous(minimum);
      model.addRow([[a, 1], ...sessionVars.map((v) => [v, -1] as const)], "<=", 0);
      model.addObjective(a, weights.minimumBonus * d.priority);
    }
    // Une séance par jour (et par décalage) au plus
    for (const vars of perSlot.values()) {
      if (vars.length > 1) model.addRow(vars.map((v) => [v, 1] as const), "<=", 1);
    }
  }

  // Séances verrouillées : fixées à 1
  const lockedMissing: string[] = [];
  const demandIds = new Set(demands.map((d) => d.id));
  for (const a of planning?.assignments ?? []) {
    if (!(a.locked || options.freezeExisting) || !demandIds.has(a.demandId)) continue;
    const key = sessionKey(a.demandId, a.resourceId, a.day, parseTime(a.start), a.cycleWeek);
    const sv = byKey.get(key);
    if (sv) model.addRow([[sv.v, 1]], "=", 1);
    else {
      lockedMissing.push(key);
      warnings.push(`Séance verrouillée impossible (hors disponibilité, capacité ou activité non permise) : demande « ${a.demandId} », ressource « ${a.resourceId} ».`);
    }
  }

  // Occupation des ressources : pas de chevauchement, sauf groupes compatibles
  for (const [resourceId, list] of entries) {
    const resource = resourcesById.get(resourceId);
    if (resource) addResourceConstraints(model, resource, list);
  }

  return { model, sessions, demands, cycleWeeks, lockedMissing, warnings };
}

/**
 * Parcourt le temps : à chaque début de séance, l'ensemble des séances en cours doit
 * respecter l'exclusivité, la capacité cumulée et les groupes compatibles.
 */
function addResourceConstraints(model: MilpModel, resource: Resource, list: Entry[]): void {
  const sorted = [...list].sort((a, b) => a.s - b.s);
  const starts = [...new Set(sorted.map((e) => e.s))];
  const active = new Set<Entry>();
  let next = 0;

  for (const t of starts) {
    for (const e of active) if (e.e <= t) active.delete(e);
    let added = false;
    while (next < sorted.length && sorted[next]!.s <= t) {
      active.add(sorted[next]!);
      next++;
      added = true;
    }
    if (!added || active.size < 2) continue; // sinon, ensemble déjà couvert par une contrainte précédente

    const exclusive = [...active].filter((e) => !e.shared);
    const shared = [...active].filter((e) => e.shared);

    if (exclusive.length > 1) model.addRow(exclusive.map((e) => [e.v, 1] as const), "<=", 1);
    if (shared.length === 0) continue;

    // Capacité cumulée
    if (resource.capacity !== undefined) {
      const total = [...active].reduce((n, e) => n + e.size, 0);
      if (total > resource.capacity) {
        model.addRow([...active].map((e) => [e.v, e.size] as const), "<=", resource.capacity);
      }
    }

    // Activités partagées : au plus une séance par activité, activités présentes dans un même groupe
    const byActivity = new Map<string, Entry[]>();
    for (const e of shared) {
      const a = e.activity as string;
      const l = byActivity.get(a);
      if (l) l.push(e);
      else byActivity.set(a, [e]);
    }
    const z = new Map<string, number>();
    for (const [a, es] of byActivity) {
      const za = model.addBinary();
      z.set(a, za);
      model.addRow([...es.map((e) => [e.v, 1] as const), [za, -1] as const], "<=", 0);
      for (const ex of exclusive) {
        // une séance exclusive exclut toute activité partagée
        model.addRow([[ex.v, 1], [za, 1]], "<=", 1);
      }
    }
    if (z.size > 1) {
      const groups = resource.compatibleGroups.filter((g) => g.some((a) => z.has(a)));
      const w = groups.map(() => model.addBinary());
      model.addRow(w.map((x) => [x, 1] as const), "<=", 1);
      for (const [a, za] of z) {
        const covering = groups.flatMap((g, i) => (g.includes(a) ? [w[i] as number] : []));
        model.addRow([[za, 1], ...covering.map((x) => [x, -1] as const)], "<=", 0);
      }
    }
  }
}

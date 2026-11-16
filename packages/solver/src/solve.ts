import { formatTime, parseTime, type Assignment, type Planning, type Space } from "@planif/core";
import { HighsWasmSolver } from "./highs.js";
import type { MilpSolver, SolveStatus, SolverOptions } from "./milp.js";
import { buildProblem, type ProblemOptions } from "./problem.js";

export interface SolveOptions extends ProblemOptions {
  solver?: MilpSolver;
  solverOptions?: SolverOptions;
}

/** Bilan d'une demande dans le planning calculé. */
export interface DemandOutcome {
  demandId: string;
  label: string;
  wanted: number;
  minimum: number;
  placed: number;
  /** Toutes les séances souhaitées sont placées. */
  satisfied: boolean;
  /** Le minimum garanti est atteint. */
  meetsMinimum: boolean;
}

export interface SolveOutcome {
  status: SolveStatus;
  timeLimitReached: boolean;
  /** Planning de la période : séances placées (les verrouillées restent verrouillées) et créneaux bloqués. */
  planning: Planning;
  outcomes: DemandOutcome[];
  /** Demandes dont toutes les séances n'ont pas pu être placées. */
  unsatisfied: DemandOutcome[];
  warnings: string[];
  stats: { variables: number; rows: number; millis: number; objective: number };
}

/** Calcule le planning d'une période pour un espace. */
export async function solvePeriod(space: Space, options: SolveOptions): Promise<SolveOutcome> {
  const problem = buildProblem(space, options);
  const solver = options.solver ?? new HighsWasmSolver();
  const solution = await solver.solve(problem.model, options.solverOptions);

  const existing = space.plannings.find((p) => p.periodId === options.periodId);
  const lockedKeys = new Set(
    (existing?.assignments ?? [])
      .filter((a) => a.locked)
      .map((a) => `${a.demandId}|${a.resourceId}|${a.day}|${parseTime(a.start)}|${a.cycleWeek}`),
  );

  const usable = solution.status === "optimal" || solution.status === "feasible";
  const assignments: Assignment[] = [];
  const placedCount = new Map<string, number>();
  if (usable) {
    for (const s of problem.sessions) {
      if ((solution.values[s.v] ?? 0) < 0.5) continue;
      assignments.push({
        demandId: s.demandId,
        resourceId: s.resourceId,
        day: s.day,
        start: formatTime(s.start),
        cycleWeek: s.offset,
        locked: lockedKeys.has(`${s.demandId}|${s.resourceId}|${s.day}|${s.start}|${s.offset}`),
      });
      placedCount.set(s.demandId, (placedCount.get(s.demandId) ?? 0) + 1);
    }
  }

  const outcomes: DemandOutcome[] = problem.demands.map((d) => {
    const placed = placedCount.get(d.id) ?? 0;
    const minimum = d.minSessions ?? d.sessions;
    return {
      demandId: d.id,
      label: d.label,
      wanted: d.sessions,
      minimum,
      placed,
      satisfied: placed >= d.sessions,
      meetsMinimum: placed >= minimum,
    };
  });

  return {
    status: solution.status,
    timeLimitReached: solution.timeLimitReached,
    planning: {
      periodId: options.periodId,
      cycleWeeks: problem.cycleWeeks,
      assignments,
      blocked: existing?.blocked ?? [],
    },
    outcomes,
    unsatisfied: outcomes.filter((o) => !o.satisfied),
    warnings: problem.warnings,
    stats: {
      variables: problem.model.variableCount,
      rows: problem.model.rows.length,
      millis: solution.millis,
      objective: solution.objective,
    },
  };
}

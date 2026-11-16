import type { Space } from "./model.js";

/**
 * Retire des plannings tout ce qui référence une ressource, une demande ou une période qui n'existe plus
 * (par exemple après la suppression d'une salle). Ne touche pas aux demandes : une demande qui vise
 * une salle supprimée reste signalée comme erreur, pour ne pas perdre de données sans prévenir.
 */
export function pruneOrphans(space: Space): Space {
  const resourceIds = new Set(space.resources.map((r) => r.id));
  const demandIds = new Set(space.demands.map((d) => d.id));
  const periodIds = new Set(space.periods.map((p) => p.id));
  return {
    ...space,
    // une règle limitée à des périodes supprimées disparaît (sinon elle vaudrait pour toutes les périodes)
    resources: space.resources.map((r) => ({
      ...r,
      weekly: r.weekly
        .filter((w) => w.periodIds.length === 0 || w.periodIds.some((p) => periodIds.has(p)))
        .map((w) => ({ ...w, periodIds: w.periodIds.filter((p) => periodIds.has(p)) })),
    })),
    plannings: space.plannings
      .filter((p) => periodIds.has(p.periodId))
      .map((p) => ({
        ...p,
        assignments: p.assignments.filter((a) => demandIds.has(a.demandId) && resourceIds.has(a.resourceId)),
        blocked: p.blocked.filter((b) => resourceIds.has(b.resourceId)),
      })),
  };
}

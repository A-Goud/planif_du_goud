import { spaceSchema, type Space } from "@planif/core";

/** Mairie fictive pour essayer le logiciel. */
export function exampleSpace(): Space {
  const week = (start: string, end: string, days = [0, 1, 2, 3, 4]) => ({ days, start, end });
  return spaceSchema.parse({
    id: "mairie-demo",
    name: "Mairie de Démo",
    resources: [
      {
        id: "gym", name: "Gymnase", type: "salle", capacity: 80,
        activities: ["basket", "badminton", "escalade", "ping-pong", "volley"],
        compatibleGroups: [["badminton", "escalade", "ping-pong"]],
        weekly: [week("17:00", "22:30"), week("09:00", "18:00", [5, 6])],
      },
      {
        id: "dojo", name: "Dojo", type: "salle", capacity: 40,
        activities: ["judo", "yoga", "danse"],
        compatibleGroups: [["yoga", "danse"]],
        weekly: [week("17:30", "22:00", [0, 1, 2, 3, 4, 5])],
      },
      {
        id: "polyvalente", name: "Salle polyvalente", type: "salle", capacity: 30,
        weekly: [week("08:00", "22:00", [0, 1, 2, 3, 4, 5])],
      },
      {
        id: "coach-lea", name: "Léa (coach)", type: "coach",
        weekly: [week("17:00", "21:00", [1, 3])],
      },
    ],
    requesters: [
      { id: "basket", name: "Basket club" },
      { id: "judo", name: "Judo club" },
      { id: "danse", name: "Danse et yoga" },
      { id: "badminton", name: "Badminton loisir" },
      { id: "escalade", name: "Escalade" },
      { id: "amicale", name: "Amicale des aînés" },
    ],
    demands: [
      { id: "d1", requesterId: "basket", label: "Entraînement seniors", activity: "basket", size: 20, durationUnits: 6, sessions: 2, minSessions: 1, place: { kind: "resource", resourceId: "gym" }, priority: 5 },
      { id: "d2", requesterId: "basket", label: "Entraînement jeunes", activity: "basket", size: 25, durationUnits: 6, sessions: 2, minSessions: 1, place: { kind: "resource", resourceId: "gym" }, priority: 4, preferredDays: [2] },
      { id: "d3", requesterId: "basket", label: "Réunion du bureau", durationUnits: 4, sessions: 1, everyKWeeks: 2, shareable: true, priority: 2 },
      { id: "d4", requesterId: "judo", label: "Cours enfants", activity: "judo", size: 20, durationUnits: 5, sessions: 2, place: { kind: "resource", resourceId: "dojo" }, priority: 4, needsResourceIds: ["coach-lea"] },
      { id: "d5", requesterId: "danse", label: "Danse", activity: "danse", size: 15, durationUnits: 6, sessions: 1, shareable: true, priority: 3 },
      { id: "d6", requesterId: "danse", label: "Yoga", activity: "yoga", size: 12, durationUnits: 4, sessions: 1, shareable: true, priority: 3 },
      { id: "d7", requesterId: "badminton", label: "Badminton", activity: "badminton", size: 16, durationUnits: 6, sessions: 1, shareable: true, priority: 3, place: { kind: "resource", resourceId: "gym" } },
      { id: "d8", requesterId: "escalade", label: "Escalade", activity: "escalade", size: 12, durationUnits: 6, sessions: 1, shareable: true, priority: 3, place: { kind: "resource", resourceId: "gym" } },
      { id: "d9", requesterId: "amicale", label: "Après-midi jeux", durationUnits: 8, sessions: 1, size: 20, priority: 2, preferredRange: { start: "09:00", end: "18:00" } },
      { id: "d10", requesterId: "amicale", label: "Réunion mensuelle", durationUnits: 4, sessions: 1, everyKWeeks: 2, shareable: true, priority: 1 },
    ],
    periods: [
      { id: "p1", name: "Septembre – Toussaint", start: "2026-09-01", end: "2026-10-16" },
      { id: "p2", name: "Novembre – Noël", start: "2026-11-02", end: "2026-12-18" },
    ],
  });
}

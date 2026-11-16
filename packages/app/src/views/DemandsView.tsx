import { useState } from "react";
import { demandSchema, type Demand } from "@planif/core";
import { newId, upsert, useStore } from "../store.js";
import { DAY_NAMES, DaysPicker, Errors, Field, TimeSelect, formatDuration } from "../ui.js";

function CheckList({ items, value, onChange }: { items: { id: string; name: string }[]; value: string[]; onChange(v: string[]): void }) {
  if (items.length === 0) return <span className="hint">Aucun choix disponible.</span>;
  return (
    <span className="days">
      {items.map((it) => (
        <label key={it.id} className={value.includes(it.id) ? "chip on" : "chip"}>
          <input type="checkbox" checked={value.includes(it.id)} onChange={(e) => onChange(e.target.checked ? [...value, it.id] : value.filter((x) => x !== it.id))} />
          {it.name}
        </label>
      ))}
    </span>
  );
}

const STABILITY = { ignored: "Ignorée", preferred: "Souhaitée", imposed: "Imposée" } as const;

export function DemandsView() {
  const { space, commit } = useStore();
  const [draft, setDraft] = useState<Demand | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");

  const requesterName = (id: string) => space.requesters.find((r) => r.id === id)?.name ?? "?";
  const places = space.resources.filter((r) => r.capacity !== undefined);
  const people = space.resources.filter((r) => r.capacity === undefined);
  const types = [...new Set(space.resources.map((r) => r.type))];

  const blank = (): Demand =>
    demandSchema.parse({ id: newId("d"), requesterId: space.requesters[0]?.id ?? "", label: "", durationUnits: 4, sessions: 1 });

  const save = () => {
    if (!draft) return;
    const result = commit({ ...space, demands: upsert(space.demands, draft) });
    setErrors(result);
    if (!result) setDraft(null);
  };

  const placeText = (d: Demand) =>
    d.place.kind === "any" ? "n'importe laquelle" : d.place.kind === "type" ? `type ${d.place.resourceType}` : (space.resources.find((r) => r.id === (d.place as { resourceId: string }).resourceId)?.name ?? "?");

  const shown = space.demands.filter((d) => !filter || d.requesterId === filter);

  return (
    <section>
      <div className="toolbar">
        <h2>Demandes</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer par demandeur">
          <option value="">Tous les demandeurs</option>
          {space.requesters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button className="primary" disabled={space.requesters.length === 0} onClick={() => { setDraft(blank()); setErrors(null); }}>Ajouter une demande</button>
      </div>
      {space.requesters.length === 0 && <p className="hint">Ajoutez d'abord un demandeur.</p>}
      {!draft && <Errors errors={errors} />}
      <table>
        <thead><tr><th>Demandeur</th><th>Demande</th><th>Séances</th><th>Durée</th><th>Lieu</th><th>Priorité</th><th /></tr></thead>
        <tbody>
          {shown.map((d) => (
            <tr key={d.id}>
              <td>{requesterName(d.requesterId)}</td>
              <td>{d.label}{d.activity ? <span className="hint"> · {d.activity}</span> : null}</td>
              <td>{d.sessions}{d.minSessions && d.minSessions < d.sessions ? ` (min ${d.minSessions})` : ""}{d.everyKWeeks > 1 ? ` / ${d.everyKWeeks} sem.` : " / sem."}</td>
              <td>{formatDuration(d.durationUnits)}</td>
              <td>{placeText(d)}</td>
              <td>{d.priority}</td>
              <td className="actions">
                <button onClick={() => { setDraft(structuredClone(d)); setErrors(null); }}>Modifier</button>
                <button className="danger" onClick={() => setErrors(commit({ ...space, demands: space.demands.filter((x) => x.id !== d.id) }))}>Supprimer</button>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={7} className="empty">Aucune demande.</td></tr>}
        </tbody>
      </table>

      {draft && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h3>{space.demands.some((d) => d.id === draft.id) ? "Modifier la demande" : "Nouvelle demande"}</h3>
          <div className="grid">
            <Field label="Demandeur">
              <select value={draft.requesterId} onChange={(e) => setDraft({ ...draft, requesterId: e.target.value })}>
                {space.requesters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Intitulé"><input required value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
            <Field label="Activité" hint="Pour les salles à activités limitées et le partage">
              <input value={draft.activity ?? ""} onChange={(e) => setDraft({ ...draft, activity: e.target.value.trim() || undefined })} />
            </Field>
            <Field label="Effectif"><input type="number" min={0} value={draft.size} onChange={(e) => setDraft({ ...draft, size: Number(e.target.value) })} /></Field>
            <Field label="Durée d'une séance (minutes)" hint={formatDuration(draft.durationUnits)}>
              <input type="number" min={15} step={15} value={draft.durationUnits * 15} onChange={(e) => setDraft({ ...draft, durationUnits: Math.max(1, Math.round(Number(e.target.value) / 15)) })} />
            </Field>
            <Field label="Séances souhaitées"><input type="number" min={1} value={draft.sessions} onChange={(e) => setDraft({ ...draft, sessions: Number(e.target.value) })} /></Field>
            <Field label="Minimum acceptable" hint="Vide = toutes les séances">
              <input type="number" min={1} value={draft.minSessions ?? ""} onChange={(e) => setDraft({ ...draft, minSessions: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
            <Field label="Rythme">
              <select value={draft.everyKWeeks} onChange={(e) => setDraft({ ...draft, everyKWeeks: Number(e.target.value) })}>
                <option value={1}>Chaque semaine</option>
                <option value={2}>Une semaine sur deux</option>
                <option value={3}>Une semaine sur trois</option>
                <option value={4}>Une semaine sur quatre</option>
              </select>
            </Field>
            <Field label="Priorité (1 à 5)">
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Stabilité d'une période à l'autre">
              <select value={draft.stability} onChange={(e) => setDraft({ ...draft, stability: e.target.value as Demand["stability"] })}>
                {Object.entries(STABILITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>

          <h4>Lieu</h4>
          <div className="grid">
            <Field label="Exigence">
              <select
                value={draft.place.kind}
                onChange={(e) => {
                  const kind = e.target.value;
                  setDraft({
                    ...draft,
                    place: kind === "any" ? { kind: "any" } : kind === "type" ? { kind: "type", resourceType: types[0] ?? "salle" } : { kind: "resource", resourceId: places[0]?.id ?? "" },
                  });
                }}
              >
                <option value="any">N'importe quelle salle</option>
                <option value="type">Un type de salle</option>
                <option value="resource">Une salle précise</option>
              </select>
            </Field>
            {draft.place.kind === "type" && (
              <Field label="Type">
                <select value={draft.place.resourceType} onChange={(e) => setDraft({ ...draft, place: { kind: "type", resourceType: e.target.value } })}>
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            )}
            {draft.place.kind === "resource" && (
              <Field label="Salle">
                <select value={draft.place.resourceId} onChange={(e) => setDraft({ ...draft, place: { kind: "resource", resourceId: e.target.value } })}>
                  {places.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={draft.shareable} onChange={(e) => setDraft({ ...draft, shareable: e.target.checked })} />
            Partageable : la salle peut accueillir en même temps une activité compatible
          </label>

          <details>
            <summary>Options avancées</summary>
            <Field label="Salles alternatives acceptées">
              <CheckList
                items={places}
                value={draft.alternatives?.resourceIds ?? []}
                onChange={(resourceIds) => setDraft({ ...draft, alternatives: resourceIds.length ? { resourceTypes: draft.alternatives?.resourceTypes ?? [], resourceIds } : undefined })}
              />
            </Field>
            <Field label="Coachs nécessaires"><CheckList items={people} value={draft.needsResourceIds} onChange={(needsResourceIds) => setDraft({ ...draft, needsResourceIds })} /></Field>
            <Field label="Jours préférés"><DaysPicker value={draft.preferredDays} onChange={(preferredDays) => setDraft({ ...draft, preferredDays })} /></Field>
            <Field label="Plage horaire préférée">
              <span className="rule">
                <label className="check">
                  <input type="checkbox" checked={!!draft.preferredRange} onChange={(e) => setDraft({ ...draft, preferredRange: e.target.checked ? { start: "17:00", end: "21:00" } : undefined })} />
                  Activer
                </label>
                {draft.preferredRange && (
                  <>
                    <TimeSelect value={draft.preferredRange.start} onChange={(start) => setDraft({ ...draft, preferredRange: { start, end: draft.preferredRange!.end } })} />
                    <span>à</span>
                    <TimeSelect allowEnd value={draft.preferredRange.end} onChange={(end) => setDraft({ ...draft, preferredRange: { start: draft.preferredRange!.start, end } })} />
                  </>
                )}
              </span>
            </Field>
            <Field label="Périodes concernées" hint="Aucune sélection = toutes les périodes">
              <CheckList items={space.periods} value={draft.periodIds} onChange={(periodIds) => setDraft({ ...draft, periodIds })} />
            </Field>
          </details>
          <p className="hint">Jours : {DAY_NAMES.join(", ")}.</p>

          <Errors errors={errors} />
          <div className="form-actions">
            <button type="submit" className="primary">Enregistrer</button>
            <button type="button" onClick={() => { setDraft(null); setErrors(null); }}>Annuler</button>
          </div>
        </form>
      )}
    </section>
  );
}

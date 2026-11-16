import { useState } from "react";
import { buildDelegation, requesterAndDescendants, requesterSchema, type Requester } from "@planif/core";
import { newId, upsert, useStore } from "../store.js";
import { downloadSpace } from "../storage.js";
import { Errors, Field } from "../ui.js";

export function RequestersView() {
  const { space, commit } = useStore();
  const [draft, setDraft] = useState<Requester | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [delegating, setDelegating] = useState<string | null>(null);
  const name = (id?: string) => space.requesters.find((r) => r.id === id)?.name;

  const save = () => {
    if (!draft) return;
    const result = commit({ ...space, requesters: upsert(space.requesters, draft) });
    setErrors(result);
    if (!result) setDraft(null);
  };

  return (
    <section>
      <div className="toolbar">
        <h2>Demandeurs</h2>
        <button className="primary" onClick={() => { setDraft(requesterSchema.parse({ id: newId("q"), name: "" })); setErrors(null); }}>Ajouter un demandeur</button>
      </div>
      <p className="hint">Associations et, pour une association, ses sections.</p>
      {!draft && <Errors errors={errors} />}
      <table>
        <thead><tr><th>Nom</th><th>Section de</th><th>Demandes</th><th /></tr></thead>
        <tbody>
          {space.requesters.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{name(r.parentId) ?? "—"}</td>
              <td>{space.demands.filter((d) => d.requesterId === r.id).length}</td>
              <td className="actions">
                <button onClick={() => setDelegating(delegating === r.id ? null : r.id)} title="Fichier des créneaux obtenus, à remettre à ce demandeur">Exporter ses créneaux</button>
                <button onClick={() => { setDraft({ ...r }); setErrors(null); }}>Modifier</button>
                <button className="danger" onClick={() => setErrors(commit({ ...space, requesters: space.requesters.filter((x) => x.id !== r.id) }))}>Supprimer</button>
              </td>
            </tr>
          ))}
          {space.requesters.length === 0 && <tr><td colSpan={4} className="empty">Aucun demandeur.</td></tr>}
        </tbody>
      </table>
      {delegating && <DelegationPanel requesterId={delegating} onClose={() => setDelegating(null)} />}
      {draft && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h3>{space.requesters.some((r) => r.id === draft.id) ? "Modifier le demandeur" : "Nouveau demandeur"}</h3>
          <div className="grid">
            <Field label="Nom"><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Section de">
              <select value={draft.parentId ?? ""} onChange={(e) => setDraft({ ...draft, parentId: e.target.value || undefined })}>
                <option value="">— aucune (association) —</option>
                {space.requesters.filter((r) => r.id !== draft.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          </div>
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

/** Fichier à remettre à un demandeur : ses créneaux deviennent les salles d'un nouvel espace. */
function DelegationPanel({ requesterId, onClose }: { requesterId: string; onClose(): void }) {
  const { space } = useStore();
  const requester = space.requesters.find((r) => r.id === requesterId);
  const owners = requesterAndDescendants(space, requesterId);
  const demandIds = new Set(space.demands.filter((d) => owners.has(d.requesterId)).map((d) => d.id));
  const periods = [...space.periods].sort((a, b) => a.start.localeCompare(b.start));
  const withSessions = (periodId: string) =>
    space.plannings.find((p) => p.periodId === periodId)?.assignments.filter((a) => demandIds.has(a.demandId)).length ?? 0;
  const [chosen, setChosen] = useState<string[]>(() => periods.filter((p) => withSessions(p.id) > 0).map((p) => p.id));
  if (!requester) return null;

  let result: ReturnType<typeof buildDelegation> | null = null;
  let failure: string | null = null;
  try {
    if (chosen.length > 0) result = buildDelegation(space, { requesterId, periodIds: chosen });
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="card">
      <h3>Créneaux de « {requester.name} »</h3>
      <p className="hint">
        Le fichier contient les salles aux horaires obtenus par {requester.name}{owners.size > 1 ? " et ses sections" : ""}. Remis à l'association, il s'ouvre comme un espace : elle y saisit ses sections, ses coachs et ses demandes, et lance son propre calcul.
      </p>
      <div className="days">
        {periods.map((p) => (
          <label key={p.id} className={`chip${chosen.includes(p.id) ? " on" : ""}`}>
            <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} />
            {p.name} ({withSessions(p.id)} séances)
          </label>
        ))}
      </div>
      {chosen.length === 0 && <p className="hint">Choisissez au moins une période.</p>}
      {failure && <p className="errors" role="alert">{failure}</p>}
      {result && (
        <>
          <p className="status">{result.sessionCount} séance(s) transmises, {result.space.resources.length} salle(s).</p>
          {result.warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}
        </>
      )}
      <div className="form-actions">
        <button className="primary" disabled={!result || result.sessionCount === 0} onClick={() => result && downloadSpace(result.space)}>Télécharger le fichier</button>
        <button onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}

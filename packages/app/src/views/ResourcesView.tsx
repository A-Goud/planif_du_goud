import { useState } from "react";
import { resourceSchema, type Resource } from "@planif/core";
import { newId, upsert, useStore } from "../store.js";
import { DAY_NAMES, DaysPicker, Errors, Field, TimeSelect, splitList } from "../ui.js";

function blank(): Resource {
  return resourceSchema.parse({ id: newId("r"), name: "", type: "salle", capacity: 30, weekly: [{ days: [0, 1, 2, 3, 4], start: "17:00", end: "22:00" }] });
}

function summary(r: Resource): string {
  return r.weekly.map((w) => `${w.days.map((d) => DAY_NAMES[d]).join(" ")} ${w.start}–${w.end}${w.everyKWeeks > 1 ? ` (1 semaine sur ${w.everyKWeeks})` : ""}${w.periodIds.length ? " (certaines périodes)" : ""}`).join(" · ") || "aucun horaire";
}

export function ResourcesView() {
  const { space, commit } = useStore();
  const [draft, setDraft] = useState<Resource | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);

  const save = () => {
    if (!draft) return;
    const result = commit({ ...space, resources: upsert(space.resources, draft) });
    setErrors(result);
    if (!result) setDraft(null);
  };
  const remove = (id: string) => {
    setErrors(commit({ ...space, resources: space.resources.filter((r) => r.id !== id) }));
  };

  return (
    <section>
      <div className="toolbar">
        <h2>Ressources</h2>
        <button className="primary" onClick={() => { setDraft(blank()); setErrors(null); }}>Ajouter une ressource</button>
      </div>
      <p className="hint">Salles, terrains, coachs… Une ressource avec une capacité est un lieu ; sans capacité, c'est une personne ou du matériel.</p>
      {!draft && <Errors errors={errors} />}
      <table>
        <thead>
          <tr><th>Nom</th><th>Type</th><th>Capacité</th><th>Activités</th><th>Horaires</th><th /></tr>
        </thead>
        <tbody>
          {space.resources.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.type}</td>
              <td>{r.capacity ?? "—"}</td>
              <td>{r.activities.join(", ") || "toutes"}</td>
              <td>{summary(r)}</td>
              <td className="actions">
                <button onClick={() => { setDraft(structuredClone(r)); setErrors(null); }}>Modifier</button>
                <button className="danger" onClick={() => remove(r.id)}>Supprimer</button>
              </td>
            </tr>
          ))}
          {space.resources.length === 0 && <tr><td colSpan={6} className="empty">Aucune ressource.</td></tr>}
        </tbody>
      </table>

      {draft && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h3>{space.resources.some((r) => r.id === draft.id) ? "Modifier la ressource" : "Nouvelle ressource"}</h3>
          <div className="grid">
            <Field label="Nom"><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Type" hint="salle, coach…">
              <input list="resource-types" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} />
              <datalist id="resource-types"><option value="salle" /><option value="gymnase" /><option value="coach" /></datalist>
            </Field>
            <Field label="Capacité" hint="Laisser vide pour une personne">
              <input
                type="number" min={1} value={draft.capacity ?? ""}
                onChange={(e) => setDraft({ ...draft, capacity: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </Field>
            <Field label="Activités acceptées" hint="Séparées par des virgules ; vide = toutes">
              <input value={draft.activities.join(", ")} onChange={(e) => setDraft({ ...draft, activities: splitList(e.target.value) })} />
            </Field>
          </div>
          <Field label="Groupes compatibles" hint="Une ligne par groupe, activités séparées par des virgules. Ex. : badminton, escalade, ping-pong">
            <textarea
              rows={2}
              value={draft.compatibleGroups.map((g) => g.join(", ")).join("\n")}
              onChange={(e) => setDraft({ ...draft, compatibleGroups: e.target.value.split("\n").map(splitList).filter((g) => g.length > 0) })}
            />
          </Field>

          <h4>Horaires d'ouverture</h4>
          {draft.weekly.map((w, i) => (
            <div className="rule" key={i}>
              <DaysPicker value={w.days} onChange={(days) => setDraft({ ...draft, weekly: draft.weekly.map((x, j) => (j === i ? { ...x, days } : x)) })} />
              <TimeSelect value={w.start} onChange={(start) => setDraft({ ...draft, weekly: draft.weekly.map((x, j) => (j === i ? { ...x, start } : x)) })} />
              <span>à</span>
              <TimeSelect allowEnd value={w.end} onChange={(end) => setDraft({ ...draft, weekly: draft.weekly.map((x, j) => (j === i ? { ...x, end } : x)) })} />
              <select
                aria-label="Rythme"
                value={`${w.everyKWeeks}:${w.weekOffset}`}
                onChange={(e) => {
                  const [k, o] = e.target.value.split(":").map(Number) as [number, number];
                  setDraft({ ...draft, weekly: draft.weekly.map((x, j) => (j === i ? { ...x, everyKWeeks: k, weekOffset: o } : x)) });
                }}
              >
                <option value="1:0">chaque semaine</option>
                <option value="2:0">semaines 1, 3, 5… (une sur deux)</option>
                <option value="2:1">semaines 2, 4, 6… (une sur deux)</option>
              </select>
              <button type="button" onClick={() => setDraft({ ...draft, weekly: draft.weekly.filter((_, j) => j !== i) })}>Retirer</button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft({ ...draft, weekly: [...draft.weekly, { days: [0], start: "18:00", end: "21:00", periodIds: [], everyKWeeks: 1, weekOffset: 0 }] })}>Ajouter une plage</button>

          <h4>Fermetures exceptionnelles</h4>
          <p className="hint">Jours où la ressource est indisponible (élections, travaux…). Les séances de ces jours sont signalées comme annulées dans le calendrier daté.</p>
          {draft.exceptions.map((x, i) => {
            const set = (patch: Partial<typeof x>) => setDraft({ ...draft, exceptions: draft.exceptions.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
            return (
              <div className="rule" key={i}>
                <input type="date" required value={x.date} onChange={(e) => set({ date: e.target.value })} />
                <label className="check">
                  <input type="checkbox" checked={!x.range} onChange={(e) => set({ range: e.target.checked ? undefined : { start: "18:00", end: "22:00" } })} /> toute la journée
                </label>
                {x.range && (
                  <>
                    <TimeSelect value={x.range.start} onChange={(start) => set({ range: { start, end: x.range!.end } })} />
                    <span>à</span>
                    <TimeSelect allowEnd value={x.range.end} onChange={(end) => set({ range: { start: x.range!.start, end } })} />
                  </>
                )}
                <input placeholder="Motif" value={x.reason ?? ""} onChange={(e) => set({ reason: e.target.value || undefined })} />
                <button type="button" onClick={() => setDraft({ ...draft, exceptions: draft.exceptions.filter((_, j) => j !== i) })}>Retirer</button>
              </div>
            );
          })}
          <button type="button" onClick={() => setDraft({ ...draft, exceptions: [...draft.exceptions, { date: "2026-12-25", closed: true }] })}>Ajouter une fermeture</button>

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

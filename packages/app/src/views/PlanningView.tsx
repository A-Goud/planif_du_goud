import { useEffect, useMemo, useRef, useState } from "react";
import {
  UNITS_PER_DAY,
  cycleLength,
  demandsOfPeriod,
  formatTime,
  parseEndTime,
  parseTime,
  projectPeriod,
  weeklyRulesFor,
  type Assignment,
  type BlockedSlot,
  type Demand,
  type Planning,
  type Space,
} from "@planif/core";
import { COMPANION_RECOMMENDED_ABOVE, DEFAULT_COMPANION_URL, detectCompanion, estimateVariables, type CompanionInfo, type DiagnoseResult, type Diagnosis, type Relaxation, type SolveOutcome } from "@planif/solver";
import { startDiagnose, startSolve, type Job, type SolveJob } from "../solveClient.js";
import { useStore } from "../store.js";
import { DAY_LONG, DAY_NAMES, Errors, Field, TimeSelect, formatDuration } from "../ui.js";

const PX = 10; // pixels par quart d'heure

type StabilityChoice = "each" | "ignored" | "preferred" | "imposed";

function occursInWeek(a: Assignment, demand: Demand | undefined, week: number): boolean {
  const k = demand?.everyKWeeks ?? 1;
  return week >= a.cycleWeek && (week - a.cycleWeek) % k === 0;
}

export function PlanningView() {
  const { space, commit } = useStore();
  const periods = [...space.periods].sort((a, b) => a.start.localeCompare(b.start));
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [stepMinutes, setStepMinutes] = useState(30);
  const [timeLimit, setTimeLimit] = useState(60);
  const [stability, setStability] = useState<StabilityChoice>("each");
  const [referenceChoice, setReferenceChoice] = useState("auto");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<SolveOutcome | null>(null);
  const [mode, setMode] = useState<"room" | "person" | "requester">("room");
  const [resourceId, setResourceId] = useState("");
  const [week, setWeek] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const job = useRef<SolveJob | null>(null);
  const diagJob = useRef<Job<DiagnoseResult> | null>(null);
  const [engine, setEngine] = useState<"browser" | "companion">("browser");
  const [companion, setCompanion] = useState<CompanionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const checkCompanion = async () => {
    setChecking(true);
    const info = await detectCompanion(DEFAULT_COMPANION_URL);
    setCompanion(info);
    if (!info) setEngine("browser");
    setChecking(false);
  };
  useEffect(() => { void checkCompanion(); }, []);
  const companionUrl = engine === "companion" && companion ? DEFAULT_COMPANION_URL : undefined;
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnoseResult | null>(null);

  const period = space.periods.find((p) => p.id === periodId) ?? periods[0];
  const planning = space.plannings.find((p) => p.periodId === period?.id);
  const demands = period ? demandsOfPeriod(space, period.id) : [];
  const demandsById = new Map(space.demands.map((d) => [d.id, d]));
  const places = space.resources.filter((r) => r.capacity !== undefined);
  const people = space.resources.filter((r) => r.capacity === undefined);
  const room = places.find((r) => r.id === resourceId) ?? places[0];
  const person = people.find((r) => r.id === resourceId) ?? people[0];
  const cycleWeeks = planning?.cycleWeeks ?? 1;

  const estimated = useMemo(() => (period ? estimateVariables(space, period.id, Math.max(1, stepMinutes / 15)) : 0), [space, period, stepMinutes]);
  const bigProblem = estimated > COMPANION_RECOMMENDED_ABOVE;

  const bilan = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of planning?.assignments ?? []) counts.set(a.demandId, (counts.get(a.demandId) ?? 0) + 1);
    return demands.map((d) => ({ demand: d, placed: counts.get(d.id) ?? 0 }));
  }, [planning, demands]);
  const unsatisfied = bilan.filter((b) => b.placed < b.demand.sessions);

  /** Périodes antérieures qui ont un planning : candidates comme référence de stabilité. */
  const referencePeriods = periods.filter((p) => p.id !== period?.id && space.plannings.some((pl) => pl.periodId === p.id && pl.assignments.length > 0));
  const referencePlanning = (): Planning | undefined => {
    if (referenceChoice === "none" || !period) return undefined;
    if (referenceChoice !== "auto") return space.plannings.find((p) => p.periodId === referenceChoice);
    const before = referencePeriods.filter((p) => p.start < period.start);
    const prev = before[before.length - 1];
    return prev ? space.plannings.find((p) => p.periodId === prev.id) : undefined;
  };

  /** Enregistre un planning modifié à la main (verrouillage, blocage, placement). */
  const savePlanning = (next: Planning): string[] | null => {
    const others = space.plannings.filter((p) => p.periodId !== next.periodId);
    return commit({ ...space, plannings: [...others, next] });
  };
  const basePlanning = (): Planning | null =>
    period ? (planning ?? { periodId: period.id, cycleWeeks: cycleLength(demands), assignments: [], blocked: [] }) : null;
  const setAssignments = (assignments: Assignment[]) => {
    const base = basePlanning();
    if (base) setError(savePlanning({ ...base, assignments })?.join(" ; ") ?? null);
  };

  const diagnose = async () => {
    if (!period) return;
    setError(null);
    setDiagnosing(true);
    const j = startDiagnose(space, {
      periodId: period.id,
      startStep: Math.max(1, stepMinutes / 15),
      reference: referencePlanning(),
      stabilityOverride: stability === "each" ? undefined : stability,
      solverOptions: { timeLimitSec: timeLimit, gap: 0.01 },
      baseline: last && last.planning.periodId === period.id ? last : undefined,
    }, companionUrl);
    diagJob.current = j;
    try {
      setDiagnosis(await j.promise);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiagnosing(false);
      diagJob.current = null;
    }
  };

  /** L'agent accepte une suggestion : la modification est appliquée, le planning est à recalculer. */
  const applySuggestion = (diag: Diagnosis, r: Relaxation) => {
    if (!period) return;
    const next: Space = {
      ...space,
      demands: r.demandPatch ? space.demands.map((d) => (d.id === diag.demandId ? { ...d, ...r.demandPatch } : d)) : space.demands,
      plannings: r.unlockOthers
        ? space.plannings.map((p) =>
            p.periodId === period.id ? { ...p, assignments: p.assignments.map((a) => (a.demandId === diag.demandId ? a : { ...a, locked: false })) } : p,
          )
        : space.plannings,
    };
    const errs = commit(next);
    if (errs) setError(errs.join(" ; "));
    else setDiagnosis(null);
  };

  const run = async (freezeExisting: boolean) => {
    if (!period) return;
    setDiagnosis(null);
    setError(null);
    setRunning(true);
    setSelected(null);
    const j = startSolve(space, {
      periodId: period.id,
      startStep: Math.max(1, stepMinutes / 15),
      reference: referencePlanning(),
      stabilityOverride: stability === "each" ? undefined : stability,
      freezeExisting,
      solverOptions: { timeLimitSec: timeLimit, gap: 0.01 },
    }, companionUrl);
    job.current = j;
    try {
      const outcome = await j.promise;
      setLast(outcome);
      setWeek(0);
      const errs = savePlanning(outcome.planning);
      if (errs) setError(errs.join(" ; "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      job.current = null;
    }
  };

  if (periods.length === 0) return <section><h2>Planning</h2><p className="empty">Ajoutez d'abord une période.</p></section>;

  const chosen = selected !== null ? planning?.assignments[selected] : undefined;
  const chosenDemand = chosen ? demandsById.get(chosen.demandId) : undefined;
  const lockedCount = planning?.assignments.filter((a) => a.locked).length ?? 0;

  return (
    <section>
      <div className="toolbar"><h2>Planning</h2></div>
      <div className="card controls">
        <label className="field">
          <span className="field-label">Période</span>
          <select value={period?.id} onChange={(e) => { setPeriodId(e.target.value); setLast(null); setWeek(0); setSelected(null); }}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Pas des débuts de séance</span>
          <select value={stepMinutes} onChange={(e) => setStepMinutes(Number(e.target.value))}>
            <option value={15}>15 min (plus précis, plus long)</option>
            <option value={30}>30 min</option>
            <option value={60}>1 h (rapide)</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Temps maximum (s)</span>
          <input type="number" min={5} value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Référence de stabilité</span>
          <select value={referenceChoice} onChange={(e) => setReferenceChoice(e.target.value)}>
            <option value="auto">Période précédente</option>
            <option value="none">Aucune</option>
            {referencePeriods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Stabilité</span>
          <select value={stability} onChange={(e) => setStability(e.target.value as StabilityChoice)}>
            <option value="each">Selon chaque demande</option>
            <option value="ignored">Ignorée pour tous</option>
            <option value="preferred">Souhaitée pour tous</option>
            <option value="imposed">Imposée pour tous</option>
          </select>
        </label>
      </div>
      <div className="card controls">
        <label className="field">
          <span className="field-label">Solveur</span>
          <select value={engine} onChange={(e) => setEngine(e.target.value as "browser" | "companion")}>
            <option value="browser">Navigateur (sans installation)</option>
            <option value="companion" disabled={!companion}>
              {companion ? `Compagnon local (HiGHS ${companion.engine === "native" ? "natif" : "WebAssembly"})` : "Compagnon local (non détecté)"}
            </option>
          </select>
        </label>
        <button onClick={() => void checkCompanion()} disabled={checking}>{checking ? "Recherche…" : "Rechercher le compagnon"}</button>
        <button onClick={() => setShowHelp(!showHelp)}>{showHelp ? "Masquer l'aide" : "Qu'est-ce que le compagnon ?"}</button>
        <span className="hint">Taille estimée : environ {estimated.toLocaleString("fr-FR")} variables.</span>
      </div>
      {bigProblem && engine === "browser" && (
        <p className="warning">
          Ce problème est volumineux : le calcul dans le navigateur peut être long, voire manquer de mémoire.{" "}
          {companion ? <button onClick={() => setEngine("companion")}>Utiliser le compagnon</button> : <>Le compagnon local est recommandé. <button onClick={() => setShowHelp(true)}>Comment l'installer</button></>}
        </p>
      )}
      {showHelp && <CompanionHelp onClose={() => setShowHelp(false)} />}
      <div className="toolbar buttons">
        {running ? (
          <button onClick={() => job.current?.cancel()}>Annuler le calcul</button>
        ) : (
          <>
            <button className="primary" onClick={() => void run(false)} disabled={demands.length === 0 || places.length === 0}>Calculer le planning</button>
            <button
              onClick={() => void run(true)}
              disabled={!planning || planning.assignments.length === 0}
              title="Garde toutes les séances déjà placées et ne place que le reste (nouvelle demande, nouvelle salle…)"
            >
              Compléter sans toucher à l'existant
            </button>
          </>
        )}
        {planning && planning.assignments.length > 0 && (
          <span className="lock-actions">
            <button onClick={() => setAssignments(planning.assignments.map((a) => ({ ...a, locked: true })))} disabled={lockedCount === planning.assignments.length}>Tout verrouiller</button>
            <button onClick={() => setAssignments(planning.assignments.map((a) => ({ ...a, locked: false })))} disabled={lockedCount === 0}>Tout déverrouiller</button>
          </span>
        )}
      </div>
      {running && <p className="status" role="status">Calcul en cours… (au plus {timeLimit} s)</p>}
      {error && <p className="errors" role="alert">{error}</p>}
      {last && !running && (
        <p className="status" role="status">
          {last.status === "optimal" && "Planning optimal"}
          {last.status === "feasible" && "Meilleur planning trouvé dans le temps imparti (optimum non prouvé)"}
          {last.status === "infeasible" && "Aucun planning possible : les séances verrouillées sont en contradiction avec les demandes (par exemple plus de séances verrouillées que de séances demandées)"}
          {last.status === "error" && "Le calcul n'a pas abouti"}
          {" "}· {last.stats.variables} variables · {(last.stats.millis / 1000).toFixed(1)} s
        </p>
      )}
      {last?.warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}

      {planning && (
        <>
          <div className="bilan">
            {unsatisfied.length === 0 ? (
              <p className="ok">Toutes les demandes sont satisfaites ({bilan.length}).</p>
            ) : (
              <>
                <p className="warning"><strong>{unsatisfied.length} demande(s) non pleinement satisfaite(s)</strong> sur {bilan.length} :</p>
                <ul>
                  {unsatisfied.map(({ demand, placed }) => {
                    const min = demand.minSessions ?? demand.sessions;
                    return (
                      <li key={demand.id}>
                        <strong>{space.requesters.find((r) => r.id === demand.requesterId)?.name}</strong> — {demand.label} : {placed} séance(s) sur {demand.sessions}
                        {placed < min ? <span className="bad"> (en dessous du minimum de {min})</span> : null}
                      </li>
                    );
                  })}
                </ul>
                <div className="toolbar buttons">
                  {diagnosing ? (
                    <button onClick={() => diagJob.current?.cancel()}>Annuler l'analyse</button>
                  ) : (
                    <button onClick={() => void diagnose()} disabled={running}>Pourquoi ? Analyser et tester des solutions</button>
                  )}
                  {diagnosing && <span className="status" role="status">Analyse en cours… (plusieurs calculs d'essai)</span>}
                </div>
              </>
            )}
            {diagnosis && !diagnosing && <DiagnosisPanel result={diagnosis} onApply={applySuggestion} />}
          </div>
        </>
      )}

      {planning && period && <DatedCalendar space={space} periodId={period.id} />}

      <div className="tabs sub">
        <button className={mode === "room" ? "active" : ""} onClick={() => setMode("room")}>Par salle</button>
        {people.length > 0 && <button className={mode === "person" ? "active" : ""} onClick={() => setMode("person")}>Par coach</button>}
        <button className={mode === "requester" ? "active" : ""} onClick={() => setMode("requester")}>Par demandeur</button>
        {cycleWeeks > 1 && (
          <span className="weeks">
            {Array.from({ length: cycleWeeks }, (_, w) => (
              <button key={w} className={week === w ? "active" : ""} onClick={() => setWeek(w)}>Semaine {w + 1}</button>
            ))}
          </span>
        )}
      </div>

      {mode === "room" ? (
        <>
          <label className="field inline">
            <span className="field-label">Salle</span>
            <select value={room?.id ?? ""} onChange={(e) => { setResourceId(e.target.value); setSelected(null); }}>
              {places.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {room && (
            <Calendar
              space={space} periodId={period?.id ?? ""} resourceId={room.id} assignments={planning?.assignments ?? []} blocked={planning?.blocked ?? []}
              week={week} demandsById={demandsById} selected={selected} onSelect={setSelected}
            />
          )}
          {chosen && chosenDemand && selected !== null && (
            <div className="card selection" role="status">
              <strong>{space.requesters.find((r) => r.id === chosenDemand.requesterId)?.name}</strong> — {chosenDemand.label} ·{" "}
              {DAY_LONG[chosen.day]} {chosen.start}–{formatTime(parseTime(chosen.start) + chosenDemand.durationUnits)}
              {chosen.locked ? " · 🔒 verrouillée" : ""}
              <span className="selection-actions">
                <button onClick={() => setAssignments(planning!.assignments.map((a, i) => (i === selected ? { ...a, locked: !a.locked } : a)))}>
                  {chosen.locked ? "Déverrouiller" : "Verrouiller"}
                </button>
                <button className="danger" onClick={() => { setAssignments(planning!.assignments.filter((_, i) => i !== selected)); setSelected(null); }}>
                  Retirer du planning
                </button>
              </span>
            </div>
          )}
        </>
      ) : mode === "person" ? (
        <>
          <label className="field inline">
            <span className="field-label">Coach</span>
            <select value={person?.id ?? ""} onChange={(e) => { setResourceId(e.target.value); setSelected(null); }}>
              {people.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {person && (
            <Calendar
              space={space} periodId={period?.id ?? ""} resourceId={person.id} assignments={planning?.assignments ?? []} blocked={planning?.blocked ?? []}
              week={week} demandsById={demandsById} selected={selected} onSelect={setSelected}
            />
          )}
          <p className="hint">Les séances où le coach est mobilisé, avec la salle. Une même personne ne peut être qu'à un endroit à la fois.</p>
        </>
      ) : (
        planning && <RequesterList space={space} assignments={planning.assignments} cycleWeeks={cycleWeeks} demandsById={demandsById} />
      )}

      {period && (
        <div className="two-cols">
          <ManualPlacement
            space={space} demands={demands} places={places} planning={planning}
            onAdd={(a) => setAssignments([...(planning?.assignments ?? []), a])}
          />
          <BlockedPanel
            space={space} places={space.resources} planning={planning} cycleWeeks={cycleWeeks}
            onChange={(blocked) => {
              const base = basePlanning();
              if (base) setError(savePlanning({ ...base, blocked })?.join(" ; ") ?? null);
            }}
          />
        </div>
      )}
      {!planning && !running && <p className="empty">Pas encore de planning pour cette période. Lancez le calcul.</p>}
    </section>
  );
}

function hue(space: Space, requesterId: string): number {
  return (space.requesters.findIndex((r) => r.id === requesterId) * 57) % 360;
}

function Calendar({ space, periodId, resourceId, assignments, blocked, week, demandsById, selected, onSelect }: {
  space: Space; periodId: string; resourceId: string; assignments: Assignment[]; blocked: BlockedSlot[]; week: number;
  demandsById: Map<string, Demand>; selected: number | null; onSelect(i: number | null): void;
}) {
  const resource = space.resources.find((r) => r.id === resourceId)!;
  const here = assignments
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => (a.resourceId === resourceId || demandsById.get(a.demandId)?.needsResourceIds.includes(resourceId)) && occursInWeek(a, demandsById.get(a.demandId), week));
  const blocks = blocked.filter((b) => b.resourceId === resourceId && (b.cycleWeek === undefined || b.cycleWeek === week));

  const opens = weeklyRulesFor(resource, periodId).flatMap((w) => w.days.map((d) => ({ d, s: parseTime(w.start), e: parseEndTime(w.end) })));
  const spans = [
    ...opens.map((o) => [o.s, o.e] as const),
    ...blocks.map((b) => [parseTime(b.range.start), parseEndTime(b.range.end)] as const),
    ...here.map(({ a }) => [parseTime(a.start), parseTime(a.start) + (demandsById.get(a.demandId)?.durationUnits ?? 4)] as const),
  ];
  const minU = Math.max(0, Math.floor(Math.min(32, ...spans.map((s) => s[0])) / 4) * 4);
  const maxU = Math.min(UNITS_PER_DAY, Math.ceil(Math.max(88, ...spans.map((s) => s[1])) / 4) * 4);
  const hours = Array.from({ length: (maxU - minU) / 4 + 1 }, (_, i) => minU + i * 4);

  return (
    <div className="calendar" role="table" aria-label={`Planning de ${resource.name}`}>
      <div className="cal-head" />
      {DAY_LONG.map((d) => <div className="cal-head" key={d} role="columnheader">{d}</div>)}
      <div className="cal-hours" style={{ height: (maxU - minU) * PX }}>
        {hours.map((h) => <span key={h} style={{ top: (h - minU) * PX }}>{formatTime(h)}</span>)}
      </div>
      {DAY_NAMES.map((_, day) => (
        <div className="cal-day" key={day} style={{ height: (maxU - minU) * PX }} onClick={() => onSelect(null)}>
          {opens.filter((o) => o.d === day).map((o, i) => (
            <div key={i} className="open" style={{ top: (o.s - minU) * PX, height: (o.e - o.s) * PX }} />
          ))}
          {blocks.filter((b) => b.day === day).map((b, i) => {
            const s = parseTime(b.range.start);
            const e = parseEndTime(b.range.end);
            return (
              <div key={i} className="blocked" style={{ top: (s - minU) * PX, height: (e - s) * PX }} title={`Bloqué${b.reason ? " : " + b.reason : ""}`}>
                <span>Bloqué{b.reason ? ` · ${b.reason}` : ""}</span>
              </div>
            );
          })}
          {here.filter(({ a }) => a.day === day).map(({ a, index }) => {
            const d = demandsById.get(a.demandId);
            const s = parseTime(a.start);
            const dur = d?.durationUnits ?? 4;
            const asso = space.requesters.find((r) => r.id === d?.requesterId)?.name ?? "";
            return (
              <button
                type="button"
                key={index}
                className={`block${selected === index ? " selected" : ""}`}
                style={{ top: (s - minU) * PX, height: dur * PX - 2, background: `hsl(${hue(space, d?.requesterId ?? "")} 60% 78%)` }}
                title={`${asso} — ${d?.label} (${formatTime(s)}–${formatTime(s + dur)})${a.locked ? " — verrouillée" : ""}`}
                onClick={(e) => { e.stopPropagation(); onSelect(selected === index ? null : index); }}
              >
                <strong>{a.locked ? "🔒 " : ""}{asso}</strong>
                <span>{d?.label}</span>
                {a.resourceId !== resourceId && <span>{space.resources.find((r) => r.id === a.resourceId)?.name}</span>}
                <span>{formatTime(s)}–{formatTime(s + dur)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ManualPlacement({ space, demands, places, planning, onAdd }: {
  space: Space; demands: Demand[]; places: Space["resources"]; planning: Planning | undefined; onAdd(a: Assignment): void;
}) {
  const [demandId, setDemandId] = useState("");
  const [resId, setResId] = useState("");
  const [day, setDay] = useState(0);
  const [start, setStart] = useState("18:00");
  const [offset, setOffset] = useState(0);
  const [errors, setErrors] = useState<string[] | null>(null);

  const demand = demands.find((d) => d.id === demandId) ?? demands[0];
  const resource = places.find((r) => r.id === resId) ?? places[0];
  if (!demand || !resource) return <div className="card"><h3>Placer à la main</h3><p className="hint">Ajoutez des demandes et des salles.</p></div>;

  const add = () => {
    const already = planning?.assignments.filter((a) => a.demandId === demand.id).length ?? 0;
    if (already >= demand.sessions) {
      setErrors([`Cette demande a déjà ses ${demand.sessions} séance(s) : retirez-en une du planning d'abord.`]);
      return;
    }
    setErrors(null);
    onAdd({ demandId: demand.id, resourceId: resource.id, day, start, cycleWeek: demand.everyKWeeks > 1 ? offset : 0, locked: true });
  };

  return (
    <div className="card">
      <h3>Placer une séance à la main</h3>
      <p className="hint">La séance est verrouillée : le calcul la respecte. Si elle est impossible (horaires, capacité…), un avertissement s'affiche au prochain calcul.</p>
      <div className="grid">
        <Field label="Demande">
          <select value={demand.id} onChange={(e) => setDemandId(e.target.value)}>
            {demands.map((d) => <option key={d.id} value={d.id}>{space.requesters.find((r) => r.id === d.requesterId)?.name} — {d.label}</option>)}
          </select>
        </Field>
        <Field label="Salle">
          <select value={resource.id} onChange={(e) => setResId(e.target.value)}>
            {places.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Jour">
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAY_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="Début" hint={`Durée : ${formatDuration(demand.durationUnits)}`}><TimeSelect value={start} onChange={setStart} /></Field>
        {demand.everyKWeeks > 1 && (
          <Field label="Semaine du cycle">
            <select value={offset} onChange={(e) => setOffset(Number(e.target.value))}>
              {Array.from({ length: demand.everyKWeeks }, (_, i) => <option key={i} value={i}>Semaine {i + 1}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Errors errors={errors} />
      <button onClick={add}>Placer et verrouiller</button>
    </div>
  );
}

function BlockedPanel({ space, places, planning, cycleWeeks, onChange }: {
  space: Space; places: Space["resources"]; planning: Planning | undefined; cycleWeeks: number; onChange(b: BlockedSlot[]): void;
}) {
  const [resId, setResId] = useState("");
  const [day, setDay] = useState(0);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [cycleWeek, setCycleWeek] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[] | null>(null);

  const resource = places.find((r) => r.id === resId) ?? places[0];
  const blocked = planning?.blocked ?? [];
  if (!resource) return <div className="card"><h3>Bloquer un créneau</h3><p className="hint">Ajoutez des salles.</p></div>;

  const add = () => {
    if (parseEndTime(end) <= parseTime(start)) {
      setErrors(["La fin doit suivre le début."]);
      return;
    }
    setErrors(null);
    onChange([
      ...blocked,
      { resourceId: resource.id, day, range: { start, end }, cycleWeek: cycleWeek === "" ? undefined : cycleWeek, reason: reason.trim() || undefined },
    ]);
    setReason("");
  };

  return (
    <div className="card">
      <h3>Bloquer un créneau</h3>
      <p className="hint">Rien ne pourra être placé sur un créneau bloqué (entretien, événement…).</p>
      <div className="grid">
        <Field label="Salle">
          <select value={resource.id} onChange={(e) => setResId(e.target.value)}>
            {places.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Jour">
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAY_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="De"><TimeSelect value={start} onChange={setStart} /></Field>
        <Field label="À"><TimeSelect allowEnd value={end} onChange={setEnd} /></Field>
        {cycleWeeks > 1 && (
          <Field label="Semaine">
            <select value={cycleWeek} onChange={(e) => setCycleWeek(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">Toutes</option>
              {Array.from({ length: cycleWeeks }, (_, i) => <option key={i} value={i}>Semaine {i + 1}</option>)}
            </select>
          </Field>
        )}
        <Field label="Motif"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="facultatif" /></Field>
      </div>
      <Errors errors={errors} />
      <button onClick={add}>Bloquer</button>
      {blocked.length > 0 && (
        <ul className="blocked-list">
          {blocked.map((b, i) => (
            <li key={i}>
              {space.resources.find((r) => r.id === b.resourceId)?.name} · {DAY_LONG[b.day]} {b.range.start}–{b.range.end}
              {b.cycleWeek !== undefined ? ` · semaine ${b.cycleWeek + 1}` : ""}{b.reason ? ` · ${b.reason}` : ""}
              <button className="danger" onClick={() => onChange(blocked.filter((_, j) => j !== i))}>Retirer</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequesterList({ space, assignments, cycleWeeks, demandsById }: {
  space: Space; assignments: Assignment[]; cycleWeeks: number; demandsById: Map<string, Demand>;
}) {
  const roomName = (id: string) => space.resources.find((r) => r.id === id)?.name ?? "?";
  return (
    <div>
      {space.requesters.map((q) => {
        const rows = assignments
          .filter((a) => demandsById.get(a.demandId)?.requesterId === q.id)
          .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
        if (rows.length === 0) return null;
        return (
          <div className="card" key={q.id}>
            <h3 style={{ color: `hsl(${hue(space, q.id)} 55% 40%)` }}>{q.name}</h3>
            <table>
              <thead><tr><th>Demande</th><th>Jour</th><th>Horaire</th><th>Salle</th><th>Fréquence</th></tr></thead>
              <tbody>
                {rows.map((a, i) => {
                  const d = demandsById.get(a.demandId);
                  const dur = d?.durationUnits ?? 4;
                  const k = d?.everyKWeeks ?? 1;
                  return (
                    <tr key={i}>
                      <td>{a.locked ? "🔒 " : ""}{d?.label}</td>
                      <td>{DAY_LONG[a.day]}</td>
                      <td>{a.start}–{formatTime(parseTime(a.start) + dur)} <span className="hint">({formatDuration(dur)})</span></td>
                      <td>{roomName(a.resourceId)}</td>
                      <td>{k === 1 ? "chaque semaine" : cycleWeeks > 1 ? `semaine ${a.cycleWeek + 1} sur ${k}` : `1 semaine sur ${k}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function DiagnosisPanel({ result, onApply }: { result: DiagnoseResult; onApply: (d: Diagnosis, r: Relaxation) => void }) {
  if (result.diagnoses.length === 0) return <p className="ok">Rien à analyser : toutes les demandes sont satisfaites.</p>;
  return (
    <div className="card diagnosis">
      <h3>Analyse des demandes non satisfaites</h3>
      <p className="hint">Chaque piste a été testée par un vrai calcul. Rien n'est appliqué sans votre accord ; après avoir appliqué une piste, relancez le calcul.</p>
      {result.diagnoses.map((d) => (
        <div key={d.demandId} className="diag">
          <h4>{d.label} : {d.placed} séance(s) sur {d.wanted}</h4>
          <ul>{d.causes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          {d.suggestions.length === 0 ? (
            <p className="hint">Aucune des modifications testées (durée plus courte, autre salle, partage, déverrouillage) ne débloque cette demande.</p>
          ) : (
            <ul className="suggestions">
              {d.suggestions.map((r, i) => {
                const lost = r.collateral.reduce((n, c) => n + c.lost, 0);
                return (
                  <li key={i}>
                    <span>
                      <strong>{r.description}</strong> → {r.placedAfter} séance(s) sur {d.wanted}
                      {lost === 0 ? <span className="ok"> · sans conséquence pour les autres</span> : (
                        <span className="bad"> · mais {lost} séance(s) perdue(s) : {r.collateral.map((c) => `${c.label} (−${c.lost})`).join(", ")}</span>
                      )}
                    </span>
                    <button onClick={() => onApply(d, r)}>Appliquer</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {result.skipped.length > 0 && <p className="hint">{result.skipped.length} autre(s) demande(s) non analysée(s) (limite de 6 par analyse).</p>}
    </div>
  );
}

/** Séances projetées sur les dates réelles de la période, avec celles qui sont annulées. */
function DatedCalendar({ space, periodId }: { space: Space; periodId: string }) {
  const sessions = useMemo(() => projectPeriod(space, periodId), [space, periodId]);
  if (sessions.length === 0) return null;
  const demands = new Map(space.demands.map((d) => [d.id, d]));
  const requesters = new Map(space.requesters.map((r) => [r.id, r.name]));
  const resources = new Map(space.resources.map((r) => [r.id, r.name]));
  const cancelled = sessions.filter((s) => s.cancelled);
  const row = (s: (typeof sessions)[number]) => {
    const d = demands.get(s.demandId);
    return [s.date, DAY_LONG[(new Date(`${s.date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? "", s.start, s.end, resources.get(s.resourceId) ?? "", requesters.get(d?.requesterId ?? "") ?? "", d?.label ?? "", s.cancelled ?? ""];
  };
  const download = () => {
    const head = ["Date", "Jour", "Début", "Fin", "Salle", "Demandeur", "Demande", "Annulée"];
    const csv = [head, ...sessions.map(row)].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "calendrier.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <details>
      <summary>Calendrier daté ({sessions.length} séances{cancelled.length ? `, dont ${cancelled.length} annulée(s)` : ""})</summary>
      <div className="toolbar buttons"><button onClick={download}>Télécharger en CSV</button></div>
      <table>
        <thead><tr><th>Date</th><th>Horaire</th><th>Salle</th><th>Demandeur</th><th>Demande</th><th /></tr></thead>
        <tbody>
          {sessions.map((s, i) => {
            const [date, day, start, end, room, who, what, why] = row(s);
            return (
              <tr key={i} className={why ? "cancelled" : ""}>
                <td>{day} {date}</td><td>{start}–{end}</td><td>{room}</td><td>{who}</td><td>{what}</td>
                <td>{why ? <span className="bad">Annulée : {why}</span> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

/** Explique le compagnon et génère le lanceur (le site autorisé y est inscrit). */
function CompanionHelp({ onClose }: { onClose(): void }) {
  const origin = window.location.origin;
  const download = () => {
    const script = `@echo off\r\ncd /d "%~dp0"\r\nnode companion.mjs --origin ${origin}\r\npause\r\n`;
    const url = URL.createObjectURL(new Blob([script], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lancer-le-compagnon.cmd";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="card">
      <h3>Le compagnon local</h3>
      <p>
        Petit programme qui calcule à la place du navigateur, sur votre ordinateur : plus de mémoire, pas de blocage de la page, et un moteur natif si
        HiGHS est installé. Vos données ne quittent pas la machine : le compagnon n'écoute que cet ordinateur et n'accepte que ce site ({origin}).
      </p>
      <h4>Sous Windows : un seul fichier</h4>
      <ol>
        <li><a href="compagnon.exe" download>Téléchargez compagnon.exe</a> (environ 95 Mo, rien d'autre à installer).</li>
        <li>Double-cliquez dessus et <strong>laissez la fenêtre ouverte</strong> pendant les calculs.</li>
        <li>Revenez ici et cliquez sur « Rechercher le compagnon ».</li>
      </ol>
      <p className="hint">
        Au premier lancement, Windows affiche « Windows a protégé votre PC » : le programme n'est pas signé. Cliquez sur « Informations complémentaires »,
        puis « Exécuter quand même ». Le navigateur peut aussi demander l'autorisation d'accéder à un programme de votre réseau local : acceptez.
      </p>
      <details>
        <summary>Autres systèmes (macOS, Linux) ou si vous préférez Node.js</summary>
        <ol>
          <li>Installez <strong>Node.js</strong> (version 20 ou plus récente).</li>
          <li><a href="compagnon.zip" download>Téléchargez l'archive du compagnon</a> et décompressez-la : elle donne un dossier « compagnon ».</li>
          <li>Dans ce dossier, lancez : <code>node companion.mjs --origin {origin}</code> (sous Windows, le lanceur ci-dessous le fait pour vous).</li>
        </ol>
        <button onClick={download}>Télécharger le lanceur Windows (.cmd)</button>
      </details>
      <div className="form-actions">
        <button onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}

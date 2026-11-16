import { afterEach, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spaceSchema } from "@planif/core";
import { HighsWasmSolver, MilpModel, RemoteSolver, detectCompanion, solvePeriod } from "@planif/solver";
import { createCompanion, type Engine } from "../src/server.js";
import { parseHighsSolution } from "../src/native.js";

const ORIGIN = "https://planification.example.org";
const inProcess: Engine = { name: "wasm", solve: (m, o) => new HighsWasmSolver().solve(m, o) };

let server: Server | undefined;
async function start(engine: Engine = inProcess): Promise<string> {
  server = createCompanion({ engine, origins: [ORIGIN] });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

function raw(url: string, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

const tinySpace = () =>
  spaceSchema.parse({
    id: "s", name: "T",
    requesters: [{ id: "a", name: "A" }],
    periods: [{ id: "p", name: "P", start: "2026-09-01", end: "2026-10-16" }],
    resources: [{ id: "r1", name: "r1", type: "salle", capacity: 30, weekly: [{ days: [0, 1], start: "17:00", end: "21:00" }] }],
    demands: [
      { id: "d1", requesterId: "a", label: "d1", durationUnits: 8, sessions: 2, priority: 5 },
      { id: "d2", requesterId: "a", label: "d2", durationUnits: 8, sessions: 2, priority: 1 },
      { id: "d3", requesterId: "a", label: "d3", durationUnits: 8, sessions: 1, priority: 3 },
    ],
    plannings: [],
  });

describe("compagnon", () => {
  it("se présente à la page autorisée", async () => {
    const url = await start();
    const r = await raw(url, { path: "/health", headers: { origin: ORIGIN } });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(JSON.parse(r.body)).toMatchObject({ name: "planif-companion", protocol: 1, engine: "wasm" });
  });

  it("refuse une autre origine, un autre nom d'hôte, et répond au contrôle préalable du navigateur", async () => {
    const url = await start();
    expect((await raw(url, { path: "/health", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await raw(url, { path: "/health", headers: { host: "evil.example" } })).status).toBe(403);
    const pre = await raw(url, { method: "OPTIONS", path: "/solve", headers: { origin: ORIGIN, "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-private-network"]).toBe("true");
    expect(pre.headers["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("calcule comme le solveur local", async () => {
    const url = await start();
    expect(await detectCompanion(url)).toMatchObject({ engine: "wasm" });
    const space = tinySpace();
    const options = { periodId: "p", startStep: 4, solverOptions: { timeLimitSec: 30 } };
    const local = await solvePeriod(space, options);
    const remote = await solvePeriod(space, { ...options, solver: new RemoteSolver(url) });
    expect(remote.status).toBe(local.status);
    expect(remote.planning.assignments).toEqual(local.planning.assignments);
    expect(remote.unsatisfied.map((o) => o.demandId)).toEqual(local.unsatisfied.map((o) => o.demandId));
  });

  it("détecte l'absence de compagnon", async () => {
    expect(await detectCompanion("http://127.0.0.1:1", 500)).toBeNull();
  });

  it("arrête le calcul quand le navigateur annule, et refuse un second calcul simultané", async () => {
    let aborted = false;
    let started!: () => void;
    const hasStarted = new Promise<void>((r) => (started = r));
    const slow: Engine = {
      name: "wasm",
      solve: (_m, _o, signal) =>
        new Promise((_res, rej) => {
          started();
          signal.addEventListener("abort", () => {
            aborted = true;
            rej(new Error("annulé"));
          });
        }),
    };
    const url = await start(slow);
    const model = new MilpModel();
    model.addBinary();
    const body = JSON.stringify({ protocol: 1, model: model.toData(), options: {} });
    const controller = new AbortController();
    const first = fetch(`${url}/solve`, { method: "POST", body, signal: controller.signal, headers: { "content-type": "application/json" } }).catch(() => null);
    await hasStarted;
    expect((await raw(url, { method: "POST", path: "/solve", body })).status).toBe(429);
    controller.abort();
    await first;
    await new Promise((r) => setTimeout(r, 100));
    expect(aborted).toBe(true);
  });

  it("refuse une requête mal formée", async () => {
    const url = await start();
    expect((await raw(url, { method: "POST", path: "/solve", body: "pas du json" })).status).toBe(400);
    expect((await raw(url, { method: "POST", path: "/solve", body: JSON.stringify({ protocol: 99 }) })).status).toBe(400);
  });
});

describe("HiGHS natif : lecture de la solution", () => {
  it("lit les colonnes et le statut", () => {
    const text = ["Model status", "Optimal", "", "# Primal solution values", "Feasible", "Objective 5200", "# Columns 3", "v0 1", "v1 0", "v2 0.5", "# Rows 1", "r0 1", ""].join("\n");
    expect(parseHighsSolution(text, 3)).toEqual({ status: "optimal", timeLimitReached: false, objective: 5200, values: [1, 0, 0.5] });
  });
  it("reconnaît le temps limite et l'infaisabilité", () => {
    const limit = ["Model status", "Time limit reached", "# Primal solution values", "Feasible", "Objective 10", "# Columns 1", "v0 1", "# Rows 0"].join("\n");
    expect(parseHighsSolution(limit, 1)).toMatchObject({ status: "feasible", timeLimitReached: true });
    expect(parseHighsSolution("Model status\nInfeasible\n", 1).status).toBe("infeasible");
    expect(parseHighsSolution("", 1).status).toBe("error");
  });
});

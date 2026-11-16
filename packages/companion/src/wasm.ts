import { Worker } from "node:worker_threads";
import type { MilpModel, MilpSolution, SolverOptions } from "@planif/solver";
import type { Engine } from "./server.js";

/**
 * HiGHS WebAssembly exécuté dans un thread du compagnon (hors du navigateur : pas de limite de mémoire d'onglet,
 * et l'arrêt du thread interrompt le calcul).
 */
export function wasmWorkerEngine(workerUrl: URL): Engine {
  return {
    name: "wasm",
    solve(model: MilpModel, options: SolverOptions, signal: AbortSignal): Promise<MilpSolution> {
      return new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl, { workerData: { model: model.toData(), options } });
        const onAbort = () => {
          void worker.terminate();
          reject(new Error("Calcul annulé."));
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
        worker.once("message", (m: { ok: true; solution: MilpSolution } | { ok: false; error: string }) => {
          signal.removeEventListener("abort", onAbort);
          void worker.terminate();
          if (m.ok) resolve(m.solution);
          else reject(new Error(m.error));
        });
        worker.once("error", (e) => {
          signal.removeEventListener("abort", onAbort);
          reject(e);
        });
      });
    },
  };
}

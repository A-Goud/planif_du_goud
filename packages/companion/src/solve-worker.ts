import { parentPort, workerData } from "node:worker_threads";
import { HighsWasmSolver, MilpModel, type MilpModelData, type SolverOptions } from "@planif/solver";

const { model, options } = workerData as { model: MilpModelData; options: SolverOptions };
new HighsWasmSolver()
  .solve(MilpModel.fromData(model), options)
  .then((solution) => parentPort?.postMessage({ ok: true, solution }))
  .catch((e: unknown) => parentPort?.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) }));

import { createCompanion } from "./server.js";
import { findNativeHighs, nativeEngine } from "./native.js";
import { wasmWorkerEngine } from "./wasm.js";

const HELP = `La planif d'Alix — compagnon de calcul

Usage : node companion.mjs --origin <adresse du site> [options]

  --origin <url>   Adresse du site autorisé (ex. https://planification.potodugoud.fr). Répétable. Obligatoire.
  --dev            Autorise aussi http://localhost:5173 (développement).
  --port <n>       Port local (défaut 47821).
  --highs <chemin> Exécutable HiGHS natif à utiliser (sinon « highs » du PATH, sinon HiGHS WebAssembly).
  --wasm           Force HiGHS WebAssembly même si un exécutable natif est trouvé.
`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));

if (flag("--help") || flag("-h")) {
  console.log(HELP);
  process.exit(0);
}

const origins = values("--origin");
if (flag("--dev")) origins.push("http://localhost:5173", "http://127.0.0.1:5173");
if (origins.length === 0) {
  console.error("Il faut indiquer au moins un site autorisé avec --origin.\n\n" + HELP);
  process.exit(1);
}

const port = Number(values("--port")[0] ?? 47821);
const native = flag("--wasm") ? null : findNativeHighs(values("--highs")[0]);
const engine = native ? nativeEngine(native) : wasmWorkerEngine(new URL("./solve-worker.mjs", import.meta.url));

createCompanion({ engine, origins })
  // Écoute réservée à cette machine : jamais accessible depuis le réseau.
  .listen(port, "127.0.0.1", () => {
    console.log(`Compagnon prêt sur http://127.0.0.1:${port}`);
    console.log(`Moteur : ${native ? `HiGHS natif (${native})` : "HiGHS WebAssembly (aucun exécutable natif trouvé)"}`);
    console.log(`Sites autorisés : ${origins.join(", ")}`);
    console.log("Laissez cette fenêtre ouverte pendant le calcul. Ctrl+C pour arrêter.");
  })
  .on("error", (e: NodeJS.ErrnoException) => {
    console.error(e.code === "EADDRINUSE" ? `Le port ${port} est déjà utilisé (un compagnon tourne-t-il déjà ?).` : e.message);
    process.exit(1);
  });

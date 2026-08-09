// Build de producción del API: transpila src/ a CJS en dist/ con esbuild.
//
// ¿Por qué esbuild y no tsc? El tsconfig raíz hereda de expo/tsconfig.base
// (moduleResolution bundler, noEmit), y con NodeNext los tipos CJS de
// stripe@22 se rompen. tsx —lo que corría en producción hasta ahora— usa
// esbuild por dentro, así que este build produce exactamente el mismo código,
// pero precompilado: arranque más rápido y sin depender de tsx en Railway.
// El typecheck lo hace `tsc --noEmit` (script build) con la config del editor.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import path from "node:path";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    if (p.endsWith(".ts") && !p.endsWith(".test.ts")) return [p];
    return [];
  });
}

await build({
  entryPoints: walk("src"),
  outdir: "dist",
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
});

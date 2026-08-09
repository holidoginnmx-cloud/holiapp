// Postinstall del monorepo. Los parches (react-native, expo-router) son de la
// app móvil; en el deploy del API a Railway `apps/mobile` ni siquiera está en
// el contexto (.railwayignore), así que ahí no hay nada que parchar. Cuando SÍ
// corre (local, EAS), un parche que no aplica debe TRONAR el install: el de
// react-native evita el crash de hermesc y perderlo en silencio regresa el bug.
// Vive en la raíz (no en scripts/) porque .railwayignore excluye scripts/.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync(new URL("./apps/mobile", import.meta.url))) {
  console.log("[postinstall] sin apps/mobile (deploy del API): parches omitidos");
  process.exit(0);
}

const r = spawnSync("npx", ["patch-package"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);

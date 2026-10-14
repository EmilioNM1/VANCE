import { startWorker } from "@/server/jobs/runner";
import { warnIfRlsBypassed } from "@/db/safety";

console.log("[worker] VANCE worker iniciado");
if (!process.env.ANTHROPIC_API_KEY) console.warn("[worker] ANTHROPIC_API_KEY no configurada: el análisis con IA quedará pendiente.");
void warnIfRlsBypassed();
const stop = startWorker();
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    stop();
    console.log("[worker] detenido");
    process.exit(0);
  });

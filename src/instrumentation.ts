export async function register() {
  // La comprobación directa de NEXT_RUNTIME permite a Next excluir este código del runtime edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warnIfRlsBypassed } = await import("./db/safety");
    await warnIfRlsBypassed();
    if (process.env.RUN_WORKER_IN_WEB === "true") {
      const { startWorker } = await import("./server/jobs/runner");
      startWorker();
      console.log("[worker] ejecutándose dentro del servidor web (RUN_WORKER_IN_WEB=true)");
    }
  }
}

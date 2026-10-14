export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_WORKER_IN_WEB === "true") {
    const { startWorker } = await import("./server/jobs/runner");
    startWorker();
    console.log("[worker] ejecutándose dentro del servidor web (RUN_WORKER_IN_WEB=true)");
  }
}

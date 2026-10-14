import { claimNextJob, onJobEnqueued, runJob } from "./queue";
import { registerAllHandlers } from "./handlers";

/**
 * Bucle de trabajo en segundo plano. Se ejecuta en `npm run worker` o, si
 * RUN_WORKER_IN_WEB=true, dentro del propio servidor Next (cómodo en desarrollo).
 */
export function startWorker(opts: { concurrency?: number; pollMs?: number } = {}) {
  registerAllHandlers();
  const concurrency = opts.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 2);
  const pollMs = opts.pollMs ?? 2000;
  let active = 0;
  let stopped = false;

  const tick = async () => {
    while (!stopped && active < concurrency) {
      const job = await claimNextJob().catch((e) => {
        console.error("[worker] error al obtener trabajo", e);
        return null;
      });
      if (!job) return;
      active++;
      console.log(`[worker] ${job.type} ${job.id} (intento ${job.attempts})`);
      runJob(job)
        .then((r) => console.log(`[worker] ${job.type} ${job.id} → ${r}`))
        .finally(() => {
          active--;
          void tick();
        });
    }
  };
  onJobEnqueued(() => void tick());
  const interval = setInterval(() => void tick(), pollMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

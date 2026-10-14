import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs, type JobType } from "@/db/schema";
import { AiUnavailableError } from "../ai/errors";

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (job: JobRow) => Promise<void>;

const handlers = new Map<JobType, JobHandler>();

export function registerJobHandler(type: JobType, fn: JobHandler) {
  handlers.set(type, fn);
}

/** Error que no merece reintento (p. ej. archivo dañado). */
export class PermanentJobError extends Error {}

let kick: (() => void) | null = null;
export function onJobEnqueued(fn: () => void) {
  kick = fn;
}

export async function enqueueJob(type: JobType, payload: Record<string, unknown>, userId: string | null, opts?: { runAt?: Date; maxAttempts?: number }) {
  const [row] = await getDb()
    .insert(jobs)
    .values({ type, payload, userId, runAt: opts?.runAt ?? new Date(), maxAttempts: opts?.maxAttempts ?? 4 })
    .returning();
  kick?.();
  return row!;
}

/** Toma el siguiente trabajo disponible de forma atómica (SKIP LOCKED permite varios workers). */
export async function claimNextJob(): Promise<JobRow | null> {
  const db = getDb();
  // Recupera trabajos bloqueados por un worker caído
  await db
    .update(jobs)
    .set({ status: "QUEUED", lockedAt: null })
    .where(and(eq(jobs.status, "RUNNING"), lt(jobs.lockedAt, new Date(Date.now() - 30 * 60_000))));
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'RUNNING', locked_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'QUEUED' AND run_at <= now()
      ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING id`);
  const id = (res.rows[0] as { id: string } | undefined)?.id;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

export async function runJob(job: JobRow): Promise<"DONE" | "RETRY" | "FAILED"> {
  const db = getDb();
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new PermanentJobError(`Sin manejador para ${job.type}`);
    await handler(job);
    await db.update(jobs).set({ status: "DONE", finishedAt: new Date(), lastError: null }).where(eq(jobs.id, job.id));
    return "DONE";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const retryable = !(e instanceof PermanentJobError) && !(e instanceof AiUnavailableError && !e.retryable);
    if (retryable && job.attempts < job.maxAttempts) {
      const delay = Math.min(30 * 60_000, 2 ** job.attempts * 15_000);
      await db
        .update(jobs)
        .set({ status: "QUEUED", lockedAt: null, lastError: msg, runAt: new Date(Date.now() + delay) })
        .where(eq(jobs.id, job.id));
      return "RETRY";
    }
    await db.update(jobs).set({ status: "FAILED", lastError: msg, finishedAt: new Date() }).where(eq(jobs.id, job.id));
    return "FAILED";
  }
}

/** Procesa trabajos hasta vaciar la cola (útil en pruebas). */
export async function drainJobs(max = 50) {
  for (let i = 0; i < max; i++) {
    const job = await claimNextJob();
    if (!job) return;
    await runJob(job);
  }
}

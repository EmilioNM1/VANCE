import { and, eq, gte, sql } from "drizzle-orm";
import { withUser } from "@/db/client";
import { aiCache, aiUsage } from "@/db/schema";
import { createHash } from "node:crypto";
import { AnthropicProvider } from "./anthropic";
import { AiBudgetExceededError, AiNotConfiguredError, AiOutputError } from "./errors";
import type { AiProvider, StructuredRequest, StructuredResponse } from "./provider";

let override: AiProvider | null | undefined;

/** Solo pruebas: inyecta un proveedor (o null para simular "sin IA"). */
export function setAiProviderForTests(p: AiProvider | null | undefined) {
  override = p;
}

export function getAiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new AnthropicProvider(key, process.env.AI_MODEL || "claude-opus-5-5");
}

export function aiConfigured() {
  return getAiProvider() !== null;
}

/** Registro de consumo de servicios externos que no pasan por aiStructured (p. ej. Gemini). */
export async function recordUsage(userId: string, operation: string, model: string, inputTokens: number, outputTokens: number) {
  await withUser(userId, (tx) => tx.insert(aiUsage).values({ userId, operation, model, inputTokens, outputTokens }));
}

export async function assertBudget(userId: string) {
  const budget = Number(process.env.AI_DAILY_TOKEN_BUDGET_PER_USER ?? 0);
  if (budget > 0 && (await tokensUsedToday(userId)) >= budget) throw new AiBudgetExceededError();
}

export async function tokensUsedToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ total: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int` })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since))),
  );
  return row?.total ?? 0;
}

/** Punto único de llamada a la IA: comprueba configuración, presupuesto y registra el consumo. */
export async function aiStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
  const provider = getAiProvider();
  if (!provider) throw new AiNotConfiguredError();
  const cacheKey =
    req.cache && !req.webSearch
      ? createHash("sha256")
          .update(JSON.stringify([provider.name, process.env.AI_MODEL ?? "", req.operation, req.system, req.content.map((c) => (c.type === "text" ? c.text : `${c.type}:${createHash("sha256").update(c.base64).digest("hex")}`))]))
          .digest("hex")
      : null;
  if (cacheKey) {
    const hit = await withUser(req.userId, async (tx) => {
      const [row] = await tx.select().from(aiCache).where(and(eq(aiCache.userId, req.userId), eq(aiCache.key, cacheKey)));
      if (!row) return null;
      const parsed = req.schema.safeParse(row.output);
      if (!parsed.success) return null;
      await tx.update(aiCache).set({ hits: row.hits + 1 }).where(and(eq(aiCache.userId, req.userId), eq(aiCache.key, cacheKey)));
      await tx.insert(aiUsage).values({ userId: req.userId, operation: `${req.operation}:cache`, model: "cache", inputTokens: 0, outputTokens: 0 });
      return parsed.data;
    });
    if (hit !== null) return { data: hit, webResults: [], usage: { inputTokens: 0, outputTokens: 0 }, model: "cache" };
  }
  const budget = Number(process.env.AI_DAILY_TOKEN_BUDGET_PER_USER ?? 0);
  if (budget > 0 && (await tokensUsedToday(req.userId)) >= budget) throw new AiBudgetExceededError();
  let res: StructuredResponse<T>;
  try {
    res = await provider.structured(req);
  } catch (e) {
    // Una salida mal formada (p. ej. un valor fuera de la lista permitida) se reintenta una vez
    if (!(e instanceof AiOutputError) || /declinó/.test(e.message)) throw e;
    res = await provider.structured(req);
  }
  if (cacheKey)
    await withUser(req.userId, (tx) =>
      tx.insert(aiCache).values({ userId: req.userId, key: cacheKey, operation: req.operation, output: res.data as object }).onConflictDoNothing(),
    );
  await withUser(req.userId, (tx) =>
    tx.insert(aiUsage).values({
      userId: req.userId,
      operation: req.operation,
      model: res.model,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
    }),
  );
  return res;
}

export * from "./errors";
export type { AiProvider, StructuredRequest, StructuredResponse } from "./provider";

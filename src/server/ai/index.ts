import { and, eq, gte, sql } from "drizzle-orm";
import { withUser } from "@/db/client";
import { aiUsage } from "@/db/schema";
import { AnthropicProvider } from "./anthropic";
import { AiBudgetExceededError, AiNotConfiguredError } from "./errors";
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
  const budget = Number(process.env.AI_DAILY_TOKEN_BUDGET_PER_USER ?? 0);
  if (budget > 0 && (await tokensUsedToday(req.userId)) >= budget) throw new AiBudgetExceededError();
  const res = await provider.structured(req);
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

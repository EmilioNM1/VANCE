/**
 * Proveedor de IA SIMULADO — exclusivamente para pruebas automáticas.
 * Devuelve respuestas predefinidas por operación para poder probar la lógica que rodea
 * a la IA (validación de fuentes, rúbricas, puntuación, etc.) sin llamadas externas.
 */
import type { AiProvider, StructuredRequest, StructuredResponse, WebResult } from "@/server/ai/provider";
import { AiUnavailableError } from "@/server/ai/errors";

type Handler = (req: StructuredRequest<unknown>) => { data: unknown; webResults?: WebResult[] } | Promise<{ data: unknown; webResults?: WebResult[] }>;

export class FakeAi implements AiProvider {
  readonly name = "fake";
  calls: { operation: string; text: string }[] = [];
  down = false;
  constructor(public handlers: Record<string, Handler> = {}) {}
  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const text = req.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
    this.calls.push({ operation: req.operation, text });
    if (this.down) throw new AiUnavailableError("simulada: IA caída");
    const h = this.handlers[req.operation];
    if (!h) throw new Error(`FakeAi: sin manejador para ${req.operation}`);
    const out = await h(req as StructuredRequest<unknown>);
    return { data: req.schema.parse(out.data), webResults: out.webResults ?? [], usage: { inputTokens: 10, outputTokens: 10 }, model: "fake" };
  }
}

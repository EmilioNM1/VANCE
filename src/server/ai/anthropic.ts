import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AiOutputError, AiUnavailableError } from "./errors";
import type { AiContentPart, AiProvider, StructuredRequest, StructuredResponse, WebResult } from "./provider";

type BetaContent = Anthropic.Beta.Messages.BetaContentBlockParam;

function toBlocks(parts: AiContentPart[]): BetaContent[] {
  return parts.map((p): BetaContent => {
    if (p.type === "text") return { type: "text", text: p.text };
    if (p.type === "pdf")
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 } };
    return { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } };
  });
}

/**
 * Proveedor real: Claude (Anthropic) con salidas estructuradas validadas por Zod.
 * - Usa `fallbacks: "default"` (beta) para que una negativa del clasificador de seguridad
 *   se reintente en el modelo de respaldo recomendado en lugar de fallar.
 * - La búsqueda web es la herramienta de servidor de Anthropic: las URLs que devuelve
 *   se recogen para validar después que la IA no cite fuentes inventadas.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60_000 });
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const tools: Anthropic.Beta.Messages.BetaToolUnion[] = req.webSearch
      ? [{ type: "web_search_20260209", name: "web_search", max_uses: req.webSearch.maxUses }]
      : [];
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: toBlocks(req.content) }];
    const webResults: WebResult[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for (let turn = 0; turn < 4; turn++) {
      let msg: Anthropic.Beta.Messages.BetaMessage;
      try {
        msg = await this.client.beta.messages
          .stream({
            model: this.model,
            max_tokens: req.maxTokens ?? 32000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: req.system,
            messages,
            tools: tools.length ? tools : undefined,
            output_config: {
              effort: req.effort ?? "medium",
              format: betaZodOutputFormat(req.schema as z.ZodType),
            },
          })
          .finalMessage();
      } catch (e) {
        throw mapError(e);
      }
      inputTokens += msg.usage.input_tokens;
      outputTokens += msg.usage.output_tokens;
      for (const block of msg.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result") webResults.push({ url: r.url, title: r.title });
        }
      }
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content as BetaContent[] });
        continue;
      }
      if (msg.stop_reason === "refusal") throw new AiOutputError("El modelo declinó procesar este contenido.");
      if (msg.stop_reason === "max_tokens") throw new AiOutputError("La respuesta de la IA se truncó (max_tokens).");
      const lastToolIdx = msg.content.map((b) => b.type).lastIndexOf("web_search_tool_result");
      const text = msg.content
        .slice(lastToolIdx + 1)
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new AiOutputError("La IA devolvió una respuesta que no es JSON válido.");
      }
      const parsed = req.schema.safeParse(raw);
      if (!parsed.success) throw new AiOutputError(`Salida de IA con formato inesperado: ${parsed.error.issues[0]?.message}`);
      return { data: parsed.data, webResults, usage: { inputTokens, outputTokens }, model: msg.model };
    }
    throw new AiOutputError("La IA no terminó la tarea tras varios turnos.");
  }
}

function mapError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new AiUnavailableError("La clave de la API de IA no es válida o no tiene permisos.", false);
  if (e instanceof Anthropic.RateLimitError) return new AiUnavailableError("La IA está saturada (límite de peticiones). Se reintentará.");
  if (e instanceof Anthropic.InternalServerError) return new AiUnavailableError("El proveedor de IA tiene un error temporal.");
  if (e instanceof Anthropic.APIConnectionError) return new AiUnavailableError("No se pudo conectar con el proveedor de IA.");
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return new AiUnavailableError();
  return e instanceof Error ? e : new Error(String(e));
}

import type { z } from "zod";

export interface WebResult {
  url: string;
  title: string;
}

export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "pdf"; base64: string }
  | { type: "image"; base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" };

export interface StructuredRequest<T> {
  /** Nombre lógico de la operación (para registro de costes y para las pruebas). */
  operation: string;
  userId: string;
  system: string;
  content: AiContentPart[];
  schema: z.ZodType<T>;
  effort?: "low" | "medium" | "high";
  /** Permite a la IA usar la búsqueda web real (herramienta del servidor de Anthropic). */
  webSearch?: { maxUses: number };
  maxTokens?: number;
}

export interface StructuredResponse<T> {
  data: T;
  /** Resultados REALES devueltos por la herramienta de búsqueda (para validar fuentes citadas). */
  webResults: WebResult[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface AiProvider {
  readonly name: string;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

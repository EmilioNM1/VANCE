import { sql } from "drizzle-orm";
import { concepts } from "@/db/schema";

/**
 * Un concepto se puede estudiar si procede de una página de apuntes o de un documento
 * listo (auditado y con conocimiento construido). Predicado único para sesiones, agenda y panel.
 */
export const studiableConcept = sql`(${concepts.pageId} is not null or exists (select 1 from documents d where d.id = ${concepts.documentId} and d.status = 'READY'))`;

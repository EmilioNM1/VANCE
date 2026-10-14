import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/db/client";
import { claimRevisions, claimSources, claims, documents, type ClaimDecision } from "@/db/schema";
import { enqueueJob } from "../jobs/queue";
import { ConflictError, NotFoundError } from "../documents/service";

export const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("ACCEPTED_ORIGINAL") }),
  z.object({ decision: z.literal("ACCEPTED_CORRECTION") }),
  z.object({ decision: z.literal("EDITED"), text: z.string().trim().min(3, "El texto es demasiado corto").max(2000) }),
  z.object({ decision: z.literal("REJECTED") }),
  z.object({ decision: z.literal("PENDING") }),
]);

/**
 * Decisión del usuario sobre una afirmación. Se conserva el texto original y se registra
 * cada cambio en claim_revisions.
 */
export async function decideClaim(userId: string, claimId: string, input: unknown) {
  const d = decisionSchema.parse(input);
  return withUser(userId, async (tx) => {
    const [c] = await tx.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.userId, userId)));
    if (!c) throw new NotFoundError("Afirmación");
    let finalText: string | null = null;
    let validated = false;
    let basis: "EXTERNAL_SOURCE" | "USER_APPROVED" | "USER_EDITED" | null = null;
    switch (d.decision) {
      case "ACCEPTED_ORIGINAL":
        finalText = c.originalText;
        validated = true;
        basis = c.category === "VERIFIED" ? "EXTERNAL_SOURCE" : "USER_APPROVED";
        break;
      case "ACCEPTED_CORRECTION": {
        if (!c.proposedText) throw new ConflictError("Esta afirmación no tiene una corrección propuesta.");
        finalText = c.proposedText;
        validated = true;
        const srcs = await tx.select({ id: claimSources.id }).from(claimSources).where(eq(claimSources.claimId, c.id)).limit(1);
        basis = srcs.length ? "EXTERNAL_SOURCE" : "USER_APPROVED";
        break;
      }
      case "EDITED":
        finalText = d.text;
        validated = true;
        basis = "USER_EDITED";
        break;
      case "REJECTED":
      case "PENDING":
        // PENDING devuelve la afirmación a su estado automático
        if (d.decision === "PENDING" && c.category === "VERIFIED") {
          finalText = c.originalText;
          validated = true;
          basis = "EXTERNAL_SOURCE";
        }
        break;
    }
    const [updated] = await tx
      .update(claims)
      .set({ decision: d.decision as ClaimDecision, finalText, validated, validationBasis: basis, updatedAt: new Date() })
      .where(eq(claims.id, c.id))
      .returning();
    await tx.insert(claimRevisions).values({
      userId,
      claimId: c.id,
      actor: "USER",
      action: `DECISION_${d.decision}`,
      before: { decision: c.decision, finalText: c.finalText, validated: c.validated },
      after: { decision: d.decision, finalText, validated },
    });
    return updated!;
  });
}

/** Acepta en bloque afirmaciones "no verificables" (no las marcadas como error). */
export async function bulkAcceptUnverifiable(userId: string, documentId: string, claimIds: string[]) {
  const ids = z.array(z.string().uuid()).max(500).parse(claimIds);
  if (!ids.length) return 0;
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.documentId, documentId), inArray(claims.id, ids), eq(claims.verdict, "UNVERIFIABLE")));
    for (const c of rows) {
      await tx
        .update(claims)
        .set({ decision: "ACCEPTED_ORIGINAL", finalText: c.originalText, validated: true, validationBasis: "USER_APPROVED", updatedAt: new Date() })
        .where(eq(claims.id, c.id));
      await tx.insert(claimRevisions).values({ userId, claimId: c.id, actor: "USER", action: "DECISION_ACCEPTED_ORIGINAL_BULK", after: { validated: true } });
    }
    return rows.length;
  });
}

export async function claimHistory(userId: string, claimId: string) {
  return withUser(userId, (tx) => tx.select().from(claimRevisions).where(eq(claimRevisions.claimId, claimId)).orderBy(claimRevisions.createdAt));
}

/** Tras revisar el informe, genera el conocimiento SOLO con las afirmaciones validadas. */
export async function approveReportAndBuild(userId: string, documentId: string) {
  await withUser(userId, async (tx) => {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
    if (!doc) throw new NotFoundError("Documento");
    if (!["REVIEW", "READY", "FAILED"].includes(doc.status) || !doc.auditCompletedAt)
      throw new ConflictError("El documento aún no ha terminado la auditoría.");
    const valid = await tx.select({ id: claims.id }).from(claims).where(and(eq(claims.documentId, documentId), eq(claims.validated, true)));
    if (!valid.length) throw new ConflictError("No hay ninguna afirmación validada. Revisa el informe y aprueba al menos una.");
    await tx.update(documents).set({ status: "BUILDING_KNOWLEDGE", statusDetail: "En cola para construir el mapa de conocimiento", error: null, errorCode: null }).where(eq(documents.id, documentId));
  });
  await enqueueJob("document.build_knowledge", { documentId }, userId);
}

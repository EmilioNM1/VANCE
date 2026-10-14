/**
 * Modelo de datos de VANCE.
 *
 * Reglas generales:
 * - Toda tabla con datos de estudio lleva `user_id` y está protegida por Row Level Security
 *   (ver drizzle/0001_rls.sql). La app además filtra siempre por usuario (defensa en profundidad).
 * - Cada actividad se puede rastrear hasta su concepto, sus afirmaciones validadas y los
 *   fragmentos (chunks) del documento original.
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  real,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  bigint,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ActivityPayload,
  AnswerKey,
  ConceptDetails,
  EvaluationResult,
  MasteryDimensions,
  Rubric,
  UserSettings,
  NoteDoc,
} from "@/lib/types";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const userRef = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// ───────────────────────────── Usuarios y autenticación ─────────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  settings: jsonb("settings").$type<UserSettings>().notNull().default({} as UserSettings),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: id(),
    userId: userRef(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: userRef(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ───────────────────────────── Bibliotecas y documentos ─────────────────────────────

export const libraries = pgTable(
  "libraries",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    subject: text("subject"),
    description: text("description"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("libraries_user_idx").on(t.userId)],
);

export type DocumentStatus =
  | "UPLOADED"
  | "EXTRACTING"
  | "EXTRACTED"
  | "AUDITING"
  | "REVIEW"
  | "BUILDING_KNOWLEDGE"
  | "READY"
  | "FAILED";

export const documents = pgTable(
  "documents",
  {
    id: id(),
    userId: userRef(),
    libraryId: uuid("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    topic: text("topic"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status").$type<DocumentStatus>().notNull().default("UPLOADED"),
    statusDetail: text("status_detail"),
    errorCode: text("error_code"),
    error: text("error"),
    pageCount: integer("page_count"),
    extractionMethod: text("extraction_method"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true }).notNull(),
    auditCompletedAt: timestamp("audit_completed_at", { withTimezone: true }),
    knowledgeBuiltAt: timestamp("knowledge_built_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    /** Índice de recuperación semántica externo (Gemini File Search). Null = solo búsqueda local. */
    indexProvider: text("index_provider").$type<"GEMINI_FILE_SEARCH" | null>(),
    indexStatus: text("index_status").$type<"PENDING" | "INDEXING" | "INDEXED" | "FAILED" | null>(),
    indexRef: text("index_ref"),
    indexError: text("index_error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_user_idx").on(t.userId), index("documents_library_idx").on(t.libraryId)],
);

export const sections = pgTable(
  "sections",
  {
    id: id(),
    userId: userRef(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    level: integer("level").notNull().default(1),
    title: text("title").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
  },
  (t) => [index("sections_document_idx").on(t.documentId, t.ord)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    userId: userRef(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    ord: integer("ord").notNull(),
    page: integer("page"),
    /** Texto tal como se extrajo. Nunca se sobrescribe. */
    text: text("text").notNull(),
    /** Corrección manual del usuario (errores de extracción). */
    editedText: text("edited_text"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  },
  (t) => [index("chunks_document_idx").on(t.documentId, t.ord)],
);

// ───────────────────────────── Verificación ─────────────────────────────

export type ClaimKind =
  | "DEFINITION"
  | "FACT"
  | "NUMBER"
  | "FORMULA"
  | "MECHANISM"
  | "PROCESS_STEP"
  | "CLASSIFICATION"
  | "CONCLUSION"
  | "EXAMPLE";

/** Veredicto de la auditoría (qué encontró la IA). */
export type ClaimVerdict =
  | "PENDING"
  | "SUPPORTED"
  | "CONFIRMED_ERROR"
  | "POSSIBLE_ERROR"
  | "OUTDATED"
  | "SOURCE_DISAGREEMENT"
  | "UNVERIFIABLE"
  | "EXTRACTION_ERROR"
  | "INTERNAL_CONTRADICTION";

/** Categoría del informe que ve el usuario. */
export type ClaimCategory = "VERIFIED" | "NEEDS_REVIEW" | "CORRECTION";

/** Decisión del usuario. */
export type ClaimDecision = "PENDING" | "ACCEPTED_ORIGINAL" | "ACCEPTED_CORRECTION" | "EDITED" | "REJECTED";

export const claims = pgTable(
  "claims",
  {
    id: id(),
    userId: userRef(),
    /** Origen: un fragmento de libro (DOCUMENT) o una página de apuntes (NOTE). */
    sourceKind: text("source_kind").$type<"DOCUMENT" | "NOTE">().notNull().default("DOCUMENT"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").references(() => chunks.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => notebookPages.id, { onDelete: "cascade" }),
    noteReviewId: uuid("note_review_id").references(() => noteReviews.id, { onDelete: "set null" }),
    ord: integer("ord").notNull(),
    kind: text("kind").$type<ClaimKind>().notNull(),
    /** Afirmación normalizada, tal como dice el documento. */
    originalText: text("original_text").notNull(),
    /** Cita literal del fragmento (comprobada en servidor). */
    quote: text("quote"),
    quoteVerified: boolean("quote_verified").notNull().default(false),
    verdict: text("verdict").$type<ClaimVerdict>().notNull().default("PENDING"),
    category: text("category").$type<ClaimCategory>().notNull().default("NEEDS_REVIEW"),
    proposedText: text("proposed_text"),
    rationale: text("rationale"),
    verificationMethod: text("verification_method"),
    decision: text("decision").$type<ClaimDecision>().notNull().default("PENDING"),
    /** Texto final validado que alimenta el motor de conocimiento. */
    finalText: text("final_text"),
    /** true solo si puede usarse como conocimiento validado. */
    validated: boolean("validated").notNull().default(false),
    validationBasis: text("validation_basis").$type<"EXTERNAL_SOURCE" | "BOOK_SOURCE" | "USER_APPROVED" | "USER_EDITED" | null>(),
    contradictsClaimIds: jsonb("contradicts_claim_ids").$type<string[]>().notNull().default([]),
    /** Metadatos de auditoría (consulta bibliográfica sugerida, dominio, incidencias de extracción). */
    meta: jsonb("meta").$type<{ searchQuery?: string; biomedical?: boolean; extractionIssue?: string | null }>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("claims_document_idx").on(t.documentId, t.ord),
    index("claims_page_idx").on(t.pageId),
    index("claims_user_validated_idx").on(t.userId, t.validated),
    check("claims_source_check", sql`(${t.sourceKind} = 'DOCUMENT' and ${t.documentId} is not null and ${t.chunkId} is not null) or (${t.sourceKind} = 'NOTE' and ${t.pageId} is not null)`),
  ],
);

export const claimSources = pgTable(
  "claim_sources",
  {
    id: id(),
    userId: userRef(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    /** De dónde salió la referencia: solo herramientas reales, nunca texto libre del modelo. */
    retrievedVia: text("retrieved_via").$type<"PUBMED" | "WEB_SEARCH" | "BOOK">().notNull(),
    /** Para fuentes de tipo BOOK: el documento y el fragmento recuperados. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").references(() => chunks.id, { onDelete: "set null" }),
    page: integer("page"),
    title: text("title").notNull(),
    url: text("url").notNull(),
    pmid: text("pmid"),
    doi: text("doi"),
    journal: text("journal"),
    year: text("year"),
    excerpt: text("excerpt"),
    stance: text("stance").$type<"SUPPORTS" | "CONTRADICTS" | "MIXED">().notNull(),
  },
  (t) => [index("claim_sources_claim_idx").on(t.claimId)],
);

/** Registro inmutable de cambios sobre afirmaciones (trazabilidad). */
export const claimRevisions = pgTable(
  "claim_revisions",
  {
    id: id(),
    userId: userRef(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    actor: text("actor").$type<"AI" | "USER" | "SYSTEM">().notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("claim_revisions_claim_idx").on(t.claimId)],
);

// ───────────────────────────── Conocimiento ─────────────────────────────

export type ConceptKind =
  | "CONCEPT"
  | "DEFINITION"
  | "PROCESS"
  | "MECHANISM"
  | "STRUCTURE"
  | "CLASSIFICATION"
  | "FORMULA"
  | "COMPARISON"
  | "FACT";

export const concepts = pgTable(
  "concepts",
  {
    id: id(),
    userId: userRef(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    /** Concepto surgido de una página de apuntes. */
    pageId: uuid("page_id").references(() => notebookPages.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: text("kind").$type<ConceptKind>().notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<ConceptDetails>().notNull().default({}),
    importance: integer("importance").notNull().default(2),
    createdAt: createdAt(),
  },
  (t) => [
    index("concepts_document_idx").on(t.documentId),
    index("concepts_page_idx").on(t.pageId),
    index("concepts_user_idx").on(t.userId),
    check("concepts_source_check", sql`${t.documentId} is not null or ${t.pageId} is not null`),
  ],
);

export const conceptClaims = pgTable(
  "concept_claims",
  {
    userId: userRef(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.conceptId, t.claimId] }), index("concept_claims_claim_idx").on(t.claimId)],
);

export type RelationType =
  | "CAUSES"
  | "ENABLES"
  | "INHIBITS"
  | "PART_OF"
  | "IS_A"
  | "PRECEDES"
  | "PREREQUISITE_OF"
  | "REGULATES"
  | "CONTRASTS_WITH"
  | "EXAMPLE_OF"
  | "RELATED_TO";

export const conceptRelations = pgTable(
  "concept_relations",
  {
    id: id(),
    userId: userRef(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => notebookPages.id, { onDelete: "cascade" }),
    fromConceptId: uuid("from_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    toConceptId: uuid("to_concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    type: text("type").$type<RelationType>().notNull(),
    description: text("description").notNull(),
    claimIds: jsonb("claim_ids").$type<string[]>().notNull().default([]),
  },
  (t) => [index("concept_relations_from_idx").on(t.fromConceptId), index("concept_relations_to_idx").on(t.toConceptId)],
);

// ───────────────────────────── Actividades ─────────────────────────────

export type ActivityType =
  | "FREE_RECALL"
  | "EXPLAIN"
  | "PROCESS_ORDER"
  | "CLOZE"
  | "RELATION"
  | "PREDICTION"
  | "CASE"
  | "RECOGNITION"
  | "DIAGRAM";

export const activities = pgTable(
  "activities",
  {
    id: id(),
    userId: userRef(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    /** Página de apuntes de la que procede (si aplica). */
    pageId: uuid("page_id").references(() => notebookPages.id, { onDelete: "cascade" }),
    /** Origen pedagógico: libro, apuntes o combinación de ambos. */
    origin: text("origin").$type<"BOOK" | "NOTES" | "COMBINED">().notNull().default("BOOK"),
    /** Concepto principal entrenado. */
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    /** Conceptos adicionales implicados (relaciones, casos acumulativos). */
    relatedConceptIds: jsonb("related_concept_ids").$type<string[]>().notNull().default([]),
    type: text("type").$type<ActivityType>().notNull(),
    prompt: text("prompt").notNull(),
    /** Lo único que ve el cliente además del enunciado. */
    payload: jsonb("payload").$type<ActivityPayload>().notNull().default({}),
    /** Solo servidor: respuesta esperada para evaluación determinista. */
    answerKey: jsonb("answer_key").$type<AnswerKey>().notNull().default({}),
    /** Solo servidor: rúbrica para evaluación semántica. */
    rubric: jsonb("rubric").$type<Rubric>().notNull(),
    /** Afirmaciones validadas que justifican la actividad (obligatorio, ≥1). */
    claimIds: jsonb("claim_ids").$type<string[]>().notNull(),
    chunkIds: jsonb("chunk_ids").$type<string[]>().notNull(),
    generatedBy: text("generated_by").$type<"RULES" | "AI" | "DEMO">().notNull(),
    retired: boolean("retired").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("activities_concept_idx").on(t.conceptId, t.type),
    index("activities_user_idx").on(t.userId),
    index("activities_page_idx").on(t.pageId),
    check("activities_source_check", sql`${t.documentId} is not null or ${t.pageId} is not null`),
  ],
);

// ───────────────────────────── Sesiones de aprendizaje ─────────────────────────────

export const studySessions = pgTable(
  "study_sessions",
  {
    id: id(),
    userId: userRef(),
    mode: text("mode").$type<"DAILY" | "DOCUMENT" | "CONCEPT" | "CUMULATIVE" | "PAGE" | "SECTION">().notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    pageId: uuid("page_id").references(() => notebookPages.id, { onDelete: "set null" }),
    notebookSectionId: uuid("notebook_section_id").references(() => notebookSections.id, { onDelete: "set null" }),
    focus: text("focus").$type<"ALL" | "ERRORS" | "NOTES" | "BOOK" | "COMBINED">().notNull().default("ALL"),
    status: text("status").$type<"ACTIVE" | "COMPLETED" | "ABANDONED">().notNull().default("ACTIVE"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("study_sessions_user_idx").on(t.userId, t.status)],
);

export type ItemState =
  | "PENDING"
  | "AWAITING_ANSWER"
  | "AWAITING_RETRY"
  | "AWAITING_POST_EXPLANATION"
  | "DONE"
  | "SKIPPED";

export const sessionItems = pgTable(
  "session_items",
  {
    id: id(),
    userId: userRef(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    reason: text("reason").notNull(),
    state: text("state").$type<ItemState>().notNull().default("PENDING"),
    /** Prueba sin pistas (evaluación periódica). */
    noHints: boolean("no_hints").notNull().default(false),
    hintLevel: integer("hint_level").notNull().default(0),
    attemptsCount: integer("attempts_count").notNull().default(0),
    firstScore: real("first_score"),
    finalScore: real("final_score"),
    explanationShown: boolean("explanation_shown").notNull().default(false),
    presentedAt: timestamp("presented_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("session_items_session_ord_idx").on(t.sessionId, t.ord)],
);

export type AttemptPhase = "INITIAL" | "RETRY" | "POST_EXPLANATION";

export const attempts = pgTable(
  "attempts",
  {
    id: id(),
    userId: userRef(),
    sessionItemId: uuid("session_item_id")
      .notNull()
      .references(() => sessionItems.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    phase: text("phase").$type<AttemptPhase>().notNull(),
    attemptNo: integer("attempt_no").notNull(),
    response: jsonb("response").notNull(),
    inputMode: text("input_mode").$type<"TEXT" | "VOICE" | "INTERACTIVE">().notNull().default("TEXT"),
    confidence: integer("confidence"),
    hintLevelAtSubmit: integer("hint_level_at_submit").notNull().default(0),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("attempts_user_concept_idx").on(t.userId, t.conceptId, t.createdAt)],
);

export const evaluations = pgTable(
  "evaluations",
  {
    id: id(),
    userId: userRef(),
    attemptId: uuid("attempt_id")
      .notNull()
      .unique()
      .references(() => attempts.id, { onDelete: "cascade" }),
    method: text("method").$type<"RULES" | "AI" | "HEURISTIC_PROVISIONAL">().notNull(),
    score: real("score").notNull(),
    result: jsonb("result").$type<EvaluationResult>().notNull(),
    /** true si la IA no estaba disponible y se debe reevaluar. */
    provisional: boolean("provisional").notNull().default(false),
    createdAt: createdAt(),
  },
);

export const hintUses = pgTable(
  "hint_uses",
  {
    id: id(),
    userId: userRef(),
    sessionItemId: uuid("session_item_id")
      .notNull()
      .references(() => sessionItems.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    text: text("text").notNull(),
    adaptive: boolean("adaptive").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("hint_uses_item_idx").on(t.sessionItemId)],
);

// ───────────────────────────── Memoria y dominio ─────────────────────────────

export type MasteryState = "NEW" | "LEARNING" | "CONSOLIDATING" | "MASTERED" | "RELEARNING";

export const conceptMastery = pgTable(
  "concept_mastery",
  {
    userId: userRef(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    state: text("state").$type<MasteryState>().notNull().default("NEW"),
    dimensions: jsonb("dimensions").$type<MasteryDimensions>().notNull(),
    stability: real("stability").notNull().default(0),
    difficulty: real("difficulty").notNull().default(5),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    independentSuccessDays: jsonb("independent_success_days").$type<string[]>().notNull().default([]),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    illusionFlag: boolean("illusion_flag").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.conceptId] }), index("concept_mastery_due_idx").on(t.userId, t.dueAt)],
);

export const reviewLogs = pgTable(
  "review_logs",
  {
    id: id(),
    userId: userRef(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id").references(() => attempts.id, { onDelete: "set null" }),
    activityType: text("activity_type").$type<ActivityType>().notNull(),
    grade: integer("grade").notNull(),
    score: real("score").notNull(),
    hintsUsed: integer("hints_used").notNull(),
    elapsedDays: real("elapsed_days").notNull(),
    predictedRecall: real("predicted_recall"),
    stabilityBefore: real("stability_before").notNull(),
    stabilityAfter: real("stability_after").notNull(),
    scheduledDays: real("scheduled_days").notNull(),
    countsForSchedule: boolean("counts_for_schedule").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("review_logs_user_idx").on(t.userId, t.createdAt), index("review_logs_concept_idx").on(t.conceptId)],
);

/** Errores conceptuales detectados (por etiqueta), con recurrencia. */
export const conceptErrors = pgTable(
  "concept_errors",
  {
    id: id(),
    userId: userRef(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    description: text("description").notNull(),
    count: integer("count").notNull().default(1),
    resolved: boolean("resolved").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("concept_errors_unique_idx").on(t.userId, t.conceptId, t.tag)],
);

/** Pares de conceptos que el usuario confunde. */
export const conceptConfusions = pgTable(
  "concept_confusions",
  {
    userId: userRef(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    confusedWithId: uuid("confused_with_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    count: integer("count").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.conceptId, t.confusedWithId] })],
);

// ───────────────────────────── Infraestructura ─────────────────────────────

export type JobType =
  | "document.extract"
  | "document.audit"
  | "document.build_knowledge"
  | "evaluation.reevaluate"
  | "document.index"
  | "document.unindex"
  | "notes.analyze"
  | "notes.build_activities";

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<JobType>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"QUEUED" | "RUNNING" | "DONE" | "FAILED">().notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** Resultado visible para el usuario (p. ej. cuántas actividades se crearon). */
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_queue_idx").on(t.status, t.runAt)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: userRef(),
    operation: text("operation").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);

// ───────────────────────────── Cuadernos y apuntes ─────────────────────────────

export const notebooks = pgTable(
  "notebooks",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    subject: text("subject"),
    /** Color de acento del cuaderno (token, no valor libre). */
    color: text("color").notNull().default("teal"),
    ord: integer("ord").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notebooks_user_idx").on(t.userId, t.ord)],
);

export const notebookSections = pgTable(
  "notebook_sections",
  {
    id: id(),
    userId: userRef(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ord: integer("ord").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("notebook_sections_nb_idx").on(t.notebookId, t.ord)],
);

export const notebookPages = pgTable(
  "notebook_pages",
  {
    id: id(),
    userId: userRef(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => notebookSections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ord: integer("ord").notNull().default(0),
    /** Documento ProseMirror/Tiptap validado en servidor. */
    content: jsonb("content").$type<NoteDoc>().notNull(),
    /** Texto plano derivado (búsqueda, análisis, exportación TXT). */
    contentText: text("content_text").notNull().default(""),
    contentHash: text("content_hash").notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),
    /** Control de concurrencia optimista entre dispositivos. */
    version: integer("version").notNull().default(1),
    lastAnalyzedHash: text("last_analyzed_hash"),
    lastAnalyzedAt: timestamp("last_analyzed_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notebook_pages_section_idx").on(t.sectionId, t.ord), index("notebook_pages_user_updated_idx").on(t.userId, t.updatedAt)],
);

/** Instantáneas para recuperar versiones anteriores (incl. antes de aceptar correcciones). */
export const pageVersions = pgTable(
  "page_versions",
  {
    id: id(),
    userId: userRef(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => notebookPages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<NoteDoc>().notNull(),
    reason: text("reason").$type<"AUTO" | "BEFORE_CORRECTION" | "BEFORE_RESTORE" | "MANUAL">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("page_versions_page_idx").on(t.pageId, t.createdAt)],
);

/** Libros de referencia vinculados a una página. */
export const pageDocumentLinks = pgTable(
  "page_document_links",
  {
    userId: userRef(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => notebookPages.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.documentId] })],
);

/** Conceptos asociados a una página: propios (NOTE) o del libro vinculado (BOOK). */
export const pageConceptLinks = pgTable(
  "page_concept_links",
  {
    userId: userRef(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => notebookPages.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    origin: text("origin").$type<"NOTE" | "BOOK">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.conceptId] }), index("page_concept_links_concept_idx").on(t.conceptId)],
);

/** Imágenes insertadas en los apuntes (almacenamiento privado existente). */
export const noteAssets = pgTable("note_assets", {
  id: id(),
  userId: userRef(),
  pageId: uuid("page_id").references(() => notebookPages.id, { onDelete: "set null" }),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: createdAt(),
});

/** Ejecución de un análisis de apuntes (página o selección) contra los libros. */
export const noteReviews = pgTable(
  "note_reviews",
  {
    id: id(),
    userId: userRef(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => notebookPages.id, { onDelete: "cascade" }),
    scope: text("scope").$type<"PAGE" | "SELECTION">().notNull(),
    selectionText: text("selection_text"),
    status: text("status").$type<"QUEUED" | "RUNNING" | "DONE" | "FAILED">().notNull().default("QUEUED"),
    statusDetail: text("status_detail"),
    contentHash: text("content_hash").notNull(),
    retrievalProvider: text("retrieval_provider"),
    omissions: jsonb("omissions").$type<{ description: string; documentId: string; documentTitle: string; page: number | null; chunkId: string | null; excerpt: string }[]>().notNull().default([]),
    externalVerification: boolean("external_verification").notNull().default(false),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("note_reviews_page_idx").on(t.pageId, t.createdAt)],
);

/** Caché de resultados de IA deterministas (misma entrada → misma salida). */
export const aiCache = pgTable(
  "ai_cache",
  {
    userId: userRef(),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    output: jsonb("output").notNull(),
    hits: integer("hits").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** Almacén de File Search de Gemini de cada usuario (aislamiento por usuario). */
export const retrievalStores = pgTable("retrieval_stores", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"GEMINI_FILE_SEARCH">().notNull(),
  storeName: text("store_name").notNull(),
  createdAt: createdAt(),
});

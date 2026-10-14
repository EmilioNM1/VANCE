-- Row Level Security: cada fila solo es visible/modificable por su propietario.
-- La aplicación fija app.user_id por transacción (ver src/db/client.ts withUser).
-- Sin app.user_id, las consultas devuelven 0 filas (fallo seguro).
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;--> statement-breakpoint
ALTER TABLE "libraries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "libraries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "libraries_owner" ON "libraries" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "documents_owner" ON "documents" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sections_owner" ON "sections" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chunks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "chunks_owner" ON "chunks" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "claims_owner" ON "claims" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "claim_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "claim_sources_owner" ON "claim_sources" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "claim_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "claim_revisions_owner" ON "claim_revisions" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "concepts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concepts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "concepts_owner" ON "concepts" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "concept_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "concept_claims_owner" ON "concept_claims" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "concept_relations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_relations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "concept_relations_owner" ON "concept_relations" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "activities_owner" ON "activities" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "study_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "study_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "study_sessions_owner" ON "study_sessions" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "session_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "session_items_owner" ON "session_items" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attempts_owner" ON "attempts" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "evaluations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evaluations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "evaluations_owner" ON "evaluations" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "hint_uses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hint_uses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "hint_uses_owner" ON "hint_uses" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "concept_mastery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_mastery" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "concept_mastery_owner" ON "concept_mastery" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "review_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "review_logs_owner" ON "review_logs" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "concept_errors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_errors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "concept_errors_owner" ON "concept_errors" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "concept_confusions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_confusions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "concept_confusions_owner" ON "concept_confusions" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_usage_owner" ON "ai_usage" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());

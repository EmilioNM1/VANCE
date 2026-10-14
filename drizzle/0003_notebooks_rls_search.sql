-- Row Level Security para las tablas de cuadernos (mismo modelo que 0001_rls.sql).
ALTER TABLE "notebooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notebooks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notebooks_owner" ON "notebooks" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "notebook_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notebook_sections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notebook_sections_owner" ON "notebook_sections" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "notebook_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notebook_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notebook_pages_owner" ON "notebook_pages" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "page_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "page_versions_owner" ON "page_versions" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "page_document_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_document_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "page_document_links_owner" ON "page_document_links" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "page_concept_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_concept_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "page_concept_links_owner" ON "page_concept_links" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "note_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note_assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "note_assets_owner" ON "note_assets" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "note_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "note_reviews_owner" ON "note_reviews" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "ai_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_cache" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_cache_owner" ON "ai_cache" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "retrieval_stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retrieval_stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "retrieval_stores_owner" ON "retrieval_stores" USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
-- Búsqueda de texto completo en los libros (recuperación local con página exacta).
ALTER TABLE "chunks" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('spanish', coalesce("edited_text", "text"))) STORED;--> statement-breakpoint
CREATE INDEX "chunks_search_idx" ON "chunks" USING gin ("search_tsv");--> statement-breakpoint
-- Búsqueda en los apuntes.
ALTER TABLE "notebook_pages" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('spanish', coalesce("title", '') || ' ' || coalesce("content_text", ''))) STORED;--> statement-breakpoint
CREATE INDEX "notebook_pages_search_idx" ON "notebook_pages" USING gin ("search_tsv");

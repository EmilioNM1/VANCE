CREATE TABLE "ai_cache" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"output" jsonb NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_cache_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "note_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"selection_text" text,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"status_detail" text,
	"content_hash" text NOT NULL,
	"retrieval_provider" text,
	"omissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_verification" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notebook_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notebook_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"title" text NOT NULL,
	"ord" integer DEFAULT 0 NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_analyzed_hash" text,
	"last_analyzed_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notebook_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notebook_id" uuid NOT NULL,
	"title" text NOT NULL,
	"ord" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notebooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"color" text DEFAULT 'teal' NOT NULL,
	"ord" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_concept_links" (
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_concept_links_page_id_concept_id_pk" PRIMARY KEY("page_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "page_document_links" (
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_document_links_page_id_document_id_pk" PRIMARY KEY("page_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_stores" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"store_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ALTER COLUMN "chunk_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "concept_relations" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "origin" text DEFAULT 'BOOK' NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_sources" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "claim_sources" ADD COLUMN "chunk_id" uuid;--> statement-breakpoint
ALTER TABLE "claim_sources" ADD COLUMN "page" integer;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "source_kind" text DEFAULT 'DOCUMENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "note_review_id" uuid;--> statement-breakpoint
ALTER TABLE "concept_relations" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "index_provider" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "index_status" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "index_ref" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "index_error" text;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "page_id" uuid;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "notebook_section_id" uuid;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "focus" text DEFAULT 'ALL' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_cache" ADD CONSTRAINT "ai_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_assets" ADD CONSTRAINT "note_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_assets" ADD CONSTRAINT "note_assets_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reviews" ADD CONSTRAINT "note_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reviews" ADD CONSTRAINT "note_reviews_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_pages" ADD CONSTRAINT "notebook_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_pages" ADD CONSTRAINT "notebook_pages_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_pages" ADD CONSTRAINT "notebook_pages_section_id_notebook_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."notebook_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_sections" ADD CONSTRAINT "notebook_sections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_sections" ADD CONSTRAINT "notebook_sections_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebooks" ADD CONSTRAINT "notebooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_concept_links" ADD CONSTRAINT "page_concept_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_concept_links" ADD CONSTRAINT "page_concept_links_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_concept_links" ADD CONSTRAINT "page_concept_links_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_document_links" ADD CONSTRAINT "page_document_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_document_links" ADD CONSTRAINT "page_document_links_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_document_links" ADD CONSTRAINT "page_document_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_stores" ADD CONSTRAINT "retrieval_stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_reviews_page_idx" ON "note_reviews" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "notebook_pages_section_idx" ON "notebook_pages" USING btree ("section_id","ord");--> statement-breakpoint
CREATE INDEX "notebook_pages_user_updated_idx" ON "notebook_pages" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "notebook_sections_nb_idx" ON "notebook_sections" USING btree ("notebook_id","ord");--> statement-breakpoint
CREATE INDEX "notebooks_user_idx" ON "notebooks" USING btree ("user_id","ord");--> statement-breakpoint
CREATE INDEX "page_concept_links_concept_idx" ON "page_concept_links" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "page_versions_page_idx" ON "page_versions" USING btree ("page_id","created_at");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sources" ADD CONSTRAINT "claim_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sources" ADD CONSTRAINT "claim_sources_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_note_review_id_note_reviews_id_fk" FOREIGN KEY ("note_review_id") REFERENCES "public"."note_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_page_id_notebook_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."notebook_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_notebook_section_id_notebook_sections_id_fk" FOREIGN KEY ("notebook_section_id") REFERENCES "public"."notebook_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_page_idx" ON "activities" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "claims_page_idx" ON "claims" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "concepts_page_idx" ON "concepts" USING btree ("page_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_source_check" CHECK ("activities"."document_id" is not null or "activities"."page_id" is not null);--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_check" CHECK (("claims"."source_kind" = 'DOCUMENT' and "claims"."document_id" is not null and "claims"."chunk_id" is not null) or ("claims"."source_kind" = 'NOTE' and "claims"."page_id" is not null));--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_source_check" CHECK ("concepts"."document_id" is not null or "concepts"."page_id" is not null);
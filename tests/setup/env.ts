import path from "node:path";
import os from "node:os";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://vance:vance@localhost:5432/vance_test";
process.env.STORAGE_DIR = path.join(os.tmpdir(), "vance-test-storage");
process.env.ANTHROPIC_API_KEY = "";
process.env.VERIFY_WITH_PUBMED = "false";
process.env.VERIFY_WITH_WEB_SEARCH = "true";
process.env.AI_DAILY_TOKEN_BUDGET_PER_USER = "0";
(process.env as Record<string, string>).NODE_ENV = "test";

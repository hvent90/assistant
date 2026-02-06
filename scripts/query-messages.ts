import { initDb, getRecentMessages } from "../src/db";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envFile = readFileSync(join(__dirname, "../.env"), "utf-8");
const dbUrl = envFile.match(/DATABASE_URL=(.+)/)?.[1] || "postgresql://assistant:assistant_password@localhost:5432/assistant";

initDb(dbUrl);
const msgs = await getRecentMessages(10);
console.log(JSON.stringify(msgs.map(m => ({
  role: m.role,
  source: m.source,
  agent: m.agent,
  created_at: m.created_at.toISOString()
})), null, 2));
process.exit(0);
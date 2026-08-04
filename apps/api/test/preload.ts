/**
 * Preload do bun test (bunfig.toml → [test] preload).
 * Roda antes de cada arquivo de teste, em cada processo worker (--parallel).
 * Garante isolamento: cada processo recebe um diretório temporário próprio
 * para o SQLite e os blobs — nenhum teste enxerga dados de outro.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sentrylike-test-"));

process.env.DATABASE_PATH = join(dir, "test.db");
process.env.DATA_DIR = join(dir, "blobs");
// owner de bootstrap criado pelo ensureBootstrap (ADMIN_USER/ADMIN_PASSWORD)
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASSWORD = "senha123";
process.env.APP_URL = "http://localhost:3001";

// limpa o diretório temporário ao final do processo
process.on("exit", () => {
  rmSync(dir, { recursive: true, force: true });
});

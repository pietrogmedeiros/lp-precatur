import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile();
} catch {
  // Sem .env: usa variáveis de ambiente do sistema e os padrões abaixo.
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface AppConfig {
  port: number;
  host: string;
  trustProxy: boolean;
  publicDir: string;
  dataDir: string;
  webhookUrl: string;
  webhookTimeoutMs: number;
  retryIntervalMs: number;
  adminToken: string;
  metricsToken: string;
  rateLimitPerMinute: number;
  evento: string;
  agentes: string[];
  autoResetSegundos: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: int(env.PORT, 3000),
    host: env.HOST ?? "0.0.0.0",
    trustProxy: env.TRUST_PROXY === "true",
    publicDir: path.join(rootDir, "public"),
    dataDir: path.resolve(rootDir, env.DATA_DIR ?? "data"),
    webhookUrl: env.N8N_WEBHOOK_URL ?? "",
    webhookTimeoutMs: int(env.N8N_TIMEOUT_MS, 10_000),
    retryIntervalMs: int(env.RETRY_INTERVAL_MS, 60_000),
    adminToken: env.ADMIN_TOKEN ?? "",
    metricsToken: env.METRICS_TOKEN ?? "",
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 60),
    evento: env.EVENT_NAME ?? "Evento de Captação em SP",
    agentes: list(env.AGENTS, ["Thales", "Aline", "Thaynara", "Tati", "Henrique", "Rhuan", "Calebe", "Karol", "Vitoria", "Matheus", "Sanmilly", "Ayrton", "Laís", "Carlos", "Chris", "Rafael"]),
    autoResetSegundos: int(env.AUTO_RESET_SECONDS, 15),
  };
}

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { LeadDelivery } from "./delivery.js";
import { LeadStore } from "./store.js";

const config = loadConfig();

const store = new LeadStore(config.dataDir);
await store.load();

const delivery = new LeadDelivery(store, config.webhookUrl, config.webhookTimeoutMs);
const app = createApp({ config, store, delivery });

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] Landing page em http://localhost:${config.port}`);
  console.log(`[server] Evento: ${config.evento} | Agentes: ${config.agentes.join(", ")}`);
  if (!config.webhookUrl) console.warn("[server] N8N_WEBHOOK_URL vazio: os leads ficam só em data/leads.jsonl");
  const pending = store.pending().length;
  if (pending) console.log(`[server] ${pending} lead(s) pendente(s) de envio; reenviando...`);
});

delivery.startRetryLoop(config.retryIntervalMs);
void delivery.retryPending();

function shutdown(signal: string) {
  console.log(`[server] ${signal} recebido, encerrando...`);
  delivery.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

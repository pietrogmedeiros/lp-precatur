import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { LeadDelivery } from "../src/server/delivery.js";
import { LeadStore } from "../src/server/store.js";

/** n8n falso: guarda o que recebe e pode simular falha. */
function fakeWebhook() {
  const received: unknown[] = [];
  let failing = false;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (failing) {
        res.writeHead(500).end();
        return;
      }
      received.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  return {
    received,
    setFailing: (v: boolean) => (failing = v),
    start: () => new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook/evento`))),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function listen(server: Server): Promise<string> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

const lead = () => ({
  id: randomUUID(),
  nome: "Maria da Silva",
  telefone: "(27) 99658-4654",
  cidade: "Vitória",
  uf: "ES",
  agente: "Calebe",
  consentimento_lgpd: true,
  criado_em: new Date().toISOString(),
  website: "",
});

describe("API de leads", () => {
  const webhook = fakeWebhook();
  let dataDir: string;
  let baseUrl: string;
  let server: Server;
  let store: LeadStore;
  let delivery: LeadDelivery;

  before(async () => {
    const webhookUrl = await webhook.start();
    dataDir = await mkdtemp(path.join(tmpdir(), "lp-precatur-"));
    const config = {
      ...loadConfig({}),
      dataDir,
      webhookUrl,
      adminToken: "segredo",
      evento: "Evento Teste",
    };
    store = new LeadStore(dataDir);
    await store.load();
    delivery = new LeadDelivery(store, webhookUrl, 2_000);
    server = createServer(createApp({ config, store, delivery }));
    baseUrl = await listen(server);
  });

  after(async () => {
    server.close();
    await webhook.stop();
    await rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    webhook.received.length = 0;
    webhook.setFailing(false);
  });

  const post = (body: unknown) =>
    fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("serve a página com a configuração injetada", async () => {
    const res = await fetch(baseUrl);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /id="app-config"/);
    assert.match(html, /Evento Teste/);
    assert.match(html, /"Thales"/);
    assert.ok(res.headers.get("content-security-policy"));
  });

  it("salva e encaminha o lead ao n8n", async () => {
    const l = lead();
    const res = await post(l);
    assert.equal(res.status, 201);
    assert.equal(webhook.received.length, 1);
    const sent = webhook.received[0] as Record<string, unknown>;
    assert.equal(sent.nome, "Maria da Silva");
    assert.equal(sent.agente, "Calebe");
    assert.equal(sent.evento, "Evento Teste");
    assert.equal(sent.website, undefined);
    assert.equal(store.get(l.id)?.enviado, true);
    assert.match(await readFile(path.join(dataDir, "leads.jsonl"), "utf8"), new RegExp(l.id));
  });

  it("não duplica o mesmo id", async () => {
    const l = lead();
    await post(l);
    const res = await post(l);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, duplicado: true });
    assert.equal(webhook.received.length, 1);
  });

  it("retorna erros por campo", async () => {
    const res = await post({ ...lead(), nome: "Ma", telefone: "123", agente: "Fulano" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { erros: Record<string, string> };
    assert.ok(body.erros.nome);
    assert.ok(body.erros.telefone);
    assert.equal(webhook.received.length, 0);
  });

  it("rejeita agente fora da lista", async () => {
    const res = await post({ ...lead(), agente: "Fulano" });
    assert.equal(res.status, 400);
  });

  it("descarta bots (honeypot) sem avisar", async () => {
    const l = { ...lead(), website: "http://spam" };
    const res = await post(l);
    assert.equal(res.status, 201);
    assert.equal(store.has(l.id), false);
    assert.equal(webhook.received.length, 0);
  });

  it("mantém o lead pendente se o n8n falhar e reenvia depois", async () => {
    webhook.setFailing(true);
    const l = lead();
    const res = await post(l);
    assert.equal(res.status, 201);
    assert.equal(store.get(l.id)?.enviado, false);
    assert.equal(store.get(l.id)?.tentativas, 1);

    webhook.setFailing(false);
    await delivery.retryPending();
    assert.equal(store.get(l.id)?.enviado, true);
    assert.equal(webhook.received.length, 1);
  });

  it("recarrega o estado do disco", async () => {
    const reloaded = new LeadStore(dataDir);
    await reloaded.load();
    assert.equal(reloaded.all().length, store.all().length);
    assert.equal(reloaded.pending().length, 0);
  });

  it("serve o painel /metrics e os dados agregados por agente", async () => {
    const page = await fetch(`${baseUrl}/metrics`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("x-robots-tag") ?? "", /noindex/);

    const res = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(res.status, 200);
    const m = (await res.json()) as {
      total: number;
      agentes: { agente: string; total: number }[];
      leads: { agente: string; nome: string }[];
    };
    assert.equal(m.total, store.all().length);
    assert.equal(m.agentes.length, 5, "agentes sem leads também aparecem");
    assert.equal(m.agentes[0]?.agente, "Calebe");
    assert.equal(m.agentes[0]?.total, m.total);
    assert.equal(m.leads[0]?.nome, "Maria da Silva");

    const csv = await fetch(`${baseUrl}/metrics/leads.csv`);
    assert.equal(csv.status, 200);
  });

  it("protege o CSV com token", async () => {
    assert.equal((await fetch(`${baseUrl}/admin/leads.csv`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/admin/leads.csv?token=errado`)).status, 404);
    const res = await fetch(`${baseUrl}/admin/leads.csv?token=segredo`);
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.match(csv, /recebido_em;nome;telefone/);
    assert.match(csv, /Maria da Silva/);
  });
});

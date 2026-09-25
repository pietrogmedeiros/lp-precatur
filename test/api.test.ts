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
  /** Caminho de cada POST recebido, na mesma ordem de `received`. */
  const paths: string[] = [];
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
      paths.push(req.url ?? "");
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  return {
    received,
    paths,
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
  perfil: "Advogado",
  tem_precatorio: "Tem",
  tipo_precatorio: "Municipal",
  prioridade: "Alta",
  observacoes: "Precatório do TJ-ES, cliente com pressa.",
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
    const webhooks = {
      lp: webhookUrl,
      "palestra-rafael": webhookUrl.replace(/evento$/, "palestra-rafael"),
      // Mesmo com URL configurada, o sorteio não pode ir ao n8n.
      sorteio: webhookUrl.replace(/evento$/, "sorteio"),
    };
    dataDir = await mkdtemp(path.join(tmpdir(), "lp-precatur-"));
    const config = {
      ...loadConfig({}),
      dataDir,
      webhooks,
      adminToken: "segredo",
      evento: "Evento Teste",
    };
    store = new LeadStore(dataDir);
    await store.load();
    delivery = new LeadDelivery(store, webhooks, 2_000);
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
    webhook.paths.length = 0;
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
    // Assets versionados: um deploy novo nunca reaproveita CSS/JS antigos do cache do celular.
    assert.match(html, /href="\/styles\.css\?v=[0-9a-f]{10}"/);
  });

  it("serve a mesma página em /palestra-rafael, com outra origem e sem qualificação", async () => {
    const [raiz, copia] = await Promise.all([fetch(baseUrl), fetch(`${baseUrl}/palestra-rafael`)]);
    assert.equal(copia.status, 200);
    const [htmlRaiz, htmlCopia] = await Promise.all([raiz.text(), copia.text()]);
    assert.match(htmlRaiz, /"origem":"lp"/);
    assert.match(htmlCopia, /"origem":"palestra-rafael"/);
    assert.match(htmlRaiz, /<body data-origem="lp">/);
    assert.match(htmlCopia, /<body data-origem="palestra-rafael">/);
    // Fora a origem, o HTML é o mesmo: os campos de cada página são escondidos pelo CSS.
    const semOrigem = (html: string) => html.replace(/<body[^>]*>/, "").replace(/<script id="app-config".*?<\/script>/, "");
    assert.equal(semOrigem(htmlCopia), semOrigem(htmlRaiz));
  });

  it("salva e encaminha o lead ao n8n", async () => {
    const l = lead();
    const res = await post(l);
    assert.equal(res.status, 201);
    assert.equal(webhook.received.length, 1);
    const sent = webhook.received[0] as Record<string, unknown>;
    assert.equal(sent.nome, "Maria da Silva");
    assert.equal(sent.agente, "Calebe");
    assert.equal(sent.perfil, "Advogado");
    assert.equal(sent.tipo_precatorio, "Municipal");
    assert.equal(sent.prioridade, "Alta");
    assert.equal(sent.evento, "Evento Teste");
    assert.equal(sent.origem, "lp");
    assert.equal(webhook.paths[0], "/webhook/evento");
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
    assert.equal(m.agentes.length, 16, "agentes sem leads também aparecem");
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
    assert.match(csv, /perfil;tem_precatorio;tipo_precatorio;prioridade;originador;observacoes/);
    assert.match(csv, /Maria da Silva/);
  });

  it("a LP principal continua exigindo agente, precatório e prioridade", async () => {
    const { agente: _a, tem_precatorio: _t, tipo_precatorio: _tp, prioridade: _p, ...semQualificacao } = lead();
    const res = await post(semQualificacao);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { erros: Record<string, string> };
    assert.deepEqual(Object.keys(body.erros).sort(), ["agente", "prioridade", "tem_precatorio"]);

    // Originador é da palestra: na LP principal é descartado.
    const l = { ...lead(), originador: "Broker" };
    assert.equal((await post(l)).status, 201);
    assert.equal(store.get(l.id)?.originador, undefined);
  });

  it("envia os leads da palestra ao webhook próprio e separa no painel", async () => {
    // A palestra só pede nome, telefone, cidade, UF, perfil e observações.
    const { agente: _a, tem_precatorio: _t, tipo_precatorio: _tp, prioridade: _p, ...base } = lead();
    const l = { ...base, originador: "Broker", origem: "palestra-rafael" };
    assert.equal((await post(l)).status, 201);
    assert.equal(webhook.paths[0], "/webhook/palestra-rafael");
    assert.equal((webhook.received[0] as Record<string, unknown>).origem, "palestra-rafael");
    assert.equal(store.get(l.id)?.origem, "palestra-rafael");
    assert.equal(store.get(l.id)?.perfil, "Advogado");
    assert.equal(store.get(l.id)?.agente, undefined);
    assert.equal((webhook.received[0] as Record<string, unknown>).originador, "Broker");

    // A palestra exige o originador.
    const semOriginador = await post({ ...base, id: randomUUID(), origem: "palestra-rafael" });
    assert.equal(semOriginador.status, 400);
    assert.deepEqual(Object.keys(((await semOriginador.json()) as { erros: object }).erros), ["originador"]);

    // Qualificação enviada por engano pela palestra é descartada.
    const extra = { ...lead(), agente: "Qualquer", originador: "Outro", origem: "palestra-rafael" };
    assert.equal((await post(extra)).status, 201);
    assert.equal(store.get(extra.id)?.agente, undefined);
    assert.equal(store.get(extra.id)?.prioridade, undefined);

    const todas = (await (await fetch(`${baseUrl}/api/metrics`)).json()) as {
      total: number;
      origens: { origem: string; total: number }[];
    };
    const palestra = (await (await fetch(`${baseUrl}/api/metrics?origem=palestra-rafael`)).json()) as {
      origem: string;
      total: number;
      origens: { origem: string; total: number }[];
      leads: { id: string; origem: string }[];
    };
    assert.equal(palestra.origem, "palestra-rafael");
    assert.equal(palestra.total, 2);
    assert.deepEqual(palestra.leads.map((x) => x.origem), ["palestra-rafael", "palestra-rafael"]);
    assert.deepEqual(palestra.origens, todas.origens, "o resumo por página ignora o filtro");
    assert.deepEqual(todas.origens.map((o) => o.total), [todas.total - 2, 2, 0]);

    const csv = await (await fetch(`${baseUrl}/metrics/leads.csv?origem=palestra-rafael`)).text();
    assert.equal(csv.trim().split("\r\n").length, 3);
    assert.match(csv, /"palestra-rafael"/);
  });

  it("o painel recebe o início do processo, para se recarregar após um deploy", async () => {
    const res = await fetch(`${baseUrl}/api/metrics`);
    assert.match(res.headers.get("x-iniciado-em") ?? "", /^\d{4}-\d{2}-\d{2}T/);
  });

  it("o sorteio só pede nome e telefone, e só capta (não vai ao n8n)", async () => {
    const html = await (await fetch(`${baseUrl}/sorteio`)).text();
    assert.match(html, /<body data-origem="sorteio">/);

    const { nome, telefone, id, criado_em, consentimento_lgpd } = lead();
    const l = { id, criado_em, nome, telefone, consentimento_lgpd, origem: "sorteio" };
    const res = await post(l);
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { numero?: number }).numero, 1);
    const salvo = store.get(l.id);
    assert.equal(salvo?.origem, "sorteio");
    assert.equal(salvo?.numero, 1);
    // Reenvio da fila offline devolve o mesmo número, sem gastar outro.
    assert.equal(((await (await post(l)).json()) as { numero?: number }).numero, 1);
    assert.equal(salvo?.cidade, undefined);
    assert.equal(salvo?.perfil, undefined);

    // Campos de outras páginas enviados por engano são descartados.
    const extra = { ...lead(), originador: "Outro", origem: "sorteio" };
    assert.equal((await post(extra)).status, 201);
    assert.equal(store.get(extra.id)?.numero, 2);
    for (const campo of ["cidade", "uf", "perfil", "agente", "originador", "observacoes"] as const) {
      assert.equal(store.get(extra.id)?.[campo], undefined, campo);
    }

    assert.ok(!webhook.paths.includes("/webhook/sorteio"), "o sorteio não vai ao n8n");
    assert.ok(!webhook.received.some((r) => (r as Record<string, unknown>).origem === "sorteio"));
    assert.ok(!store.pending().some((x) => x.origem === "sorteio"), "não fica pendente");

    const csv = await (await fetch(`${baseUrl}/metrics/leads.csv?origem=sorteio`)).text();
    assert.equal(csv.trim().split("\r\n").length, 3);

    const m = (await (await fetch(`${baseUrl}/api/metrics?origem=sorteio`)).json()) as {
      total: number;
      pendentes: number;
      leads: { cidade?: string; uf?: string; numero?: number }[];
    };
    assert.equal(m.total, 2);
    assert.equal(m.pendentes, 0);
    assert.deepEqual(m.leads.map((x) => x.numero), [2, 1]);

    // Cadastros simultâneos nunca repetem número.
    const juntos = Array.from({ length: 5 }, () => ({ ...l, id: randomUUID() }));
    const numeros = await Promise.all(juntos.map(async (x) => ((await (await post(x)).json()) as { numero: number }).numero));
    assert.deepEqual(numeros.sort((a, b) => a - b), [3, 4, 5, 6, 7]);
    // Só o sorteio é numerado.
    assert.ok(store.all().every((x) => (x.origem === "sorteio") === (x.numero !== undefined)));
    assert.equal(m.leads[0]?.cidade, undefined);
  });

  it("o sorteador lista só os inscritos do sorteio, por número", async () => {
    const page = await fetch(`${baseUrl}/sorteador`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /src="\/js\/sorteador\.js/);

    const r = (await (await fetch(`${baseUrl}/api/sorteio`)).json()) as {
      evento: string;
      participantes: { numero: number; nome: string; telefone: string }[];
    };
    assert.equal(r.evento, "Evento Teste");
    const numeros = r.participantes.map((x) => x.numero);
    assert.ok(numeros.length >= 2);
    assert.deepEqual(numeros, [...numeros].sort((a, b) => a - b));
    assert.equal(numeros.length, store.all().filter((l) => l.origem === "sorteio").length);
    assert.deepEqual(Object.keys(r.participantes[0]!).sort(), ["nome", "numero", "telefone"]);
  });
});

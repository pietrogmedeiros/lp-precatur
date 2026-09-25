import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ORIGENS, ORIGENS_NUMERADAS, ORIGEM_PADRAO, camposForaDaPagina, type LeadField, type LeadResponse, type Origem, type PublicConfig } from "../shared/lead.js";
import { buildMetrics } from "./metrics.js";
import { leadRequestSchema } from "./schema.js";
import type { AppConfig } from "./config.js";
import type { LeadDelivery } from "./delivery.js";
import type { LeadStore, StoredLead } from "./store.js";
import type { SorteioResponse } from "../shared/sorteio.js";

interface Deps {
  config: AppConfig;
  store: LeadStore;
  delivery: LeadDelivery;
  /** Se DATA_DIR é um volume (null = não dá para saber). Exposto no /api/health. */
  dataVolume?: boolean | null;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://servicodados.ibge.gov.br",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
}

/** Limite simples por IP, em janela fixa de 1 minuto. */
function rateLimit(perMinute: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response<LeadResponse>, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + 60_000 };
      hits.set(key, entry);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
    }
    entry.count += 1;
    if (entry.count > perMinute) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      res.status(429).json({ ok: false, erros: { geral: "Muitas tentativas. Aguarde um instante." } });
      return;
    }
    next();
  };
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Token via "Authorization: Bearer ..." ou ?token=... */
function adminTokenFrom(req: Request): string | undefined {
  const header = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header || (typeof req.query.token === "string" ? req.query.token : undefined);
}

function toCsv(leads: StoredLead[]): string {
  const cols = [
    "numero", "recebido_em", "nome", "telefone", "cidade", "uf", "agente", "perfil", "tem_precatorio", "tipo_precatorio",
    "prioridade", "originador", "observacoes", "evento", "origem", "enviado", "tentativas", "ultimo_erro", "id",
  ] as const;
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = leads.map((l) => {
    const row = { ...l, origem: l.origem ?? ORIGEM_PADRAO };
    return cols.map((c) => esc(row[c])).join(";");
  });
  // BOM + ";" para o Excel em português abrir com acentos e colunas corretas.
  return "\ufeff" + [cols.join(";"), ...rows].join("\r\n");
}

/**
 * Acrescenta ?v=<hash do conteúdo> ao CSS e JS locais. O HTML nunca fica em cache, mas os assets
 * ficam por 1h: sem a versão na URL, quem abriu a página antes de um deploy recebia o HTML novo
 * com o CSS/JS antigos.
 */
function versionAssets(html: string, publicDir: string): string {
  return html.replace(/(href|src)="\/([^"?]+\.(?:css|js))"/g, (tag, attr: string, file: string) => {
    const full = path.join(publicDir, file);
    if (!existsSync(full)) return tag;
    const hash = createHash("sha256").update(readFileSync(full)).digest("hex").slice(0, 10);
    return `${attr}="/${file}?v=${hash}"`;
  });
}

/** URLs de cada página de captação; todas servem o mesmo index.html. */
const PAGINAS: Record<Origem, string[]> = {
  lp: ["/", "/index.html"],
  "palestra-rafael": ["/palestra-rafael"],
  sorteio: ["/sorteio"],
};

/** ?origem=... válido, ou undefined (= todas as páginas). */
function origemFrom(req: Request): Origem | undefined {
  const v = req.query.origem;
  return ORIGENS.find((o) => o === v);
}

export function createApp({ config, store, delivery, dataVolume = null }: Deps) {
  const app = express();
  // Muda a cada deploy/reinício: permite conferir de fora que o processo novo subiu.
  const iniciadoEm = new Date().toISOString();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(securityHeaders);

  // Injeta a configuração na página (sem requisição extra e sem "piscar" os selects).
  // A página é a mesma em todas as URLs; só muda a origem, que decide o webhook do lead.
  const indexTemplate = versionAssets(readFileSync(path.join(config.publicDir, "index.html"), "utf8"), config.publicDir);
  for (const origem of ORIGENS) {
    const publicConfig: PublicConfig = {
      evento: config.evento,
      origem,
      agentes: config.agentes,
      autoResetSegundos: config.autoResetSegundos,
    };
    const configJson = JSON.stringify(publicConfig).replace(/</g, "\\u003c");
    // data-origem esconde os campos de outras páginas já no primeiro paint (sem esperar o JS).
    const html = indexTemplate
      .replace("<body>", `<body data-origem="${origem}">`)
      .replace("<!--APP_CONFIG-->", `<script id="app-config" type="application/json">${configJson}</script>`);
    app.get(PAGINAS[origem], (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(html);
    });
  }

  const metricsHtml = versionAssets(readFileSync(path.join(config.publicDir, "metrics.html"), "utf8"), config.publicDir);
  app.get("/metrics", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(metricsHtml);
  });
  const sorteadorHtml = versionAssets(readFileSync(path.join(config.publicDir, "sorteador.html"), "utf8"), config.publicDir);
  app.get("/sorteador", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(sorteadorHtml);
  });
  app.use(express.static(config.publicDir, { index: false, maxAge: "1h" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, leads: store.all().length, pendentes: store.pending().length, volume: dataVolume, iniciado_em: iniciadoEm });
  });

  app.post(
    "/api/leads",
    rateLimit(config.rateLimitPerMinute),
    express.json({ limit: "10kb" }),
    async (req: Request, res: Response<LeadResponse>) => {
      const parsed = leadRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const erros: LeadResponse["erros"] = {};
        for (const issue of parsed.error.issues) {
          const field = (issue.path[0] as LeadField | undefined) ?? "geral";
          erros[field] ??= issue.message;
        }
        res.status(400).json({ ok: false, erros });
        return;
      }

      const { website, ...data } = parsed.data;
      for (const campo of camposForaDaPagina(data.origem)) delete data[campo];

      // Bot caiu no honeypot: finge sucesso e descarta.
      if (website) {
        res.status(201).json({ ok: true });
        return;
      }

      if (data.agente !== undefined && !config.agentes.includes(data.agente)) {
        res.status(400).json({ ok: false, erros: { agente: "Selecione quem te atendeu." } });
        return;
      }

      // O front reenvia leads que ficaram na fila offline; o id evita duplicar.
      const existente = store.get(data.id);
      if (existente) {
        res.status(200).json({ ok: true, duplicado: true, ...(existente.numero ? { numero: existente.numero } : {}) });
        return;
      }

      const lead: StoredLead = {
        ...data,
        ...(ORIGENS_NUMERADAS.includes(data.origem) ? { numero: store.nextNumero(data.origem) } : {}),
        evento: config.evento,
        recebido_em: new Date().toISOString(),
        enviado: false,
        tentativas: 0,
      };
      await store.save(lead);
      // O lead já está salvo em disco: responde sucesso mesmo se o n8n falhar (o reenvio é automático).
      await delivery.deliver(lead);
      res.status(201).json({ ok: true, ...(lead.numero ? { numero: lead.numero } : {}) });
    },
  );

  const sendCsv = (res: Response, origem?: Origem) => {
    const date = new Date().toISOString().slice(0, 10);
    const leads = origem ? store.all().filter((l) => (l.origem ?? ORIGEM_PADRAO) === origem) : store.all();
    res.setHeader("Content-Disposition", `attachment; filename="leads-precatur-${origem ? `${origem}-` : ""}${date}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.type("text/csv; charset=utf-8").send(toCsv(leads));
  };

  const isAdmin = (req: Request) => {
    const token = adminTokenFrom(req);
    return Boolean(config.adminToken && token && safeEqual(token, config.adminToken));
  };

  // Painel /metrics: aberto por padrão; com METRICS_TOKEN definido, passa a exigir o token.
  const canViewMetrics = (req: Request) => {
    if (!config.metricsToken) return true;
    const token = adminTokenFrom(req);
    return Boolean(token && safeEqual(token, config.metricsToken));
  };

  app.get("/api/metrics", rateLimit(config.rateLimitPerMinute), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // O painel compara com o valor da primeira carga e se recarrega após um deploy (JS novo).
    res.setHeader("X-Iniciado-Em", iniciadoEm);
    if (!canViewMetrics(req)) {
      res.status(401).json({ ok: false, erro: "Token inválido." });
      return;
    }
    res.json(buildMetrics(store.all(), { evento: config.evento, agentes: config.agentes, origem: origemFrom(req) }));
  });

  // Inscritos do /sorteio para o sorteador (mesma regra de acesso do /metrics).
  app.get("/api/sorteio", rateLimit(config.rateLimitPerMinute), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!canViewMetrics(req)) {
      res.status(401).json({ ok: false, erro: "Token inválido." });
      return;
    }
    const participantes = store
      .all()
      .filter((l) => l.origem === "sorteio" && l.numero)
      .map((l) => ({ numero: l.numero!, nome: l.nome, telefone: l.telefone }))
      .sort((a, b) => a.numero - b.numero);
    res.json({ evento: config.evento, participantes } satisfies SorteioResponse);
  });

  // CSV do painel (mesma regra de acesso do /metrics).
  app.get("/metrics/leads.csv", (req, res) => {
    if (!canViewMetrics(req)) {
      res.status(401).send("Token inválido.");
      return;
    }
    sendCsv(res, origemFrom(req));
  });

  // Exportação CSV: /admin/leads.csv?token=SEU_TOKEN (desativado se ADMIN_TOKEN estiver vazio).
  app.get("/admin/leads.csv", (req, res) => {
    if (!isAdmin(req)) {
      res.status(404).send("Not found");
      return;
    }
    sendCsv(res, origemFrom(req));
  });

  app.use((_req, res) => {
    res.status(404).send("Not found");
  });

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error("[server]", err);
    res.status(status).json({
      ok: false,
      erros: { geral: status === 400 ? "Requisição inválida." : "Erro interno. Tente novamente." },
    });
  });

  return app;
}

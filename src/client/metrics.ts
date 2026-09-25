import { ORIGEM_ROTULOS, vaiAoN8n, type Origem } from "../shared/lead.js";
import type { AgentMetrics, Breakdown, MetricsLead, MetricsResponse } from "../shared/metrics.js";

const TOKEN_KEY = "precatur_metrics_token";
const REFRESH_MS = 30_000;

/* ---------- Helpers ---------- */
function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Elemento não encontrado: ${selector}`);
  return el;
}

/** Cria elementos sem innerHTML (dados de lead nunca viram HTML). */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const c of children) if (c != null) el.append(c);
  return el;
}

const svgIcon = (path: string) => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
};

const ICON_OK = "m5 12 5 5 9-10";
const ICON_WAIT = "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0";

function statusBadge(ok: boolean, okText: string, waitText: string): HTMLElement {
  return h("span", { class: `status ${ok ? "good" : "warn"}` }, svgIcon(ok ? ICON_OK : ICON_WAIT), ok ? okText : waitText);
}

/** "Média" -> "p-media": classe estável para cor de prioridade. */
const priorityClass = (p: string) =>
  `p-${p.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}`;

const TZ = "America/Sao_Paulo";
const fmtDateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtInt = new Intl.NumberFormat("pt-BR");
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");

/* ---------- Token (opcional: só se o servidor tiver METRICS_TOKEN) ---------- */
function getToken(): string {
  const fromUrl = new URLSearchParams(location.search).get("token");
  if (fromUrl) {
    setToken(fromUrl);
    history.replaceState(null, "", location.pathname); // tira o token da barra de endereço
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function setToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sem storage */
  }
}

/* ---------- Estado ---------- */
let token = getToken();
let data: MetricsResponse | null = null;
/** Página de captação filtrada; "" = todas. */
let selectedOrigem: Origem | "" = "";
let selectedAgent = "";
let selectedPriority = "";
let query = "";
let timer: number | undefined;

const loginView = $("#login-view");
const dashView = $("#dash-view");
const actions = $("#actions");
const refreshBtn = $<HTMLButtonElement>("#refresh");
const agentFilter = $<HTMLSelectElement>("#filter-agent");
const priorityFilter = $<HTMLSelectElement>("#filter-priority");
const searchInput = $<HTMLInputElement>("#filter-q");
const tooltip = $("#tooltip");

function showLogin(message = ""): void {
  window.clearInterval(timer);
  dashView.hidden = true;
  actions.hidden = true;
  loginView.hidden = false;
  $("#login-err").textContent = message;
  $<HTMLInputElement>("#token").focus();
}

/** Processo do servidor visto na primeira carga; se mudar, houve deploy e o JS desta aba está velho. */
let servidorIniciadoEm: string | null = null;

async function load(): Promise<void> {
  refreshBtn.classList.add("spin");
  try {
    const origem = selectedOrigem;
    const res = await fetch(`/api/metrics${origem ? `?origem=${origem}` : ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (res.status === 401) {
      showLogin(token ? "Token inválido." : "");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const iniciadoEm = res.headers.get("X-Iniciado-Em");
    if (iniciadoEm && servidorIniciadoEm && iniciadoEm !== servidorIniciadoEm) {
      location.reload();
      return;
    }
    servidorIniciadoEm ??= iniciadoEm;
    // Troca de aba no meio da requisição: descarta a resposta da aba anterior.
    if (origem !== selectedOrigem) return;
    data = (await res.json()) as MetricsResponse;
    loginView.hidden = true;
    dashView.hidden = false;
    actions.hidden = false;
    $("#logout").hidden = !token;
    render();
  } catch {
    $("#updated").textContent = "Falha ao atualizar. Tentando de novo…";
  } finally {
    refreshBtn.classList.remove("spin");
  }
}

function startPolling(): void {
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (!document.hidden) void load();
  }, REFRESH_MS);
}

/* ---------- Render ---------- */
function render(): void {
  if (!data) return;
  const d = data;

  $("#evento").textContent = d.origem ? `${d.evento} · ${ORIGEM_ROTULOS[d.origem]}` : d.evento;
  $("#updated").textContent = `Atualizado às ${fmtTime.format(new Date(d.gerado_em))}`;
  const csvParams = new URLSearchParams();
  if (token) csvParams.set("token", token);
  if (d.origem) csvParams.set("origem", d.origem);
  const csv = $<HTMLAnchorElement>("#csv");
  csv.href = `/metrics/leads.csv${csvParams.size ? `?${csvParams}` : ""}`;

  renderOrigens(d);

  $("#kpi-total").textContent = fmtInt.format(d.total);
  $("#kpi-hoje").textContent = fmtInt.format(d.hoje);
  $("#kpi-agentes").textContent = `${d.agentes.filter((a) => a.total > 0).length}/${d.agentes.length}`;
  $("#kpi-alta").textContent = fmtInt.format(d.alta_prioridade);
  $("#kpi-n8n").replaceChildren(
    d.origem && !vaiAoN8n(d.origem)
      ? "Só captação"
      : statusBadge(d.pendentes === 0, "Todos enviados", `${d.pendentes} pendente${d.pendentes > 1 ? "s" : ""}`),
  );

  renderRanking(d.agentes, d.total);
  renderHours(d.horas_hoje);
  renderUfs(d.ufs, d.total);
  renderBars("#prioridades", d.prioridades, d.total, true);
  renderBars("#perfis", d.perfis, d.total, false);
  renderBars("#precatorios", d.precatorios, d.total, false);
  renderBars("#originadores", d.originadores, d.total, false);
  syncAgentFilter(d.agentes);
  syncPriorityFilter(d.prioridades);
  renderTable();
}

function renderOrigens(d: MetricsResponse): void {
  const todas = d.origens.reduce(
    (s, o) => ({ ...s, total: s.total + o.total, hoje: s.hoje + o.hoje, pendentes: s.pendentes + o.pendentes }),
    { origem: "" as const, rotulo: "Todas as páginas", total: 0, hoje: 0, pendentes: 0 },
  );
  $("#origens").replaceChildren(
    ...[todas, ...d.origens].map((o) => {
      const btn = h("button", { type: "button" }, o.rotulo, h("b", {}, fmtInt.format(o.total)));
      btn.setAttribute("aria-pressed", String(selectedOrigem === o.origem));
      bindTooltip(btn, () => `${o.rotulo}: ${o.total} leads · ${o.hoje} hoje${o.pendentes ? ` · ${o.pendentes} pendente(s) no n8n` : ""}`);
      btn.addEventListener("click", () => {
        if (selectedOrigem === o.origem) return;
        selectedOrigem = o.origem;
        tooltip.hidden = true;
        void load();
      });
      return btn;
    }),
  );
}

function renderRanking(agentes: AgentMetrics[], total: number): void {
  const max = Math.max(1, ...agentes.map((a) => a.total));
  const list = $("#ranking");
  list.classList.toggle("filtered", selectedAgent !== "");
  list.replaceChildren(
    ...agentes.map((a) => {
      const bar = h("span");
      bar.style.width = `${(a.total / max) * 100}%`;
      const ultimo = a.ultimo ? `último às ${fmtDateTime.format(new Date(a.ultimo))}` : "sem leads ainda";
      const btn = h(
        "button",
        { type: "button" },
        h("span", { class: "name", title: a.agente }, a.agente),
        h("span", { class: "track" }, bar),
        h(
          "span",
          { class: "nums" },
          h("strong", {}, fmtInt.format(a.total)),
          ` · ${pct(a.total, total)}`,
          h("small", {}, `${a.hoje} hoje`),
        ),
      );
      btn.setAttribute("aria-pressed", String(selectedAgent === a.agente));
      btn.setAttribute(
        "aria-label",
        `${a.agente}: ${a.total} leads (${pct(a.total, total)}), ${a.hoje} hoje, ${ultimo}`,
      );
      bindTooltip(btn, () => `${a.agente}: ${a.total} leads · ${a.hoje} hoje · ${ultimo}${a.pendentes ? ` · ${a.pendentes} pendente(s) no n8n` : ""}`);
      btn.addEventListener("click", () => {
        selectedAgent = selectedAgent === a.agente ? "" : a.agente;
        agentFilter.value = selectedAgent;
        render();
      });
      return h("li", {}, btn);
    }),
  );
}

function renderHours(horas: MetricsResponse["horas_hoje"]): void {
  const withData = horas.filter((x) => x.total > 0).map((x) => x.hora);
  // Mostra o horário comercial e expande se houver lead fora dele.
  const from = Math.min(8, ...withData);
  const to = Math.max(20, ...withData);
  const slice = horas.filter((x) => x.hora >= from && x.hora <= to);
  const max = Math.max(1, ...slice.map((x) => x.total));
  const total = slice.reduce((s, x) => s + x.total, 0);
  const peak = slice.reduce((a, b) => (b.total > a.total ? b : a), slice[0]!);

  $("#hours-sub").textContent = total ? `Pico às ${peak.hora}h (${peak.total})` : "Nenhum lead hoje";
  const box = $("#hours");
  box.setAttribute("aria-label", slice.map((x) => `${x.hora}h: ${x.total}`).join(", "));
  box.replaceChildren(
    ...slice.map((x, i) => {
      const bar = h("i");
      bar.style.height = `${(x.total / max) * 100}%`;
      const col = h("div", { class: `col${x.total ? "" : " zero"}` }, bar, h("b", { class: i % 2 ? "hide" : "" }, `${x.hora}h`));
      bindTooltip(col, () => `${x.hora}h–${x.hora + 1}h: ${x.total} lead${x.total === 1 ? "" : "s"}`);
      return col;
    }),
  );
}

function renderUfs(ufs: MetricsResponse["ufs"], total: number): void {
  const top = ufs.slice(0, 8);
  const max = Math.max(1, ...top.map((u) => u.total));
  const list = $("#ufs");
  if (!top.length) {
    list.replaceChildren(h("li", { class: "muted" }, "Sem dados ainda."));
    return;
  }
  list.replaceChildren(
    ...top.map((u) => {
      const bar = h("span");
      bar.style.width = `${(u.total / max) * 100}%`;
      const li = h("li", {}, h("strong", {}, u.uf), h("span", { class: "track" }, bar), h("span", {}, String(u.total)));
      bindTooltip(li, () => `${u.uf}: ${u.total} lead${u.total === 1 ? "" : "s"} (${pct(u.total, total)})`);
      return li;
    }),
  );
}

/** Barras dos recortes por categoria. `colorir` pinta cada barra com a cor da prioridade. */
function renderBars(selector: string, itens: Breakdown[], total: number, colorir: boolean): void {
  const max = Math.max(1, ...itens.map((i) => i.total));
  $(selector).replaceChildren(
    ...itens.map((i) => {
      const bar = h("span", colorir ? { class: priorityClass(i.rotulo) } : {});
      bar.style.width = `${(i.total / max) * 100}%`;
      const li = h(
        "li",
        { class: i.total ? "" : "zero" },
        h("span", { class: "rotulo", title: i.rotulo }, i.rotulo),
        h("span", { class: "valor" }, fmtInt.format(i.total)),
        h("span", { class: "track" }, bar),
      );
      bindTooltip(li, () => `${i.rotulo}: ${i.total} lead${i.total === 1 ? "" : "s"} (${pct(i.total, total)})`);
      return li;
    }),
  );
}

/** As opções vêm prontas do recorte: as três fixas, mais "Não informado" se houver lead antigo. */
function syncPriorityFilter(prioridades: Breakdown[]): void {
  const next = prioridades.map((p) => p.rotulo);
  const current = [...priorityFilter.options].slice(1).map((o) => o.value).join("|");
  if (current !== next.join("|")) {
    priorityFilter.replaceChildren(new Option("Todas as prioridades", ""), ...next.map((p) => new Option(p, p)));
  }
  priorityFilter.value = selectedPriority;
  // A opção escolhida pode ter sumido entre atualizações: não deixa um filtro invisível travando a tabela.
  if (priorityFilter.value !== selectedPriority) selectedPriority = "";
}

function syncAgentFilter(agentes: AgentMetrics[]): void {
  const current = [...agentFilter.options].slice(1).map((o) => o.value).join("|");
  const next = agentes.map((a) => a.agente).sort((a, b) => a.localeCompare(b));
  if (current !== next.join("|")) {
    agentFilter.replaceChildren(new Option("Todos os agentes", ""), ...next.map((a) => new Option(a, a)));
  }
  agentFilter.value = selectedAgent;
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function renderTable(): void {
  if (!data) return;
  const q = normalize(query.trim());
  const qDigits = query.replace(/\D/g, "");
  const leads = data.leads.filter((l) => {
    if (selectedAgent && l.agente !== selectedAgent) return false;
    if (selectedPriority && (l.prioridade ?? "Não informado") !== selectedPriority) return false;
    if (!q) return true;
    if (normalize(`${l.nome} ${l.cidade ?? ""} ${l.uf ?? ""} ${l.perfil ?? ""} ${l.observacoes ?? ""}`).includes(q)) return true;
    return qDigits.length >= 3 && l.telefone.replace(/\D/g, "").includes(qDigits);
  });

  const escopo = [selectedAgent && `de ${selectedAgent}`, selectedPriority && `· prioridade ${selectedPriority}`]
    .filter(Boolean)
    .join(" ");
  $("#table-title").textContent = `Leads ${escopo} (${leads.length})`.replace(/\s+/g, " ");
  $("#empty").hidden = leads.length > 0;
  $("#rows").replaceChildren(...leads.map(row));
}

function row(l: MetricsLead): HTMLTableRowElement {
  const digits = l.telefone.replace(/\D/g, "");
  const wa = h("a", { href: `https://wa.me/55${digits}`, target: "_blank", rel: "noopener", title: "Abrir no WhatsApp" }, l.telefone);
  // Páginas que só captam não mandam ao n8n: não há o que ficar pendente.
  const badge = vaiAoN8n(l.origem) ? statusBadge(l.enviado, "Enviado", "Pendente") : h("span", { class: "muted-cell" }, "Só captação");
  if (!l.enviado && l.ultimo_erro) badge.title = `${l.tentativas} tentativa(s): ${l.ultimo_erro}`;
  const nome = h("td", { class: "name" }, l.numero ? h("span", { class: "numero" }, `Nº ${l.numero}`) : null, l.nome);
  // Observação completa fica no title; a célula mostra só a primeira linha.
  if (l.observacoes) nome.append(h("span", { class: "obs", title: l.observacoes }, l.observacoes));

  const precatorio = l.tem_precatorio === "Não tem" ? "Não tem" : l.tipo_precatorio ?? "—";
  const prioridade = l.prioridade
    ? h("span", { class: `tag ${priorityClass(l.prioridade)}` }, l.prioridade)
    : "—";

  return h(
    "tr",
    {},
    h("td", { class: "when" }, fmtDateTime.format(new Date(l.recebido_em))),
    h("td", {}, ORIGEM_ROTULOS[l.origem] ?? l.origem),
    nome,
    h("td", {}, wa),
    h("td", { class: l.cidade ? "" : "muted-cell" }, l.cidade ? `${l.cidade}/${l.uf}` : "—"),
    h("td", { class: l.agente ? "" : "muted-cell" }, l.agente ?? "—"),
    h("td", { class: l.perfil ? "" : "muted-cell" }, l.perfil ?? "—"),
    h("td", { class: l.originador ? "" : "muted-cell" }, l.originador ?? "—"),
    h("td", { class: precatorio === "—" ? "muted-cell" : "" }, precatorio),
    h("td", {}, prioridade),
    h("td", {}, badge),
  );
}

/* ---------- Tooltip ---------- */
function bindTooltip(el: HTMLElement, text: () => string): void {
  el.addEventListener("pointerenter", () => {
    tooltip.textContent = text();
    tooltip.hidden = false;
    const r = el.getBoundingClientRect();
    tooltip.style.left = `${Math.min(Math.max(r.left + r.width / 2, 120), window.innerWidth - 120)}px`;
    tooltip.style.top = `${r.top}px`;
  });
  el.addEventListener("pointerleave", () => (tooltip.hidden = true));
}
window.addEventListener("scroll", () => (tooltip.hidden = true), { passive: true });

/* ---------- Eventos ---------- */
$<HTMLFormElement>("#login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $<HTMLInputElement>("#token").value.trim();
  setToken(token);
  void load().then(startPolling);
});

$("#logout").addEventListener("click", () => {
  token = "";
  setToken("");
  showLogin();
});

refreshBtn.addEventListener("click", () => void load());

agentFilter.addEventListener("change", () => {
  selectedAgent = agentFilter.value;
  render();
});

priorityFilter.addEventListener("change", () => {
  selectedPriority = priorityFilter.value;
  renderTable();
});

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  renderTable();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void load();
});

void load().then(startPolling);

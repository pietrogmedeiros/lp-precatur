import {
  UFS,
  CONSENT_ERROR,
  ORIGINADORES,
  camposForaDaPagina,
  ORIGEM_PADRAO,
  PERFIS,
  PRIORIDADES,
  TEM_PRECATORIO,
  TIPOS_PRECATORIO,
  fieldValidators,
  formatPhone,
  validateTipoPrecatorio,
  type LeadField,
  type LeadRequest,
  type LeadResponse,
  type PublicConfig,
} from "../shared/lead.js";

const QUEUE_KEY = "precatur_fila_v1";
const QUEUE_RETRY_MS = 30_000;

/* ---------- Helpers de DOM ---------- */
function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Elemento não encontrado: ${selector}`);
  return el;
}

function readConfig(): PublicConfig {
  const raw = document.getElementById("app-config")?.textContent;
  const fallback: PublicConfig = { evento: "", origem: ORIGEM_PADRAO, agentes: [], autoResetSegundos: 15 };
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<PublicConfig>) };
  } catch {
    return fallback;
  }
}

/** crypto.randomUUID só existe em HTTPS/localhost; em http://IP-da-rede (tablet no evento) usa o fallback. */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- Fila offline (localStorage) ---------- */
function loadQueue(): LeadRequest[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as LeadRequest[];
  } catch {
    return [];
  }
}

function saveQueue(queue: LeadRequest[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Armazenamento indisponível (modo privado): segue sem fila.
  }
}

type SendResult = { status: "ok"; numero?: number } | { status: "invalid"; body: LeadResponse } | { status: "retry" };

async function postLead(lead: LeadRequest): Promise<SendResult> {
  try {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    });
    if (res.ok) return { status: "ok", numero: ((await res.json()) as LeadResponse).numero };
    if (res.status === 400) return { status: "invalid", body: (await res.json()) as LeadResponse };
    return { status: "retry" };
  } catch {
    return { status: "retry" };
  }
}

let flushing = false;
async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const lead of loadQueue()) {
      const result = await postLead(lead);
      if (result.status === "retry") break; // servidor ainda fora do ar
      // Enviado ou rejeitado de vez: sai da fila.
      saveQueue(loadQueue().filter((l) => l.id !== lead.id));
    }
  } finally {
    flushing = false;
  }
}

/* ---------- Página ---------- */
const config = readConfig();

const form = $<HTMLFormElement>("#lead-form");
const card = $("#form-card");
const btn = $<HTMLButtonElement>("#submit-btn");
const alertBox = $("#form-alert");
const consent = $<HTMLInputElement>("#consent");
const consentWrap = $("#consent-wrap");
const ufSelect = $<HTMLSelectElement>("#uf");
const agentSelect = $<HTMLSelectElement>("#agente");
const perfilSelect = $<HTMLSelectElement>("#perfil");
const originadorSelect = $<HTMLSelectElement>("#originador");
const phoneInput = $<HTMLInputElement>("#telefone");
const cityList = $<HTMLDataListElement>("#cidades-list");
const tipoField = $("[data-field='tipo_precatorio']");

$("#event-name").textContent = config.evento || "Estamos no evento";
UFS.forEach((uf) => ufSelect.add(new Option(uf, uf)));
config.agentes.forEach((a) => agentSelect.add(new Option(a, a)));
PERFIS.forEach((p) => perfilSelect.add(new Option(p, p)));
ORIGINADORES.forEach((o) => originadorSelect.add(new Option(o, o)));

/** Monta um grupo de radios como botões: <input> escondido + <label> clicável. */
function buildChoices(containerId: string, name: string, options: readonly string[]): void {
  const container = $(containerId);
  container.replaceChildren(
    ...options.flatMap((value, i) => {
      const id = `${name}-${i}`;
      const input = Object.assign(document.createElement("input"), { type: "radio", name, value, id });
      const label = Object.assign(document.createElement("label"), { htmlFor: id, textContent: value });
      return [input, label];
    }),
  );
}

buildChoices("#tem-precatorio-choices", "tem_precatorio", TEM_PRECATORIO);
buildChoices("#tipo-precatorio-choices", "tipo_precatorio", TIPOS_PRECATORIO);
buildChoices("#prioridade-choices", "prioridade", PRIORIDADES);

/* ---------- Máscara de telefone: (DD) 99999-9999 ---------- */
const countDigits = (s: string) => s.replace(/\D/g, "").length;

function applyPhoneMask(): void {
  const raw = phoneInput.value;
  const caret = phoneInput.selectionStart ?? raw.length;
  const digitsBeforeCaret = countDigits(raw.slice(0, caret));
  const masked = formatPhone(raw);
  phoneInput.value = masked;
  // Recoloca o cursor depois do mesmo número de dígitos (não pula para o fim ao editar no meio).
  let pos = 0;
  for (let seen = 0; pos < masked.length && seen < digitsBeforeCaret; pos++) {
    if (/\d/.test(masked[pos]!)) seen++;
  }
  if (document.activeElement === phoneInput) phoneInput.setSelectionRange(pos, pos);
}

// Backspace logo depois de ")", " " ou "-" apaga o dígito anterior, em vez de travar na máscara.
phoneInput.addEventListener("beforeinput", (e) => {
  const { selectionStart: start, selectionEnd: end, value } = phoneInput;
  if (e.inputType !== "deleteContentBackward" || start === null || start !== end || start === 0) return;
  if (/\d/.test(value[start - 1]!)) return;
  let i = start - 1;
  while (i > 0 && !/\d/.test(value[i - 1]!)) i--;
  if (i === 0) return;
  e.preventDefault();
  phoneInput.value = value.slice(0, i - 1) + value.slice(start);
  phoneInput.setSelectionRange(i - 1, i - 1);
  applyPhoneMask();
});
phoneInput.addEventListener("input", applyPhoneMask);

/* Sugestão de cidades (IBGE) ao escolher a UF; sem internet o campo continua livre. */
const cityCache = new Map<string, string[]>();
ufSelect.addEventListener("change", async () => {
  const uf = ufSelect.value;
  cityList.replaceChildren();
  try {
    if (!cityCache.has(uf)) {
      const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
      if (!res.ok) return;
      const data = (await res.json()) as { nome: string }[];
      cityCache.set(uf, data.map((m) => m.nome));
    }
    if (ufSelect.value !== uf) return; // trocou de UF durante o carregamento
    cityList.replaceChildren(
      ...cityCache.get(uf)!.map((nome) => Object.assign(document.createElement("option"), { value: nome })),
    );
  } catch {
    /* ignora */
  }
});

/* ---------- Validação ---------- */
const FORM_FIELDS = [
  "nome", "telefone", "cidade", "uf", "agente",
  "perfil", "originador", "tem_precatorio", "tipo_precatorio", "prioridade", "observacoes",
] as const satisfies readonly LeadField[];
type FormField = (typeof FORM_FIELDS)[number];

/** Campos exclusivos de outras páginas ficam escondidos e não são validados nem enviados. */
const foraDaPagina: readonly string[] = camposForaDaPagina(config.origem);
const perguntado = (name: FormField) => !foraDaPagina.includes(name);
const camposAtivos = FORM_FIELDS.filter(perguntado);

/** Valor atual do campo. Em grupos de radio, RadioNodeList.value é a opção marcada (ou ""). */
function value(name: FormField): string {
  const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | RadioNodeList | null;
  return el?.value ?? "";
}

function wrapOf(name: FormField): HTMLElement | null {
  return form.querySelector<HTMLElement>(`[data-field="${name}"]`);
}

/** Primeiro controle do campo, para levar o foco quando a validação falha. */
function focusTarget(name: FormField): HTMLElement | null {
  return wrapOf(name)?.querySelector<HTMLElement>("input, select, textarea") ?? null;
}

function setError(name: LeadField, message: string | null): void {
  if (name === "consentimento_lgpd") {
    consentWrap.classList.toggle("has-error", message !== null);
    return;
  }
  const wrap = form.querySelector<HTMLElement>(`[data-field="${name}"]`);
  if (!wrap) return;
  wrap.classList.toggle("has-error", message !== null);
  const err = wrap.querySelector(".err");
  if (err && message) err.textContent = message;
}

function checkField(name: FormField): boolean {
  const v = value(name);
  let message =
    name === "tipo_precatorio"
      ? validateTipoPrecatorio(v, value("tem_precatorio"))
      : fieldValidators[name](v);
  if (!message && name === "agente" && !config.agentes.includes(v)) message = "Selecione quem te atendeu.";
  setError(name, message);
  return message === null;
}

/** Tipo de precatório só aparece para quem tem; ao esconder, limpa a resposta anterior. */
function syncTipoPrecatorio(): void {
  const tem = value("tem_precatorio") === "Tem";
  tipoField.hidden = !tem;
  if (tem) return;
  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="tipo_precatorio"]')) {
    radio.checked = false;
  }
  setError("tipo_precatorio", null);
}

for (const name of FORM_FIELDS) {
  const wrap = wrapOf(name);
  if (!wrap) continue;
  for (const el of wrap.querySelectorAll<HTMLElement>("input, select, textarea")) {
    // Radio e select reagem ao "change"; texto só ao sair do campo, para não acusar erro enquanto digita.
    const isChoice = el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === "radio");
    el.addEventListener(isChoice ? "change" : "blur", () => checkField(name));
    el.addEventListener("input", () => {
      if (wrap.classList.contains("has-error")) checkField(name);
    });
  }
}
form.addEventListener("change", (e) => {
  if ((e.target as HTMLInputElement).name === "tem_precatorio") syncTipoPrecatorio();
});
consent.addEventListener("change", () => setError("consentimento_lgpd", consent.checked ? null : CONSENT_ERROR));

function validateAll(): boolean {
  let first: HTMLElement | null = null;
  for (const name of camposAtivos) {
    if (!checkField(name) && !first) first = focusTarget(name);
  }
  setError("consentimento_lgpd", consent.checked ? null : CONSENT_ERROR);
  if (!consent.checked && !first) first = consent;
  first?.focus();
  return first === null;
}

function showAlert(message: string | null): void {
  alertBox.textContent = message ?? "";
  alertBox.classList.toggle("show", message !== null);
}

/* ---------- Envio ---------- */
let resetTimer: number | undefined;

function setLoading(loading: boolean): void {
  btn.disabled = loading;
  btn.classList.toggle("loading", loading);
}

function showSuccess(lead: LeadRequest, numero?: number): void {
  const firstName = lead.nome.trim().split(/\s+/)[0];
  $("#success-msg").textContent = numero
    ? `Obrigado, ${firstName}! Você está participando do sorteio com o número ${numero}.`
    : `Obrigado, ${firstName}! Em breve um especialista da Precatur entrará em contato pelo ${formatPhone(lead.telefone)}.`;
  card.classList.add("done");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  startAutoReset();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showAlert(null);
  if (!validateAll()) return;

  const temPrecatorio = value("tem_precatorio") as LeadRequest["tem_precatorio"];
  const observacoes = value("observacoes").trim();
  const lead: LeadRequest = {
    id: uuid(),
    nome: value("nome").trim(),
    telefone: value("telefone").trim(),
    // Só vai o que a página pergunta: sem precatório não há tipo, e observação vazia não vira "".
    ...(perguntado("cidade") ? { cidade: value("cidade").trim() } : {}),
    ...(perguntado("uf") ? { uf: value("uf") as LeadRequest["uf"] } : {}),
    ...(perguntado("perfil") ? { perfil: value("perfil") as LeadRequest["perfil"] } : {}),
    ...(perguntado("agente") ? { agente: value("agente") } : {}),
    ...(perguntado("originador") ? { originador: value("originador") as LeadRequest["originador"] } : {}),
    ...(perguntado("tem_precatorio") ? { tem_precatorio: temPrecatorio } : {}),
    ...(perguntado("tipo_precatorio") && temPrecatorio === "Tem"
      ? { tipo_precatorio: value("tipo_precatorio") as LeadRequest["tipo_precatorio"] }
      : {}),
    ...(perguntado("prioridade") ? { prioridade: value("prioridade") as LeadRequest["prioridade"] } : {}),
    ...(perguntado("observacoes") && observacoes ? { observacoes } : {}),
    consentimento_lgpd: true,
    criado_em: new Date().toISOString(),
    origem: config.origem,
    website: (form.elements.namedItem("website") as HTMLInputElement).value,
  };

  setLoading(true);
  const result = await postLead(lead);
  setLoading(false);

  if (result.status === "invalid") {
    const erros = result.body.erros ?? {};
    for (const [field, message] of Object.entries(erros)) {
      if (field !== "geral") setError(field as LeadField, message ?? "");
    }
    showAlert(erros.geral ?? "Confira os campos destacados.");
    return;
  }

  if (result.status === "retry") {
    // Sem conexão com o servidor: guarda no aparelho e reenvia depois. O lead não se perde.
    saveQueue([...loadQueue(), lead]);
  }
  showSuccess(lead, result.status === "ok" ? result.numero : undefined);
});

function resetForm(): void {
  window.clearInterval(resetTimer);
  form.reset();
  cityList.replaceChildren();
  form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
  consentWrap.classList.remove("has-error");
  showAlert(null);
  syncTipoPrecatorio();
  $("#countdown").textContent = "";
  card.classList.remove("done");
  focusTarget("nome")?.focus();
}

function startAutoReset(): void {
  const total = config.autoResetSegundos;
  if (!total) return;
  const countdown = $("#countdown");
  let left = total;
  const render = () => (countdown.textContent = `Voltando ao formulário em ${left}s`);
  render();
  resetTimer = window.setInterval(() => {
    left -= 1;
    if (left <= 0) resetForm();
    else render();
  }, 1000);
}

$("#new-lead").addEventListener("click", resetForm);

/* ---------- Fila offline ---------- */
window.addEventListener("online", () => void flushQueue());
window.setInterval(() => void flushQueue(), QUEUE_RETRY_MS);
void flushQueue();

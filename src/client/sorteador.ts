import {
  elegiveis,
  indiceAleatorio,
  mascararTelefone,
  parseNumeros,
  type Participante,
  type SorteioResponse,
} from "../shared/sorteio.js";

/** Mesmo token do /metrics: quem já entrou no painel nesta aba não precisa digitar de novo. */
const TOKEN_KEY = "precatur_metrics_token";
const ESTADO_KEY = "precatur_sorteador";
const REFRESH_MS = 30_000;
const reduzMovimento = matchMedia("(prefers-reduced-motion: reduce)").matches;

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

const fmtTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Aleatoriedade criptográfica: ninguém consegue prever o próximo número. */
const random32 = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

/* ---------- Token ---------- */
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

function setToken(value: string): void {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sem storage */
  }
}

/* ---------- Estado (fica neste navegador: recarregar a página não perde os ganhadores) ---------- */
interface Ganhador extends Participante {
  sorteado_em: string;
}

interface Estado {
  ganhadores: Ganhador[];
  excluidos: string;
  umaChancePorTelefone: boolean;
}

function carregarEstado(): Estado {
  const padrao: Estado = { ganhadores: [], excluidos: "", umaChancePorTelefone: true };
  try {
    const salvo = JSON.parse(localStorage.getItem(ESTADO_KEY) ?? "null") as Partial<Estado> | null;
    return { ...padrao, ...salvo, ganhadores: Array.isArray(salvo?.ganhadores) ? salvo.ganhadores : [] };
  } catch {
    return padrao;
  }
}

function salvarEstado(): void {
  try {
    localStorage.setItem(ESTADO_KEY, JSON.stringify(estado));
  } catch {
    /* sem storage: vale só enquanto a aba estiver aberta */
  }
}

let token = getToken();
const estado = carregarEstado();
let participantes: Participante[] = [];
let sorteando = false;
let timer: number | undefined;

const loginView = $("#login-view");
const mainView = $("#main-view");
const actions = $("#actions");
const sortearBtn = $<HTMLButtonElement>("#sortear");
const excluidosInput = $<HTMLInputElement>("#excluidos");
const umaChanceInput = $<HTMLInputElement>("#uma-chance");
const bilhete = $("#bilhete");

excluidosInput.value = estado.excluidos;
umaChanceInput.checked = estado.umaChancePorTelefone;

const concorrentes = () =>
  elegiveis(participantes, {
    excluidos: new Set([...parseNumeros(estado.excluidos), ...estado.ganhadores.map((g) => g.numero)]),
    umaChancePorTelefone: estado.umaChancePorTelefone,
  });

function showLogin(message = ""): void {
  window.clearInterval(timer);
  mainView.hidden = true;
  actions.hidden = true;
  loginView.hidden = false;
  $("#login-err").textContent = message;
  $<HTMLInputElement>("#token").focus();
}

/** Busca os inscritos. Devolve false se precisou de login ou falhou. */
async function load(): Promise<boolean> {
  try {
    const res = await fetch("/api/sorteio", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (res.status === 401) {
      showLogin(token ? "Token inválido." : "");
      return false;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as SorteioResponse;
    participantes = data.participantes;
    $("#evento").textContent = data.evento;
    loginView.hidden = true;
    mainView.hidden = false;
    actions.hidden = false;
    $("#logout").hidden = !token;
    $("#erro").textContent = "";
    render();
    return true;
  } catch {
    $("#erro").textContent = "Não foi possível carregar os participantes. Verifique a conexão.";
    return false;
  }
}

function startPolling(): void {
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (!document.hidden && !sorteando) void load();
  }, REFRESH_MS);
}

/* ---------- Render ---------- */
function render(): void {
  const n = concorrentes().length;
  const fora = participantes.length - n;
  $("#info").textContent = participantes.length
    ? `${plural(n, "participante concorrendo", "participantes concorrendo")}${fora ? ` · ${fora} fora` : ""}`
    : "Ainda não há inscritos no sorteio.";
  sortearBtn.disabled = sorteando || n === 0;
  sortearBtn.textContent = estado.ganhadores.length ? "Sortear de novo" : "Sortear";
  renderGanhadores();
}

function renderGanhadores(): void {
  const lista = $("#ganhadores");
  $("#sem-ganhadores").hidden = estado.ganhadores.length > 0;
  $("#limpar").hidden = estado.ganhadores.length === 0 || sorteando;
  lista.replaceChildren(
    ...estado.ganhadores.map((g, i) => {
      const devolver = h("button", { type: "button", class: "devolver", title: "Devolver ao sorteio (sorteado por engano)" }, "×");
      devolver.setAttribute("aria-label", `Devolver o número ${g.numero} ao sorteio`);
      devolver.hidden = sorteando;
      devolver.addEventListener("click", () => {
        if (!confirmar(`Devolver o Nº ${g.numero} (${g.nome}) ao sorteio?`)) return;
        estado.ganhadores.splice(i, 1);
        salvarEstado();
        render();
      });
      return h(
        "li",
        {},
        h("span", { class: "pos" }, `${i + 1}º`),
        h("span", { class: "num" }, `Nº ${g.numero}`),
        h("span", { class: "quem" }, h("strong", {}, g.nome), h("small", {}, `${mascararTelefone(g.telefone)} · ${fmtTime.format(new Date(g.sorteado_em))}`)),
        devolver,
      );
    }),
  );
}

/** Confirmação nativa; sem ela (ex.: navegador que bloqueia diálogos) a ação segue. */
function confirmar(msg: string): boolean {
  try {
    return window.confirm(msg);
  } catch {
    return true;
  }
}

function mostrar(p: Participante, telefone = false): void {
  $("#numero").textContent = `Nº ${p.numero}`;
  $("#nome").textContent = p.nome;
  $("#telefone").textContent = telefone ? mascararTelefone(p.telefone) : "";
}

/* ---------- Sorteio ---------- */
async function sortear(): Promise<void> {
  if (sorteando) return;
  sorteando = true;
  sortearBtn.disabled = true;
  $("#erro").textContent = "";
  bilhete.classList.remove("revelado");
  $("#confete").replaceChildren();

  // Busca de novo na hora: quem se inscreveu nos últimos segundos também concorre.
  const ok = await load();
  const lista = concorrentes();
  if (!ok || lista.length === 0) {
    sorteando = false;
    if (ok) $("#erro").textContent = "Não há participantes para sortear.";
    render();
    return;
  }
  render();

  const vencedor = lista[indiceAleatorio(lista.length, random32)]!;

  // Suspense: nomes passando cada vez mais devagar até parar no vencedor.
  bilhete.classList.add("girando");
  const passos = reduzMovimento ? 4 : 38;
  for (let i = 0; i < passos; i++) {
    mostrar(lista[Math.floor(Math.random() * lista.length)]!);
    const t = i / passos;
    await esperar(reduzMovimento ? 250 : 45 + 380 * t * t * t);
  }
  bilhete.classList.remove("girando");
  mostrar(vencedor, true);
  bilhete.classList.add("revelado");
  if (!reduzMovimento) soltarConfete();

  estado.ganhadores.push({ ...vencedor, sorteado_em: new Date().toISOString() });
  salvarEstado();
  sorteando = false;
  render();
}

function soltarConfete(): void {
  const cores = ["#C9A27A", "#34474D", "#E8D5BF", "#8FB3BD", "#F2B35C"];
  const pecas = Array.from({ length: 90 }, (_, i) => {
    const p = h("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = cores[i % cores.length]!;
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    p.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    p.style.setProperty("--x", `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
    return p;
  });
  const box = $("#confete");
  box.replaceChildren(...pecas);
  setTimeout(() => box.replaceChildren(), 4500);
}

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

sortearBtn.addEventListener("click", () => void sortear());

$("#limpar").addEventListener("click", () => {
  if (!confirmar("Limpar a lista de ganhadores? Todos voltam a concorrer.")) return;
  estado.ganhadores = [];
  salvarEstado();
  bilhete.classList.remove("revelado");
  $("#numero").textContent = "?";
  $("#nome").textContent = "Pronto para sortear";
  $("#telefone").textContent = "";
  render();
});

excluidosInput.addEventListener("input", () => {
  estado.excluidos = excluidosInput.value;
  salvarEstado();
  render();
});

umaChanceInput.addEventListener("change", () => {
  estado.umaChancePorTelefone = umaChanceInput.checked;
  salvarEstado();
  render();
});

$("#fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !sorteando) void load();
});

void load().then(startPolling);

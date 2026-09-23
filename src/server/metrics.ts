import { ORIGENS, ORIGEM_PADRAO, ORIGEM_ROTULOS, ORIGINADORES, PERFIS, PRIORIDADES, TIPOS_PRECATORIO, type Origem } from "../shared/lead.js";
import type { AgentMetrics, Breakdown, MetricsLead, MetricsResponse, OrigemMetrics } from "../shared/metrics.js";
import type { StoredLead } from "./store.js";

/** Leads antigos (anteriores ao campo) e valores fora da lista caem aqui. */
const SEM_RESPOSTA = "Não informado";

/**
 * Conta os leads por categoria mantendo as opções fixas na ordem do formulário,
 * mesmo zeradas — um "Alta: 0" diz tanto quanto um "Alta: 12".
 */
function breakdown(leads: StoredLead[], fixas: readonly string[], key: (l: StoredLead) => string): Breakdown[] {
  const counts = new Map<string, number>(fixas.map((r) => [r, 0]));
  for (const lead of leads) {
    const rotulo = key(lead);
    counts.set(rotulo, (counts.get(rotulo) ?? 0) + 1);
  }
  // Extras (Não informado, valores antigos) vão para o fim, sem poluir quando estão zerados.
  return [...counts.entries()]
    .filter(([rotulo, total]) => total > 0 || fixas.includes(rotulo))
    .map(([rotulo, total]) => ({ rotulo, total }));
}

/** Rótulo do precatório na visão consolidada: o tipo de quem tem, "Não tem" de quem não tem. */
function precatorioLabel(lead: StoredLead): string {
  if (lead.tem_precatorio === "Não tem") return "Não tem";
  return lead.tipo_precatorio ?? SEM_RESPOSTA;
}

export const TIME_ZONE = "America/Sao_Paulo";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" });

const dayOf = (iso: string | Date) => dayFmt.format(new Date(iso));
const hourOf = (iso: string) => Number(hourFmt.format(new Date(iso)));

const origemOf = (lead: StoredLead): Origem => lead.origem ?? ORIGEM_PADRAO;

/**
 * Consolida os leads por agente, UF e hora.
 * Agentes configurados aparecem mesmo sem leads; agentes antigos (fora da lista atual) também entram.
 * Com `origem`, tudo considera só os leads daquela página, exceto o resumo por página.
 */
export function buildMetrics(
  todos: StoredLead[],
  opts: { evento: string; agentes: string[]; origem?: Origem; now?: Date },
): MetricsResponse {
  const now = opts.now ?? new Date();
  const today = dayOf(now);

  const origens: OrigemMetrics[] = ORIGENS.map((origem) => {
    const daPagina = todos.filter((l) => origemOf(l) === origem);
    return {
      origem,
      rotulo: ORIGEM_ROTULOS[origem],
      total: daPagina.length,
      hoje: daPagina.filter((l) => dayOf(l.recebido_em) === today).length,
      pendentes: daPagina.filter((l) => !l.enviado).length,
    };
  });
  const leads = opts.origem ? todos.filter((l) => origemOf(l) === opts.origem) : todos;

  const byAgent = new Map<string, AgentMetrics>();
  for (const agente of opts.agentes) byAgent.set(agente, { agente, total: 0, hoje: 0, pendentes: 0 });

  const byUf = new Map<string, number>();
  const hours = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0 }));
  let hoje = 0;
  let pendentes = 0;

  for (const lead of leads) {
    const isToday = dayOf(lead.recebido_em) === today;
    // Leads da palestra não têm agente: entram nos totais, mas não no ranking.
    if (lead.agente) {
      const a = byAgent.get(lead.agente) ?? { agente: lead.agente, total: 0, hoje: 0, pendentes: 0 };
      a.total += 1;
      if (isToday) a.hoje += 1;
      if (!lead.enviado) a.pendentes += 1;
      if (!a.ultimo || lead.recebido_em > a.ultimo) a.ultimo = lead.recebido_em;
      byAgent.set(lead.agente, a);
    }

    byUf.set(lead.uf, (byUf.get(lead.uf) ?? 0) + 1);
    if (isToday) {
      hoje += 1;
      hours[hourOf(lead.recebido_em)]!.total += 1;
    }
    if (!lead.enviado) pendentes += 1;
  }

  const metricsLeads: MetricsLead[] = leads
    .map((l) => ({
      id: l.id,
      nome: l.nome,
      telefone: l.telefone,
      cidade: l.cidade,
      uf: l.uf,
      ...(l.agente ? { agente: l.agente } : {}),
      ...(l.perfil ? { perfil: l.perfil } : {}),
      ...(l.tem_precatorio ? { tem_precatorio: l.tem_precatorio } : {}),
      ...(l.tipo_precatorio ? { tipo_precatorio: l.tipo_precatorio } : {}),
      ...(l.prioridade ? { prioridade: l.prioridade } : {}),
      ...(l.originador ? { originador: l.originador } : {}),
      ...(l.observacoes ? { observacoes: l.observacoes } : {}),
      evento: l.evento,
      origem: origemOf(l),
      recebido_em: l.recebido_em,
      enviado: l.enviado,
      tentativas: l.tentativas,
      ...(l.ultimo_erro ? { ultimo_erro: l.ultimo_erro } : {}),
    }))
    .sort((a, b) => b.recebido_em.localeCompare(a.recebido_em));

  return {
    evento: opts.evento,
    origem: opts.origem ?? null,
    origens,
    gerado_em: now.toISOString(),
    fuso: TIME_ZONE,
    total: leads.length,
    hoje,
    pendentes,
    agentes: [...byAgent.values()].sort((a, b) => b.total - a.total || a.agente.localeCompare(b.agente)),
    ufs: [...byUf.entries()].map(([uf, total]) => ({ uf, total })).sort((a, b) => b.total - a.total),
    prioridades: breakdown(leads, PRIORIDADES, (l) => l.prioridade ?? SEM_RESPOSTA),
    perfis: breakdown(leads, PERFIS, (l) => l.perfil ?? SEM_RESPOSTA),
    precatorios: breakdown(leads, [...TIPOS_PRECATORIO, "Não tem"], precatorioLabel),
    originadores: breakdown(leads, ORIGINADORES, (l) => l.originador ?? SEM_RESPOSTA),
    alta_prioridade: leads.filter((l) => l.prioridade === "Alta").length,
    horas_hoje: hours,
    leads: metricsLeads,
  };
}

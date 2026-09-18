import type { AgentMetrics, MetricsLead, MetricsResponse } from "../shared/metrics.js";
import type { StoredLead } from "./store.js";

export const TIME_ZONE = "America/Sao_Paulo";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" });

const dayOf = (iso: string | Date) => dayFmt.format(new Date(iso));
const hourOf = (iso: string) => Number(hourFmt.format(new Date(iso)));

/**
 * Consolida os leads por agente, UF e hora.
 * Agentes configurados aparecem mesmo sem leads; agentes antigos (fora da lista atual) também entram.
 */
export function buildMetrics(
  leads: StoredLead[],
  opts: { evento: string; agentes: string[]; now?: Date },
): MetricsResponse {
  const now = opts.now ?? new Date();
  const today = dayOf(now);

  const byAgent = new Map<string, AgentMetrics>();
  for (const agente of opts.agentes) byAgent.set(agente, { agente, total: 0, hoje: 0, pendentes: 0 });

  const byUf = new Map<string, number>();
  const hours = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0 }));
  let hoje = 0;
  let pendentes = 0;

  for (const lead of leads) {
    const isToday = dayOf(lead.recebido_em) === today;
    const a = byAgent.get(lead.agente) ?? { agente: lead.agente, total: 0, hoje: 0, pendentes: 0 };
    a.total += 1;
    if (isToday) a.hoje += 1;
    if (!lead.enviado) a.pendentes += 1;
    if (!a.ultimo || lead.recebido_em > a.ultimo) a.ultimo = lead.recebido_em;
    byAgent.set(lead.agente, a);

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
      agente: l.agente,
      evento: l.evento,
      recebido_em: l.recebido_em,
      enviado: l.enviado,
      tentativas: l.tentativas,
      ...(l.ultimo_erro ? { ultimo_erro: l.ultimo_erro } : {}),
    }))
    .sort((a, b) => b.recebido_em.localeCompare(a.recebido_em));

  return {
    evento: opts.evento,
    gerado_em: now.toISOString(),
    fuso: TIME_ZONE,
    total: leads.length,
    hoje,
    pendentes,
    agentes: [...byAgent.values()].sort((a, b) => b.total - a.total || a.agente.localeCompare(b.agente)),
    ufs: [...byUf.entries()].map(([uf, total]) => ({ uf, total })).sort((a, b) => b.total - a.total),
    horas_hoje: hours,
    leads: metricsLeads,
  };
}

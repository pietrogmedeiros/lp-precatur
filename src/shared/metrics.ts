import type { UF } from "./lead.js";

export interface AgentMetrics {
  agente: string;
  total: number;
  hoje: number;
  pendentes: number;
  /** ISO do último lead captado pelo agente. */
  ultimo?: string;
}

export interface MetricsLead {
  id: string;
  nome: string;
  telefone: string;
  cidade: string;
  uf: UF;
  agente: string;
  evento: string;
  recebido_em: string;
  enviado: boolean;
  tentativas: number;
  ultimo_erro?: string;
}

export interface MetricsResponse {
  evento: string;
  gerado_em: string;
  fuso: string;
  total: number;
  hoje: number;
  pendentes: number;
  agentes: AgentMetrics[];
  ufs: { uf: string; total: number }[];
  /** Leads por hora do dia (0-23, no fuso do evento), considerando só hoje. */
  horas_hoje: { hora: number; total: number }[];
  /** Leads mais recentes primeiro. */
  leads: MetricsLead[];
}

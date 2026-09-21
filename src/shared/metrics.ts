import type { Perfil, Prioridade, TemPrecatorio, TipoPrecatorio, UF } from "./lead.js";

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
  /** Leads captados antes destes campos existirem não os têm. */
  perfil?: Perfil;
  tem_precatorio?: TemPrecatorio;
  tipo_precatorio?: TipoPrecatorio;
  prioridade?: Prioridade;
  observacoes?: string;
  evento: string;
  recebido_em: string;
  enviado: boolean;
  tentativas: number;
  ultimo_erro?: string;
}

/** Contagem por categoria, com as opções fixas sempre presentes (inclusive zeradas). */
export interface Breakdown {
  rotulo: string;
  total: number;
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
  prioridades: Breakdown[];
  perfis: Breakdown[];
  /** Municipal/Estadual/Federal, mais "Não tem". */
  precatorios: Breakdown[];
  /** Leads de prioridade alta, o número que puxa a ação do time. */
  alta_prioridade: number;
  /** Leads por hora do dia (0-23, no fuso do evento), considerando só hoje. */
  horas_hoje: { hora: number; total: number }[];
  /** Leads mais recentes primeiro. */
  leads: MetricsLead[];
}

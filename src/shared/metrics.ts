import type { Origem, Originador, Perfil, Prioridade, TemPrecatorio, TipoPrecatorio, UF } from "./lead.js";

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
  /** Número do sorteio (só nas páginas numeradas). */
  numero?: number;
  nome: string;
  telefone: string;
  /** Leads captados antes destes campos existirem, ou por páginas que não os pedem, não os têm. */
  cidade?: string;
  uf?: UF;
  agente?: string;
  perfil?: Perfil;
  tem_precatorio?: TemPrecatorio;
  tipo_precatorio?: TipoPrecatorio;
  prioridade?: Prioridade;
  originador?: Originador;
  observacoes?: string;
  evento: string;
  origem: Origem;
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

/** Leads de cada página de captação, sempre sobre o total (ignora o filtro de página). */
export interface OrigemMetrics {
  origem: Origem;
  rotulo: string;
  total: number;
  hoje: number;
  pendentes: number;
}

export interface MetricsResponse {
  evento: string;
  /** Página filtrada (?origem=...), ou null quando o painel mostra todas. */
  origem: Origem | null;
  origens: OrigemMetrics[];
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
  /** Originador do contato (só a palestra pergunta; os demais caem em "Não informado"). */
  originadores: Breakdown[];
  /** Leads de prioridade alta, o número que puxa a ação do time. */
  alta_prioridade: number;
  /** Leads por hora do dia (0-23, no fuso do evento), considerando só hoje. */
  horas_hoje: { hora: number; total: number }[];
  /** Leads mais recentes primeiro. */
  leads: MetricsLead[];
}

/**
 * Regras de validação e tipos do lead, compartilhados entre front e servidor.
 * Sem dependências, para o bundle do front continuar leve.
 */

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type UF = (typeof UFS)[number];

/** Quem é a pessoa do outro lado: define a abordagem comercial. */
export const PERFIS = ["Advogado", "Originador", "Intermediário", "Fundo", "Outros"] as const;
export type Perfil = (typeof PERFIS)[number];

export const TEM_PRECATORIO = ["Tem", "Não tem"] as const;
export type TemPrecatorio = (typeof TEM_PRECATORIO)[number];

export const TIPOS_PRECATORIO = ["Municipal", "Estadual", "Federal"] as const;
export type TipoPrecatorio = (typeof TIPOS_PRECATORIO)[number];

export const PRIORIDADES = ["Alta", "Média", "Baixa"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

export const OBSERVACOES_MAX = 1000;

/**
 * Dígitos do telefone sem código do país (+55) nem zero de operadora/DDD (027...).
 * Ex.: "+55 (27) 99658-4654" -> "27996584654".
 */
export function phoneDigits(value: string): string {
  let d = value.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length >= 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 11);
}

/** Valida DDD (11 a 99, nenhum DDD termina em 0) e celular com 9 na frente. */
export function isValidPhone(value: string): boolean {
  const d = phoneDigits(value);
  if (d.length !== 10 && d.length !== 11) return false;
  if (!/^[1-9][1-9]/.test(d)) return false;
  if (d.length === 11) return d[2] === "9";
  return /^[2-5]/.test(d.slice(2)); // fixo: começa com 2 a 5
}

/** Máscara de telefone brasileiro: (27) 99658-4654 ou (27) 3333-4444. */
export function formatPhone(value: string): string {
  const d = phoneDigits(value);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Campos que a pessoa preenche. */
export interface LeadFields {
  nome: string;
  telefone: string;
  cidade: string;
  uf: UF;
  agente: string;
  perfil: Perfil;
  tem_precatorio: TemPrecatorio;
  /** Só existe quando tem_precatorio é "Tem". */
  tipo_precatorio?: TipoPrecatorio;
  prioridade: Prioridade;
  observacoes?: string;
  consentimento_lgpd: true;
}

export type LeadField = keyof LeadFields;

/** Payload que o front envia para POST /api/leads. */
export interface LeadRequest extends LeadFields {
  id: string;
  criado_em: string;
  /** Honeypot: pessoas não veem este campo, bots costumam preenchê-lo. */
  website?: string;
}

/** Retorna a mensagem de erro do campo, ou null se o valor é válido. */
type Validator = (value: string) => string | null;

const includes = (options: readonly string[], value: string) => options.includes(value);

export const fieldValidators = {
  nome: (v) => {
    const t = v.trim();
    if (t.length < 5 || t.split(/\s+/).length < 2) return "Informe seu nome completo.";
    if (t.length > 120) return "Nome muito longo.";
    return null;
  },
  telefone: (v) => (isValidPhone(v) ? null : "Informe um telefone válido com DDD."),
  cidade: (v) => {
    const t = v.trim();
    if (t.length < 2) return "Informe sua cidade.";
    if (t.length > 80) return "Cidade muito longa.";
    return null;
  },
  uf: (v) => ((UFS as readonly string[]).includes(v) ? null : "Selecione."),
  agente: (v) => (v.trim().length >= 1 && v.length <= 60 ? null : "Selecione quem te atendeu."),
  perfil: (v) => (includes(PERFIS, v) ? null : "Selecione o perfil do contato."),
  tem_precatorio: (v) => (includes(TEM_PRECATORIO, v) ? null : "Informe se a pessoa tem precatório."),
  prioridade: (v) => (includes(PRIORIDADES, v) ? null : "Selecione a prioridade."),
  observacoes: (v) => (v.trim().length <= OBSERVACOES_MAX ? null : `Máximo de ${OBSERVACOES_MAX} caracteres.`),
} satisfies Record<Exclude<LeadField, "consentimento_lgpd" | "tipo_precatorio">, Validator>;

/**
 * Tipo de precatório só é perguntado (e só é aceito) quando a pessoa tem precatório;
 * quem não tem não deve carregar um tipo solto no cadastro.
 */
export function validateTipoPrecatorio(tipo: string, tem: string): string | null {
  if (tem !== "Tem") return tipo ? "Tipo de precatório não se aplica a quem não tem." : null;
  return includes(TIPOS_PRECATORIO, tipo) ? null : "Selecione o tipo de precatório.";
}

export const CONSENT_ERROR = "É preciso autorizar o contato.";

/** Configuração pública injetada pelo servidor na página. */
export interface PublicConfig {
  evento: string;
  agentes: string[];
  autoResetSegundos: number;
}

export interface LeadResponse {
  ok: boolean;
  duplicado?: boolean;
  erros?: Partial<Record<LeadField | "geral", string>>;
}

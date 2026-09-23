import { z } from "zod";
import {
  CONSENT_ERROR,
  OBSERVACOES_MAX,
  ORIGENS,
  ORIGEM_PADRAO,
  CAMPOS_DA_PAGINA,
  ORIGINADORES,
  PERFIS,
  PRIORIDADES,
  TEM_PRECATORIO,
  TIPOS_PRECATORIO,
  UFS,
  fieldValidators,
  formatPhone,
  validateTipoPrecatorio,
  type LeadRequest,
} from "../shared/lead.js";

/** Aplica a mesma regra usada no front (src/shared/lead.ts). */
const rule = (name: keyof typeof fieldValidators) => (value: string, ctx: z.RefinementCtx) => {
  const message = fieldValidators[name](value);
  if (message) ctx.addIssue({ code: "custom", message });
};

export const leadRequestSchema = z
  .object({
    id: z.uuid({ error: "ID inválido." }),
    criado_em: z.iso.datetime({ error: "Data inválida." }),
    nome: z.string().trim().superRefine(rule("nome")),
    telefone: z.string().trim().superRefine(rule("telefone")).transform(formatPhone),
    cidade: z.string().trim().superRefine(rule("cidade")),
    uf: z.enum(UFS, { error: fieldValidators.uf("") ?? undefined }),
    agente: z.string().trim().superRefine(rule("agente")).optional(),
    perfil: z.enum(PERFIS, { error: fieldValidators.perfil("") ?? undefined }),
    tem_precatorio: z.enum(TEM_PRECATORIO, { error: fieldValidators.tem_precatorio("") ?? undefined }).optional(),
    tipo_precatorio: z.enum(TIPOS_PRECATORIO).optional(),
    prioridade: z.enum(PRIORIDADES, { error: fieldValidators.prioridade("") ?? undefined }).optional(),
    originador: z.enum(ORIGINADORES, { error: fieldValidators.originador("") ?? undefined }).optional(),
    // Campo livre e opcional: string vazia vira ausência, para não gravar "" no lead.
    observacoes: z
      .string()
      .trim()
      .max(OBSERVACOES_MAX, { error: `Máximo de ${OBSERVACOES_MAX} caracteres.` })
      .optional()
      .transform((v) => v || undefined),
    origem: z.enum(ORIGENS).default(ORIGEM_PADRAO),
    consentimento_lgpd: z.literal(true, { error: CONSENT_ERROR }),
    website: z.string().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    // Cada página exige só os próprios campos; os de outras páginas o servidor descarta.
    const campos = CAMPOS_DA_PAGINA[data.origem];
    for (const campo of campos) {
      if (campo === "tipo_precatorio") continue; // condicional, validado abaixo
      if (data[campo] === undefined) ctx.addIssue({ code: "custom", path: [campo], message: fieldValidators[campo]("") ?? "" });
    }
    if (!campos.includes("tipo_precatorio")) return;
    const message = validateTipoPrecatorio(data.tipo_precatorio ?? "", data.tem_precatorio ?? "");
    if (message) ctx.addIssue({ code: "custom", path: ["tipo_precatorio"], message });
  }) satisfies z.ZodType<LeadRequest>;

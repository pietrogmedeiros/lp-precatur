import { z } from "zod";
import { CONSENT_ERROR, UFS, fieldValidators, formatPhone, type LeadRequest } from "../shared/lead.js";

/** Aplica a mesma regra usada no front (src/shared/lead.ts). */
const rule = (name: keyof typeof fieldValidators) => (value: string, ctx: z.RefinementCtx) => {
  const message = fieldValidators[name](value);
  if (message) ctx.addIssue({ code: "custom", message });
};

export const leadRequestSchema = z.object({
  id: z.uuid({ error: "ID inválido." }),
  criado_em: z.iso.datetime({ error: "Data inválida." }),
  nome: z.string().trim().superRefine(rule("nome")),
  telefone: z.string().trim().superRefine(rule("telefone")).transform(formatPhone),
  cidade: z.string().trim().superRefine(rule("cidade")),
  uf: z.enum(UFS, { error: fieldValidators.uf("") ?? undefined }),
  agente: z.string().trim().superRefine(rule("agente")),
  consentimento_lgpd: z.literal(true, { error: CONSENT_ERROR }),
  website: z.string().max(200).optional(),
}) satisfies z.ZodType<LeadRequest>;

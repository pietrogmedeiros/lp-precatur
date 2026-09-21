import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { fieldValidators, formatPhone, isValidPhone, validateTipoPrecatorio } from "../src/shared/lead.js";
import { leadRequestSchema } from "../src/server/schema.js";

const valid = {
  nome: "Maria da Silva",
  telefone: "27996584654",
  cidade: "Vitória",
  uf: "ES",
  agente: "Thales",
  perfil: "Advogado",
  tem_precatorio: "Tem",
  tipo_precatorio: "Estadual",
  prioridade: "Alta",
  consentimento_lgpd: true,
  id: randomUUID(),
  criado_em: new Date().toISOString(),
};

describe("formatPhone", () => {
  it("formata celular e fixo", () => {
    assert.equal(formatPhone("27996584654"), "(27) 99658-4654");
    assert.equal(formatPhone("2733334444"), "(27) 3333-4444");
    assert.equal(formatPhone("(27) 9"), "(27) 9");
    assert.equal(formatPhone(""), "");
  });

  it("remove +55 e zero de operadora ao colar", () => {
    assert.equal(formatPhone("+55 27 99658-4654"), "(27) 99658-4654");
    assert.equal(formatPhone("5527996584654"), "(27) 99658-4654");
    assert.equal(formatPhone("027996584654"), "(27) 99658-4654");
  });
});

describe("isValidPhone", () => {
  it("valida DDD e formato", () => {
    assert.equal(isValidPhone("(11) 99999-9999"), true);
    assert.equal(isValidPhone("(27) 3333-4444"), true);
    assert.equal(isValidPhone("(10) 99999-9999"), false, "DDD inexistente");
    assert.equal(isValidPhone("(01) 99999-9999"), false, "DDD inexistente");
    assert.equal(isValidPhone("(11) 89999-9999"), false, "celular sem 9");
    assert.equal(isValidPhone("(11) 9999-999"), false, "incompleto");
  });
});

describe("leadRequestSchema", () => {
  it("aceita um lead válido e normaliza o telefone", () => {
    const r = leadRequestSchema.parse(valid);
    assert.equal(r.telefone, "(27) 99658-4654");
  });

  it("exige nome e sobrenome", () => {
    assert.equal(leadRequestSchema.safeParse({ ...valid, nome: "Maria" }).success, false);
  });

  it("rejeita telefone sem DDD", () => {
    assert.equal(leadRequestSchema.safeParse({ ...valid, telefone: "99658465" }).success, false);
  });

  it("rejeita UF inexistente", () => {
    assert.equal(leadRequestSchema.safeParse({ ...valid, uf: "XX" }).success, false);
  });

  it("exige consentimento LGPD", () => {
    assert.equal(leadRequestSchema.safeParse({ ...valid, consentimento_lgpd: false }).success, false);
  });

  it("exige perfil e prioridade da lista", () => {
    assert.equal(leadRequestSchema.safeParse({ ...valid, perfil: "Contador" }).success, false);
    assert.equal(leadRequestSchema.safeParse({ ...valid, prioridade: "Urgente" }).success, false);
  });

  it("exige tipo de precatório de quem tem", () => {
    const { tipo_precatorio: _, ...semTipo } = valid;
    const r = leadRequestSchema.safeParse(semTipo);
    assert.equal(r.success, false);
    assert.equal(r.error?.issues[0]?.path[0], "tipo_precatorio");
  });

  it("recusa tipo de precatório de quem não tem", () => {
    assert.equal(
      leadRequestSchema.safeParse({ ...valid, tem_precatorio: "Não tem" }).success,
      false,
    );
    const { tipo_precatorio: _, ...semTipo } = valid;
    assert.equal(leadRequestSchema.safeParse({ ...semTipo, tem_precatorio: "Não tem" }).success, true);
  });

  it("trata observação vazia como ausente e corta a longa demais", () => {
    assert.equal(leadRequestSchema.parse({ ...valid, observacoes: "   " }).observacoes, undefined);
    assert.equal(leadRequestSchema.parse({ ...valid, observacoes: " nota " }).observacoes, "nota");
    assert.equal(leadRequestSchema.safeParse({ ...valid, observacoes: "x".repeat(1001) }).success, false);
  });
});

describe("fieldValidators", () => {
  it("retorna a mensagem do campo inválido", () => {
    assert.equal(fieldValidators.nome("Maria"), "Informe seu nome completo.");
    assert.equal(fieldValidators.nome("Maria Silva"), null);
    assert.equal(fieldValidators.uf("SP"), null);
    assert.equal(fieldValidators.uf(""), "Selecione.");
    assert.equal(fieldValidators.perfil("Fundo"), null);
    assert.equal(fieldValidators.perfil(""), "Selecione o perfil do contato.");
  });
});

describe("validateTipoPrecatorio", () => {
  it("só exige o tipo de quem tem precatório", () => {
    assert.equal(validateTipoPrecatorio("Federal", "Tem"), null);
    assert.equal(validateTipoPrecatorio("", "Tem"), "Selecione o tipo de precatório.");
    assert.equal(validateTipoPrecatorio("", "Não tem"), null);
    assert.ok(validateTipoPrecatorio("Federal", "Não tem"));
  });
});

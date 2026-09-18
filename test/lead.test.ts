import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { fieldValidators, formatPhone, isValidPhone } from "../src/shared/lead.js";
import { leadRequestSchema } from "../src/server/schema.js";

const valid = {
  nome: "Maria da Silva",
  telefone: "27996584654",
  cidade: "Vitória",
  uf: "ES",
  agente: "Thales",
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
});

describe("fieldValidators", () => {
  it("retorna a mensagem do campo inválido", () => {
    assert.equal(fieldValidators.nome("Maria"), "Informe seu nome completo.");
    assert.equal(fieldValidators.nome("Maria Silva"), null);
    assert.equal(fieldValidators.uf("SP"), null);
    assert.equal(fieldValidators.uf(""), "Selecione.");
  });
});

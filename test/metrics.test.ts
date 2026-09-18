import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMetrics } from "../src/server/metrics.js";
import type { StoredLead } from "../src/server/store.js";

const base = {
  telefone: "(11) 99999-9999",
  cidade: "São Paulo",
  uf: "SP" as const,
  consentimento_lgpd: true as const,
  evento: "Teste",
  criado_em: "2026-09-18T12:00:00.000Z",
  enviado: true,
  tentativas: 1,
};

const lead = (id: string, agente: string, recebido_em: string, extra: Partial<StoredLead> = {}): StoredLead => ({
  ...base,
  id,
  nome: `Lead ${id}`,
  agente,
  recebido_em,
  ...extra,
});

describe("buildMetrics", () => {
  // 18/09 15h em São Paulo = 18h UTC
  const now = new Date("2026-09-18T18:00:00.000Z");
  const leads = [
    lead("1", "Thales", "2026-09-18T13:10:00.000Z"), // 10h SP, hoje
    lead("2", "Thales", "2026-09-18T13:40:00.000Z", { enviado: false }), // 10h SP, hoje
    lead("3", "Calebe", "2026-09-18T17:05:00.000Z", { uf: "RJ" }), // 14h SP, hoje
    lead("4", "Thales", "2026-09-17T20:00:00.000Z"), // ontem
    lead("5", "Ex-agente", "2026-09-18T02:30:00.000Z"), // 23h30 de 17/09 em SP: ontem
  ];
  const m = buildMetrics(leads, { evento: "Teste", agentes: ["Thales", "Calebe", "Rhuan"], now });

  it("totais e hoje no fuso de São Paulo", () => {
    assert.equal(m.total, 5);
    assert.equal(m.hoje, 3);
    assert.equal(m.pendentes, 1);
  });

  it("agrupa por agente, ordena e inclui quem não tem lead", () => {
    assert.deepEqual(
      m.agentes.map((a) => [a.agente, a.total, a.hoje, a.pendentes]),
      [["Thales", 3, 2, 1], ["Calebe", 1, 1, 0], ["Ex-agente", 1, 0, 0], ["Rhuan", 0, 0, 0]],
    );
    assert.equal(m.agentes[0]?.ultimo, "2026-09-18T13:40:00.000Z");
  });

  it("conta por hora (hoje) e por UF", () => {
    assert.equal(m.horas_hoje[10]?.total, 2);
    assert.equal(m.horas_hoje[14]?.total, 1);
    assert.deepEqual(m.ufs, [{ uf: "SP", total: 4 }, { uf: "RJ", total: 1 }]);
  });

  it("lista os leads do mais recente para o mais antigo", () => {
    assert.deepEqual(m.leads.map((l) => l.id), ["3", "2", "1", "5", "4"]);
  });
});

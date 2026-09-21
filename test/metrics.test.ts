import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMetrics } from "../src/server/metrics.js";
import type { StoredLead } from "../src/server/store.js";

const base = {
  telefone: "(11) 99999-9999",
  cidade: "São Paulo",
  uf: "SP" as const,
  perfil: "Advogado" as const,
  tem_precatorio: "Tem" as const,
  tipo_precatorio: "Federal" as const,
  prioridade: "Média" as const,
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

  it("repassa os campos de qualificação para a tabela do painel", () => {
    const l = m.leads.find((x) => x.id === "3");
    assert.equal(l?.perfil, "Advogado");
    assert.equal(l?.tipo_precatorio, "Federal");
    assert.equal(l?.prioridade, "Média");
  });
});

describe("buildMetrics: recortes por qualificação", () => {
  const now = new Date("2026-09-18T18:00:00.000Z");
  const leads = [
    lead("1", "Thales", "2026-09-18T13:10:00.000Z", { prioridade: "Alta", perfil: "Fundo" }),
    lead("2", "Thales", "2026-09-18T13:40:00.000Z", { prioridade: "Alta", tipo_precatorio: "Municipal" }),
    lead("3", "Calebe", "2026-09-18T17:05:00.000Z", {
      prioridade: "Baixa",
      tem_precatorio: "Não tem",
      tipo_precatorio: undefined,
    }),
  ];
  const m = buildMetrics(leads, { evento: "Teste", agentes: ["Thales", "Calebe"], now });

  it("mantém as opções do formulário mesmo zeradas, na ordem", () => {
    assert.deepEqual(m.prioridades, [
      { rotulo: "Alta", total: 2 },
      { rotulo: "Média", total: 0 },
      { rotulo: "Baixa", total: 1 },
    ]);
    assert.deepEqual(m.perfis.map((p) => p.rotulo), ["Advogado", "Originador", "Intermediário", "Fundo", "Outros"]);
    assert.equal(m.perfis.find((p) => p.rotulo === "Fundo")?.total, 1);
  });

  it("separa o tipo de precatório de quem não tem", () => {
    assert.deepEqual(m.precatorios, [
      { rotulo: "Municipal", total: 1 },
      { rotulo: "Estadual", total: 0 },
      { rotulo: "Federal", total: 1 },
      { rotulo: "Não tem", total: 1 },
    ]);
  });

  it("conta os leads de alta prioridade", () => {
    assert.equal(m.alta_prioridade, 2);
  });

  it("não quebra com leads antigos, sem os campos novos", () => {
    const antigo = { ...lead("9", "Thales", "2026-09-18T13:10:00.000Z") } as Record<string, unknown>;
    delete antigo.prioridade;
    delete antigo.perfil;
    delete antigo.tem_precatorio;
    delete antigo.tipo_precatorio;
    const r = buildMetrics([antigo as never], { evento: "Teste", agentes: ["Thales"], now });
    assert.equal(r.prioridades.find((p) => p.rotulo === "Não informado")?.total, 1);
    assert.equal(r.precatorios.find((p) => p.rotulo === "Não informado")?.total, 1);
    assert.equal(r.alta_prioridade, 0);
    assert.equal(r.leads[0]?.prioridade, undefined);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { elegiveis, indiceAleatorio, mascararTelefone, parseNumeros } from "../src/shared/sorteio.js";

const p = (numero: number, telefone: string) => ({ numero, nome: `Pessoa ${numero}`, telefone });

describe("sorteador", () => {
  const inscritos = [p(3, "(51) 98683-2184"), p(1, "(27) 99658-4654"), p(2, "51 986832184"), p(4, "(11) 91234-5678")];

  it("uma chance por telefone: repetidos concorrem só com o primeiro número", () => {
    const todos = elegiveis(inscritos, { excluidos: new Set(), umaChancePorTelefone: true });
    assert.deepEqual(todos.map((x) => x.numero), [1, 2, 4]);
    const livre = elegiveis(inscritos, { excluidos: new Set(), umaChancePorTelefone: false });
    assert.deepEqual(livre.map((x) => x.numero), [1, 2, 3, 4]);
  });

  it("excluído não concorre, nem com outra inscrição do mesmo telefone", () => {
    const r = elegiveis(inscritos, { excluidos: new Set([2]), umaChancePorTelefone: true });
    assert.deepEqual(r.map((x) => x.numero), [1, 4]);
    const livre = elegiveis(inscritos, { excluidos: new Set([2]), umaChancePorTelefone: false });
    assert.deepEqual(livre.map((x) => x.numero), [1, 3, 4]);
  });

  it("índice aleatório sem viés: descarta o topo que não fecha múltiplo de n", () => {
    const valores = [0xffff_ffff, 7];
    assert.equal(indiceAleatorio(3, () => valores.shift()!), 1);
    assert.throws(() => indiceAleatorio(0, () => 0));
    const contagem = [0, 0, 0];
    let x = 0;
    for (let i = 0; i < 3000; i++) contagem[indiceAleatorio(3, () => x++)]! += 1;
    assert.deepEqual(contagem, [1000, 1000, 1000]);
  });

  it("mascara o telefone para o telão", () => {
    assert.equal(mascararTelefone("(51) 98683-2184"), "(51) 9••••-2184");
    assert.equal(mascararTelefone("(27) 3333-4444"), "(27) 3•••-4444");
  });

  it("lê a lista de números excluídos", () => {
    assert.deepEqual([...parseNumeros("1, 4;10-12 x 9-3")], [1, 4, 10, 11, 12]);
  });
});

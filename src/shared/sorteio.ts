/**
 * Regras do sorteador (/sorteador), compartilhadas entre front e testes.
 * Sem dependências, para o bundle do front continuar leve.
 */
import { phoneDigits } from "./lead.js";

/** Inscrito do /sorteio como o sorteador recebe do servidor. */
export interface Participante {
  numero: number;
  nome: string;
  telefone: string;
}

export interface SorteioResponse {
  evento: string;
  /** Em ordem de número (1, 2, 3...). */
  participantes: Participante[];
}

export interface OpcoesSorteio {
  /** Números que não concorrem: ganhadores anteriores, testes, desistências. */
  excluidos: ReadonlySet<number>;
  /** Quem se inscreveu mais de uma vez com o mesmo telefone concorre só com o primeiro número. */
  umaChancePorTelefone: boolean;
}

/** Quem concorre, na ordem de número. */
export function elegiveis(participantes: readonly Participante[], opcoes: OpcoesSorteio): Participante[] {
  const ordenados = [...participantes].sort((a, b) => a.numero - b.numero);
  if (!opcoes.umaChancePorTelefone) return ordenados.filter((p) => !opcoes.excluidos.has(p.numero));
  // O telefone de um excluído também sai: quem já ganhou não volta a concorrer com outra inscrição.
  const vistos = new Set(ordenados.filter((p) => opcoes.excluidos.has(p.numero)).map((p) => phoneDigits(p.telefone)));
  return ordenados.filter((p) => {
    const tel = phoneDigits(p.telefone);
    if (vistos.has(tel)) return false;
    vistos.add(tel);
    return true;
  });
}

/**
 * Índice uniforme em [0, n), sem viés de módulo: descarta os valores do topo
 * de 32 bits que não fecham um múltiplo de n.
 */
export function indiceAleatorio(n: number, random32: () => number): number {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError("Nenhum participante para sortear.");
  const limite = Math.floor(0x1_0000_0000 / n) * n;
  for (;;) {
    const x = random32();
    if (x < limite) return x % n;
  }
}

/** Telefone para exibir no telão: (51) 9••••-2184. */
export function mascararTelefone(value: string): string {
  const d = phoneDigits(value);
  if (d.length < 10) return "";
  const meio = d.slice(2, -4).replace(/\d/g, "•");
  return `(${d.slice(0, 2)}) ${d[2]}${meio.slice(1)}-${d.slice(-4)}`;
}

/** "1, 3-5, 12" -> {1, 3, 4, 5, 12}. Ignora o que não for número; intervalos limitados a 10 mil. */
export function parseNumeros(texto: string): Set<number> {
  const result = new Set<number>();
  for (const parte of texto.split(/[\s,;]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(parte);
    if (!m) continue;
    const de = Number(m[1]);
    const ate = m[2] ? Number(m[2]) : de;
    if (ate < de || ate - de > 10_000) continue;
    for (let i = de; i <= ate; i++) result.add(i);
  }
  return result;
}

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { LeadFields, Origem } from "../shared/lead.js";

export interface StoredLead extends LeadFields {
  id: string;
  evento: string;
  /** Ausente em leads gravados antes do campo existir (todos da LP principal). */
  origem?: Origem;
  criado_em: string;
  recebido_em: string;
  enviado: boolean;
  enviado_em?: string;
  tentativas: number;
  ultimo_erro?: string;
}

/**
 * Guarda os leads em um arquivo JSON Lines append-only (data/leads.jsonl).
 * Cada alteração grava uma nova linha com o estado completo do lead; ao carregar,
 * a última linha de cada id vence. Assim nenhum lead se perde, mesmo se o n8n cair.
 */
export class LeadStore {
  private readonly leads = new Map<string, StoredLead>();
  private readonly file: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "leads.jsonl");
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    let content = "";
    try {
      content = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const lead = JSON.parse(line) as StoredLead;
        this.leads.set(lead.id, lead);
      } catch {
        // Linha corrompida (ex.: queda de energia no meio da escrita): ignora.
      }
    }
  }

  has(id: string): boolean {
    return this.leads.has(id);
  }

  get(id: string): StoredLead | undefined {
    return this.leads.get(id);
  }

  save(lead: StoredLead): Promise<void> {
    this.leads.set(lead.id, lead);
    const line = JSON.stringify(lead) + "\n";
    // Serializa as escritas para as linhas nunca se misturarem.
    // Uma falha anterior não deve travar as próximas escritas.
    const write = this.writeChain.catch(() => {}).then(() => appendFile(this.file, line, "utf8"));
    this.writeChain = write;
    return write;
  }

  all(): StoredLead[] {
    return [...this.leads.values()].sort((a, b) => a.recebido_em.localeCompare(b.recebido_em));
  }

  pending(): StoredLead[] {
    return this.all().filter((l) => !l.enviado);
  }
}

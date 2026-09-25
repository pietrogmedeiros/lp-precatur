import { ORIGEM_PADRAO, vaiAoN8n, type Origem } from "../shared/lead.js";
import type { LeadStore, StoredLead } from "./store.js";

/** Dados enviados ao n8n (sem os campos internos de controle de entrega). */
export function toWebhookPayload(lead: StoredLead) {
  return {
    id: lead.id,
    nome: lead.nome,
    telefone: lead.telefone,
    cidade: lead.cidade,
    uf: lead.uf,
    agente: lead.agente,
    perfil: lead.perfil,
    tem_precatorio: lead.tem_precatorio,
    tipo_precatorio: lead.tipo_precatorio,
    prioridade: lead.prioridade,
    originador: lead.originador,
    observacoes: lead.observacoes,
    evento: lead.evento,
    origem: lead.origem ?? ORIGEM_PADRAO,
    consentimento_lgpd: lead.consentimento_lgpd,
    criado_em: lead.criado_em,
    recebido_em: lead.recebido_em,
  };
}

export class LeadDelivery {
  private retryTimer?: NodeJS.Timeout;
  private retrying = false;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly store: LeadStore,
    private readonly webhooks: Partial<Record<Origem, string>>,
    private readonly timeoutMs: number,
  ) {}

  /** Cada página de captação tem seu próprio webhook; as que só captam não têm nenhum. */
  private urlFor(lead: StoredLead): string {
    if (!vaiAoN8n(lead.origem)) return "";
    return this.webhooks[lead.origem ?? ORIGEM_PADRAO] ?? "";
  }

  private get enabled(): boolean {
    return Object.values(this.webhooks).some(Boolean);
  }

  /** Tenta enviar o lead ao n8n e registra o resultado. Nunca lança erro. */
  async deliver(lead: StoredLead): Promise<StoredLead> {
    const url = this.urlFor(lead);
    if (!url || this.inFlight.has(lead.id)) return lead;

    this.inFlight.add(lead.id);
    const attempt = { ...lead, tentativas: lead.tentativas + 1 };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toWebhookPayload(lead)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`n8n respondeu HTTP ${res.status}`);
      const sent: StoredLead = { ...attempt, enviado: true, enviado_em: new Date().toISOString() };
      delete sent.ultimo_erro;
      await this.store.save(sent);
      return sent;
    } catch (err) {
      const failed: StoredLead = { ...attempt, ultimo_erro: err instanceof Error ? err.message : String(err) };
      await this.store.save(failed);
      console.warn(`[leads] falha ao enviar ${lead.id} ao n8n (tentativa ${failed.tentativas}): ${failed.ultimo_erro}`);
      return failed;
    } finally {
      this.inFlight.delete(lead.id);
    }
  }

  /** Reenvia todos os leads pendentes, um por vez. */
  async retryPending(): Promise<void> {
    if (this.retrying || !this.enabled) return;
    this.retrying = true;
    try {
      for (const { id } of this.store.pending()) {
        // Relê o estado atual: o lead pode ter sido enviado enquanto a fila era percorrida.
        const current = this.store.get(id);
        if (current && !current.enviado) await this.deliver(current);
      }
    } finally {
      this.retrying = false;
    }
  }

  startRetryLoop(intervalMs: number): void {
    if (!this.enabled || intervalMs <= 0) return;
    this.retryTimer = setInterval(() => void this.retryPending(), intervalMs);
    this.retryTimer.unref();
  }

  stop(): void {
    clearInterval(this.retryTimer);
  }
}

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
    evento: lead.evento,
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
    private readonly webhookUrl: string,
    private readonly timeoutMs: number,
  ) {}

  /** Tenta enviar o lead ao n8n e registra o resultado. Nunca lança erro. */
  async deliver(lead: StoredLead): Promise<StoredLead> {
    if (!this.webhookUrl || this.inFlight.has(lead.id)) return lead;

    this.inFlight.add(lead.id);
    const attempt = { ...lead, tentativas: lead.tentativas + 1 };
    try {
      const res = await fetch(this.webhookUrl, {
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
    if (this.retrying || !this.webhookUrl) return;
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
    if (!this.webhookUrl || intervalMs <= 0) return;
    this.retryTimer = setInterval(() => void this.retryPending(), intervalMs);
    this.retryTimer.unref();
  }

  stop(): void {
    clearInterval(this.retryTimer);
  }
}

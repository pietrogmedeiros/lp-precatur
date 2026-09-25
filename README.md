# LP Precatur: captação de leads em eventos

Landing page da Precatur para captar leads no estande (tablet/totem) e pelo celular dos visitantes.
Node.js + TypeScript (Express no servidor, TS puro no front).

**Formulário:** nome, telefone/WhatsApp com DDD (máscara automática), cidade/UF (sugestões do IBGE),
agente Precatur que atendeu e consentimento LGPD.

## Como funciona

```
Navegador ──POST /api/leads──▶ Servidor Node ──POST JSON──▶ n8n (N8N_WEBHOOK_URL)
                                    │
                                    └─▶ data/leads.jsonl (cópia de todos os leads)
```

- O servidor valida o lead com as **mesmas regras do front** (`src/shared/lead.ts`), salva em disco e encaminha ao n8n.
- **Nenhum lead se perde:**
  - se o n8n falhar, o lead fica pendente e o servidor reenvia a cada `RETRY_INTERVAL_MS`;
  - se o servidor estiver fora do ar, o navegador guarda o lead e reenvia sozinho quando voltar.
- **Sem duplicados:** cada lead tem um `id` gerado no navegador, e reenvios com o mesmo id são ignorados.
- **Anti-spam:** campo honeypot invisível e limite de envios por IP.
- **Modo totem:** após o cadastro, a tela volta sozinha para um formulário em branco (`AUTO_RESET_SECONDS`).

### Payload enviado ao n8n

```json
{
  "id": "9a24c058-963b-4847-a5d5-52e5ad9e892e",
  "nome": "Maria da Silva",
  "telefone": "(27) 99658-4654",
  "cidade": "Vitória",
  "uf": "ES",
  "agente": "Henrique",
  "evento": "Precatório Summit",
  "consentimento_lgpd": true,
  "criado_em": "2026-09-18T21:45:11.733Z",
  "recebido_em": "2026-09-18T21:45:11.745Z"
}
```

## Rodando

Requer Node.js 22+.

```bash
npm install
cp .env.example .env     # ajuste evento, agentes e webhook
npm run dev              # desenvolvimento, com reload: http://localhost:3000
```

Produção:

```bash
npm run build
npm start
```

Docker:

```bash
docker build -t lp-precatur .
docker run -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data lp-precatur
```

### Easypanel

1. **Fonte:** GitHub `pietrogmedeiros/lp-precatur`, branch `main`.
2. **Construção:** Dockerfile (caminho `Dockerfile`).
3. **Ambiente:**
   ```
   N8N_WEBHOOK_URL=https://SEU-N8N/webhook/evento
   EVENT_NAME=Precatório Summit
   AGENTS=Thales,Aline,Thaynara,Tati,Henrique,Rhuan,Calebe,Karol,Vitoria,Matheus,Sanmilly,Ayrton,Laís,Carlos,Chris,Rafael
   ADMIN_TOKEN=um-token-longo-e-secreto
   TRUST_PROXY=true
   ```
4. **Montagens:** volume em `/app/data`, para não perder os leads a cada deploy.
5. **Domínios:** porta do proxy **3000**.

## Configuração (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `N8N_WEBHOOK_URL` | (vazio) | Webhook que recebe os leads. Vazio: os leads ficam só em `data/leads.jsonl` |
| `N8N_WEBHOOK_URL_PALESTRA_RAFAEL` | (vazio) | Webhook dos leads da página `/palestra-rafael`. Vazio: ficam pendentes no disco e são enviados quando for preenchido |
| `EVENT_NAME` | `Precatório Summit` | Nome do evento (selo no topo e campo `evento`) |
| `AGENTS` | `Thales,Aline,Thaynara,Tati,Henrique,Rhuan,Calebe,Karol,Vitoria,Matheus,Sanmilly,Ayrton,Laís,Carlos,Chris,Rafael` | Agentes da lista, separados por vírgula |
| `AUTO_RESET_SECONDS` | `15` | Volta ao formulário após o sucesso (`0` desativa) |
| `ADMIN_TOKEN` | (vazio) | Libera o CSV em `/admin/leads.csv?token=...` |
| `METRICS_TOKEN` | (vazio) | Vazio: `/metrics` aberto. Preenchido: o painel pede esse token |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Onde o servidor escuta |
| `DATA_DIR` | `data` | Pasta do `leads.jsonl` |
| `RETRY_INTERVAL_MS` | `60000` | Intervalo de reenvio ao n8n |
| `N8N_TIMEOUT_MS` | `10000` | Tempo limite de cada envio ao n8n |
| `RATE_LIMIT_PER_MINUTE` | `60` | Envios por IP por minuto |
| `TRUST_PROXY` | `false` | `true` atrás de proxy (Render, Railway, Nginx...) |

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/` | Landing page |
| `GET` | `/palestra-rafael` | A mesma landing page, sem agente, precatório e prioridade e com o campo Originador; os leads vão para `N8N_WEBHOOK_URL_PALESTRA_RAFAEL` |
| `GET` | `/sorteio` | A página da palestra só com nome e telefone, sem a faixa "Análise 100% gratuita". Só capta: os leads (`origem: "sorteio"`) ficam no painel e no CSV e não vão ao n8n |
| `POST` | `/api/leads` | Recebe um lead (201 criado, 200 duplicado, 400 com erros por campo) |
| `GET` | `/metrics` | Painel: leads por página, por agente, por hora e por UF, e a lista de leads com filtro por agente |
| `GET` | `/api/metrics` | Dados do painel em JSON (`?origem=lp`, `?origem=palestra-rafael` ou `?origem=sorteio` filtra por página) |
| `GET` | `/metrics/leads.csv` | CSV com a mesma regra de acesso do painel (aceita o mesmo `?origem=`) |
| `GET` | `/api/health` | Status, total de leads e pendentes de envio ao n8n |
| `GET` | `/admin/leads.csv?token=...` | Exporta todos os leads em CSV (abre direto no Excel) |

## Estrutura

```
public/            HTML, CSS e imagens (public/js/app.js é gerado no build)
src/shared/        Regras de validação, máscara de telefone e tipos (front + servidor)
src/client/        Lógica do formulário (TypeScript, bundle com esbuild)
src/server/        Express: rotas, gravação em disco, envio e reenvio ao n8n
test/              Testes (node:test): validação e API ponta a ponta com n8n falso
```

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Front e servidor em modo watch |
| `npm run build` | Gera `public/js/app.js` e `dist/` |
| `npm start` | Sobe o servidor compilado |
| `npm test` | Roda os testes |
| `npm run typecheck` | Checa os tipos do front e do servidor |

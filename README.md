# CRM Prospera

CRM multi-tenant para imobiliárias com distribuição automática de leads do Meta Lead Ads:
webhook → roleta em round-robin entre os corretores (1º lead novo vai pro corretor #1, o
2º pro #2, o 3º pro #3, e assim por diante — cada lead que expira sem resposta escala pro
próximo colocado, mas isso não afeta pra onde o próximo lead NOVO vai) → temporizador real
controlado pelo servidor →
transferência automática se ninguém responder a tempo → aviso por WhatsApp ao corretor (novo
lead e prazo esgotado) → dashboards em tempo (quase) real para dono e corretores.

Identidade visual: preto (`#191919`) + dourado (`#F6C324`) + off-white (`#FFFFF0`).

## Stack e por que ela é assim

| Camada | Escolha | Observação |
|---|---|---|
| Frontend/backend | Next.js 16 (App Router) + TypeScript + Tailwind v4 | API Routes fazem a autoridade de negócio; nada crítico roda só no cliente |
| Banco | PostgreSQL no **Railway** | Não é Supabase — decisão do usuário. Prisma com migrations reais |
| Auth | Auth.js v5 (Credentials + JWT) + bcrypt | Sem Supabase Auth disponível |
| Multi-tenant | `src/lib/tenant-db.ts` — extensão do Prisma Client que injeta `organization_id` (vindo da sessão) em toda query | Substitui o RLS nativo do Supabase; nunca confia só no frontend |
| Realtime | Polling curto (2–3s) via SWR | Sem Supabase Realtime; simples, confiável, sem infra extra. Ver "Evoluindo o realtime" abaixo |
| Job de expiração | Processo Node separado em `worker/`, rodando a cada 15s | Plano Hobby da Vercel só permite cron 1x/dia — insuficiente para expirar leads em minutos. O worker roda no Railway (junto do banco), sempre ativo |
| Deploy | App → Vercel · Banco + worker → Railway | |

Toda a lógica crítica (quem recebe o lead, quando expira, quem pode assumir) vive em
`packages/db/src/rotation.ts`, compartilhada entre o app Next.js e o worker — é a única fonte
de verdade, com transações e `SELECT ... FOR UPDATE` para nunca permitir duas pessoas
assumirem o mesmo lead (ver "Concorrência" abaixo).

## Estrutura do monorepo

```
app/            Next.js — UI, API routes, auth, middleware
worker/         Processo Node que expira atribuições vencidas (roda continuamente)
packages/db/    Schema Prisma, migrations, seed, motor de rotação (fonte única de verdade)
```

## Instalação

Pré-requisitos: Node 20+, um banco Postgres acessível publicamente (ex.: Railway).

```bash
npm install
```

### 1. Banco (Railway)

1. Crie um projeto no [railway.app](https://railway.app) e adicione um serviço **PostgreSQL**
   (`+ New` → `Database` → `Add PostgreSQL`).
2. No serviço Postgres, aba **Settings → Networking**, clique em **Add Public Access** para
   gerar a variável `DATABASE_PUBLIC_URL` (host termina em `*.proxy.rlwy.net`). É essa URL
   pública que você vai usar — a `DATABASE_URL` interna (`*.railway.internal`) só funciona
   entre serviços dentro do próprio projeto Railway.
3. Copie o valor resolvido (não a fórmula com `${{...}}`) da aba **Variables**.

### 2. Variáveis de ambiente

```bash
cp packages/db/.env.example packages/db/.env
cp worker/.env.example worker/.env
cp app/.env.example app/.env.local
```

Preencha `DATABASE_URL` nos três com a mesma connection string pública do Railway. Gere os
segredos indicados nos comentários do `app/.env.example` (`AUTH_SECRET`,
`META_TOKEN_ENCRYPTION_KEY`, `META_VERIFY_TOKEN`, `CRON_SECRET`).

### 3. Migrations + seed

```bash
npm run db:migrate   # cria as tabelas (prisma migrate dev)
npm run db:seed       # popula um ambiente de demonstração (ver contas abaixo)
```

O seed é isolado (`slug: prospera`) e nunca deve ser usado em produção — ver seção
"Seed vs. produção".

### 4. Rodar

```bash
npm run dev      # Next.js em http://localhost:3000
npm run worker    # em outro terminal — processa expirações a cada 15s
```

Sem o worker rodando, leads continuam sendo criados e atribuídos normalmente, mas nunca
expiram/transferem sozinhos — para produção ele **precisa** estar sempre ativo (ver "Deploy").

### Contas (seed)

As senhas dos corretores são geradas aleatoriamente pelo seed e impressas no terminal a cada
execução (`npm run db:seed`) — anote a saída do comando. Valores atuais:

| Papel | Email | Senha |
|---|---|---|
| Dono (OWNER) | adm@prospera.com | metodoneosprospera2026 |
| Corretor #1 | eduardo@prospera.com | bCGPtopWA5 |
| Corretor #2 | gisele@prospera.com | 9g3czG86Uj |
| Corretor #3 | joao@prospera.com | ovdPD4kr6t |
| Corretor #4 | maurilo@prospera.com | vwREywYudJ |
| Corretor #5 | mara@prospera.com | btPuDeazXB |
| Corretor #6 | tassi@prospera.com | LyHX53sLpj |

**Importante:** essas senhas estão em texto puro em `packages/db/seed.ts` e agora no histórico do
git — são credenciais reais de uso, não só dados de demonstração. Troque-as após o primeiro
login (ainda não há tela de "alterar senha" — pode ser feito gerando um novo hash com bcrypt e
atualizando `password_hash` diretamente, ou recriando o usuário) antes de expor este ambiente
publicamente, e evite dar push deste repositório para um remoto público sem antes trocar a
senha do OWNER.

## Testes

```bash
npm test --workspace app
```

Roda contra o **Postgres real** configurado em `app/.env.local` (cada teste cria sua própria
organização isolada e limpa tudo ao final — não usa o mesmo banco de dev de forma destrutiva,
mas evite rodar contra produção). Cobre os cenários críticos do escopo original: atribuição ao
primeiro corretor, timer gravado pelo servidor, claim dentro do prazo interrompe a rotação,
expiração transfere para o próximo, corretor pausado é pulado, ciclo completo volta ao
primeiro corretor, dois cliques simultâneos só um vence, corretor errado nunca assume,
idempotência do `meta_lead_id`, isolação cross-tenant, organização sem corretor ativo, e o
webhook do Meta de ponta a ponta (assinatura, verificação, criação, idempotência) com a Graph
API mockada no formato oficial documentado.

## Concorrência: como garantimos que só uma pessoa assume o lead

Todo o ciclo de vida de uma atribuição (`lead_assignments`) passa por transações Postgres com
`SELECT ... FOR UPDATE` na linha ativa antes de qualquer leitura/decisão:

- **Claim** (`claimLead` em `packages/db/src/rotation.ts`): trava a tentativa `ASSIGNED` atual,
  revalida corretor + prazo, só então marca `CONTACTED`.
- **Expiração** (`expireAndRotate`, chamado pelo worker a cada 15s): trava a mesma linha,
  revalida `status = ASSIGNED AND expires_at <= now()` antes de expirar — se um claim já
  resolveu a tentativa, não faz nada.
- **Distribuição** (`assignNextLead`/`distributeNewLead`): trava a linha de `rotation_state` da
  organização antes de ler/avançar a posição da fila, serializando leads concorrentes.

O timer nunca é decidido pelo navegador: `expires_at` é gravado pelo servidor no momento da
atribuição, e o frontend só calcula `expires_at - hora_do_servidor` (recebida a cada
resposta da API) para exibir a contagem regressiva.

## Configuração do Meta for Developers

Pesquisado na documentação oficial atual (`developers.facebook.com`) antes de implementar —
não foi assumido nada de versões antigas da API.

1. **Criar o app**: [developers.facebook.com/apps](https://developers.facebook.com/apps) →
   "Criar app" → tipo "Empresa".
2. **Adicionar o produto Webhooks**: no painel do app, adicione o produto **Webhooks**.
3. **Configurar a URL de callback**: em Webhooks → objeto **Página**, informe:
   - Callback URL: `https://SEU_DOMINIO/api/webhooks/meta`
   - Verify Token: o mesmo valor de `META_VERIFY_TOKEN` no seu `.env`
   - Campo a assinar: **`leadgen`**
   - Habilite **"Include Values"** no dashboard (senão a Meta manda só o nome dos campos
     alterados, sem os valores).
4. **Permissões necessárias** (App Review, modo desenvolvimento dispensa review para testar com
   contas de teste): `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`,
   `pages_read_engagement`, `ads_management` (e `pages_manage_ads` se for usar a leitura
   completa de campanha via Graph API).
5. **Obter um token de página de longa duração** com permissão de ADVERTISE na página — ver
   [guia oficial de long-lived tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived).
6. **Conectar no CRM**: em `/settings/integrations/meta`, informe o **Page ID** e o **token de
   acesso da página**. O CRM automaticamente:
   - testa o token (`GET /{page-id}`),
   - inscreve a página no seu webhook (`POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`),
   - salva o token **criptografado** (AES-256-GCM) no banco.
7. **Testar**: gere um lead de teste no seu formulário (Meta oferece um modo de teste no
   Gerenciador de Anúncios) e confirme em `/leads` que ele chegou e foi distribuído.

### Formato dos dados (confirmado na doc atual, Graph API v25.0)

- Webhook POST: `{ object: "page", entry: [{ id: <page_id>, changes: [{ field: "leadgen", value: { leadgen_id, page_id, form_id, adgroup_id, ad_id, created_time } }] }] }`.
  **`campaign_id` não vem no webhook nem no lead** — o CRM busca via `ad_id` (`GET
  /{ad_id}?fields=name,campaign{id,name},adset{id,name}`), de forma best-effort (se falhar, o
  lead é salvo mesmo assim, só sem esses nomes).
- Assinatura: header `X-Hub-Signature-256: sha256=<hmac>` (HMAC-SHA256 do corpo bruto com o App
  Secret) — validado em toda requisição antes de processar.
- Dados completos do lead: `GET /{leadgen_id}?fields=id,created_time,ad_id,form_id,field_data` —
  `field_data` é um array de `{ name, values: [...] }` (uma pergunta do formulário por item).
- Idempotência: `meta_lead_id` é `UNIQUE` no banco — reenvios do mesmo evento (a Meta reenvia em
  caso de falha de ack por até 36h) nunca duplicam o lead; o CRM registra um evento
  `WEBHOOK_DUPLICATE` e não redistribui.

## Configuração do WhatsApp (aviso automático para corretores)

Usa a **WhatsApp Cloud API** oficial da Meta (gratuita dentro do volume normal de uma operação
pequena/média, sem risco de banimento de número — ao contrário de bibliotecas não-oficiais que
imitam o WhatsApp Web). Três mensagens automáticas possíveis por lead: (1) quando ele é
atribuído a um corretor pela primeira vez, (2) quando esse corretor deixa o prazo esgotar sem
responder, e (3) se a roleta der uma volta completa sem ninguém responder e o lead voltar para
um corretor que já tinha recebido esse mesmo lead antes — nesse caso é um template diferente
("já passou pela equipe toda"), não uma repetição do aviso de "novo lead" a cada volta.

1. **Reaproveite o app da Meta** já criado para os Leads (ou crie um novo em
   [developers.facebook.com/apps](https://developers.facebook.com/apps)) e adicione o produto
   **WhatsApp**.
2. **Número de telefone**: cadastre e verifique um número da empresa no painel do produto
   WhatsApp — não pode ser um número que já tem uma conta pessoal/Business ativa no app do
   celular. A Meta fornece um número de teste gratuito para desenvolvimento (mensagens só para
   destinatários cadastrados como "número de teste"); para produção real, verifique um número
   próprio.
3. **Templates de mensagem**: business-initiated fora da janela de 24h só pode usar templates
   pré-aprovados. Em **WhatsApp Manager → Modelos de mensagem**, crie os três abaixo (categoria
   **Utilidade**, idioma **Português (BR)**) — os textos exatos também aparecem em
   `/settings/integrations/whatsapp`:
   - `novo_lead_atribuido`: "Olá {{1}}! Você recebeu um novo lead no CRM Próspera: {{2}},
     telefone {{3}}. Você tem {{4}} minutos para entrar em contato antes que ele passe para o
     próximo corretor."
   - `lead_expirado_corretor`: "Atenção {{1}}: o tempo para atender o lead {{2}} esgotou e ele
     foi transferido para o próximo corretor da fila."
   - `lead_retornou_corretor`: "Atenção {{1}}! O lead {{2}} (telefone {{3}}) já passou por toda
     a equipe sem resposta e voltou para você. Você tem mais {{4}} minutos para entrar em
     contato." — enviado no lugar de `novo_lead_atribuido` quando a roleta já tinha passado por
     esse corretor antes para o mesmo lead (evita repetir a mesma mensagem a cada volta).
   A aprovação pode levar de minutos a alguns dias; enquanto pendente, o envio falha e fica
   registrado em `audit_logs`/no campo "Último erro" da integração, sem travar a distribuição
   do lead (é best-effort).
4. **Token de acesso** com a permissão `whatsapp_business_messaging` (o mesmo System User usado
   para os Leads pode ganhar essa permissão extra).
5. **Conectar no CRM**: em `/settings/integrations/whatsapp`, informe o **Phone Number ID** e o
   token. O CRM testa (`GET /{phone-number-id}`) e salva o token **criptografado**.
6. **Cadastre o telefone pessoal de cada corretor** em `/settings/brokers` (campo já existente)
   — é para esse número que as mensagens são enviadas.
7. **Testar**: use o campo "Testar com um número" na própria tela de configuração antes de
   depender de um lead real.

## Notificações Push (avisa mesmo com o CRM fechado)

Web Push de verdade (Service Worker + Push API + VAPID) — sem Firebase, sem OneSignal, sem
custo. Avisa **todos os OWNER/ADMIN e todo corretor com `status = ACTIVE`** assim que um lead
novo é criado (webhook do Meta ou criação manual), mesmo com a aba/app fechado, incluindo
celular (Android e iPhone via PWA instalado) e PC.

### O que foi criado

- Tabela `push_subscriptions` (`packages/db/prisma/schema.prisma`) — um usuário pode ter várias
  inscrições (uma por navegador/dispositivo). Migration: `add_push_subscriptions`.
- `app/src/lib/push-server.ts` — `notifyNewLead(lead)` (chamada nos dois pontos reais de criação
  de lead: `api/webhooks/meta` e `api/leads`, via `after()` do Next.js — não atrasa nem quebra a
  resposta) e `sendTestPush(userId)`. Limpa sozinho inscrições que voltarem 404/410 (dispositivo
  desinstalou/expirou); qualquer outro erro só fica registrado em `lastError`, nunca derruba o
  envio dos demais.
- `app/public/sw.js` (Service Worker) + `app/public/manifest.json` + ícones (`icon-192.png`,
  `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`, gerados a partir do símbolo
  do logo da Próspera).
- Rotas: `GET /api/push/vapid-public-key` (pública), `POST /api/push/subscribe`,
  `POST /api/push/unsubscribe`, `GET /api/push/subscriptions`, `DELETE /api/push/subscriptions/:id`,
  `POST /api/push/test` (só OWNER/ADMIN).
- UI: banner "Ative as notificações" nos dois dashboards (substituiu o antigo, que só pedia
  permissão da Notification API in-tab — este novo faz o fluxo completo de push de verdade) +
  tela de gerenciamento em `/settings/notifications` (dono) e `/broker/profile` (corretor), com
  lista de dispositivos, botão de desativar por dispositivo e botão de teste (admin).

### Configurar as variáveis de ambiente

```bash
node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"
```

Adicione na Vercel (Production) e no `.env.local`:

```
VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_SUBJECT="mailto:seu-email@dominio.com"
```

`VAPID_SUBJECT` precisa ser uma URI `mailto:` ou `https:` válida — alguns serviços de push
rejeitam a requisição sem isso. Só o app (Vercel) precisa dessas variáveis — o worker não envia
push, só a Meta/WhatsApp.

### Testar

- **PC (Chrome/Edge)**: mais rápido pra iterar — abre o CRM, clica em "Ativar" no banner,
  aceita a permissão do navegador, clica em "Enviar notificação de teste" (só aparece pra
  OWNER/ADMIN) em `/settings/notifications`.
- **Android (Chrome)**: mesmo fluxo, funciona direto no navegador — não precisa instalar como
  PWA (embora instalar deixe a experiência mais parecida com um app nativo).
- **iPhone**: **obrigatório instalar como PWA primeiro** — Safari só permite Web Push pra sites
  adicionados à Tela de Início (iOS 16.4+), nunca numa aba comum. Toque em **Compartilhar** →
  **"Adicionar à Tela de Início"**, abra o CRM a partir do ícone criado (não mais pelo Safari) e
  só então ative as notificações. O banner/tela de configurações detecta automaticamente esse
  estado e mostra a instrução certa.
- **HTTPS é obrigatório em produção** (Vercel já serve tudo em HTTPS por padrão). Pra testar num
  iPhone físico durante o desenvolvimento, `localhost` não basta — o celular batendo no seu PC
  pela rede local não é um "contexto seguro" pro navegador; use um deploy de preview da Vercel
  ou um túnel HTTPS (ngrok, Tailscale Funnel) em vez disso.
- **Limitação conhecida**: na União Europeia, por causa do DMA, a Apple mudou o comportamento de
  "Adicionar à Tela de Início" e Web Push pode não funcionar mesmo instalado. Não é relevante
  pra operação da Próspera (Brasil), mas fica registrado caso o público mude no futuro.

## Segurança e RBAC

- Roles: `OWNER`, `ADMIN`, `BROKER`. Middleware (`src/middleware.ts`) redireciona por role;
  toda rota de API revalida com `requireSession([...roles])`.
- Isolamento multi-tenant reforçado em duas camadas: (1) toda query de dados tenant-scoped passa
  por `scopedDb(organizationId)`, que injeta o filtro a partir da sessão; (2) o motor de
  rotação/claim/expiração (código de sistema, não uma requisição de usuário) sempre recebe
  `organizationId` explícito e o valida em toda escrita.
- Tokens da Meta (Leads e WhatsApp) nunca ficam em texto puro: criptografados com AES-256-GCM
  (`META_TOKEN_ENCRYPTION_KEY`, compartilhada entre app e worker) antes de salvar; nunca
  expostos ao frontend.
- Senhas com bcrypt; sessão JWT assinada (`AUTH_SECRET`).
- `/api/cron/expire-assignments` (fallback de teste do worker) exige
  `Authorization: Bearer $CRON_SECRET`.

## Deploy

**App (Vercel)**: importe o repositório, defina o *root directory* como `app`, configure as
mesmas variáveis de `app/.env.example` no painel da Vercel (`DATABASE_URL` apontando para o
Postgres do Railway). Depois do deploy, atualize a URL do webhook no App Dashboard da Meta para
o domínio de produção.

**Worker (Railway)**: crie um novo serviço no mesmo projeto Railway a partir deste repositório,
*root directory* `worker`, comando de start `npm run start --workspace worker` (ou
`node --import tsx src/index.ts`), com `DATABASE_URL` apontando para o mesmo Postgres e
`META_TOKEN_ENCRYPTION_KEY` com o **mesmo valor** usado na Vercel (o worker precisa decifrar
tokens de integrações — Meta e WhatsApp — que foram criptografados pelo app). Esse processo
precisa ficar **sempre ativo** — é ele quem expira e transfere leads (e dispara o aviso de
"prazo esgotado" por WhatsApp) sem depender do navegador de ninguém estar aberto (seção "o
sistema continua funcionando mesmo com o navegador fechado").

## Evoluindo o realtime

O polling (2–3s) atende ao requisito de "sem refresh manual", mas para push instantâneo no
futuro: um serviço WebSocket dedicado no Railway (mesma vantagem de long-running process que o
worker já usa) ou um provedor gerenciado como Pusher/Ably, publicando eventos a partir dos
mesmos pontos onde hoje gravamos `audit_logs` (assign/claim/expire).

## Seed vs. produção

`packages/db/seed.ts` cria a organização `prospera` com dados fictícios — nunca é
chamado pelo fluxo principal (webhook, API de criação de corretor, etc.) e é seguro rodar em
desenvolvimento repetidamente (idempotente). Não rode `npm run db:seed` contra um banco de
produção com dados reais.

## O que fica como próximo passo

- OAuth completo (Facebook Login for Business) para conectar a página sem colar o token
  manualmente — hoje o dono cola um token de página já gerado (documentado acima), o que é
  suficiente e funcional, mas um fluxo "Conectar com Facebook" com seleção de página é uma
  evolução natural.
- Notificações por WhatsApp/email (a estrutura de `audit_logs` já registra todos os eventos
  necessários para disparar isso depois).
- Múltiplas equipes por organização — o schema já isola tudo por `organization_id` de um jeito
  que comporta uma tabela `teams` no meio sem quebrar nada, mas isso não foi implementado.

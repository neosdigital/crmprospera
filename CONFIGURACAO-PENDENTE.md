# CRM Próspera — Status e o que falta configurar

_Gerado em 20/09/2026, revisando código, banco de dados de produção e o histórico desta sessão de configuração._

---

## 1. O que já está pronto (funcionalidades do CRM)

Tudo abaixo já está **commitado, no ar na Vercel e funcionando** — testado ponta a ponta durante esta sessão.

| Funcionalidade | Onde | Observação |
|---|---|---|
| Motor de rotação: ranking fixo | `packages/db/src/rotation.ts` | Todo lead novo vai sempre para o corretor #1. Só escala pro #2, #3... se quem está acima não responder a tempo. Se der a volta completa, volta pro #1. |
| Worker de expiração sempre ativo | Railway, serviço `crmprospera-worker` | Roda a cada 15s, expira e transfere leads mesmo com todo mundo offline. Redeployado várias vezes nesta sessão, está com o código mais recente. |
| Rede de segurança contra worker fora do ar | `sweepOrganizationExpirations` | Além do worker, os próprios endpoints de polling (`/api/dashboard/live`, `/api/broker/my-leads`) também varrem e expiram tentativas vencidas. |
| Kanban da carteira do corretor | `/broker/wallet` | Colunas: Em andamento, Qualificado, Agendado, Convertido, Perdido. Arrastar-e-soltar. |
| Campo "Observação" por lead | Kanban + `/leads/[id]` | Campo `Lead.notes`, editável pelo corretor (leads na carteira dele) e pelo dono. |
| Traduções PT-BR | `src/lib/labels.ts` | Nenhum status em inglês aparece mais na tela (era `IN_PROGRESS`, `ASSIGNED` etc.). |
| Botão "Sair" no menu mobile | Owner e corretor | Antes só existia na sidebar desktop. |
| Botão "Enviar Lead Fictício" | `/leads` e `/live` (Admin) | Gera lead com dados aleatórios e já distribui pela roleta — pra testar sem depender de lead real. |
| Filtro de período por calendário | `/dashboard`, botão "Filtrar Data" | Além de Hoje/7 dias/30 dias, agora dá pra escolher um intervalo De/Até personalizado. |
| Edição de telefone do corretor | `/settings/rotation` | Antes só dava pra definir na criação do corretor. Importante pro WhatsApp funcionar certo. |
| **Integração WhatsApp — código pronto, falta configurar do lado da Meta** | `/settings/integrations/whatsapp` | Ver seção 3.2 abaixo. |
| **Integração Meta Ads (Leads) — parcialmente configurada** | `/settings/integrations/meta` | Ver seção 3.1 abaixo. |

### Reset de dados

A pedido, todos os 21 leads de teste/seed (e os registros dependentes: 207 atribuições, 603 logs de auditoria) foram apagados. Corretores, usuários e configurações continuam intactos. Hoje existem só 3 leads de teste criados via botão "Enviar Lead Fictício" depois do reset — nenhum lead real ainda.

### Infraestrutura

| Camada | Onde | Status |
|---|---|---|
| App (Next.js) | Vercel — `https://crmprospera.vercel.app` | No ar, deploy automático a cada `git push` |
| Banco (Postgres) | Railway, projeto `proud-solace`, serviço `Postgres-wkhr` | No ar |
| Worker de expiração | Railway, projeto `proud-solace`, serviço `crmprospera-worker` | No ar, sempre ativo, código atualizado |
| Repositório | `github.com/neosdigital/crmprospera`, branch `main` | Tudo commitado até `f243f08` |

---

## 2. O que falta — resumo rápido

| Item | Status |
|---|---|
| Verificação do webhook (GET) | ✅ Confirmado funcionando |
| `META_APP_SECRET` na Vercel | ❌ Não configurado |
| Identificar a Página dentro do Business Portfolio "Prospera" | ❌ Ainda não localizada |
| App da Meta associado ao Business Portfolio "Prospera" | ⚠️ Não confirmado |
| Token de **Página** (não de usuário) com permissões corretas | ❌ Não gerado |
| Conectar em `/settings/integrations/meta` | ❌ Não feito |
| Confirmar toggle "Assinar" no campo `leadgen` | ⚠️ Não confirmado |
| Produto WhatsApp adicionado no app | ❌ Não feito |
| Número de WhatsApp Business verificado | ❌ Não feito |
| Os 3 templates de mensagem criados e **aprovados** | ❌ Não feito |
| Conectar em `/settings/integrations/whatsapp` | ❌ Não feito |

---

## 3. Detalhamento — o que falta em cada integração

### 3.1 Meta Ads (Leads)

**O que já foi confirmado nesta sessão:**
- O app na Meta já tem o caso de uso "Capturar e gerenciar leads de anúncios com a API de Marketing" adicionado.
- A URL do webhook (`https://crmprospera.vercel.app/api/webhooks/meta`) responde corretamente à verificação da Meta — testei diretamente com `curl` simulando a checagem da Meta e recebi `200 OK` com o challenge correto de volta. Isso confirma que `META_VERIFY_TOKEN` está certo na Vercel.

**O que falta, em ordem:**

1. **Achar a Página certa.** Descobrimos que a conta de anúncios que vai rodar as campanhas ("NEOS + PROSPERA", ID `1763552198217471`) está dentro do **Business Portfolio "Prospera"** — diferente dos outros portfólios que apareceram antes ("Howx GROUP", "HowxDigital"). Ainda não achamos qual **Página do Facebook** está associada a esse mesmo portfólio "Prospera". Isso precisa ser confirmado antes de qualquer outro passo — sem a Página certa, nada mais funciona.
   - Onde olhar: dentro do portfólio "Prospera" (o mesmo menu onde apareceu a conta de anúncios), deve existir uma aba/seção "Páginas".

2. **Confirmar que o app da Meta está no portfólio "Prospera".** Em Configurações do app → Básico → campo "Portfólio empresarial". Se estiver em outro portfólio, o token gerado não vai ter permissão sobre a Página, mesmo com as permissões certas marcadas.

3. **Gerar um token de PÁGINA (não de usuário).**
   - ⚠️ Já tentamos um token nesta sessão que o usuário colou direto no chat — ao testar, ele resolveu para o perfil pessoal "Arthur Lemos", não para uma Página, e dava acesso a 17 páginas de **outras** contas/clientes (nenhuma delas do projeto Próspera). Esse token **não foi salvo em lugar nenhum** — testamos, falhou ao tentar inscrever no webhook (porque não é token de Página), e descartamos. Ele ainda é um token de usuário válido, então por segurança, se quiser, pode revogá-lo depois em Configurações da Conta do Facebook → Segurança → Apps e sites.
   - O jeito certo: no Graph API Explorer, gerar especificamente um **"Token de Acesso à Página"** (não um token de usuário com permissões de página), selecionando a Página certa do portfólio "Prospera". Depois, estender esse token pra não expirar (Access Token Debugger → "Estender Token de Acesso").
   - Permissões necessárias: `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management`.

4. **Adicionar `META_APP_SECRET` na Vercel.** Em Configurações do app → Básico → "Chave secreta do aplicativo" → Mostrar → copiar. Adicionar como variável de ambiente na Vercel (Production) e redeployar. **Sem isso, mesmo com tudo o resto certo, todo lead real será rejeitado** com erro "Invalid signature" — é uma variável diferente do `META_VERIFY_TOKEN`.

5. **Conectar em `/settings/integrations/meta`** com o Page ID + token de página gerado no passo 3. O CRM testa o token, inscreve a Página no webhook automaticamente e salva tudo criptografado — não precisa mexer mais no painel da Meta depois disso.

6. **Conferir se o campo `leadgen` está com o toggle "Assinar" ativado** na aba Page do Webhooks (dentro do app da Meta) — o passo 5 deveria fazer isso automaticamente via API, mas vale confirmar visualmente.

7. **Testar**: gerar um lead de teste no Gerenciador de Anúncios e confirmar que ele aparece em `/leads`.

### 3.2 WhatsApp (Cloud API)

Nada foi conectado ainda — só o código está pronto. Faltam, em ordem:

1. Adicionar o produto **WhatsApp** no mesmo app da Meta (idealmente o mesmo do item 3.1, já que precisa estar no mesmo Business Portfolio "Prospera").
2. Verificar um **número de telefone da empresa** dentro do produto WhatsApp — não pode ser um número com WhatsApp pessoal ativo.
3. Gerar um token com a permissão `whatsapp_business_messaging` e copiar o **Phone Number ID**.
4. Criar os **3 templates de mensagem** no WhatsApp Manager (categoria Utilidade, idioma Português BR) e aguardar aprovação da Meta (minutos a alguns dias):
   - `novo_lead_atribuido`
   - `lead_expirado_corretor`
   - `lead_retornou_corretor`
   
   Os textos exatos e os exemplos de variáveis já estão prontos em `/settings/integrations/whatsapp` (tela do CRM) e no `README.md`, seção "Configuração do WhatsApp".
5. Conectar em `/settings/integrations/whatsapp` com o Phone Number ID + token.
6. Usar o campo "Testar com um número" da própria tela antes de depender de um lead real.
7. Conferir que cada corretor tem o telefone pessoal certo em `/settings/rotation` (isso **já está feito** — todos os 6 corretores têm telefone cadastrado).

### 3.3 Variáveis de ambiente — checklist final

| Variável | Local (`.env.local`) | Vercel (Production) | Railway (worker) |
|---|---|---|---|
| `DATABASE_URL` | ✅ | precisa conferir | ✅ |
| `AUTH_SECRET` | ✅ | precisa conferir | não se aplica |
| `META_TOKEN_ENCRYPTION_KEY` | ✅ | **precisa conferir/adicionar** | ✅ confirmado |
| `META_VERIFY_TOKEN` | ✅ | ✅ confirmado (testado com curl) | não se aplica |
| `META_APP_SECRET` | ❌ ainda não configurado em lugar nenhum | ❌ | não se aplica |
| `CRON_SECRET` | opcional (só fallback de teste manual) | opcional | não se aplica |

**Atenção especial ao `META_TOKEN_ENCRYPTION_KEY` na Vercel**: se essa variável não estiver lá com o **mesmo valor** usado no worker do Railway, a conexão das integrações (Meta e WhatsApp) vai falhar ao tentar salvar o token, ou o worker não vai conseguir decifrá-lo depois. Valor a usar (mesmo já configurado no worker):
```
META_TOKEN_ENCRYPTION_KEY=8157146c7938f26a1ba17cb99013114feaca5f08864adf7719f1c811781f02db
```

---

## 4. Ordem recomendada para terminar tudo

1. Achar a Página do Facebook dentro do Business Portfolio "Prospera".
2. Confirmar que o app da Meta está associado a esse mesmo portfólio.
3. Gerar o token de **Página** (não de usuário) com as permissões corretas.
4. Pegar o `META_APP_SECRET` e adicionar na Vercel.
5. Conferir/adicionar `META_TOKEN_ENCRYPTION_KEY` na Vercel.
6. Conectar em `/settings/integrations/meta`.
7. Testar com um lead de teste do Gerenciador de Anúncios.
8. Adicionar o produto WhatsApp, verificar o número, gerar o token.
9. Criar e aguardar aprovação dos 3 templates.
10. Conectar em `/settings/integrations/whatsapp` e testar com "Testar com um número".
11. Teste final ponta a ponta: lead real chega pela campanha → aparece em `/leads` → corretor #1 recebe WhatsApp → se não responder a tempo, escala e o próximo recebe.

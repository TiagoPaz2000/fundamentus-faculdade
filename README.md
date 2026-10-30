# Carteira da Turma

App da faculdade para acompanhar uma carteira de ações compartilhada. Todos os usuários convidados veem os mesmos dados; só administradores compram, vendem, editam, mexem no caixa e gerenciam usuários.

- Next.js 16 (App Router, Cache Components, `proxy.ts`), TypeScript e Tailwind v4
- Supabase: Auth (e-mail e senha, só convidados), Postgres com RLS e Storage (bucket privado `screenshots`)
- Cotações: Fundamentus (cotação e indicadores) e InfoMoney (cotação e histórico OHLC para os candles)
- Prints da página do Fundamentus com Puppeteer (`@sparticuz/chromium` na Vercel, Chrome local em desenvolvimento)
- Planilha `.xlsx` com ExcelJS e gráfico de candles com lightweight-charts v5

## Funcionalidades

| Rota | O que faz |
| --- | --- |
| `/login` | Login com e-mail e senha. Não existe cadastro. |
| `/` | Cards (caixa, investido, valor de mercado, resultado, papéis na carteira X/10), formulário de compra (admin), tabela com filtro abertas/fechadas/todas, prints e ações de admin. |
| `/papel/[ticker]` | Candles do InfoMoney com volume, linhas tracejadas nos preços de compra/venda, marcadores nas datas, indicadores do Fundamentus e as posições com os prints em miniatura. |
| `/caixa` | Movimentações com saldo acumulado. O admin lança aporte, retirada e ajuste, e exclui lançamentos manuais. |
| `/usuarios` | (admin) Promover ou rebaixar administradores. O último admin não pode ser removido. |
| `/definir-senha` | Definir senha depois de aceitar o convite. |
| `/api/export` | Baixa a planilha (abas "Carteira" e "Caixa"; links dos prints valem 7 dias). Exige login. |
| `/api/cron/scrape` | Cron diário que atualiza as cotações dos papéis em aberto. Exige `Authorization: Bearer CRON_SECRET`. |
| `/api/cron/orders` | Executa as compras agendadas cujo preço foi atingido (3x por dia útil, dentro do pregão). Exige `Authorization: Bearer CRON_SECRET`. |
| `/auth/confirm` | Destino dos links de convite e de recuperação de senha. |

### Regras principais

- **Carteira de 10 papéis × 100 ações**: são escolhidos até 10 papéis, e cada compra é automaticamente de **100 ações** daquele papel. A quantidade não é digitada nem editada. Cada papel tem no máximo uma posição aberta: depois de fechar, ele pode voltar. Papéis com compra agendada ocupam vaga. O formulário mostra as vagas livres e o banco também barra (trigger `enforce_portfolio_limit`, redefinido na migration `0003`); o erro é traduzido para uma mensagem amigável.
- **Caixa**: o saldo é a view `cash_balance`. Compras debitam e vendas creditam automaticamente (trigger `sync_position_cash`). Uma compra que deixa o saldo negativo é permitida, com aviso.
- **Horário do pregão**: a compra imediata só é aceita de segunda a sexta, das 10:00 às 17:00 (Brasília). A data da compra é sempre a de hoje. O servidor recusa fora desse horário, mesmo que alguém chame a action direto. O horário pode ser ajustado com as envs `MARKET_OPEN` e `MARKET_CLOSE` (`HH:MM`), porque a B3 muda o horário em alguns períodos do ano.
- **Compra agendada (preço-limite)**: fora do pregão, ou se preferir, o admin informa ticker, quantidade, **preço desejado** e, opcionalmente, a validade, e agenda. Dentro do pregão, o cron `/api/cron/orders` (ou o botão **Verificar agora**) busca a cotação; se ela estiver **no preço desejado ou abaixo** e for **de hoje**, a compra é registrada pela cotação do momento, com print e histórico como numa compra normal. Se estiver acima, a ordem continua aguardando. Ordens vencidas viram "Vencida". Um papel agendado ocupa uma das 10 vagas, e a ordem também é de 100 ações. O admin pode cancelar ordens pendentes.
- **Tela de compra** (pensada para celular): digite o papel ou o nome da empresa no campo de busca (lista de ~1000 papéis do Fundamentus, em cache por 1 dia via `/api/tickers`) e escolha. Aparecem as **100 ações**, o **valor atual** e o total. Ao clicar em **Comprar**, o servidor busca a cotação de novo naquele instante e registra a compra por ela (o preço não é digitado), depois tira o print. Papéis sem negociação recente (cotação com mais de 7 dias) não podem ser comprados nem agendados.
- **Compra**: insere a posição e depois, em paralelo, (b) tira o print do Fundamentus e sobe para `screenshots/<TICKER>/<id>-buy-<timestamp>.png`, (c) importa o histórico do InfoMoney desde a data da compra menos 180 dias e (d) grava a cotação atual das duas fontes. Se b, c ou d falharem, a compra continua valendo e o erro aparece na tela; em **Gerenciar** há "Tirar print novamente" e "Reimportar histórico".
- **Fechar posição**: busca a cotação atual (Fundamentus, com fallback para o InfoMoney) para pré-preencher o preço, grava a venda e tira o print `-sell-`.
- Todas as Server Actions conferem `profiles.is_admin` no servidor antes de agir, sem depender só do RLS. O upload de prints e a escrita em `quotes` usam service role, sempre depois dessa checagem (ou do `CRON_SECRET`, no caso do cron).

## Setup

### 1. Supabase

1. Crie um projeto em <https://supabase.com>.
2. Abra **SQL Editor**, cole o conteúdo de `supabase/migrations/0001_init.sql` e rode. Isso cria as tabelas, as views, os triggers, o RLS e o bucket privado `screenshots`. Depois rode `supabase/migrations/0002_scheduled_orders.sql`, que cria as compras agendadas, e `supabase/migrations/0003_ten_tickers.sql`, que troca o limite antigo de 100 ações no total pela regra de 10 papéis × 100 ações.
   - O e-mail `tiagopaz.jna@gmail.com` vira admin automaticamente. Para usar outro admin inicial, troque o e-mail na migration **antes** de rodar, ou depois rode `update public.profiles set is_admin = true where email = '...'`.
3. Em **Authentication → Sign In / Providers** (ou **Auth → Settings**), **desligue "Allow new users to sign up"**. Assim só entra quem for convidado.
4. Em **Authentication → URL Configuration**, defina o **Site URL**: a URL da Vercel em produção ou `http://localhost:3000` localmente. Adicione as duas em **Redirect URLs**.
5. Em **Authentication → Email Templates**:
   - **Invite user**: troque o link para
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/definir-senha`
   - **Reset password** (opcional): use
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/definir-senha`
6. Para convidar alguém: **Authentication → Users → Invite user**. A pessoa recebe o e-mail, clica no link, define a senha em `/definir-senha` e já entra. Outra opção é **Add user → Create new user**, com senha e "Auto Confirm User" marcado.
7. Para promover outros admins, use a tela `/usuarios`.

### 2. Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

| Variável | Onde achar |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` / secret key. **Nunca** exponha no cliente. |
| `CRON_SECRET` | Uma string aleatória longa, por exemplo `openssl rand -hex 32` |
| `MARKET_OPEN` / `MARKET_CLOSE` | Opcional. Horário do pregão em Brasília, padrão `10:00` / `17:00`. |
| `CHROME_EXECUTABLE_PATH` | Só local: caminho do Chrome, por exemplo `C:\Program Files\Google\Chrome\Application\chrome.exe` ou `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |

As variáveis são lidas em tempo de request, então o `npm run build` funciona sem elas.

### 3. Rodar localmente

```bash
npm install
npm run dev          # http://localhost:3000
```

Verificações:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Testes manuais dos scrapers e do print (precisam de internet):

```bash
npx tsx scripts/test-fundamentus.ts PETR4 VALE3
# print: salva o PNG na pasta indicada (padrão: ./tmp)
npx tsx --conditions=react-server scripts/test-screenshot.ts PETR4 ./tmp
```

(`--conditions=react-server` é necessário porque `lib/screenshot.ts` importa `server-only`.)

### 4. Deploy na Vercel

1. Importe o repositório na Vercel (framework Next.js).
2. Em **Settings → Environment Variables**, cadastre `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET`. **Não** defina `CHROME_EXECUTABLE_PATH` na Vercel: lá o app usa `@sparticuz/chromium`.
3. Use **Node.js 22 ou superior** (Settings → General → Node.js Version), exigido pelo `@sparticuz/chromium` 153.
4. Faça o deploy. O `vercel.json` registra os crons (horários em UTC; Brasília = UTC−3):
   - `/api/cron/scrape`: `30 21 * * 1-5`, 18h30 de Brasília em dias úteis.
   - `/api/cron/orders`: `30 13`, `0 16` e `15 19` em dias úteis, ou seja, cerca de 10h30, 13h00 e 16h15 de Brasília, dentro do pregão.

    A Vercel envia `Authorization: Bearer <CRON_SECRET>` automaticamente quando a variável `CRON_SECRET` existe.
5. Atualize o **Site URL** do Supabase para a URL de produção.

Configuração relevante já incluída:

- `next.config.ts`: `serverExternalPackages` para `puppeteer-core`, `@sparticuz/chromium` e `exceljs`, e `outputFileTracingIncludes` para levar os binários do Chromium nas funções de `/` e `/papel/[ticker]`.
- As páginas que disparam prints (`/` e `/papel/[ticker]`) exportam `maxDuration = 60`, que vale para as Server Actions delas. O cron usa `maxDuration = 300`.
- Com Cache Components ativo, o Next 16 **não aceita** `export const runtime` nas rotas. O runtime padrão já é Node.js, então essa exportação foi omitida de propósito.

### 5. Testar o cron localmente

Com `npm run dev` rodando e `CRON_SECRET` no `.env.local`:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/scrape
```

A resposta é um JSON com `ok`, `tickers`, `saved` e `results[TICKER][fundamentus|infomoney]` (`ok` com o preço, ou o `error`). Sem o header, a rota responde 401.

Compras agendadas (fora do pregão responde `ran: false` com o motivo):

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/orders
```

## Estrutura

```
proxy.ts                      renova a sessão do Supabase e redireciona para /login
app/(main)/...                páginas logadas (layout com cabeçalho)
app/login, app/auth/confirm   login e confirmação de convite
app/actions/*.ts              Server Actions (posições, caixa, usuários, auth)
app/api/export/route.ts       planilha .xlsx
app/api/cron/scrape/route.ts  cron de cotações
lib/supabase/{server,client,admin,proxy}.ts
lib/database.types.ts         tipos das tabelas (escritos à mão a partir do SQL)
lib/portfolio.ts              carga e cálculos da carteira
lib/quotes.ts                 upsert de cotações, histórico e upload de prints
lib/screenshot.ts             Puppeteer (server-only)
lib/market-hours.ts           horário do pregão
lib/scheduled-orders.ts       execução das compras agendadas
lib/scrapers/*                scrapers do Fundamentus e do InfoMoney
supabase/migrations/0001_init.sql, 0002_scheduled_orders.sql, 0003_ten_tickers.sql
```

## Limitações

- **Plano Hobby da Vercel**: cada cron roda no máximo 1 vez por dia (por isso as ordens usam 3 entradas separadas no `vercel.json`), e a Vercel pode disparar em qualquer momento dentro da hora agendada. Para cotações intradiárias seria preciso o plano Pro ou um agendador externo chamando a rota com o `CRON_SECRET`.
- **Compras agendadas no plano Hobby**: cada cron dispara em algum momento dentro da hora agendada, então a verificação não é em tempo real. Se o preço tocar o limite e voltar entre duas verificações, a ordem não executa. Use **Verificar agora** para checar na hora. A cotação do Fundamentus tem atraso, e a compra é registrada por essa cotação, não por um preço de corretora.
- **Feriados da B3** não estão no calendário. Nesses dias, a execução agendada não compra porque exige uma cotação com a data de hoje; já a compra imediata não é bloqueada em feriado.
- **O print registra o momento do cadastro**, não a data de compra informada. Se você lança hoje uma compra feita semana passada, o print mostra a página do Fundamentus de hoje. O mesmo vale para "Tirar print novamente".
- Fundamentus e InfoMoney publicam cotações com atraso e podem mudar o HTML ou a API sem aviso. Nesse caso os scrapers falham e o app mostra o erro; a compra ou venda continua sendo registrada.
- A "cotação atual" é a cotação mais recente gravada no banco (atualizada pelo cron, por uma compra ou por "buscar cotação"). Se as duas fontes têm cotação do mesmo dia, vale a do InfoMoney.
- O print usa Chromium em função serverless: a primeira execução (cold start) pode levar de 10 a 20 s.
- Excluir uma posição apaga também os lançamentos de caixa dela (cascade) e os prints.

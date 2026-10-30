# Carteira da Turma

App da faculdade para acompanhar uma carteira de ações compartilhada. Todos os **membros** veem os mesmos dados e cada um compra até 2 papéis; só administradores vendem, editam, mexem no caixa e gerenciam membros.

> **Projeto Supabase compartilhado.** Este app usa o mesmo projeto Supabase de outro app (blender-ai). O login (`auth.users`) é comum aos dois, então ter conta não dá acesso à carteira: só entra quem é **membro** (tem linha em `public.profiles`). As tabelas da carteira (`profiles`, `positions`, `cash_movements`, `quotes`, `scheduled_orders`) não colidem com as do outro app (`perfis`, `pontes`, `fila`…). Os templates de e-mail e as configurações de Auth também são compartilhados: este app **não envia e-mails** e não depende deles.

- Next.js 16 (App Router, Cache Components, `proxy.ts`), TypeScript e Tailwind v4
- Supabase: Auth (e-mail e senha), acesso só para membros, Postgres com RLS e Storage (bucket privado `screenshots`)
- Cotações: Fundamentus (cotação e indicadores) e InfoMoney (cotação e histórico OHLC para os candles)
- Prints da página do Fundamentus com Puppeteer (`@sparticuz/chromium` na Vercel, Chrome local em desenvolvimento)
- Planilha `.xlsx` com ExcelJS e gráfico de candles com lightweight-charts v5

## Funcionalidades

| Rota | O que faz |
| --- | --- |
| `/login` | Login com e-mail e senha. Não existe cadastro. |
| `/sem-acesso` | Aparece para quem está logado mas não é membro (ex.: conta do outro app): mostra o e-mail e o botão de sair. |
| `/` | Cards (caixa, investido, valor de mercado, resultado, papéis na carteira X/10), formulário de compra (todo membro), tabela com filtro abertas/fechadas/todas, prints e ações de admin. |
| `/papel/[ticker]` | Candles do InfoMoney com volume, linhas tracejadas nos preços de compra/venda, marcadores nas datas, indicadores do Fundamentus e as posições com os prints em miniatura. |
| `/caixa` | Movimentações com saldo acumulado. O admin lança aporte, retirada e ajuste, e exclui lançamentos manuais. |
| `/usuarios` | (admin) Membros: adicionar por e-mail, gerar link de convite/senha, remover, promover/rebaixar admin. O último admin não pode ser removido nem rebaixado. |
| `/definir-senha` | Definir senha depois de aceitar o convite. |
| `/api/export` | Baixa a planilha (abas "Carteira" e "Caixa"; links dos prints valem 7 dias). Exige ser membro. |
| `/api/cron/scrape` | Cron diário que atualiza as cotações dos papéis em aberto. Exige `Authorization: Bearer CRON_SECRET`. |
| `/auth/confirm` | Destino dos links de convite e de recuperação de senha. |

### Regras principais

- **Carteira de 10 papéis × 100 ações**: são escolhidos até 10 papéis, e cada compra é automaticamente de **100 ações** daquele papel. A quantidade não é digitada nem editada. Cada papel tem no máximo uma posição aberta: depois de fechar, ele pode voltar. Cada membro tem no máximo **2 posições abertas** (vender libera a vaga). O formulário mostra as vagas livres e o banco também barra (trigger `enforce_portfolio_limit`, redefinido na migration `0003`); o erro é traduzido para uma mensagem amigável.
- **Caixa**: o saldo é a view `cash_balance`. Compras debitam e vendas creditam automaticamente (trigger `sync_position_cash`). Uma compra que deixa o saldo negativo é permitida, com aviso.
- **Compra a qualquer hora (dentro ou fora do pregão)**: não existe agendamento nem bloqueio de horário. O preço é sempre a cotação buscada no servidor **no momento do clique** (Fundamentus, com fallback para o InfoMoney). Dentro do pregão (segunda a sexta, 10:00–17:00 de Brasília) é a cotação atual; **fora do pregão** (noite, madrugada, fim de semana, antes da abertura) os sites já mostram o **último fechamento**, então a compra sai pelo valor de fechamento do último pregão. A data da compra é sempre a de hoje. O horário do pregão serve só para a interface (rótulo "Pregão aberto/fechado" e "cotação atual" × "fechamento de dd/mm") e pode ser ajustado com as envs `MARKET_OPEN` e `MARKET_CLOSE` (`HH:MM`), porque a B3 muda o horário em alguns períodos do ano.
- **Tela de compra** (pensada para celular): digite o papel ou o nome da empresa no campo de busca (lista de ~1000 papéis do Fundamentus, em cache por 1 dia via `/api/tickers`) e escolha. Aparecem as **100 ações**, o preço que será usado (**cotação atual** ou **fechamento de dd/mm**, pela data da cotação) e o total. Ao clicar em **Comprar**, o servidor busca a cotação de novo naquele instante e registra a compra por ela (o preço não é digitado), depois tira o print. Papéis sem negociação recente (cotação com mais de 7 dias) não podem ser comprados.
- **Compra**: insere a posição e depois, em paralelo, (b) tira o print do Fundamentus e sobe para `screenshots/<TICKER>/<id>-buy-<timestamp>.png`, (c) importa o histórico do InfoMoney desde a data da compra menos 180 dias e (d) grava a cotação atual das duas fontes. Se b, c ou d falharem, a compra continua valendo e o erro aparece na tela; em **Gerenciar** há "Tirar print novamente" e "Reimportar histórico".
- **Fechar posição**: busca a cotação atual (Fundamentus, com fallback para o InfoMoney) para pré-preencher o preço, grava a venda e tira o print `-sell-`.
- **Membros**: páginas, Server Actions, `/api/export` e `/api/tickers` exigem que o usuário logado tenha perfil em `profiles`; o RLS (migration `0004`) também só deixa membros lerem os dados. Os crons usam service role e não dependem de login.
- Todas as Server Actions conferem `profiles.is_admin` no servidor antes de agir, sem depender só do RLS. O upload de prints e a escrita em `quotes` usam service role, sempre depois dessa checagem (ou do `CRON_SECRET`, no caso do cron).

## Setup

### 1. Supabase

1. Use o projeto Supabase **já existente** do blender-ai (ou crie um novo em <https://supabase.com>).
2. No **SQL Editor**, rode as migrations em ordem: `0001_init.sql`, `0002_scheduled_orders.sql`, `0003_ten_tickers.sql`, `0004_membros.sql` e `0005_compras_por_usuario.sql` (pasta `supabase/migrations`).
   - `0001`: tabelas, views, triggers, RLS e o bucket privado `screenshots`.
   - `0002`: tabela `scheduled_orders` (compras agendadas). O app não usa mais agendamento; a tabela fica no banco sem uso.
   - `0003`: regra de 10 papéis × 100 ações.
   - `0004`: modelo de membros para coexistir com o outro app. Remove o trigger que criava perfil para **todo** usuário novo, cria `is_member()`, faz as policies de leitura (tabelas e prints) exigirem membro e impede apagar o último admin. Só o admin inicial (`tiagopaz.dev@gmail.com`) ganha perfil automaticamente. Na primeira execução, apaga os perfis que a `0001` criou para usuários do outro app (reexecutar não apaga membros novos); falha sem apagar nada se o admin inicial não existir em `auth.users`.
   - `0005`: cada membro compra os próprios papéis, no máximo **2 abertos por usuário** (vender libera a vaga). O trigger ainda soma ordens `pending` de `scheduled_orders`, que fica vazia e conta zero. Cria `profiles.name` (parte do email antes do @). A compra de membros passa pelo servidor (service role); pelo RLS só admin escreve em `positions`.
3. **Não** desligue o cadastro público nem edite os templates de e-mail: essas configurações são do projeto inteiro e o outro app depende delas. A carteira não precisa disso, porque o acesso é controlado pela lista de membros.
4. Em **Authentication → URL Configuration**, adicione a URL da carteira (Vercel e `http://localhost:3000`) em **Redirect URLs**. Não troque o **Site URL** se ele for do outro app.

#### Membros e convites

- **Membro** = usuário do auth com linha em `public.profiles`. Quem está logado sem perfil vê "Você não tem acesso a esta carteira".
- Em `/usuarios`, o admin digita um e-mail em **Adicionar membro**:
  - **E-mail que já tem conta** (por exemplo, usuário do outro app): só é criado o perfil. A pessoa entra com a senha que já usa.
  - **E-mail novo**: o servidor cria o usuário com `auth.admin.generateLink({ type: "invite" })`, **sem enviar e-mail**, cria o perfil e mostra um link `/auth/confirm?token_hash=…&type=invite` para copiar e mandar por WhatsApp ou outro canal. Ao abrir, a pessoa é autenticada e cai em `/definir-senha`.
- O link expira no prazo de OTP do projeto (padrão do Supabase: 1 hora). Para reenviar, use **Gerar link de convite** no membro. Para quem esqueceu a senha, use **Gerar link de senha**. A senha vale também no outro app, porque a conta é a mesma.
- **Remover** apaga só o perfil: a conta continua existindo, inclusive no outro app. Ninguém pode remover a si mesmo, e o último admin não pode ser removido (o banco também barra).

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
4. Faça o deploy. O `vercel.json` registra o cron (horário em UTC; Brasília = UTC−3):
   - `/api/cron/scrape`: `30 21 * * 1-5`, 18h30 de Brasília em dias úteis.

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
lib/market-hours.ts           horário do pregão (só para os rótulos da compra)
lib/scrapers/*                scrapers do Fundamentus e do InfoMoney
supabase/migrations/0001_init.sql … 0005_compras_por_usuario.sql
```

## Limitações

- **Plano Hobby da Vercel**: cada cron roda no máximo 1 vez por dia, e a Vercel pode disparar em qualquer momento dentro da hora agendada. Para cotações intradiárias seria preciso o plano Pro ou um agendador externo chamando a rota com o `CRON_SECRET`.
- **Feriados da B3** não estão no calendário. Num feriado em dia útil a compra continua liberada e sai pela cotação que os sites mostram (o fechamento do último pregão); como a data da cotação não é de hoje, a tela mostra "fechamento de dd/mm" mesmo dentro do horário do pregão.
- A cotação do Fundamentus tem atraso, e a compra é registrada por essa cotação, não por um preço de corretora. Fora do pregão a data da compra (hoje) e a data da cotação (último pregão) são diferentes.
- **O print registra o momento do cadastro**, não a data de compra informada. Se você lança hoje uma compra feita semana passada, o print mostra a página do Fundamentus de hoje. O mesmo vale para "Tirar print novamente".
- Fundamentus e InfoMoney publicam cotações com atraso e podem mudar o HTML ou a API sem aviso. Nesse caso os scrapers falham e o app mostra o erro; a compra ou venda continua sendo registrada.
- A "cotação atual" é a cotação mais recente gravada no banco (atualizada pelo cron, por uma compra ou por "buscar cotação"). Se as duas fontes têm cotação do mesmo dia, vale a do InfoMoney.
- O print usa Chromium em função serverless: a primeira execução (cold start) pode levar de 10 a 20 s.
- Excluir uma posição apaga também os lançamentos de caixa dela (cascade) e os prints.

-- =====================================================================
-- Carteira compartilhada: vários usuários logados (só convidados) veem
-- os mesmos dados. Apenas admins compram, editam, vendem e mexem no caixa.
-- =====================================================================

-- ---------- Perfis / admins ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Admin inicial (outros admins são promovidos pela tela de usuários)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, is_admin)
  values (new.id, new.email, lower(new.email) = 'tiagopaz.jna@gmail.com')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill para usuários criados antes desta migration
insert into public.profiles (id, email, is_admin)
select id, email, lower(email) = 'tiagopaz.jna@gmail.com' from auth.users
on conflict (id) do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- ---------- Posições ----------
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  ticker text not null check (ticker = upper(ticker)),
  quantity numeric not null default 1 check (quantity > 0),
  buy_date date not null,
  buy_price numeric(14,4) not null check (buy_price > 0),
  buy_screenshot_path text,            -- caminho no bucket "screenshots"
  status text not null default 'open' check (status in ('open','closed')),
  sell_date date,
  sell_price numeric(14,4) check (sell_price is null or sell_price > 0),
  sell_screenshot_path text,
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (status = 'open' or (sell_date is not null and sell_price is not null))
);
create index if not exists positions_ticker_idx on public.positions(ticker);

-- ---------- Caixa ("valor disponível") ----------
-- Saldo = soma de amount. Compras/vendas geram movimentos automaticamente.
create table if not exists public.cash_movements (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('deposit','withdraw','adjust','buy','sell')),
  amount numeric(14,2) not null,       -- positivo entra, negativo sai
  position_id uuid references public.positions(id) on delete cascade,
  note text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (position_id, kind)
);

create or replace view public.cash_balance with (security_invoker = true) as
  select coalesce(sum(amount), 0)::numeric(14,2) as balance from public.cash_movements;

create or replace function public.sync_position_cash() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- compra: sempre reflete preço × quantidade atuais
  insert into public.cash_movements (kind, amount, position_id, note)
  values ('buy', -(new.buy_price * new.quantity), new.id, 'Compra ' || new.ticker)
  on conflict (position_id, kind) do update set amount = excluded.amount, note = excluded.note;

  -- venda: existe só enquanto a posição estiver fechada
  if new.status = 'closed' then
    insert into public.cash_movements (kind, amount, position_id, note)
    values ('sell', new.sell_price * new.quantity, new.id, 'Venda ' || new.ticker)
    on conflict (position_id, kind) do update set amount = excluded.amount, note = excluded.note;
  else
    delete from public.cash_movements where position_id = new.id and kind = 'sell';
  end if;
  return new;
end $$;

drop trigger if exists positions_cash_sync on public.positions;
create trigger positions_cash_sync after insert or update on public.positions
  for each row execute function public.sync_position_cash();

-- ---------- Cotações (cron) ----------
-- Uma linha por ticker/fonte/dia. open/high/low vêm do InfoMoney (candles).
create table if not exists public.quotes (
  id bigint generated always as identity primary key,
  ticker text not null,
  source text not null check (source in ('fundamentus','infomoney')),
  quote_date date not null,
  price numeric(14,4) not null,        -- fechamento / último preço
  open numeric(14,4),
  high numeric(14,4),
  low numeric(14,4),
  volume numeric,
  change_pct numeric(8,4),             -- variação do dia em % (ex: -1.23)
  scraped_at timestamptz not null default now(),
  raw jsonb,
  unique (ticker, source, quote_date)
);
create index if not exists quotes_ticker_date_idx on public.quotes(ticker, quote_date desc);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.positions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.quotes enable row level security;

create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles admin update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "positions read" on public.positions for select to authenticated using (true);
create policy "positions admin insert" on public.positions for insert to authenticated with check (public.is_admin());
create policy "positions admin update" on public.positions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "positions admin delete" on public.positions for delete to authenticated using (public.is_admin());

create policy "cash read" on public.cash_movements for select to authenticated using (true);
create policy "cash admin insert" on public.cash_movements for insert to authenticated
  with check (public.is_admin() and kind in ('deposit','withdraw','adjust'));
create policy "cash admin delete" on public.cash_movements for delete to authenticated
  using (public.is_admin() and kind in ('deposit','withdraw','adjust'));

create policy "quotes read" on public.quotes for select to authenticated using (true);
-- escrita em quotes: apenas service role (cron / backfill)

-- ---------- Storage (prints) ----------
insert into storage.buckets (id, name, public) values ('screenshots','screenshots', false)
on conflict (id) do nothing;

create policy "screenshots read" on storage.objects for select to authenticated
  using (bucket_id = 'screenshots');
-- upload dos prints é feito no servidor com service role

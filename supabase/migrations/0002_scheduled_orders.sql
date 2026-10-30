-- =====================================================================
-- Compras agendadas (ordem com preço-limite).
-- Fora do horário do pregão o admin não compra direto: ele define o preço
-- que quer pagar e agenda. Dentro do horário comercial, o cron (ou o botão
-- "Verificar agora") compra quando a cotação estiver <= limit_price.
-- Rode depois de 0001_init.sql.
-- =====================================================================

create table if not exists public.scheduled_orders (
  id uuid primary key default gen_random_uuid(),
  ticker text not null check (ticker = upper(ticker)),
  quantity integer not null check (quantity between 1 and 100),
  limit_price numeric(14,4) not null check (limit_price > 0),
  valid_until date,                      -- null = até cancelar
  status text not null default 'pending'
    check (status in ('pending','executing','executed','cancelled','expired','failed')),
  position_id uuid references public.positions(id) on delete set null,
  executed_price numeric(14,4),
  executed_at timestamptz,
  last_checked_at timestamptz,
  last_check_price numeric(14,4),
  error text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists scheduled_orders_status_idx on public.scheduled_orders(status, created_at);

alter table public.scheduled_orders enable row level security;

drop policy if exists "orders read" on public.scheduled_orders;
create policy "orders read" on public.scheduled_orders for select to authenticated using (true);

drop policy if exists "orders admin insert" on public.scheduled_orders;
create policy "orders admin insert" on public.scheduled_orders for insert to authenticated
  with check (public.is_admin() and status = 'pending');

-- admin só cancela (a execução é feita no servidor com service role)
drop policy if exists "orders admin update" on public.scheduled_orders;
create policy "orders admin update" on public.scheduled_orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "orders admin delete" on public.scheduled_orders;
create policy "orders admin delete" on public.scheduled_orders for delete to authenticated
  using (public.is_admin() and status <> 'executing');

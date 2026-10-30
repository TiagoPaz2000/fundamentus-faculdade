-- =====================================================================
-- Cada membro compra os próprios papéis: no máximo 2 abertos/agendados
-- por usuário (vender libera a vaga). A carteira continua com no máximo
-- 10 papéis. Editar, vender e mexer no caixa continuam só com admin.
-- O nome exibido é a parte do email antes do @ (joao@teste.com → joao).
-- Rode depois da 0004. Pode ser rodada mais de uma vez.
-- =====================================================================

-- Nome de exibição derivado do email
alter table public.profiles
  add column if not exists name text generated always as (split_part(email, '@', 1)) stored;

-- ---------- Limite de 2 por usuário ----------
-- Conta posições abertas + ordens 'pending' do mesmo usuário. Ordens em
-- 'executing' não contam: no momento da execução a posição nova é que conta.
create or replace function public.carteira_user_slots_used(p_user uuid, p_position uuid, p_order uuid)
returns integer language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.positions
      where status = 'open' and created_by = p_user
        and id is distinct from p_position)::int
  + (select count(*) from public.scheduled_orders
      where status = 'pending' and created_by = p_user
        and id is distinct from p_order)::int
$$;

create or replace function public.enforce_user_limit_positions() returns trigger
language plpgsql as $$
begin
  if new.status <> 'open' or new.created_by is null then
    return new;
  end if;
  -- só checa quando a posição passa a ocupar vaga (nova ou reaberta)
  if tg_op = 'UPDATE' and old.status = 'open' and old.created_by is not distinct from new.created_by then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('portfolio_limit'));
  if public.carteira_user_slots_used(new.created_by, new.id, null) >= 2 then
    raise exception 'Regra da carteira: cada usuário pode ter no máximo 2 papéis abertos ou agendados'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists positions_user_limit on public.positions;
create trigger positions_user_limit before insert or update on public.positions
  for each row execute function public.enforce_user_limit_positions();

create or replace function public.enforce_user_limit_orders() returns trigger
language plpgsql as $$
begin
  if new.status <> 'pending' or new.created_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pending' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('portfolio_limit'));
  if public.carteira_user_slots_used(new.created_by, null, new.id) >= 2 then
    raise exception 'Regra da carteira: cada usuário pode ter no máximo 2 papéis abertos ou agendados'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists orders_user_limit on public.scheduled_orders;
create trigger orders_user_limit before insert or update on public.scheduled_orders
  for each row execute function public.enforce_user_limit_orders();

-- ---------- RLS ----------
-- Compra e cancelamento de membros passam SEMPRE pelo servidor (service role),
-- que valida pregão, preço atual e dono. Assim um membro não consegue inserir
-- posição com preço/data arbitrários nem editar ordens direto pela API REST.
drop policy if exists "positions member insert" on public.positions;
drop policy if exists "positions admin insert" on public.positions;
create policy "positions admin insert" on public.positions for insert to authenticated
  with check (public.is_admin());

drop policy if exists "orders admin insert" on public.scheduled_orders;
drop policy if exists "orders member insert" on public.scheduled_orders;
create policy "orders member insert" on public.scheduled_orders for insert to authenticated
  with check (status = 'pending'
              and (public.is_admin() or (public.is_member() and created_by = auth.uid())));

drop policy if exists "orders member update" on public.scheduled_orders;
drop policy if exists "orders admin update" on public.scheduled_orders;
create policy "orders admin update" on public.scheduled_orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

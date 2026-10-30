-- =====================================================================
-- Regra nova da carteira: são escolhidos até 10 papéis e cada compra é,
-- automaticamente, de 100 ações daquele papel.
--   * no máximo 10 papéis com posição aberta;
--   * no máximo 1 posição aberta por papel;
--   * toda compra nova (INSERT) tem quantidade = 100.
-- Substitui o limite antigo de "100 ações abertas no total" da 0001.
-- Rode depois de 0001_init.sql (e 0002, se usar agendamentos).
-- =====================================================================

create or replace function public.enforce_portfolio_limit() returns trigger
language plpgsql as $$
declare
  open_tickers integer;
begin
  if tg_op = 'INSERT' and new.quantity <> 100 then
    raise exception 'Regra da carteira: cada papel é comprado com exatamente 100 ações (recebido: %)', new.quantity
      using errcode = 'check_violation';
  end if;

  if new.status <> 'open' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('portfolio_limit'));

  if exists (
    select 1 from public.positions
     where status = 'open' and ticker = new.ticker and id <> new.id
  ) then
    raise exception 'Regra da carteira: % já tem uma posição aberta', new.ticker
      using errcode = 'check_violation';
  end if;

  select count(*) into open_tickers
    from public.positions
   where status = 'open' and id <> new.id;
  if open_tickers >= 10 then
    raise exception 'Regra da carteira: já existem % papéis abertos (máximo 10)', open_tickers
      using errcode = 'check_violation';
  end if;

  return new;
end $$;
-- O trigger positions_portfolio_limit (da 0001) continua apontando para esta função.

-- Agendamentos (0002): também são sempre de 100 ações.
do $$
begin
  if to_regclass('public.scheduled_orders') is not null then
    alter table public.scheduled_orders drop constraint if exists scheduled_orders_quantity_100;
    alter table public.scheduled_orders
      add constraint scheduled_orders_quantity_100 check (quantity = 100) not valid;
  end if;
end $$;

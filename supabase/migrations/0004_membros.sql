-- =====================================================================
-- Coexistência com outro app no mesmo projeto Supabase (blender-ai).
-- auth.users é compartilhado, então "estar logado" não basta: só acessa
-- a carteira quem tem linha em public.profiles (membro). Admins adicionam
-- membros pela tela /usuarios.
-- Rode depois da 0001, 0002 e 0003. Pode ser rodada mais de uma vez.
-- =====================================================================

-- 1) Remove o trigger genérico da 0001, que criava perfil para QUALQUER
--    usuário novo (inclusive os do blender-ai). O blender-ai usa o próprio
--    trigger ao_criar_usuario/criar_perfil(), que não é tocado aqui.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- 2) Bootstrap do admin com nome próprio da carteira: só cria perfil para o
--    email do admin inicial; os demais membros entram pela tela /usuarios.
create or replace function public.carteira_bootstrap_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'tiagopaz.dev@gmail.com' then
    insert into public.profiles (id, email, is_admin)
    values (new.id, new.email, true)
    on conflict (id) do update set is_admin = true;
  end if;
  return new;
end $$;

drop trigger if exists carteira_bootstrap_admin on auth.users;
create trigger carteira_bootstrap_admin after insert on auth.users
  for each row execute function public.carteira_bootstrap_admin();

-- 3) Garante o admin inicial (já existe em auth.users) e, SÓ NA PRIMEIRA
--    execução (antes de is_member() existir), limpa os perfis que a 0001
--    criou em massa para usuários do blender-ai. Reexecutar não apaga
--    membros adicionados depois.
insert into public.profiles (id, email, is_admin)
select id, email, true from auth.users where lower(email) = 'tiagopaz.dev@gmail.com'
on conflict (id) do update set is_admin = true;

do $
begin
  if to_regprocedure('public.is_member()') is null then
    if not exists (select 1 from public.profiles where is_admin) then
      raise exception 'Admin inicial (tiagopaz.dev@gmail.com) não encontrado em auth.users; nada foi apagado';
    end if;
    delete from public.profiles where not is_admin;
  end if;
end $;

-- 4) Membro = tem perfil
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid())
$$;

-- 5) Não deixa remover (delete) o último admin; a 0001 só cobria o update
create or replace function public.keep_one_admin_on_delete() returns trigger
language plpgsql as $$
begin
  -- pg_trigger_depth() > 1: delete em cascata vindo de auth.users (conta
  -- apagada no painel/outro app). Não bloqueia isso.
  if old.is_admin and pg_trigger_depth() = 1 then
    perform pg_advisory_xact_lock(hashtext('keep_one_admin'));
    if not exists (select 1 from public.profiles where is_admin and id <> old.id) then
      raise exception 'Não é possível remover o último admin' using errcode = 'check_violation';
    end if;
  end if;
  return old;
end $$;

drop trigger if exists profiles_keep_one_admin_delete on public.profiles;
create trigger profiles_keep_one_admin_delete before delete on public.profiles
  for each row execute function public.keep_one_admin_on_delete();

-- 6) Leitura passa de "qualquer logado" para "membro"
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (public.is_member());

drop policy if exists "positions read" on public.positions;
create policy "positions read" on public.positions for select to authenticated using (public.is_member());

drop policy if exists "cash read" on public.cash_movements;
create policy "cash read" on public.cash_movements for select to authenticated using (public.is_member());

drop policy if exists "quotes read" on public.quotes;
create policy "quotes read" on public.quotes for select to authenticated using (public.is_member());

drop policy if exists "orders read" on public.scheduled_orders;
create policy "orders read" on public.scheduled_orders for select to authenticated using (public.is_member());

-- Storage é compartilhado entre os apps: policy com nome próprio da carteira
drop policy if exists "screenshots read" on storage.objects;
drop policy if exists "carteira screenshots read" on storage.objects;
create policy "carteira screenshots read" on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and public.is_member());

-- ============================================================================
-- ObservaEdu 1.2.0 — Correção incremental do cadastro público
-- Arquivo: supabase_public_signup_fix.sql
-- ============================================================================
-- OBJETIVO
--   Remover o bloqueio legado por lista manual (observaedu_is_authorized) e
--   permitir que qualquer conta autenticada use as tabelas de observações e
--   configurações, sempre limitada a owner_id = auth.uid().
--
-- ESTADO PRESSUPOSTO (confirme antes de executar)
--   - Existem public.observaedu_observations, public.observaedu_settings e
--     public.observaedu_authorized_users.
--   - As políticas atuais de observações/configurações ainda chamam
--     public.observaedu_is_authorized().
--   - observaedu_authorized_users possui a política
--     observaedu_authorized_select_self.
--   - anon e authenticated possuem EXECUTE em observaedu_is_authorized().
--
-- O QUE ESTE ARQUIVO FAZ
--   1. Confere pré-requisitos (tabelas e coluna owner_id) sem criar nada.
--   2. Liga RLS nas três tabelas (operação idempotente).
--   3. Remove TODAS as políticas existentes nas três tabelas, inclusive as de
--      nomes antigos/desconhecidos, e recria apenas 8 políticas owner-only.
--   4. Retira todo acesso do cliente à tabela legada de autorizados.
--   5. Revoga privilégios amplos (inclusive TRUNCATE/REFERENCES/TRIGGER) e
--      concede apenas SELECT/INSERT/UPDATE/DELETE a authenticated.
--   6. Antes de revogar EXECUTE de observaedu_is_authorized(), verifica
--      dependências em políticas, views, matviews, outras funções e pg_depend.
--      Se houver dependência inesperada, ABORTA e desfaz tudo.
--   7. NÃO altera dados, NÃO cria/recria/apaga tabelas e NÃO usa
--      DROP TABLE, TRUNCATE ou DELETE.
--
-- COMO EXECUTAR
--   SQL Editor > cole o arquivo inteiro > Run. O bloco é transacional:
--   qualquer erro desfaz todas as alterações.
--   NÃO execute pelo navegador do ObservaEdu.
--
-- OBSERVAÇÃO IMPORTANTE
--   Este script não foi executado pelo autor. Os testes reais de cadastro,
--   login e isolamento entre duas contas continuam pendentes.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Pré-requisitos
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.observaedu_observations') is null then
    raise exception
      'Tabela public.observaedu_observations não encontrada. Este script é incremental e não cria tabelas.';
  end if;

  if to_regclass('public.observaedu_settings') is null then
    raise exception
      'Tabela public.observaedu_settings não encontrada. Este script é incremental e não cria tabelas.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'observaedu_observations'
      and column_name = 'owner_id'
  ) then
    raise exception
      'Coluna owner_id ausente em public.observaedu_observations. Ajuste a estrutura antes de aplicar as políticas.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'observaedu_settings'
      and column_name = 'owner_id'
  ) then
    raise exception
      'Coluna owner_id ausente em public.observaedu_settings. Ajuste a estrutura antes de aplicar as políticas.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. RLS habilitada nas três tabelas (nunca desabilitar)
-- ----------------------------------------------------------------------------
alter table public.observaedu_observations enable row level security;
alter table public.observaedu_settings enable row level security;

do $$
begin
  if to_regclass('public.observaedu_authorized_users') is not null then
    execute 'alter table public.observaedu_authorized_users enable row level security';
  else
    raise notice
      'Tabela legada public.observaedu_authorized_users ausente; RLS não se aplica.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Remover TODAS as políticas antigas das três tabelas
-- ----------------------------------------------------------------------------
-- A v1.1.0 pode ter deixado políticas com nomes diferentes dos atuais.
-- Remover todas evita que uma política antiga (por exemplo, a que exige
-- observaedu_is_authorized) continue valendo junto com as novas.
-- Isto altera apenas políticas; nenhuma linha de dados é tocada.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'observaedu_observations',
        'observaedu_settings',
        'observaedu_authorized_users'
      )
    order by tablename, policyname
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );

    raise notice 'Política removida: %.%.%',
      v_policy.schemaname,
      v_policy.tablename,
      v_policy.policyname;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Observações: 4 políticas owner-only
-- ----------------------------------------------------------------------------
drop policy if exists observaedu_observations_select_own
  on public.observaedu_observations;
create policy observaedu_observations_select_own
  on public.observaedu_observations
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
  );

drop policy if exists observaedu_observations_insert_own
  on public.observaedu_observations;
create policy observaedu_observations_insert_own
  on public.observaedu_observations
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
  );

drop policy if exists observaedu_observations_update_own
  on public.observaedu_observations;
create policy observaedu_observations_update_own
  on public.observaedu_observations
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
  )
  with check (
    owner_id = (select auth.uid())
  );

drop policy if exists observaedu_observations_delete_own
  on public.observaedu_observations;
create policy observaedu_observations_delete_own
  on public.observaedu_observations
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 4. Configurações: 4 políticas owner-only
-- ----------------------------------------------------------------------------
drop policy if exists observaedu_settings_select_own
  on public.observaedu_settings;
create policy observaedu_settings_select_own
  on public.observaedu_settings
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
  );

drop policy if exists observaedu_settings_insert_own
  on public.observaedu_settings;
create policy observaedu_settings_insert_own
  on public.observaedu_settings
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
  );

drop policy if exists observaedu_settings_update_own
  on public.observaedu_settings;
create policy observaedu_settings_update_own
  on public.observaedu_settings
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
  )
  with check (
    owner_id = (select auth.uid())
  );

drop policy if exists observaedu_settings_delete_own
  on public.observaedu_settings;
create policy observaedu_settings_delete_own
  on public.observaedu_settings
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 5. Tabela legada de autorizados: nenhum acesso do cliente
-- ----------------------------------------------------------------------------
-- Os registros históricos permanecem intactos. A tabela deixa de participar
-- do fluxo: sem políticas e sem privilégios para public/anon/authenticated.
-- A administração continua possível apenas no painel/SQL Editor (postgres).
do $$
begin
  if to_regclass('public.observaedu_authorized_users') is not null then
    execute 'revoke all on table public.observaedu_authorized_users from public';
    execute 'revoke all on table public.observaedu_authorized_users from anon';
    execute 'revoke all on table public.observaedu_authorized_users from authenticated';

    raise notice
      'Acesso do cliente revogado em public.observaedu_authorized_users.';
  else
    raise notice
      'Tabela legada public.observaedu_authorized_users ausente; nada a revogar.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Privilégios mínimos nas tabelas de dados
-- ----------------------------------------------------------------------------
-- "revoke all" remove também TRUNCATE, REFERENCES e TRIGGER. O GRANT abaixo
-- devolve somente as quatro operações usadas pelo app. public e anon ficam
-- sem qualquer privilégio; service_role e o papel administrativo não são
-- alterados.
revoke all on table public.observaedu_observations from public;
revoke all on table public.observaedu_observations from anon;
revoke all on table public.observaedu_observations from authenticated;
grant select, insert, update, delete
  on table public.observaedu_observations
  to authenticated;

revoke all on table public.observaedu_settings from public;
revoke all on table public.observaedu_settings from anon;
revoke all on table public.observaedu_settings from authenticated;
grant select, insert, update, delete
  on table public.observaedu_settings
  to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Função legada observaedu_is_authorized()
-- ----------------------------------------------------------------------------
-- Verifica dependências antes de revogar EXECUTE. Se qualquer política, view,
-- matview, outra função ou dependência registrada ainda usar a função, o
-- script aborta e o BEGIN...COMMIT desfaz tudo. Nesse caso, investigue e
-- ajuste manualmente; não remova a função às cegas.
do $$
declare
  v_fn oid := to_regprocedure('public.observaedu_is_authorized()')::oid;
  v_dep record;
begin
  if v_fn is null then
    raise notice
      'Função public.observaedu_is_authorized() ausente; nada a revogar.';
  else
    -- 7.1 Políticas de qualquer schema/tabela que ainda citem a função.
    for v_dep in
      select schemaname, tablename, policyname
      from pg_policies
      where coalesce(qual, '') ilike '%observaedu_is_authorized%'
         or coalesce(with_check, '') ilike '%observaedu_is_authorized%'
    loop
      raise exception
        'A função ainda é usada pela política %.%.%. Revise antes de revogar EXECUTE.',
        v_dep.schemaname,
        v_dep.tablename,
        v_dep.policyname;
    end loop;

    -- 7.2 Views comuns.
    for v_dep in
      select schemaname, viewname
      from pg_views
      where definition ilike '%observaedu_is_authorized%'
    loop
      raise exception
        'A função ainda é usada pela view %.%. Revise antes de revogar EXECUTE.',
        v_dep.schemaname,
        v_dep.viewname;
    end loop;

    -- 7.3 Materialized views.
    for v_dep in
      select schemaname, matviewname
      from pg_matviews
      where definition ilike '%observaedu_is_authorized%'
    loop
      raise exception
        'A função ainda é usada pela materialized view %.%. Revise antes de revogar EXECUTE.',
        v_dep.schemaname,
        v_dep.matviewname;
    end loop;

    -- 7.4 Outras funções/procedimentos que citem a função no corpo.
    for v_dep in
      select n.nspname as schema_name, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.oid <> v_fn
        and p.prosrc ilike '%observaedu_is_authorized%'
    loop
      raise exception
        'A função ainda é citada pela função %.%. Revise antes de revogar EXECUTE.',
        v_dep.schema_name,
        v_dep.proname;
    end loop;

    -- 7.5 Dependências registradas (defaults, constraints, triggers etc.).
    for v_dep in
      select pg_describe_object(classid, objid, 0) as object_description,
             deptype
      from pg_depend
      where refclassid = 'pg_proc'::regclass
        and refobjid = v_fn
        and not (
          classid = 'pg_proc'::regclass
          and objid = v_fn
        )
    loop
      raise exception
        'A função ainda tem dependência registrada: % (deptype %). Revise antes de revogar EXECUTE.',
        v_dep.object_description,
        v_dep.deptype;
    end loop;

    -- 7.6 Sem dependências: remove EXECUTE de public, anon e authenticated.
    execute 'revoke all on function public.observaedu_is_authorized() from public';
    execute 'revoke all on function public.observaedu_is_authorized() from anon';
    execute 'revoke all on function public.observaedu_is_authorized() from authenticated';

    raise notice
      'EXECUTE revogado de public, anon e authenticated em public.observaedu_is_authorized().';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 8. Função de trigger updated_at: não precisa de EXECUTE do cliente
-- ----------------------------------------------------------------------------
-- Triggers já criados continuam disparando sem EXECUTE do papel da sessão;
-- o privilégio só é exigido na criação do trigger. Revogar evita chamada
-- direta pelo cliente.
do $$
begin
  if to_regprocedure('public.observaedu_set_updated_at()') is not null then
    execute 'revoke all on function public.observaedu_set_updated_at() from public';
    execute 'revoke all on function public.observaedu_set_updated_at() from anon';
    execute 'revoke all on function public.observaedu_set_updated_at() from authenticated';
  else
    raise notice
      'Função public.observaedu_set_updated_at() ausente; nada a revogar.';
  end if;
end $$;

commit;

-- ============================================================================
-- 9. VERIFICAÇÃO (somente leitura; execute depois do commit)
-- ============================================================================
-- As consultas abaixo estão comentadas de propósito. Copie uma por vez no
-- SQL Editor. Nenhuma delas altera dados, políticas ou privilégios.
--
-- 9.0 Contagem de dados ANTES de aplicar (guarde o resultado para comparar):
-- select 'observaedu_observations' as tabela, count(*) as registros
-- from public.observaedu_observations
-- union all
-- select 'observaedu_settings', count(*) from public.observaedu_settings;
--
-- 9.1 RLS nas três tabelas
-- select c.relname as tabela,
--        c.relrowsecurity as rls_habilitada,
--        c.relforcerowsecurity as rls_forcada
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in (
--     'observaedu_observations',
--     'observaedu_settings',
--     'observaedu_authorized_users'
--   )
-- order by c.relname;
-- Esperado: rls_habilitada = true nas três; rls_forcada = false.
--
-- 9.2 Políticas existentes
-- select tablename as tabela,
--        policyname as politica,
--        cmd as comando,
--        roles as papeis,
--        qual as using_expressao,
--        with_check as with_check_expressao
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'observaedu_observations',
--     'observaedu_settings',
--     'observaedu_authorized_users'
--   )
-- order by tablename, cmd, policyname;
-- Esperado: 8 linhas (4 de observações + 4 de configurações), todas com
-- papeis = {authenticated}, owner_id = (select auth.uid()) em qual/with_check
-- e nenhuma menção a observaedu_is_authorized.
-- observaedu_authorized_users não deve ter nenhuma linha.
--
-- 9.3 Contagem de políticas por tabela
-- select t.tabela, count(p.policyname) as total_politicas
-- from (
--   values
--     ('observaedu_observations'),
--     ('observaedu_settings'),
--     ('observaedu_authorized_users')
-- ) as t(tabela)
-- left join pg_policies p
--   on p.schemaname = 'public'
--  and p.tablename = t.tabela
-- group by t.tabela
-- order by t.tabela;
-- Esperado: observações = 4, configurações = 4, autorizados = 0.
--
-- 9.4 WITH CHECK de INSERT e UPDATE
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('observaedu_observations', 'observaedu_settings')
--   and cmd in ('INSERT', 'UPDATE')
-- order by tablename, cmd;
-- Esperado: INSERT com with_check preenchido; UPDATE com qual e with_check
-- preenchidos, ambos com owner_id = (select auth.uid()).
--
-- 9.5 Privilégios de tabela (matriz por papel)
-- select r.papel,
--        t.tabela,
--        coalesce(
--          string_agg(p.privilegio, ', ' order by p.privilegio)
--            filter (
--              where has_table_privilege(
--                r.papel::name,
--                format('public.%I', t.tabela),
--                p.privilegio
--              )
--            ),
--          'nenhum'
--        ) as privilegios
-- from (values ('anon'), ('authenticated')) as r(papel)
-- cross join (
--   values
--     ('observaedu_observations'),
--     ('observaedu_settings'),
--     ('observaedu_authorized_users')
-- ) as t(tabela)
-- cross join (
--   values
--     ('SELECT'),
--     ('INSERT'),
--     ('UPDATE'),
--     ('DELETE'),
--     ('TRUNCATE'),
--     ('REFERENCES'),
--     ('TRIGGER')
-- ) as p(privilegio)
-- group by r.papel, t.tabela
-- order by r.papel, t.tabela;
-- Esperado:
--   anon: nenhum nas três tabelas.
--   authenticated: DELETE, INSERT, SELECT, UPDATE em observações e
--                  configurações; nenhum em observaedu_authorized_users.
--   Nenhum TRUNCATE, REFERENCES ou TRIGGER em nenhuma linha.
--
-- 9.6 TRUNCATE explicitamente
-- select t.tabela,
--        has_table_privilege(
--          'authenticated',
--          format('public.%I', t.tabela),
--          'TRUNCATE'
--        ) as authenticated_truncate,
--        has_table_privilege(
--          'anon',
--          format('public.%I', t.tabela),
--          'TRUNCATE'
--        ) as anon_truncate
-- from (
--   values
--     ('observaedu_observations'),
--     ('observaedu_settings'),
--     ('observaedu_authorized_users')
-- ) as t(tabela)
-- order by t.tabela;
-- Esperado: false, false nas três linhas.
--
-- 9.7 ACL da função legada
-- select p.oid::regprocedure as funcao,
--        p.prosecdef as security_definer,
--        p.proacl as acl
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname = 'observaedu_is_authorized';
-- Esperado: acl sem "anon=X", sem "authenticated=X" e sem "=X" (PUBLIC).
-- O dono (postgres) pode continuar com X.
--
-- 9.8 EXECUTE efetivo da função legada
-- select r.papel,
--        has_function_privilege(
--          r.papel::name,
--          'public.observaedu_is_authorized()'::regprocedure::oid,
--          'EXECUTE'
--        ) as pode_executar
-- from (values ('anon'), ('authenticated')) as r(papel)
-- order by r.papel;
-- Esperado: false para os dois papéis.
--
-- 9.9 Dependências restantes da função legada
-- Esta consulta também pode ser executada ANTES do script. Se retornar
-- alguma linha, o bloco 7 abortará antes de revogar EXECUTE.
-- select pg_describe_object(classid, objid, 0) as objeto_dependente,
--        deptype
-- from pg_depend
-- where refclassid = 'pg_proc'::regclass
--   and refobjid = 'public.observaedu_is_authorized()'::regprocedure::oid
--   and not (
--     classid = 'pg_proc'::regclass
--     and objid = 'public.observaedu_is_authorized()'::regprocedure::oid
--   );
-- Esperado: 0 linhas.
--
-- 9.10 Nenhuma política cita a função legada
-- select schemaname, tablename, policyname
-- from pg_policies
-- where coalesce(qual, '') ilike '%observaedu_is_authorized%'
--    or coalesce(with_check, '') ilike '%observaedu_is_authorized%';
-- Esperado: 0 linhas.
--
-- 9.11 Contagem de dados DEPOIS de aplicar
-- select 'observaedu_observations' as tabela, count(*) as registros
-- from public.observaedu_observations
-- union all
-- select 'observaedu_settings', count(*) from public.observaedu_settings;
-- Compare com o resultado de 9.0. Este script não executa DML; as contagens
-- devem ser idênticas.
--
-- 9.12 Triggers de updated_at
-- select event_object_table as tabela,
--        trigger_name,
--        action_timing,
--        event_manipulation
-- from information_schema.triggers
-- where trigger_schema = 'public'
--   and event_object_table in (
--     'observaedu_observations',
--     'observaedu_settings'
--   )
-- order by event_object_table, trigger_name;
-- Esperado: os dois triggers BEFORE UPDATE continuam existindo.
--
-- 9.13 ACL da função de trigger
-- select p.oid::regprocedure as funcao, p.proacl as acl
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname = 'observaedu_set_updated_at';
-- Esperado: acl sem "=X" (PUBLIC), "anon=X" ou "authenticated=X".
--
-- ============================================================================
-- 10. OBSERVAÇÕES FINAIS
-- ============================================================================
-- - A função observaedu_is_authorized() NÃO é removida por este arquivo. Ela
--   apenas perde EXECUTE para os papéis do cliente. Depois de confirmar que
--   nenhuma política/view/função depende dela, a remoção manual pode ser
--   feita com:
--       drop function if exists public.observaedu_is_authorized();
--   Não faça isso antes de revisar as consultas 9.9 e 9.10.
--
-- - A tabela observaedu_authorized_users continua existindo para preservar
--   o histórico, mas não concede mais acesso. Não é usada pelo código atual
--   do ObservaEdu (o cliente só acessa observaedu_observations e
--   observaedu_settings).
--
-- - Se o PostgREST continuar respondendo com o estado antigo depois do
--   commit, aguarde alguns segundos ou execute, separadamente:
--       notify pgrst, 'reload schema';
--
-- - Nenhuma chave, senha ou segredo está incluído neste arquivo.
-- ============================================================================

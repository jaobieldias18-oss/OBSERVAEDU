-- ============================================================================
-- ObservaEdu 1.2.0 — Atualização incremental para cadastro público
-- ============================================================================
-- O que este arquivo faz:
--   1. remove a dependência da lista manual observaedu_authorized_users;
--   2. recria as políticas de observações e configurações exigindo apenas
--      owner_id = auth.uid();
--   3. mantém a RLS habilitada nas três tabelas (nunca é desabilitada);
--   4. retira qualquer acesso do cliente à tabela legada de autorizados;
--   5. NÃO cria, NÃO recria e NÃO apaga tabelas nem registros.
--
-- Quando usar:
--   - se o banco já foi criado pela versão 1.1.0 (supabase_schema.sql antigo),
--     execute ESTE arquivo uma vez;
--   - em instalação nova, basta executar supabase_schema.sql (já atualizado).
--
-- Como executar:
--   SQL Editor > selecione o arquivo inteiro (Ctrl+A) > Run.
--   O bloco é transacional: qualquer erro desfaz tudo.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Verificação de pré-requisitos (falha com mensagem clara)
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.observaedu_observations') is null
     or to_regclass('public.observaedu_settings') is null then
    raise exception
      'Tabelas base ausentes. Execute supabase_schema.sql antes deste arquivo.';
  end if;

  if to_regclass('public.observaedu_authorized_users') is null then
    raise exception
      'Tabela observaedu_authorized_users ausente. Execute supabase_schema.sql antes deste arquivo.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. RLS permanece habilitada (nunca desabilitar)
-- ----------------------------------------------------------------------------
alter table public.observaedu_observations enable row level security;
alter table public.observaedu_settings enable row level security;
alter table public.observaedu_authorized_users enable row level security;

-- ----------------------------------------------------------------------------
-- 3. Observações: políticas somente por dono
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
-- 4. Configurações: políticas somente por dono
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
-- 5. Tabela legada: nenhuma política e nenhum privilégio para o cliente
-- ----------------------------------------------------------------------------
-- Os registros existentes são preservados. A tabela deixa de conceder
-- qualquer acesso; a gestão continua possível no SQL Editor (role postgres,
-- que ignora RLS).
drop policy if exists observaedu_authorized_select_self
  on public.observaedu_authorized_users;
drop policy if exists observaedu_authorized_insert_self
  on public.observaedu_authorized_users;
drop policy if exists observaedu_authorized_update_self
  on public.observaedu_authorized_users;
drop policy if exists observaedu_authorized_delete_self
  on public.observaedu_authorized_users;

revoke all on table public.observaedu_authorized_users from public;
revoke all on table public.observaedu_authorized_users from anon;
revoke all on table public.observaedu_authorized_users from authenticated;

-- Privilégios das tabelas de dados continuam restritos ao papel autenticado
-- e limitados pelas políticas acima. "anon" não recebe nada.
revoke all on table public.observaedu_observations from public;
revoke all on table public.observaedu_observations from anon;
grant select, insert, update, delete on table public.observaedu_observations
  to authenticated;

revoke all on table public.observaedu_settings from public;
revoke all on table public.observaedu_settings from anon;
grant select, insert, update, delete on table public.observaedu_settings
  to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Função legada da v1.1.0
-- ----------------------------------------------------------------------------
-- A função observaedu_is_authorized() não é mais usada por nenhuma política.
-- Ela é mantida para não quebrar instalações antigas; pode ser removida
-- manualmente depois de confirmar que não há dependências:
--
--   drop function if exists public.observaedu_is_authorized();
--
-- Para conferir dependências antes de remover:
--   select proname, proacl
--   from pg_proc
--   where proname = 'observaedu_is_authorized';

commit;

-- ============================================================================
-- 7. VERIFICAÇÃO (execute separadamente, depois do commit)
-- ============================================================================
-- Esperado: rowsecurity = true nas três tabelas.
--
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename like 'observaedu%'
-- order by tablename;
--
-- Esperado: 8 políticas nas tabelas de dados (4 + 4), todas para
-- "authenticated", com owner_id = auth.uid() e nenhuma USING (true).
-- A tabela de autorizados não deve ter políticas.
--
-- select schemaname, tablename, policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename like 'observaedu%'
-- order by tablename, policyname;
--
-- Esperado: nenhum privilégio para anon na tabela de autorizados.
--
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name = 'observaedu_authorized_users';

-- ============================================================================
-- 8. CADASTRO PÚBLICO (configuração no painel, não em SQL)
-- ============================================================================
-- 1. Authentication > Sign In / Providers > Email: habilitado.
-- 2. Authentication > Settings: "Allow new users to sign up" habilitado.
-- 3. Authentication > URL Configuration:
--      Site URL ......... https://SEU_DOMINIO/
--      Redirect URLs .... https://SEU_DOMINIO/
--                         http://localhost:8123/
-- 4. "Confirm email" conforme sua preferência:
--      - habilitado: o usuário recebe um link e só entra depois de confirmar;
--      - desabilitado: o cadastro já retorna sessão e entra direto.
--    Para entrega confiável dos e-mails, configure SMTP em
--    Authentication > Emails / SMTP Settings.
--
-- Nenhuma conta precisa ser inserida manualmente. A conta do responsável
-- pelo projeto é uma conta comum; administração ocorre no painel do Supabase.

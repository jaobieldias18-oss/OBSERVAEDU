-- ============================================================================
-- ObservaEdu 1.2.0 — Esquema do Supabase (PostgreSQL)
-- ============================================================================
-- IMPORTANTE
-- 1. Revise este arquivo antes de executar.
-- 2. Execute no SQL Editor do painel do Supabase, com uma conta
--    administrativa do projeto. NÃO execute pelo navegador do ObservaEdu.
-- 3. Este script NÃO apaga nem recria tabelas. Ele usa "if not exists" e
--    substitui apenas políticas com o mesmo nome (drop policy if exists).
-- 4. Se já existirem tabelas com estes nomes, inspecione a estrutura antes:
--       select table_name
--       from information_schema.tables
--       where table_schema = 'public'
--       order by table_name;
--    Se a estrutura for diferente, adapte o script manualmente em vez de
--    apagar dados. Bancos criados na 1.1.0 podem usar
--    supabase_signup_update.sql em vez deste arquivo.
-- 5. O cadastro é público: não é preciso inserir contas manualmente em
--    observaedu_authorized_users. Veja a seção 9.
--
-- MODELO DE DADOS
-- - observaedu_observations: uma linha por observação.
--   * "payload" jsonb preserva exatamente o formato já usado pelo app
--     (identificacao, respostas, comentarios, complementares, analise,
--     createdAt, updatedAt e campos futuros).
--   * colunas extras (status, professor, disciplina, turma, observation_date)
--     são cópias consultáveis para filtros/índices. O app lê o payload.
-- - observaedu_settings: uma linha por usuário com a identificação da escola.
-- - observaedu_authorized_users: tabela legada mantida apenas para não apagar
--   dados. Ela NÃO concede acesso: as políticas usam somente auth.uid().
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Tabela legada de autorizados (não usada para autorização)
-- ----------------------------------------------------------------------------
-- Mantida para compatibilidade com bancos criados na versão 1.1.0. A partir
-- da 1.2.0 o cadastro é público e o acesso é definido apenas por
-- owner_id = auth.uid(). Nenhuma política é criada para esta tabela.
create table if not exists public.observaedu_authorized_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.observaedu_authorized_users is
  'Tabela legada (v1.1.0). Nao concede acesso na v1.2.0; mantida apenas para preservar dados historicos.';

-- ----------------------------------------------------------------------------
-- 2. Observações
-- ----------------------------------------------------------------------------
create table if not exists public.observaedu_observations (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'rascunho',
  professor text,
  disciplina text,
  turma text,
  observation_date date,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint observaedu_observations_status_check
    check (status in ('rascunho', 'concluida')),
  constraint observaedu_observations_id_format
    check (id ~ '^obs_[A-Za-z0-9_-]{6,}$'),
  constraint observaedu_observations_payload_object
    check (jsonb_typeof(payload) = 'object')
);

comment on table public.observaedu_observations is
  'Observações pedagógicas do ObservaEdu. payload preserva o registro completo; as demais colunas apoiam filtros.';

comment on column public.observaedu_observations.payload is
  'Registro completo no formato do app: id, status, identificacao, respostas, comentarios, complementares, analise, createdAt, updatedAt.';

comment on column public.observaedu_observations.owner_id is
  'Dono do registro. Deve ser sempre auth.uid(); validado pelas políticas RLS.';

create index if not exists observaedu_observations_owner_updated_idx
  on public.observaedu_observations (owner_id, updated_at desc);

create index if not exists observaedu_observations_owner_status_idx
  on public.observaedu_observations (owner_id, status);

create index if not exists observaedu_observations_owner_date_idx
  on public.observaedu_observations (owner_id, observation_date desc);

create index if not exists observaedu_observations_owner_professor_idx
  on public.observaedu_observations (owner_id, lower(professor));

-- ----------------------------------------------------------------------------
-- 3. Configurações (identificação da escola)
-- ----------------------------------------------------------------------------
create table if not exists public.observaedu_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint observaedu_settings_payload_object
    check (jsonb_typeof(payload) = 'object')
);

comment on table public.observaedu_settings is
  'Configurações do ObservaEdu por usuário (nome da escola, unidade e cidade).';

-- ----------------------------------------------------------------------------
-- 4. updated_at automático no servidor
-- ----------------------------------------------------------------------------
create or replace function public.observaedu_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.observaedu_set_updated_at() from public;
grant execute on function public.observaedu_set_updated_at() to authenticated;

drop trigger if exists observaedu_observations_set_updated_at
  on public.observaedu_observations;
create trigger observaedu_observations_set_updated_at
  before update on public.observaedu_observations
  for each row execute function public.observaedu_set_updated_at();

drop trigger if exists observaedu_settings_set_updated_at
  on public.observaedu_settings;
create trigger observaedu_settings_set_updated_at
  before update on public.observaedu_settings
  for each row execute function public.observaedu_set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Autorização
-- ----------------------------------------------------------------------------
-- A v1.2.0 não usa lista manual de usuários. Cada conta autenticada acessa
-- somente as próprias linhas, porque todas as políticas exigem
-- owner_id = auth.uid(). Não há papel de administrador no cliente.
-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.observaedu_observations enable row level security;
alter table public.observaedu_settings enable row level security;
alter table public.observaedu_authorized_users enable row level security;

-- Observações: SELECT/INSERT/UPDATE/DELETE apenas do próprio dono.
-- Não há USING (true) e não há dependência de lista de autorizados.
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

-- Configurações: mesmas regras.
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

-- Tabela legada de autorizados: RLS habilitada e SEM políticas. Sem política
-- e sem privilégios, nenhuma conta comum lê ou escreve nela. A gestão, se
-- necessária, é feita apenas no painel/SQL Editor do Supabase.
drop policy if exists observaedu_authorized_select_self
  on public.observaedu_authorized_users;
drop policy if exists observaedu_authorized_insert_self
  on public.observaedu_authorized_users;
drop policy if exists observaedu_authorized_update_self
  on public.observaedu_authorized_users;
drop policy if exists observaedu_authorized_delete_self
  on public.observaedu_authorized_users;

-- ----------------------------------------------------------------------------
-- 7. Privilégios de tabela
-- ----------------------------------------------------------------------------
-- A RLS só é eficaz junto com privilégios corretos. "anon" não recebe acesso
-- às tabelas do aplicativo; usuários autenticados recebem apenas o necessário
-- e continuam limitados pelas políticas acima.
revoke all on table public.observaedu_observations from public;
revoke all on table public.observaedu_observations from anon;
grant select, insert, update, delete on table public.observaedu_observations
  to authenticated;

revoke all on table public.observaedu_settings from public;
revoke all on table public.observaedu_settings from anon;
grant select, insert, update, delete on table public.observaedu_settings
  to authenticated;

revoke all on table public.observaedu_authorized_users from public;
revoke all on table public.observaedu_authorized_users from anon;
revoke all on table public.observaedu_authorized_users from authenticated;

commit;

-- ============================================================================
-- 8. VERIFICAÇÃO (opcional, execute separadamente)
-- ============================================================================
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename like 'observaedu%';
--
-- select schemaname, tablename, policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename like 'observaedu%'
-- order by tablename, policyname;

-- ============================================================================
-- 9. CADASTRO PÚBLICO E CONTA DO RESPONSÁVEL
-- ============================================================================
-- A partir da v1.2.0 qualquer pessoa pode criar a própria conta pelo botão
-- "Criar minha conta" na tela de entrada. Nenhuma linha precisa ser inserida
-- em observaedu_authorized_users: o isolamento é feito por owner_id = auth.uid().
--
-- No painel do Supabase:
--   1. Authentication > Sign In / Providers > Email: mantenha habilitado.
--   2. Authentication > Settings: habilite "Allow new users to sign up".
--   3. Authentication > URL Configuration: cadastre a Site URL e as
--      Redirect URLs do ObservaEdu, por exemplo:
--        http://localhost:8123/
--        https://SEU_DOMINIO/
--   4. Se "Confirm email" estiver habilitado, configure o SMTP para que os
--      links de confirmação sejam entregues. Sem SMTP confiável, os e-mails
--      podem ficar limitados pelo serviço padrão do Supabase.
--
-- A conta do responsável pelo projeto é uma conta comum. Não existe botão,
-- coluna ou metadata que conceda administração pelo navegador. Toda
-- administração (banco, políticas, usuários) acontece no painel do Supabase.
--
-- Para inspecionar as contas cadastradas (somente no SQL Editor):
--   select id, email, email_confirmed_at, created_at
--   from auth.users
--   order by created_at desc;

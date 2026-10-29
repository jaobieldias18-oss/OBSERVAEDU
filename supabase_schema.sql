-- ============================================================================
-- ObservaEdu 1.1.0 — Esquema do Supabase (PostgreSQL)
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
--    apagar dados.
-- 5. Depois de executar, crie a conta em Authentication > Users e autorize-a
--    na tabela observaedu_authorized_users (veja o fim do arquivo).
--
-- MODELO DE DADOS
-- - observaedu_observations: uma linha por observação.
--   * "payload" jsonb preserva exatamente o formato já usado pelo app
--     (identificacao, respostas, comentarios, complementares, analise,
--     createdAt, updatedAt e campos futuros).
--   * colunas extras (status, professor, disciplina, turma, observation_date)
--     são cópias consultáveis para filtros/índices. O app lê o payload.
-- - observaedu_settings: uma linha por usuário com a identificação da escola.
-- - observaedu_authorized_users: lista explícita de contas autorizadas.
--   Sem linha nesta tabela, nenhuma política de dados libera acesso.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Lista de usuários autorizados (controle de acesso por conta)
-- ----------------------------------------------------------------------------
create table if not exists public.observaedu_authorized_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.observaedu_authorized_users is
  'Contas do Supabase Auth autorizadas a usar o ObservaEdu. Gerenciada pelo administrador no SQL Editor.';

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
-- 5. Função de autorização (security definer, sem expor a lista)
-- ----------------------------------------------------------------------------
-- Uma conta autenticada só acessa dados se estiver nesta lista. A função é
-- SECURITY DEFINER para que as políticas possam consultar a lista mesmo sem
-- conceder SELECT amplo sobre ela. O search_path fixo evita sequestro de nomes.
create or replace function public.observaedu_is_authorized()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.observaedu_authorized_users a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.observaedu_is_authorized() from public;
grant execute on function public.observaedu_is_authorized() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.observaedu_observations enable row level security;
alter table public.observaedu_settings enable row level security;
alter table public.observaedu_authorized_users enable row level security;

-- Observações: SELECT/INSERT/UPDATE/DELETE apenas do próprio dono E apenas
-- se a conta estiver na lista de autorizados. Não há USING (true).
drop policy if exists observaedu_observations_select_own
  on public.observaedu_observations;
create policy observaedu_observations_select_own
  on public.observaedu_observations
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
  );

drop policy if exists observaedu_observations_insert_own
  on public.observaedu_observations;
create policy observaedu_observations_insert_own
  on public.observaedu_observations
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
  );

drop policy if exists observaedu_observations_update_own
  on public.observaedu_observations;
create policy observaedu_observations_update_own
  on public.observaedu_observations
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
  )
  with check (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
  );

drop policy if exists observaedu_observations_delete_own
  on public.observaedu_observations;
create policy observaedu_observations_delete_own
  on public.observaedu_observations
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
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
    and public.observaedu_is_authorized()
  );

drop policy if exists observaedu_settings_insert_own
  on public.observaedu_settings;
create policy observaedu_settings_insert_own
  on public.observaedu_settings
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
  );

drop policy if exists observaedu_settings_update_own
  on public.observaedu_settings;
create policy observaedu_settings_update_own
  on public.observaedu_settings
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
  )
  with check (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
  );

drop policy if exists observaedu_settings_delete_own
  on public.observaedu_settings;
create policy observaedu_settings_delete_own
  on public.observaedu_settings
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    and public.observaedu_is_authorized()
  );

-- Lista de autorizados: cada usuário autenticado pode ver somente a própria
-- linha (necessário para a checagem da interface). Não há políticas de
-- INSERT/UPDATE/DELETE para contas comuns: a lista é gerenciada pelo
-- administrador no SQL Editor / painel.
drop policy if exists observaedu_authorized_select_self
  on public.observaedu_authorized_users;
create policy observaedu_authorized_select_self
  on public.observaedu_authorized_users
  for select
  to authenticated
  using (user_id = (select auth.uid()));

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
grant select on table public.observaedu_authorized_users to authenticated;

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
-- 9. AUTORIZAÇÃO DA CONTA REAL (executar SOMENTE depois de criar o usuário)
-- ============================================================================
-- Não invente UUIDs. Crie a conta em Authentication > Users, copie o UUID
-- mostrado no painel e substitua o e-mail abaixo. O comando usa o e-mail
-- para localizar a conta e não cria usuários.
--
-- insert into public.observaedu_authorized_users (user_id, note)
-- select id, 'Orientador(a) — conta principal'
-- from auth.users
-- where email = 'SUBSTITUA_PELO_EMAIL_DA_CONTA'
-- on conflict (user_id) do nothing;
--
-- Para conceder acesso a outra pessoa posteriormente, repita o comando com
-- o e-mail correto. Para revogar, remova a linha correspondente:
--
-- delete from public.observaedu_authorized_users
-- where user_id = (select id from auth.users where email = 'EMAIL_DA_CONTA');
--
-- Recomendado no painel: Authentication > Providers/Settings, desative
-- "Allow new users to sign up" para impedir cadastro público.

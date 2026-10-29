# ObservaEdu 1.2.0 — Supabase com cadastro público

Este documento descreve a autenticação da versão 1.2.0, o que já foi testado,
o que depende de configuração no painel do Supabase e como operar com
segurança. O aplicativo continua em HTML/CSS/JavaScript puro, sem build,
sem React/Next.js e sem servidor próprio.

> **Situação atual:** `supabase-config.js` está com `publishableKey: ''`.
> Portanto o ObservaEdu abre em **modo local** (`localStorage`), sem tela de
> entrada. Nenhum SQL foi executado por esta integração e nenhum teste real
> contra o Supabase foi rodado. Os testes de cadastro/login/RLS reais
> continuam pendentes até você configurar a chave e o painel.

---

## 1. O que mudou na 1.2.0

| Antes (1.1.0) | Agora (1.2.0) |
| --- | --- |
| Conta criada manualmente no painel | Qualquer pessoa pode criar conta na tela de entrada |
| Acesso exigia linha em `observaedu_authorized_users` | Acesso exige apenas sessão válida; RLS usa `owner_id = auth.uid()` |
| Tela só tinha “Entrar” | Abas “Entrar” e “Criar minha conta” |
| Sem confirmação de e-mail no app | Cadastro com `signUp()` e tratamento de confirmação |
| Lista de autorizados decidia acesso | Tabela legada, preservada mas sem conceder acesso |

O modo local, os relatórios, o backup, a migração, a impressão e o PWA não
foram alterados em comportamento.

---

## 2. Modos de funcionamento

| Situação | Modo | Tela de entrada | Armazenamento |
| --- | --- | --- | --- |
| `publishableKey` vazia | Local | Não | `localStorage` deste navegador |
| `publishableKey` preenchida | Nuvem | Sim | Supabase (PostgreSQL + RLS) |

- No modo nuvem, a lista de observações vem **somente** do Supabase.
- Se a nuvem falhar, o app mostra erro e **não** carrega os registros locais
  como se fossem da nuvem.
- Os registros locais antigos continuam intactos e só são enviados pela ação
  explícita de migração.

### 2.1 Ordem de carregamento

```
supabase-config.js (head)
  → questions.js
  → vendor/supabase-js-2.118.0.js
  → supabase.js
  → storage.js
  → analysis.js
  → report.js
  → auth.js
  → app.js
```

### 2.2 Arquivos

| Arquivo | Papel |
| --- | --- |
| `supabase-config.js` | URL do projeto e chave **pública**; nomes das tabelas de dados. |
| `supabase.js` | Cliente validado, `signUp`, `signIn`, `signOut`, sessão, CRUD, migração, mensagens de erro. |
| `auth.js` | Abas Entrar/Criar conta, validação, confirmação de e-mail, restauração de sessão, bloqueio da área interna, logout. |
| `storage.js` | Fachada local/nuvem; APIs locais de backup preservadas. |
| `app.js` | Persistência assíncrona, confirmação de gravação no servidor, migração, exclusão, configurações. |
| `supabase_schema.sql` | Esquema completo para instalações novas (já no modelo 1.2.0). |
| `supabase_signup_update.sql` | Atualização incremental para bancos criados pela 1.1.0. |
| `service-worker.js` | Cache apenas da interface; não intercepta API do Supabase. |

---

## 3. Segurança e modelo de dados

### 3.1 Isolamento por conta

As políticas RLS das tabelas de dados usam apenas:

```sql
owner_id = (select auth.uid())
```

- `SELECT`, `INSERT`, `UPDATE` e `DELETE` são liberados somente para o papel
  `authenticated` e somente para as linhas do próprio usuário.
- `INSERT`/`UPDATE` usam `WITH CHECK` com a mesma condição, impedindo gravar
  uma linha com `owner_id` de outra pessoa.
- `anon` não recebe privilégio algum nas tabelas.
- Não existe `USING (true)` em nenhuma política.

O aplicativo também filtra por `owner_id` nas consultas, mas isso é apenas
uma segunda camada: mesmo que alguém altere o JavaScript ou chame a API
diretamente com o próprio token, o banco continua aplicando a RLS.

### 3.2 Sem administrador no navegador

Não existe coluna de papel, `user_metadata.role`, `localStorage` ou função
JavaScript que conceda administração. Alterar qualquer um desses itens no
navegador **não** aumenta privilégio algum: a única credencial aceita pelo
banco é o token da sessão, e as políticas não leem metadata.

Administração real ocorre apenas no painel do Supabase (SQL Editor,
Authentication, tabelas), com credenciais que nunca vão para o frontend.
Se um dia for necessário um painel administrativo dentro do app, ele deve
ser implementado no servidor (Edge Function) com verificação de papel em
tabela própria — **não implementado** nesta versão.

### 3.3 Tabela legada `observaedu_authorized_users`

- Continua existindo para não apagar dados da 1.1.0.
- Fica com RLS habilitada e **sem políticas**.
- `anon` e `authenticated` não têm privilégio de leitura/escrita nela.
- Portanto ela não bloqueia nem concede acesso a ninguém.
- A função `observaedu_is_authorized()` da 1.1.0 não é mais usada. Pode ser
  removida manualmente no SQL Editor depois de conferir dependências.

### 3.4 Dados

`observaedu_observations` guarda:

- `id` (`text`, PK) — identificador `obs_<uuid>` do app;
- `owner_id` (`uuid`) — sempre `auth.uid()`;
- `status`, `professor`, `disciplina`, `turma`, `observation_date` — cópias
  consultáveis para filtros;
- `payload` (`jsonb`) — registro completo no formato atual (`id`, `status`,
  `identificacao`, `respostas`, `comentarios`, `complementares`, `analise`,
  `createdAt`, `updatedAt`);
- `created_at`, `updated_at`.

`observaedu_settings` tem `owner_id` (PK) e `payload` (`jsonb`).

---

## 4. Credenciais no frontend

Preencha apenas:

```js
window.OBSERVAEDU_SUPABASE_CONFIG = {
  url: 'https://yvdvnttynnzgivvllalq.supabase.co',
  publishableKey: 'sb_publishable_...',
  observationsTable: 'observaedu_observations',
  settingsTable: 'observaedu_settings'
};
```

- A chave pública está em **Project Settings → API Keys → Publishable key**.
- **Nunca** coloque `sb_secret_...`, `service_role`, senha do banco ou token
  administrativo. O código rejeita chaves com esses padrões.
- Se uma chave secreta já foi exposta, revogue/rotacione no painel.
- Para voltar ao modo local, deixe `publishableKey: ''` e recarregue.

---

## 5. SQL: aplicar corretamente

### 5.1 Banco novo (nunca executou o esquema)

1. Revise `supabase_schema.sql`.
2. No SQL Editor, **selecione o arquivo inteiro (Ctrl+A)** e clique em Run.
3. O script é transacional (`begin` … `commit`) e não apaga dados.

### 5.2 Banco criado pela 1.1.0 (seu caso)

Execute **apenas** `supabase_signup_update.sql`:

1. Revise o arquivo.
2. Ctrl+A → Run.
3. Ele recria as 8 políticas de dados sem a lista de autorizados, mantém a
   RLS ligada, remove o acesso do cliente à tabela legada e **não** apaga
   tabelas nem registros.

> Não execute `supabase_schema.sql` e `supabase_signup_update.sql` “ao mesmo
> tempo” sem revisar: em banco novo, o schema já contém o modelo final; o
> update é para bancos antigos. Rodar os dois em sequência também é seguro
> (as políticas são recriadas com os mesmos nomes), mas é redundante.

### 5.3 Verificação

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename like 'observaedu%';

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename like 'observaedu%'
order by tablename, policyname;
```

Esperado:

- `rowsecurity = true` nas três tabelas;
- 4 políticas em `observaedu_observations` e 4 em `observaedu_settings`;
- nenhuma política em `observaedu_authorized_users`;
- todas as condições com `owner_id = auth.uid()`;
- nenhuma `USING (true)`.

---

## 6. Configuração do cadastro público no painel

1. **Authentication → Sign In / Providers → Email**
   - mantenha o provedor Email habilitado;
   - “Allow new users to sign up” **habilitado**.
2. **Authentication → Settings**
   - “Confirm email”: escolha o comportamento (veja 6.1).
3. **Authentication → URL Configuration**
   - **Site URL:** a URL exata do app publicado, com barra final, por exemplo
     `https://SEU_DOMINIO/` ou `https://SEU_DOMINIO/observaedu/`.
   - **Redirect URLs:** inclua a mesma URL exata e as variações usadas:
     ```
     https://SEU_DOMINIO/
     https://SEU_DOMINIO/index.html
     https://SEU_DOMINIO/observaedu/
     https://SEU_DOMINIO/observaedu/index.html
     http://localhost:8123/
     http://localhost:8123/index.html
     ```
     Remova as linhas que não se aplicam ao seu domínio. O app envia
     `emailRedirectTo` igual a `origem + caminho` da página aberta; se essa
     URL não estiver na lista, o link de confirmação cai na Site URL padrão
     e pode não voltar para o app.
   - Em GitHub Pages, o caminho costuma ser `/nome-do-repositorio/`.
4. **SMTP (recomendado)**
   - Authentication → Emails/SMTP: configure um provedor próprio.
   - O serviço padrão do Supabase tem limites baixos de envio; sem SMTP,
     confirmações e reenvios podem falhar por rate limit.
5. **Proteção contra abuso (opcional)**
   - Ative CAPTCHA (Turnstile/hCaptcha) em Authentication → Settings.
   - O Supabase já aplica rate limits, mas cadastro público sempre merece
     monitoramento.

### 6.1 Confirmação de e-mail: os dois cenários

| “Confirm email” | Resultado do `signUp()` | Comportamento no app |
| --- | --- | --- |
| Desabilitado | Retorna sessão | Entra direto após criar a conta |
| Habilitado | Retorna usuário, sem sessão | Mostra “Conta criada, confirme o e-mail” e libera “Reenviar e-mail de confirmação” |

Com confirmação habilitada, o link abre o Supabase, confirma a conta e
redireciona para o app com um `code` (fluxo PKCE). O código só pode ser
trocado por sessão no **mesmo navegador** em que o cadastro foi feito, pois a
verificação usa um segredo local. Se o link for aberto em outro navegador ou
dispositivo:

- a confirmação do e-mail ainda é concluída no Supabase;
- o app avisa que não conseguiu concluir a sessão automaticamente;
- basta entrar com e-mail e senha.

O app também trata links expirados/inválidos e limpa os parâmetros da URL
para a mensagem não reaparecer ao recarregar.

---

## 7. Fluxos da interface

### 7.1 Criar conta

1. Abra o ObservaEdu com a chave pública configurada.
2. Clique em **Criar minha conta**.
3. Informe e-mail e senha (mínimo 6, máximo 72 caracteres).
4. Mensagens possíveis:
   - **conta criada + confirmação pendente** (verde);
   - **e-mail já utilizado** (vermelho);
   - **senha fraca/curta** (vermelho, no campo);
   - **cadastro desativado no projeto** (vermelho);
   - **sem conexão / falha de rede** (vermelho);
   - **muitas tentativas** (vermelho, com orientação de aguardar).
5. Se a confirmação estiver desabilitada, o app entra direto.

### 7.2 Entrar, sessão e sair

- Login com e-mail e senha; erros claros para credenciais inválidas,
  e-mail não confirmado, falta de conexão e sessão expirada.
- A sessão é restaurada ao recarregar (chave
  `observaedu.supabase.auth.v1` no `localStorage`).
- **Sair** encerra a sessão no Supabase e volta à tela de entrada.
- Se a sessão expirar/for revogada, o app volta ao bloqueio com aviso.

### 7.3 Reenviar confirmação

Aparece após um cadastro pendente. Valida o e-mail e chama
`supabase.auth.resend({ type: 'signup' })`. A mensagem é neutra para não
revelar se o endereço existe.

---

## 8. Conta do responsável e administração

Sua conta pessoal continua funcionando normalmente: ela é uma conta comum,
com os mesmos direitos de qualquer usuário — ou seja, enxerga apenas os
próprios registros. Isso é intencional e atende ao requisito de que ninguém
se torne administrador alterando o navegador.

Para administrar o projeto:

- **contas:** Authentication → Users;
- **dados de qualquer usuário:** Table Editor / SQL Editor;
- **políticas e esquema:** SQL Editor;
- **cadastro/confirmação/URLs/SMTP:** Authentication.

Nada disso exige papel de administrador dentro do app.

---

## 9. Migração dos dados locais

1. No modo local, **Configurações → Exportar backup** e guarde o JSON.
2. Preencha a chave pública e entre com sua conta.
3. **Configurações → Conta e nuvem** mostra quantos registros locais existem.
4. **Exportar dados locais** baixa uma cópia só do `localStorage`.
5. **Migrar registros locais**: valida cada item, ignora IDs já existentes e
   mostra importados / já existentes / com falha.
6. Os registros locais **não são apagados**.
7. Acima de 1.000 registros, a contagem de “já existentes” pode ficar
   imprecisa (limite padrão do PostgREST), mas o `upsert` por chave primária
   não duplica dados.

---

## 10. Backup, exclusão e limpeza

- **Exportar backup:** JSON com observações e configurações do modo ativo.
- **Exportar dados locais:** somente os registros antigos do navegador.
- **Importar backup:** no modo local substitui após confirmação; no modo
  nuvem mescla/atualiza por ID.
- **Apagar dados:** no modo local limpa o navegador.
- **Apagar dados da nuvem:** remove apenas as linhas da conta no Supabase;
  o `localStorage` é preservado.
- O backup JSON não é criptografado.

---

## 11. PWA e offline

- O service worker guarda apenas HTML, CSS, JS, biblioteca do Supabase,
  logo, manifesto e ícones.
- Requisições para `*.supabase.co` não são interceptadas nem armazenadas.
- Nenhum registro, configuração, backup, token ou resposta da API entra no
  Cache Storage.
- Offline, a interface pode abrir pelo cache, mas login e dados da nuvem não
  funcionam. **Não há sincronização offline fictícia** nem fila de escrita.
- Se uma gravação falhar, o conteúdo permanece no formulário; fechar a página
  pode perder o que não foi confirmado.

---

## 12. Testes executados nesta versão

Ambiente: Chromium embutido, servidor estático local (`localhost:8123`),
28/10/2026. O modo local foi testado com `publishableKey` vazia. A tela de
entrada foi testada com uma chave fictícia temporária e um cliente Supabase
**simulado em memória**, sem nenhuma chamada de rede. O harness temporário foi
removido depois dos testes.

### 12.1 Verificações automáticas

| Teste | Resultado |
| --- | --- |
| `node --check` em todos os JS do projeto, incluindo o vendor | Passou |
| Varredura estática de segurança (35 verificações) | 35/35 passaram |
| Testes unitários de configuração e mensagens de erro | 16/16 passaram |
| Testes unitários de `signUp()` e `resendConfirmation()` | 10/10 passaram |

As verificações incluíram: chave pública vazia; rejeição de `sb_secret_` e
`service_role`; ausência de `auth.admin`, papel de administrador e
`user_metadata` como autorização; `owner_id = auth.uid()` nas 8 políticas;
RLS habilitada nas três tabelas; nenhuma política na tabela legada; nenhum
`USING (true)`; nenhum `drop table`, `truncate` ou `delete from` no SQL;
`detectSessionInUrl`, PKCE e `emailRedirectTo`; abas “Entrar”/“Criar minha
conta”; e ausência de chaves secretas no frontend.

### 12.2 Testes de interface com Supabase simulado

| Teste | Resultado |
| --- | --- |
| App em modo local sem erros no console | Passou |
| Tela de entrada oculta e dashboard disponível sem chave | Passou |
| Versão 1.2.0 exibida no rodapé | Passou |
| Abas “Entrar”/“Criar minha conta”, títulos e textos dinâmicos | Passou |
| `autocomplete` muda para `new-password` no cadastro | Passou |
| Validação de e-mail e senha (vazio, inválido, curto, longo) | Passou |
| Cadastro com confirmação pendente, senha limpa e reenvio visível | Passou |
| Reenvio do e-mail de confirmação | Passou |
| Cadastro com e-mail já utilizado (anti-enumeração) | Passou |
| Cadastro recusado por senha fraca | Passou |
| Cadastro desativado no projeto | Passou |
| Erro de rede no cadastro | Passou |
| Cadastro com sessão imediata (confirmação desativada) entra no app | Passou |
| Login com credenciais inválidas | Passou |
| Login com e-mail não confirmado | Passou |
| Login válido, sessão restaurada após recarregar e logout | Passou |
| Evento de sessão expirada/revogada volta ao bloqueio com aviso | Passou |
| Retorno de link de confirmação sem sessão e URL limpa | Passou |
| Erro de link expirado, mensagem clara e URL limpa | Passou |
| Área interna inerte/bloqueada sem sessão | Passou |
| Nenhuma chamada real ao Supabase durante os testes com mock | Passou |

### 12.3 Dados locais, backup e migração

| Teste | Resultado |
| --- | --- |
| Gravação/leitura local e configurações | Passou |
| Geração e leitura de backup JSON | Passou |
| Migração explícita local → nuvem simulada | Passou |
| Registros locais preservados depois da migração | Passou |
| Dados reais em `127.0.0.1:8123` preservados (hash SHA-256 idêntico) | Passou |
| Dados temporários de teste removidos do `localhost:8123` | Passou |

### 12.4 Testes pendentes (exigem Supabase real)

Estes **não foram executados** e não devem ser considerados aprovados:

- execução de `supabase_signup_update.sql` no banco real;
- conferência das políticas RLS no painel;
- cadastro real de um usuário novo;
- confirmação de e-mail real (link, expiração, reenvio, SMTP);
- login, restauração de sessão e logout reais;
- dois usuários distintos, comprovando isolamento de leitura/escrita;
- tentativas de leitura, edição e exclusão do registro de outro usuário;
- CRUD real na nuvem e configurações reais;
- migração real dos registros locais e contagens;
- falha de rede real durante gravação;
- impressão física em A4, instalação em iPhone/Android e uso offline real.

---

## 13. Limitações conhecidas

- Não há recuperação de senha na interface; use o painel do Supabase ou
  configure o fluxo de recuperação futuramente.
- Não há MFA, papéis, convites, auditoria ou compartilhamento institucional.
- Cadastro público depende de rate limit/CAPTCHA do Supabase; não há
  verificação de vínculo institucional.
- Confirmação por link funciona melhor no mesmo navegador (PKCE). Em outro
  dispositivo, confirme e depois faça login normalmente.
- Sem sincronização em tempo real ou resolução de conflitos: o último
  `upsert` confirmado prevalece.
- Sem fila offline para gravações.
- Sessão no `localStorage`; XSS continua sendo risco e não há CSP no
  servidor estático.
- Backup JSON não é criptografado.
- A tabela legada `observaedu_authorized_users` permanece no banco sem uso.

---

## 14. Solução de problemas

| Mensagem/situação | Causa provável | Ação |
| --- | --- | --- |
| “A chave pública ainda não foi configurada…” | `publishableKey` vazia | Colar a chave e recarregar. |
| “A chave configurada parece ser administrativa…” | Chave secreta | Remover e rotacionar no Supabase. |
| “O cadastro público está desativado…” | Signup desabilitado | Authentication → habilitar “Allow new users to sign up”. |
| “Já existe uma conta com este e-mail.” | E-mail cadastrado | Usar “Entrar” ou redefinir senha no painel. |
| “Conta criada, confirme o e-mail” mas nada chega | SMTP/limite de envio | Configurar SMTP e usar “Reenviar”; verificar spam. |
| “Não foi possível concluir a confirmação…” | Link expirado ou aberto em outro navegador | Reenviar ou simplesmente entrar com e-mail e senha. |
| “E-mail ou senha incorretos.” | Credenciais inválidas | Conferir dados. |
| “O e-mail desta conta ainda não foi confirmado.” | Confirmação pendente | Abrir o link ou reenviar. |
| `42P01 relation ... does not exist` | SQL não aplicado | Executar o arquivo correto inteiro (Ctrl+A → Run). |
| Erro de permissão ao gravar | RLS/grants | Conferir `supabase_signup_update.sql` e as políticas. |
| “Gravação não confirmada” | Rede/RLS | Manter o formulário, exportar backup e tentar de novo. |

---

## 15. Checklist manual no painel

1. [ ] Executar `supabase_signup_update.sql` (banco da 1.1.0) ou
       `supabase_schema.sql` (banco novo), inteiro.
2. [ ] Conferir `rowsecurity = true` e as 8 políticas por `auth.uid()`.
3. [ ] Habilitar “Allow new users to sign up”.
4. [ ] Definir Site URL e Redirect URLs (`https://…/` e
       `http://localhost:8123/`).
5. [ ] Decidir “Confirm email” e, se habilitado, configurar SMTP.
6. [ ] Colar a chave `sb_publishable_...` em `supabase-config.js`.
7. [ ] Criar uma conta de teste pelo app e confirmar o e-mail.
8. [ ] Entrar, salvar um rascunho, recarregar, editar, concluir, excluir e
       salvar configurações.
9. [ ] Criar uma segunda conta e comprovar que A não vê nem altera dados de B.
10. [ ] Migrar os registros locais após exportar backup e conferir contagens.

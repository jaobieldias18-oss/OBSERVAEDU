/*
 * ObservaEdu — Configuração pública do Supabase
 * ----------------------------------------------
 * Este arquivo é carregado pelo navegador e, por isso, seu conteúdo é
 * público. Coloque aqui SOMENTE a URL do projeto e a chave publicável
 * (sb_publishable_...). Nunca use sb_secret_..., service_role ou senhas.
 *
 * A segurança real depende de:
 *   1. Supabase Auth (login obrigatório, com cadastro público opcional);
 *   2. Row Level Security (RLS) nas tabelas, sempre por owner_id = auth.uid().
 *
 * Não existe lista manual de autorizados nem papel de administrador no
 * navegador: cada conta acessa apenas os próprios registros.
 *
 * Se publishableKey ficar vazia, o ObservaEdu continua funcionando em modo
 * local (localStorage), sem login e sem enviar registros para a nuvem.
 * Depois de colar a chave, recarregue a página: o login será exigido.
 */

window.OBSERVAEDU_SUPABASE_CONFIG = {
  // Project URL informada pelo proprietário do projeto.
  url: 'https://yvdvnttynnzgivvllalq.supabase.co',

  // Cole aqui a chave pública do projeto, começando com "sb_publishable_".
  // Exemplo de formato (NÃO use este valor): 'sb_publishable_xxxxxxxxxxxxxxxxxxxx'
  publishableKey: '',

  // Nomes das tabelas criadas por supabase_schema.sql.
  observationsTable: 'observaedu_observations',
  settingsTable: 'observaedu_settings'
};

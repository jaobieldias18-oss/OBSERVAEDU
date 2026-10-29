
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
  // URL do projeto Supabase.
  url: 'https://yvdvnttynnzgivvllalq.supabase.co',

  // Chave pública (publishable) do projeto.
  publishableKey: 'sb_publishable_M5tQa864O_e2l-srL5t5xg_xzIHzqFY',

  // Nomes das tabelas.
  observationsTable: 'observaedu_observations',
  settingsTable: 'observaedu_settings'
};

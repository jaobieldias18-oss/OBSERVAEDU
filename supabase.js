/*
 * ObservaEdu — Cliente e acesso a dados do Supabase
 * -------------------------------------------------
 * Centraliza:
 *   - criação validada do cliente @supabase/supabase-js v2;
 *   - login, cadastro público, confirmação de e-mail, logout e sessão;
 *   - leitura/gravação de observações e configurações com RLS;
 *   - migração e mensagens de erro compreensíveis.
 *
 * O acesso não depende de lista manual: cada conta autenticada enxerga
 * somente as próprias linhas, porque as políticas RLS exigem
 * owner_id = auth.uid(). Não existe papel de administrador no navegador.
 *
 * Este arquivo nunca deve conter chaves secretas. A chave usada aqui é a
 * chave pública do projeto (sb_publishable_...), visível no navegador.
 * A proteção dos dados é feita pelas políticas RLS em supabase_schema.sql.
 */

window.ObservaEduSupabase = (function () {
  'use strict';

  const CONFIG = window.OBSERVAEDU_SUPABASE_CONFIG || {};
  const URL_VALUE =
    typeof CONFIG.url === 'string' ? CONFIG.url.trim().replace(/\/+$/, '') : '';
  const KEY_VALUE =
    typeof CONFIG.publishableKey === 'string' ? CONFIG.publishableKey.trim() : '';

  const TABLES = {
    observations: CONFIG.observationsTable || 'observaedu_observations',
    settings: CONFIG.settingsTable || 'observaedu_settings'
  };

  const ID_PATTERN = /^obs_[A-Za-z0-9_-]{6,}$/;

  // Para onde o Supabase redireciona depois da confirmação de e-mail.
  // A URL precisa estar cadastrada em Authentication > URL Configuration.
  function redirectUrl() {
    if (typeof window === 'undefined' || !window.location) return undefined;
    return window.location.origin + window.location.pathname;
  }

  let client = null;
  let clientFailure = null;

  function decodeBase64Url(value) {
    const normalized = String(value || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return window.atob(padded);
  }

  // Rejeita chaves administrativas mesmo que sejam coladas por engano.
  function looksLikeSecretKey(key) {
    if (/^sb_secret_/i.test(key)) return true;
    if (/service[_-]?role/i.test(key)) return true;

    const parts = key.split('.');
    if (parts.length === 3 && /^eyJ/i.test(key)) {
      try {
        const payload = JSON.parse(decodeBase64Url(parts[1]));
        if (payload && payload.role === 'service_role') return true;
      } catch (error) {
        // Uma chave pública legada pode não ser um JWT decodificável aqui;
        // nesse caso ela não é classificada como secreta por este teste.
      }
    }
    return false;
  }

  function configuration() {
    if (!URL_VALUE) {
      return {
        configured: false,
        reason: 'A URL do Supabase não foi configurada em supabase-config.js.'
      };
    }

    const isHttps = /^https:\/\//i.test(URL_VALUE);
    const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(URL_VALUE);
    if (!isHttps && !isLocalDev) {
      return {
        configured: false,
        reason: 'A URL do Supabase deve usar https (ou http apenas em desenvolvimento local).'
      };
    }

    if (!KEY_VALUE) {
      return {
        configured: false,
        reason:
          'A chave pública ainda não foi configurada em supabase-config.js. ' +
          'O ObservaEdu permanece em modo local até a chave ser informada.'
      };
    }

    if (looksLikeSecretKey(KEY_VALUE)) {
      return {
        configured: false,
        reason:
          'A chave configurada parece ser administrativa. Use somente a chave pública ' +
          '(sb_publishable_...) no navegador. Remova imediatamente qualquer chave secreta do projeto.'
      };
    }

    return { configured: true, reason: '' };
  }

  function isConfigured() {
    return configuration().configured;
  }

  function getClient() {
    const status = configuration();
    if (!status.configured) {
      const error = new Error(status.reason);
      error.code = 'config';
      throw error;
    }

    if (client) return client;
    if (clientFailure) throw clientFailure;

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      clientFailure = new Error(
        'A biblioteca do Supabase não foi carregada. Verifique o arquivo ' +
          'vendor/supabase-js-2.118.0.js e recarregue a página.'
      );
      clientFailure.code = 'library';
      throw clientFailure;
    }

    try {
      client = window.supabase.createClient(URL_VALUE, KEY_VALUE, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Necessário para concluir o link de confirmação de e-mail.
          detectSessionInUrl: true,
          flowType: 'pkce',
          // Chave própria para não colidir com outros usos na mesma origem.
          storageKey: 'observaedu.supabase.auth.v1'
        }
      });
    } catch (error) {
      clientFailure = error;
      throw error;
    }

    return client;
  }

  function friendlyError(error) {
    if (!error) return 'Ocorreu um erro inesperado. Tente novamente.';

    if (error.code === 'config' || error.code === 'library' || error.code === 'auth') {
      return error.message;
    }

    const message = String(
      error.message || error.error_description || error.msg || error || ''
    );
    const code = String(error.code || error.status || '');

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return (
        'Sem conexão com a internet. A gravação no servidor não pôde ser confirmada. ' +
        'O conteúdo preenchido permanece nesta sessão; tente novamente quando a conexão voltar.'
      );
    }

    if (/invalid login credentials|invalid_credentials/i.test(message)) {
      return 'E-mail ou senha incorretos.';
    }
    if (/pkce|code verifier|code challenge/i.test(message)) {
      return (
        'O link de confirmação foi aberto em outro navegador ou dispositivo. ' +
        'A conta pode já estar confirmada; entre com e-mail e senha. Se ainda não estiver, ' +
        'solicite um novo link de confirmação.'
      );
    }
    if (/email not confirmed/i.test(message)) {
      return 'O e-mail desta conta ainda não foi confirmado. Abra o link enviado pelo Supabase antes de entrar.';
    }
    if (/too many requests|rate.?limit|over_email_send_rate_limit/i.test(message)) {
      return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
    }
    if (/already registered|already exists|email_exists|user_already_exists/i.test(message)) {
      return (
        'Já existe uma conta com este e-mail. Use "Entrar" ou solicite a redefinição de senha ' +
        'ao responsável pelo projeto.'
      );
    }
    if (/weak.?password|password should be at least|password.*too short|passwords?.*characters/i.test(message)) {
      return 'A senha é muito fraca. Use pelo menos 6 caracteres e evite senhas comuns.';
    }
    if (/signups? (are )?(not allowed|disabled)|signup.*disabled|email signups?.*disabled/i.test(message)) {
      return (
        'O cadastro público está desativado neste projeto Supabase. ' +
        'Ative "Allow new users to sign up" em Authentication e tente novamente.'
      );
    }
    if (/email address.*invalid|invalid.*email|email_address_invalid/i.test(message)) {
      return 'O e-mail informado não foi aceito pelo Supabase. Verifique o endereço e tente novamente.';
    }
    if (/user not found/i.test(message)) {
      return 'Usuário não encontrado. Verifique o e-mail informado.';
    }
    if (/email logins are disabled|email provider.*disabled/i.test(message)) {
      return 'O login por e-mail/senha está desativado no projeto Supabase.';
    }
    if (
      /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out/i.test(
        message
      ) ||
      code === 'ETIMEDOUT'
    ) {
      return (
        'Não foi possível conectar ao Supabase. Verifique a internet e tente novamente. ' +
        'Nenhuma confirmação de gravação foi recebida do servidor.'
      );
    }
    if (/row-level security|permission denied|42501/i.test(message)) {
      return (
        'A conta autenticada não tem permissão para esta operação. ' +
        'Verifique as políticas RLS (owner_id = auth.uid()) no Supabase.'
      );
    }
    if (/jwt|refresh token|sessão|session/i.test(message)) {
      return 'Sua sessão expirou ou não é válida. Entre novamente.';
    }
    if (/relation .* does not exist|42P01|schema cache|does not exist/i.test(message)) {
      return (
        'A estrutura do banco ainda não foi criada ou está incompleta. ' +
        'Execute supabase_schema.sql e, se o banco já existia, supabase_signup_update.sql.'
      );
    }
    if (/duplicate key|23505/i.test(message)) {
      return 'Já existe um registro com este identificador.';
    }
    if (/payload too large|413/i.test(message)) {
      return 'O conteúdo é grande demais para ser enviado ao servidor.';
    }

    return (
      'Não foi possível concluir a operação no Supabase.' +
      (message ? ' Detalhe técnico: ' + message : ' Tente novamente.')
    );
  }

  function makeError(message, code) {
    const error = new Error(message);
    if (code) error.code = code;
    return error;
  }

  async function getSession() {
    const supabase = getClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data && data.session ? data.session : null;
  }

  async function requireSession() {
    const session = await getSession();
    if (!session || !session.user) {
      throw makeError('Sua sessão não está ativa. Entre novamente para continuar.', 'auth');
    }
    return session;
  }

  async function signIn(email, password) {
    try {
      const supabase = getClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
      });
      if (error) return { ok: false, error: friendlyError(error) };
      if (!data || !data.session) {
        return { ok: false, error: 'O servidor não retornou uma sessão. Tente novamente.' };
      }
      return { ok: true, session: data.session };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  async function signOut() {
    try {
      const supabase = getClient();
      const { error } = await supabase.auth.signOut();
      if (error) return { ok: false, error: friendlyError(error) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  // Cadastro público com e-mail e senha. O Supabase pode:
  //   - devolver uma sessão (confirmação de e-mail desativada);
  //   - devolver só o usuário (confirmação pendente);
  //   - devolver um usuário sem "identities" quando o e-mail já existe
  //     (comportamento anti-enumeração com confirmação ativada).
  async function signUp(email, password) {
    try {
      const supabase = getClient();
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: { emailRedirectTo: redirectUrl() }
      });

      if (error) {
        return { ok: false, code: String(error.code || ''), error: friendlyError(error) };
      }

      const user = data && data.user ? data.user : null;
      const session = data && data.session ? data.session : null;

      if (user && Array.isArray(user.identities) && user.identities.length === 0) {
        return {
          ok: false,
          code: 'email_exists',
          error:
            'Já existe uma conta com este e-mail. Use "Entrar" ou solicite a redefinição de senha ' +
            'ao responsável pelo projeto.'
        };
      }

      if (!session) {
        return { ok: true, needsConfirmation: true, user: user };
      }

      return { ok: true, needsConfirmation: false, user: user, session: session };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  // Reenvia o e-mail de confirmação de cadastro.
  async function resendConfirmation(email) {
    try {
      const supabase = getClient();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: { emailRedirectTo: redirectUrl() }
      });
      if (error) return { ok: false, error: friendlyError(error) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  function onAuthStateChange(callback) {
    const supabase = getClient();
    return supabase.auth.onAuthStateChange(function (event, session) {
      callback(event, session);
    });
  }

  function isValidId(id) {
    return typeof id === 'string' && ID_PATTERN.test(id);
  }

  function isoOrNow(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function dateOrNull(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  function textOrNull(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text ? text : null;
  }

  function recordToRow(record, ownerId) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    if (!isValidId(record.id)) return null;

    const identification =
      record.identificacao && typeof record.identificacao === 'object'
        ? record.identificacao
        : {};
    const payload = JSON.parse(JSON.stringify(record));

    return {
      id: record.id,
      owner_id: ownerId,
      status: record.status === 'concluida' ? 'concluida' : 'rascunho',
      professor: textOrNull(identification.professor),
      disciplina: textOrNull(identification.disciplina),
      turma: textOrNull(identification.turma),
      observation_date: dateOrNull(identification.data),
      payload: payload,
      created_at: isoOrNow(record.createdAt),
      updated_at: isoOrNow(record.updatedAt)
    };
  }

  function rowToRecord(row) {
    if (!row) return null;
    const payload =
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? row.payload
        : {};

    const record = Object.assign({}, payload);
    if (!record.id) record.id = row.id;
    if (!record.status && row.status) record.status = row.status;
    if (!record.createdAt && row.created_at) record.createdAt = row.created_at;
    if (!record.updatedAt && row.updated_at) record.updatedAt = row.updated_at;
    return record;
  }

  async function listObservations() {
    try {
      const session = await requireSession();
      const supabase = getClient();
      const { data, error } = await supabase
        .from(TABLES.observations)
        .select('id, payload, status, created_at, updated_at')
        .eq('owner_id', session.user.id)
        .order('updated_at', { ascending: false });

      if (error) return { ok: false, error: friendlyError(error), data: [] };

      const records = (data || [])
        .map(rowToRecord)
        .filter(function (record) {
          return record && isValidId(record.id);
        });

      return { ok: true, data: records };
    } catch (error) {
      return { ok: false, error: friendlyError(error), data: [] };
    }
  }

  async function getObservation(id) {
    try {
      if (!isValidId(id)) return { ok: false, error: 'Identificador de registro inválido.' };
      const session = await requireSession();
      const supabase = getClient();
      const { data, error } = await supabase
        .from(TABLES.observations)
        .select('id, payload, status, created_at, updated_at')
        .eq('owner_id', session.user.id)
        .eq('id', id)
        .maybeSingle();

      if (error) return { ok: false, error: friendlyError(error) };
      if (!data) return { ok: false, error: 'Registro não encontrado nesta conta.' };
      return { ok: true, data: rowToRecord(data) };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  async function upsertObservation(record) {
    try {
      const session = await requireSession();
      const row = recordToRow(record, session.user.id);
      if (!row) {
        return {
          ok: false,
          error: 'O registro está em formato inválido e não foi enviado ao servidor.'
        };
      }

      const supabase = getClient();
      const { data, error } = await supabase
        .from(TABLES.observations)
        .upsert(row, { onConflict: 'id' })
        .select('id, updated_at')
        .maybeSingle();

      if (error) return { ok: false, error: friendlyError(error) };
      if (!data) {
        return {
          ok: false,
          error: 'O servidor não confirmou a gravação do registro. Tente novamente.'
        };
      }

      return { ok: true, id: data.id, savedAt: data.updated_at };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  async function saveManyObservations(records) {
    const result = { saved: 0, failed: 0, errors: [] };
    const list = Array.isArray(records) ? records : [];

    for (let index = 0; index < list.length; index += 1) {
      const record = list[index];
      const response = await upsertObservation(record);
      if (response.ok) {
        result.saved += 1;
      } else {
        result.failed += 1;
        result.errors.push({
          id: record && record.id ? record.id : '(sem id)',
          error: response.error
        });
      }
    }

    return Object.assign({ ok: result.failed === 0 }, result);
  }

  async function deleteObservation(id) {
    try {
      if (!isValidId(id)) return { ok: false, error: 'Identificador de registro inválido.' };
      const session = await requireSession();
      const supabase = getClient();
      const { data, error } = await supabase
        .from(TABLES.observations)
        .delete()
        .eq('owner_id', session.user.id)
        .eq('id', id)
        .select('id');

      if (error) return { ok: false, error: friendlyError(error) };
      if (!Array.isArray(data) || !data.length) {
        return {
          ok: false,
          error:
            'O servidor não confirmou a exclusão. O registro pode já ter sido removido ' +
            'ou não pertence a esta conta.'
        };
      }

      return { ok: true, deleted: data.length };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  async function loadSettings() {
    try {
      const session = await requireSession();
      const supabase = getClient();
      const { data, error } = await supabase
        .from(TABLES.settings)
        .select('payload, updated_at')
        .eq('owner_id', session.user.id)
        .maybeSingle();

      if (error) return { ok: false, error: friendlyError(error), data: {}, exists: false };
      if (!data) return { ok: true, data: {}, exists: false };

      const payload =
        data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)
          ? data.payload
          : {};
      return { ok: true, data: payload, exists: true, updatedAt: data.updated_at };
    } catch (error) {
      return { ok: false, error: friendlyError(error), data: {}, exists: false };
    }
  }

  async function saveSettings(settings) {
    try {
      const session = await requireSession();
      const supabase = getClient();
      const payload =
        settings && typeof settings === 'object' && !Array.isArray(settings)
          ? JSON.parse(JSON.stringify(settings))
          : {};

      const { data, error } = await supabase
        .from(TABLES.settings)
        .upsert(
          {
            owner_id: session.user.id,
            payload: payload,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'owner_id' }
        )
        .select('owner_id, updated_at')
        .maybeSingle();

      if (error) return { ok: false, error: friendlyError(error) };
      if (!data) {
        return {
          ok: false,
          error: 'O servidor não confirmou a gravação das configurações. Tente novamente.'
        };
      }

      return { ok: true, savedAt: data.updated_at };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  // Limpa SOMENTE os dados da conta na nuvem. Os registros antigos do
  // localStorage não são tocados por esta função.
  async function clearCloudData() {
    try {
      const session = await requireSession();
      const supabase = getClient();

      const observations = await supabase
        .from(TABLES.observations)
        .delete()
        .eq('owner_id', session.user.id)
        .select('id');
      if (observations.error) {
        return { ok: false, error: friendlyError(observations.error) };
      }

      const settings = await supabase
        .from(TABLES.settings)
        .delete()
        .eq('owner_id', session.user.id);
      if (settings.error) {
        return {
          ok: false,
          error:
            'As observações foram removidas, mas as configurações não. ' +
            friendlyError(settings.error)
        };
      }

      return {
        ok: true,
        deleted: Array.isArray(observations.data) ? observations.data.length : 0
      };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  // Migração explícita: envia os registros locais, ignora ids que já existem
  // na nuvem, valida cada item e devolve contagens reais do servidor.
  async function migrateRecords(records, onProgress) {
    const result = {
      imported: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    try {
      const session = await requireSession();
      const supabase = getClient();
      const existing = await supabase
        .from(TABLES.observations)
        .select('id')
        .eq('owner_id', session.user.id);

      if (existing.error) {
        return { ok: false, error: friendlyError(existing.error), data: result };
      }

      const cloudIds = new Set(
        (existing.data || []).map(function (row) {
          return row.id;
        })
      );
      const seen = new Set();
      const list = Array.isArray(records) ? records : [];

      for (let index = 0; index < list.length; index += 1) {
        const record = list[index];
        const id = record && typeof record.id === 'string' ? record.id : '';

        if (!isValidId(id)) {
          result.failed += 1;
          result.errors.push({
            id: id || '(sem id)',
            error: 'Registro local sem identificador válido; não foi enviado.'
          });
        } else if (cloudIds.has(id) || seen.has(id)) {
          result.skipped += 1;
        } else {
          seen.add(id);
          const response = await upsertObservation(record);
          if (response.ok) {
            result.imported += 1;
            cloudIds.add(id);
          } else {
            result.failed += 1;
            result.errors.push({ id: id, error: response.error });
          }
        }

        if (typeof onProgress === 'function') {
          onProgress({
            processed: index + 1,
            total: list.length,
            imported: result.imported,
            skipped: result.skipped,
            failed: result.failed
          });
        }
      }

      return Object.assign({ ok: result.failed === 0 }, result);
    } catch (error) {
      return { ok: false, error: friendlyError(error), data: result };
    }
  }

  return {
    configuration: configuration,
    isConfigured: isConfigured,
    getClient: getClient,
    friendlyError: friendlyError,
    getSession: getSession,
    signIn: signIn,
    signUp: signUp,
    resendConfirmation: resendConfirmation,
    signOut: signOut,
    onAuthStateChange: onAuthStateChange,
    listObservations: listObservations,
    getObservation: getObservation,
    upsertObservation: upsertObservation,
    saveManyObservations: saveManyObservations,
    deleteObservation: deleteObservation,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    clearCloudData: clearCloudData,
    migrateRecords: migrateRecords
  };
})();

/*
 * ObservaEdu — Camada de armazenamento
 * ------------------------------------
 * Reúne duas fontes de dados, sem misturá-las silenciosamente:
 *
 *   1. NUVEM (quando supabase-config.js tem uma chave pública):
 *      as observações e configurações são lidas/gravadas no Supabase,
 *      sempre com sessão autenticada e RLS. As funções *Async abaixo são
 *      usadas nesse modo e só retornam sucesso após resposta do servidor.
 *
 *   2. LOCAL (quando não há chave pública configurada):
 *      mantém o funcionamento anterior com localStorage. As funções
 *      síncronas continuam disponíveis para backup e migração.
 *
 * O localStorage antigo NUNCA é apagado automaticamente. A migração para
 * a nuvem é uma ação explícita em Configurações.
 *
 * IMPORTANTE: localStorage NÃO é um banco de dados institucional.
 * Ele não possui controle de acesso, auditoria nem compartilhamento entre
 * computadores. No modo nuvem, a proteção real vem do Supabase Auth + RLS.
 */

window.ObservaEduStorage = (function () {
  'use strict';

  const CONFIG = window.OBSERVAEDU_CONFIG;
  const memory = {}; // fallback em memória, usado se o localStorage falhar
  let available = null;

  function clone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  function hasMemory(key) {
    return Object.prototype.hasOwnProperty.call(memory, key);
  }

  function friendlyError(error) {
    const text = String(error && (error.name || error.message) || error || '');
    if (/quota|exceeded|full/i.test(text)) {
      return 'O espaço disponível neste navegador está cheio. Exporte um backup e tente novamente.';
    }
    if (/security|denied|blocked|not allowed/i.test(text)) {
      return 'O navegador bloqueou o acesso aos dados. Verifique as permissões ou o modo de navegação privada.';
    }
    return 'Não foi possível acessar os dados deste navegador.';
  }

  function checkAvailability() {
    try {
      const testKey = '__observaedu_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      available = true;
    } catch (error) {
      available = false;
    }
    return available;
  }

  function isAvailable() {
    return available === null ? checkAvailability() : available;
  }

  // Preserva uma cópia do conteúdo corrompido antes de qualquer nova gravação.
  function backupCorrupted(key, raw) {
    const backupKey = key + '.corrupted.' + Date.now();
    try {
      localStorage.setItem(backupKey, raw);
      return backupKey;
    } catch (error) {
      return null;
    }
  }

  function readJSON(key) {
    let raw;
    try {
      raw = localStorage.getItem(key);
      available = true;
    } catch (error) {
      available = false;
      if (hasMemory(key)) {
        return {
          ok: true,
          data: clone(memory[key]),
          exists: true,
          fromMemory: true,
          warning: friendlyError(error)
        };
      }
      return { ok: false, error: friendlyError(error), code: 'access' };
    }

    if (raw === null) {
      return { ok: true, data: null, exists: false };
    }

    try {
      const data = JSON.parse(raw);
      memory[key] = clone(data);
      return { ok: true, data: data, exists: true };
    } catch (error) {
      const backupKey = backupCorrupted(key, raw);
      return {
        ok: false,
        code: 'parse',
        backupKey: backupKey,
        error:
          'Os dados salvos neste navegador estão em um formato que não pôde ser lido. ' +
          (backupKey
            ? 'Uma cópia do conteúdo anterior foi preservada no próprio navegador.'
            : 'Não foi possível criar uma cópia de segurança automática.')
      };
    }
  }

  function writeJSON(key, value) {
    memory[key] = clone(value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
      available = true;
      return { ok: true };
    } catch (error) {
      available = false;
      return { ok: false, error: friendlyError(error), code: 'write' };
    }
  }

  function loadObservations() {
    const result = readJSON(CONFIG.storageKey);
    if (!result.ok) {
      return { ok: false, data: [], error: result.error, backupKey: result.backupKey };
    }
    if (result.data === null) {
      return { ok: true, data: [], warning: result.warning };
    }
    if (!Array.isArray(result.data)) {
      return {
        ok: false,
        data: [],
        error: 'Os dados estão em um formato inesperado. Nenhum dado foi apagado.'
      };
    }
    return { ok: true, data: result.data, warning: result.warning };
  }

  function saveObservations(observations) {
    if (!Array.isArray(observations)) {
      return { ok: false, error: 'Formato inválido de observações.' };
    }
    return writeJSON(CONFIG.storageKey, observations);
  }

  function loadSettings() {
    const result = readJSON(CONFIG.settingsKey);
    if (!result.ok) {
      return { ok: false, data: {}, error: result.error };
    }
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
      return { ok: true, data: {}, warning: result.warning };
    }
    return { ok: true, data: result.data, warning: result.warning };
  }

  function saveSettings(settings) {
    return writeJSON(CONFIG.settingsKey, settings && typeof settings === 'object' ? settings : {});
  }

  function getUsage() {
    let bytes = 0;
    let accessible = isAvailable();
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || key.indexOf('observaedu.') !== 0) continue;
        const value = localStorage.getItem(key) || '';
        // Aproximação: cada caractere UTF-16 ocupa cerca de 2 bytes.
        bytes += (key.length + value.length) * 2;
      }
    } catch (error) {
      accessible = false;
    }
    if (!accessible) {
      Object.keys(memory).forEach(function (key) {
        if (key.indexOf('observaedu.') !== 0) return;
        bytes += (key.length + JSON.stringify(memory[key]).length) * 2;
      });
    }
    return { bytes: bytes, available: accessible };
  }

  function clearAll() {
    try {
      localStorage.removeItem(CONFIG.storageKey);
      localStorage.removeItem(CONFIG.settingsKey);
      Object.keys(memory).forEach(function (key) {
        if (key.indexOf('observaedu.') === 0) delete memory[key];
      });
      available = true;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  }

  function createBackup(observations, settings) {
    return {
      app: CONFIG.appName,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      observations: clone(observations || []),
      settings: clone(settings || {})
    };
  }

  /* =======================================================================
   * INTEGRAÇÃO COM O SUPABASE (modo nuvem)
   * ===================================================================== */

  function Cloud() {
    return window.ObservaEduSupabase;
  }

  function isCloudConfigured() {
    const cloud = Cloud();
    return !!(cloud && typeof cloud.isConfigured === 'function' && cloud.isConfigured());
  }

  function mode() {
    return isCloudConfigured() ? 'cloud' : 'local';
  }

  function cloudNotConfigured() {
    return {
      ok: false,
      error:
        'A conexão com a conta não está configurada. Informe a chave pública do projeto e recarregue a página.',
      mode: 'cloud'
    };
  }

  // Lista usada pelo app no modo nuvem. Em caso de falha, NÃO devolve os
  // registros locais: isso evitaria uma mistura silenciosa de fontes.
  async function loadObservationsAsync() {
    if (!isCloudConfigured()) {
      const local = loadObservations();
      local.mode = 'local';
      return local;
    }

    const result = await Cloud().listObservations();
    return {
      ok: !!result.ok,
      data: result.ok && Array.isArray(result.data) ? result.data : [],
      error: result.error,
      mode: 'cloud'
    };
  }

  async function saveObservation(record) {
    if (!isCloudConfigured()) return cloudNotConfigured();
    return Cloud().upsertObservation(record);
  }

  async function saveObservationsAsync(records) {
    if (!isCloudConfigured()) return cloudNotConfigured();
    const result = await Cloud().saveManyObservations(records);
    return Object.assign({ mode: 'cloud' }, result);
  }

  async function deleteObservationAsync(id) {
    if (!isCloudConfigured()) return cloudNotConfigured();
    return Cloud().deleteObservation(id);
  }

  async function loadSettingsAsync() {
    if (!isCloudConfigured()) {
      const local = loadSettings();
      local.mode = 'local';
      return local;
    }

    const result = await Cloud().loadSettings();
    return {
      ok: !!result.ok,
      data: result.ok && result.data && typeof result.data === 'object' ? result.data : {},
      error: result.error,
      mode: 'cloud'
    };
  }

  async function saveSettingsAsync(settings) {
    if (!isCloudConfigured()) return cloudNotConfigured();
    return Cloud().saveSettings(settings);
  }

  async function clearCloudData() {
    if (!isCloudConfigured()) return cloudNotConfigured();
    return Cloud().clearCloudData();
  }

  // Lê os registros locais para prévia/migração sem alterar nada.
  function getLocalRecords() {
    const result = loadObservations();
    return {
      ok: !!result.ok,
      records: result.ok ? result.data : [],
      error: result.error,
      backupKey: result.backupKey
    };
  }

  // Migração explícita: envia os registros locais, ignora duplicados e
  // devolve contagens reais. O localStorage permanece intacto.
  async function migrateLocalToCloud(onProgress) {
    if (!isCloudConfigured()) return cloudNotConfigured();

    const local = getLocalRecords();
    if (!local.ok) {
      return {
        ok: false,
        error:
          local.error ||
          'Não foi possível ler os registros locais. Nada foi enviado.',
        localCount: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: []
      };
    }

    const result = await Cloud().migrateRecords(local.records, onProgress);
    const counts = result.data || result;

    return {
      ok: !!result.ok,
      error: result.error,
      localCount: local.records.length,
      imported: Number(counts.imported) || 0,
      skipped: Number(counts.skipped) || 0,
      failed: Number(counts.failed) || 0,
      errors: Array.isArray(counts.errors) ? counts.errors : []
    };
  }

  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: 'O arquivo selecionado não é um JSON válido.' };
    }

    let observations;
    let settings;
    let exportedAt = null;

    if (Array.isArray(data)) {
      // Compatibilidade com um arquivo que contenha apenas a lista.
      observations = data;
      settings = {};
    } else if (data && typeof data === 'object') {
      observations = data.observations;
      settings = data.settings || {};
      exportedAt = typeof data.exportedAt === 'string' ? data.exportedAt : null;
    } else {
      return { ok: false, error: 'O arquivo de backup não contém dados reconhecíveis.' };
    }

    if (!Array.isArray(observations)) {
      return { ok: false, error: 'O backup não contém uma lista de observações.' };
    }
    if (settings && (typeof settings !== 'object' || Array.isArray(settings))) {
      return { ok: false, error: 'O backup contém configurações em formato inválido.' };
    }

    return {
      ok: true,
      data: {
        observations: observations,
        settings: settings || {},
        exportedAt: exportedAt
      }
    };
  }

  return {
    checkAvailability: checkAvailability,
    isAvailable: isAvailable,
    loadObservations: loadObservations,
    saveObservations: saveObservations,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    getUsage: getUsage,
    clearAll: clearAll,
    createBackup: createBackup,
    parseBackup: parseBackup,

    // Modo nuvem (Supabase)
    mode: mode,
    isCloudConfigured: isCloudConfigured,
    loadObservationsAsync: loadObservationsAsync,
    saveObservation: saveObservation,
    saveObservationsAsync: saveObservationsAsync,
    deleteObservationAsync: deleteObservationAsync,
    loadSettingsAsync: loadSettingsAsync,
    saveSettingsAsync: saveSettingsAsync,
    clearCloudData: clearCloudData,
    getLocalRecords: getLocalRecords,
    migrateLocalToCloud: migrateLocalToCloud
  };
})();

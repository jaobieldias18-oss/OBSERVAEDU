/*
 * ObservaEdu — Interface e fluxo da aplicação
 * -------------------------------------------
 * Este arquivo liga o formulário, o armazenamento (local ou Supabase),
 * a análise por regras e o relatório. A ordem de carregamento dos scripts é:
 * questions.js -> supabase.js -> storage.js -> analysis.js -> report.js ->
 * auth.js -> app.js.
 *
 * Organização do código:
 * 1. Utilidades e estado
 * 2. Inicialização, autenticação, navegação e diálogos
 * 3. Painel, histórico, relatórios e configurações
 * 4. Formulário (identificação, perguntas e campos complementares)
 * 5. Análise, resumo final e relatório
 * 6. Ações gerais (backup, migração, exclusão, impressão)
 *
 * Todo texto digitado pelo usuário é inserido com textContent (nunca
 * innerHTML), evitando que o conteúdo seja interpretado como HTML.
 */

(function () {
  'use strict';

  const CONFIG = window.OBSERVAEDU_CONFIG;
  const Storage = window.ObservaEduStorage;
  const Auth = window.ObservaEduAuth;
  const Analysis = window.ObservaEduAnalysis;
  const Report = window.ObservaEduReport;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const TOTAL_QUESTIONS = CONFIG.sections.reduce(function (total, section) {
    return total + section.questions.length;
  }, 0);

  // Títulos exibidos na barra superior em cada tela.
  const VIEW_META = {
    dashboard: {
      title: 'Painel',
      subtitle: 'Visão geral das observações pedagógicas'
    },
    form: {
      title: 'Observação',
      subtitle: 'Registro, análise e relatório da observação'
    },
    history: {
      title: 'Histórico',
      subtitle: 'Pesquise, filtre e gerencie os registros salvos'
    },
    reports: {
      title: 'Relatórios',
      subtitle: 'Documentos das observações concluídas'
    },
    report: {
      title: 'Relatório',
      subtitle: 'Visualização, revisão e impressão do documento'
    },
    settings: {
      title: 'Configurações',
      subtitle: 'Escola, conta, armazenamento e backup'
    }
  };

  // Campos necessários para concluir uma observação.
  const REQUIRED_FIELDS = [
    { key: 'professor', label: 'Nome do professor(a) observado(a)' },
    { key: 'disciplina', label: 'Disciplina' },
    { key: 'turma', label: 'Turma ou ano escolar' },
    { key: 'data', label: 'Data da observação' },
    { key: 'observador', label: 'Nome do orientador(a) / observador(a)' }
  ];

  const STEPS = [
    { number: 1, title: 'Identificação', hint: 'Dados essenciais' },
    { number: 2, title: 'Introdução', hint: '6 perguntas' },
    { number: 3, title: 'Desenvolvimento', hint: '12 perguntas' },
    { number: 4, title: 'Conclusão', hint: '7 perguntas' },
    { number: 5, title: 'Complementares', hint: 'Textos opcionais' },
    { number: 6, title: 'Análise', hint: 'Revisão dos textos' },
    { number: 7, title: 'Revisão', hint: 'Gerar relatório' }
  ];

  const state = {
    observations: [],
    settings: {},
    view: 'dashboard',
    storageAvailable: true,
    mode: 'local',
    user: null,
    cloudLoaded: false,
    pendingCloudWrite: false,
    migrationBusy: false,

    form: null,
    formStep: 1,
    formIsNew: true,
    formDirty: false,
    formReturnView: 'dashboard',

    filters: {
      search: '',
      disciplina: '',
      turma: '',
      status: '',
      from: '',
      to: ''
    },
    reportsSearch: '',

    currentReportId: null,
    reportSnapshot: null
  };

  let confirmResolver = null;
  let historyTimer = null;
  let reportsTimer = null;

  // PWA: instalação e atualização controladas pelo navegador.
  let pwaRegistration = null;
  let pwaUpdateWorker = null;
  let pwaInstallPrompt = null;
  let pwaReloading = false;

  /* =======================================================================
   * 1. UTILIDADES GERAIS
   * ===================================================================== */

  function $(id) {
    return document.getElementById(id);
  }

  function el(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function append(parent) {
    for (let i = 1; i < arguments.length; i += 1) {
      const child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (item) {
          if (item !== null && item !== undefined) parent.appendChild(item);
        });
      } else {
        parent.appendChild(child);
      }
    }
    return parent;
  }

  function clearNode(node) {
    if (node) node.textContent = '';
  }

  function clone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function stringValue(value) {
    return typeof value === 'string' ? value : '';
  }

  // Normaliza texto para busca: remove acentos e diferenças de maiúsculas.
  function searchKey(value) {
    return clean(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function initials(name) {
    const parts = clean(name).split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function validIso(value) {
    if (typeof value !== 'string' || !value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'obs_' + window.crypto.randomUUID();
    }
    return (
      'obs_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 9)
    );
  }

  function formatDateBR(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(value));
    if (!match) return 'Não informado';
    return match[3] + '/' + match[2] + '/' + match[1];
  }

  function formatDateTimeBR(value) {
    if (!value) return 'Não informado';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Não informado';
    return (
      date.toLocaleDateString('pt-BR') +
      ' às ' +
      date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    );
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1).replace('.', ',') + ' KB';
    return (value / (1024 * 1024)).toFixed(2).replace('.', ',') + ' MB';
  }

  function plural(count, singular, pluralForm) {
    return count === 1 ? singular : pluralForm;
  }

  function svgIcon(id, className) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className || 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function makeButton(label, action, dataset, variant, iconId) {
    const button = el('button', 'btn ' + (variant || 'btn-secondary'));
    button.type = 'button';
    button.dataset.action = action;
    if (dataset) {
      Object.keys(dataset).forEach(function (key) {
        button.dataset[key] = dataset[key];
      });
    }
    if (iconId) button.appendChild(svgIcon(iconId));
    button.appendChild(el('span', null, label));
    return button;
  }

  function sortByUpdated(a, b) {
    const aTime = new Date(a.updatedAt).getTime() || 0;
    const bTime = new Date(b.updatedAt).getTime() || 0;
    return bTime - aTime;
  }

  function sortedObservations() {
    return state.observations.slice().sort(sortByUpdated);
  }

  function getRecord(id) {
    return (
      state.observations.find(function (record) {
        return record.id === id;
      }) || null
    );
  }

  function answerIsValid(value) {
    return CONFIG.answerOptions.some(function (option) {
      return option.value === value;
    });
  }

  function getAnsweredCount(record) {
    if (!record) return 0;
    let count = 0;
    CONFIG.sections.forEach(function (section) {
      section.questions.forEach(function (question) {
        if (answerIsValid(record.respostas && record.respostas[question.id])) {
          count += 1;
        }
      });
    });
    return count;
  }

  function unansweredList(record) {
    const list = [];
    CONFIG.sections.forEach(function (section) {
      section.questions.forEach(function (question) {
        const value = record && record.respostas ? record.respostas[question.id] : '';
        if (!answerIsValid(value)) {
          list.push({ section: section, question: question });
        }
      });
    });
    return list;
  }

  function missingRequiredFields(record) {
    const identificacao = (record && record.identificacao) || {};
    return REQUIRED_FIELDS.filter(function (field) {
      return !clean(identificacao[field.key]);
    });
  }

  function getValidation(record) {
    const missingRequired = missingRequiredFields(record);
    const unanswered = unansweredList(record);
    return {
      missingRequired: missingRequired,
      unanswered: unanswered,
      valid: missingRequired.length === 0 && unanswered.length === 0,
      firstStep: missingRequired.length
        ? 1
        : unanswered.length
          ? unanswered[0].section.step
          : 7
    };
  }

  // Indica em qual etapa o registro deve ser retomado.
  function suggestStep(record) {
    const validation = getValidation(record);
    if (validation.missingRequired.length) return 1;
    if (validation.unanswered.length) return validation.unanswered[0].section.step;
    if (!record.analise) return 6;
    return 7;
  }

  function hasAnyData(record) {
    if (!record) return false;
    const identificacao = record.identificacao || {};
    if (
      clean(identificacao.professor) ||
      clean(identificacao.disciplina) ||
      clean(identificacao.turma) ||
      clean(identificacao.data) ||
      clean(identificacao.horario) ||
      clean(identificacao.observador) ||
      clean(identificacao.tema)
    ) {
      return true;
    }
    if (getAnsweredCount(record) > 0) return true;
    if (
      CONFIG.sections.some(function (section) {
        return clean(record.comentarios && record.comentarios[section.id]);
      })
    ) {
      return true;
    }
    return CONFIG.complementaryFields.some(function (field) {
      return clean(record.complementares && record.complementares[field.key]);
    });
  }

  function statusBadge(status) {
    const meta = CONFIG.statuses[status] || { label: 'Status não informado', tone: 'neutral' };
    return el('span', 'badge badge--' + meta.tone, meta.label);
  }

  function createBlankRecord() {
    const stamp = nowIso();
    const record = {
      id: createId(),
      status: 'rascunho',
      identificacao: {
        professor: '',
        disciplina: '',
        turma: '',
        data: '',
        horario: '',
        observador: '',
        tema: ''
      },
      respostas: {},
      comentarios: {},
      complementares: {},
      analise: null,
      createdAt: stamp,
      updatedAt: stamp
    };

    CONFIG.sections.forEach(function (section) {
      record.comentarios[section.id] = '';
    });
    CONFIG.complementaryFields.forEach(function (field) {
      record.complementares[field.key] = '';
    });
    return record;
  }

  function normalizeAnalysis(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const narratives = raw.narratives && typeof raw.narratives === 'object' ? raw.narratives : {};
    return {
      narratives: {
        sintese: stringValue(narratives.sintese),
        positivas: stringValue(narratives.positivas),
        atencao: stringValue(narratives.atencao),
        sugestoes: stringValue(narratives.sugestoes)
      },
      generatedAt: validIso(raw.generatedAt),
      sourceSignature: typeof raw.sourceSignature === 'string' ? raw.sourceSignature : '',
      manuallyEdited: raw.manuallyEdited === true,
      editedAt: validIso(raw.editedAt)
    };
  }

  function normalizeRecord(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const identification = source.identificacao && typeof source.identificacao === 'object'
      ? source.identificacao
      : {};
    const answers = source.respostas && typeof source.respostas === 'object' ? source.respostas : {};
    const comments = source.comentarios && typeof source.comentarios === 'object' ? source.comentarios : {};
    const complementary = source.complementares && typeof source.complementares === 'object'
      ? source.complementares
      : {};

    const updatedAt = validIso(source.updatedAt) || nowIso();
    const createdAt = validIso(source.createdAt) || updatedAt;

    const record = {
      id: clean(source.id) || createId(),
      status: source.status === 'concluida' ? 'concluida' : 'rascunho',
      identificacao: {
        professor: stringValue(identification.professor),
        disciplina: stringValue(identification.disciplina),
        turma: stringValue(identification.turma),
        data: stringValue(identification.data),
        horario: stringValue(identification.horario),
        observador: stringValue(identification.observador),
        tema: stringValue(identification.tema)
      },
      respostas: {},
      comentarios: {},
      complementares: {},
      analise: normalizeAnalysis(source.analise),
      createdAt: createdAt,
      updatedAt: updatedAt
    };

    CONFIG.sections.forEach(function (section) {
      section.questions.forEach(function (question) {
        const value = answers[question.id];
        if (answerIsValid(value)) record.respostas[question.id] = value;
      });
      record.comentarios[section.id] = stringValue(comments[section.id]);
    });

    CONFIG.complementaryFields.forEach(function (field) {
      record.complementares[field.key] = stringValue(complementary[field.key]);
    });

    // Preserva campos desconhecidos para não perder dados de versões futuras.
    return Object.assign({}, source, record);
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      schoolName: stringValue(source.schoolName),
      schoolUnit: stringValue(source.schoolUnit),
      city: stringValue(source.city)
    };
  }

  function dedupeRecords(records) {
    const map = new Map();
    records.forEach(function (record) {
      map.set(record.id, record);
    });
    return Array.from(map.values());
  }

  /* =======================================================================
   * 2. MENSAGENS, ARMAZENAMENTO E DIÁLOGOS
   * ===================================================================== */

  function showBanner(message) {
    const banner = $('appBanner');
    const text = $('appBannerMessage');
    if (!banner || !text) return;
    text.textContent = message;
    banner.hidden = false;
  }

  function hideBanner() {
    const banner = $('appBanner');
    if (banner) banner.hidden = true;
  }

  function showToast(message, type) {
    const container = $('toastContainer');
    if (!container) return;
    const tone = type || 'info';
    const icons = {
      success: 'i-check',
      error: 'i-alert',
      warning: 'i-alert',
      info: 'i-info'
    };
    const toast = el('div', 'toast toast--' + tone);
    toast.appendChild(svgIcon(icons[tone] || 'i-info'));
    toast.appendChild(el('span', null, message));
    container.appendChild(toast);

    window.setTimeout(function () {
      toast.classList.add('is-leaving');
      window.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 240);
    }, 4200);
  }

  async function loadData() {
    state.storageAvailable = Storage.checkAvailability();

    if (state.mode === 'cloud') {
      const results = await Promise.all([
        Storage.loadObservationsAsync(),
        Storage.loadSettingsAsync()
      ]);
      const observations = results[0];
      const settings = results[1];
      const problems = [];

      if (observations.ok) {
        const normalized = (observations.data || []).map(normalizeRecord);
        state.observations = dedupeRecords(normalized).sort(sortByUpdated);
        state.cloudLoaded = true;
      } else {
        state.observations = [];
        state.cloudLoaded = false;
        problems.push(
          'Não foi possível carregar os registros da nuvem. ' +
            (observations.error || 'Verifique a conexão e tente novamente.')
        );
      }

      if (settings.ok) {
        state.settings = normalizeSettings(settings.data);
      } else {
        state.settings = normalizeSettings({});
        problems.push(
          'Não foi possível carregar as configurações da nuvem. ' +
            (settings.error || 'As configurações atuais não foram alteradas.')
        );
      }

      state.pendingCloudWrite = false;

      if (!state.storageAvailable) {
        problems.push(
          'O navegador bloqueou o armazenamento local. A sessão pode não permanecer ' +
            'ao recarregar a página; verifique as permissões do navegador.'
        );
      }

      if (problems.length) showBanner(problems.join(' '));
      updateStoragePanel();
      return observations.ok;
    }

    const observations = Storage.loadObservations();
    if (observations.ok) {
      const normalized = (observations.data || []).map(normalizeRecord);
      state.observations = dedupeRecords(normalized).sort(sortByUpdated);
      if (observations.warning) showBanner(observations.warning);
    } else {
      state.observations = [];
      state.storageAvailable = false;
      showBanner(observations.error);
    }

    const settings = Storage.loadSettings();
    if (settings.ok) {
      state.settings = normalizeSettings(settings.data);
      if (settings.warning && !observations.warning) showBanner(settings.warning);
    } else {
      state.settings = normalizeSettings({});
      if (observations.ok) showBanner(settings.error);
    }

    if (!state.storageAvailable) {
      showBanner(
        'O navegador bloqueou o armazenamento local. Você ainda pode usar o sistema nesta sessão, ' +
          'mas os registros não serão mantidos ao fechar ou atualizar a página. ' +
          'Verifique as permissões do navegador ou o modo de navegação privada.'
      );
    }

    updateStoragePanel();
    return observations.ok;
  }

  async function saveObservationsToStorage() {
    if (state.mode === 'cloud') {
      const result = await Storage.saveObservationsAsync(state.observations);
      if (!result.ok) {
        state.pendingCloudWrite = true;
        showBanner(
          (result.error ||
            (result.failed
              ? result.failed + ' registro(s) não foram gravados no servidor.'
              : 'Não foi possível gravar os dados na nuvem.')) +
            ' Os dados desta sessão permanecem na interface, mas a gravação no servidor NÃO foi confirmada.'
        );
        updateStoragePanel();
        return false;
      }
      state.pendingCloudWrite = false;
      updateStoragePanel();
      return true;
    }

    const result = Storage.saveObservations(state.observations);
    if (!result.ok) {
      state.storageAvailable = false;
      showBanner(
        (result.error || 'Não foi possível gravar os dados.') +
          ' Os registros desta sessão permanecem apenas na memória até a página ser fechada.'
      );
      updateStoragePanel();
      return false;
    }
    state.storageAvailable = true;
    return true;
  }

  async function saveSettingsToStorage() {
    if (state.mode === 'cloud') {
      const result = await Storage.saveSettingsAsync(state.settings);
      if (!result.ok) {
        state.pendingCloudWrite = true;
        showBanner(
          (result.error || 'Não foi possível gravar as configurações na nuvem.') +
            ' As alterações valem apenas nesta sessão até que o servidor confirme a gravação.'
        );
        updateStoragePanel();
        return false;
      }
      state.pendingCloudWrite = false;
      updateStoragePanel();
      return true;
    }

    const result = Storage.saveSettings(state.settings);
    if (!result.ok) {
      state.storageAvailable = false;
      showBanner(
        (result.error || 'Não foi possível gravar as configurações.') +
          ' As alterações valem apenas nesta sessão.'
      );
      updateStoragePanel();
      return false;
    }
    state.storageAvailable = true;
    return true;
  }

  function askConfirm(options) {
    const config = options || {};
    const dialog = $('confirmDialog');
    if (!dialog) return Promise.resolve(window.confirm(config.message || 'Confirmar ação?'));

    if (confirmResolver) {
      const previous = confirmResolver;
      confirmResolver = null;
      previous(false);
    }

    $('confirmTitle').textContent = config.title || 'Confirmar ação';
    $('confirmMessage').textContent = config.message || '';
    const okButton = $('confirmOk');
    okButton.textContent = config.confirmLabel || 'Confirmar';
    okButton.className = config.danger ? 'btn btn-danger' : 'btn btn-primary';

    return new Promise(function (resolve) {
      confirmResolver = resolve;
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        const answer = window.confirm(config.message || 'Confirmar ação?');
        confirmResolver = null;
        resolve(answer);
      }
    });
  }

  function finishConfirm(value) {
    const dialog = $('confirmDialog');
    const resolver = confirmResolver;
    confirmResolver = null;
    if (resolver) resolver(value);
    if (dialog && dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }

  function discardForm() {
    state.form = null;
    state.formDirty = false;
    state.formStep = 1;
  }

  async function confirmDiscardForm() {
    if (!state.form) return true;
    if (!state.formDirty) {
      discardForm();
      return true;
    }
    const confirmed = await askConfirm({
      title: 'Alterações não salvas',
      message:
        'Este formulário tem alterações que ainda não foram salvas. Deseja descartá-las? ' +
        'Para manter o conteúdo, cancele e use "Salvar rascunho".',
      confirmLabel: 'Descartar alterações',
      danger: true
    });
    if (confirmed) discardForm();
    return confirmed;
  }

  /* =======================================================================
   * 2.1 NAVEGAÇÃO E INICIALIZAÇÃO
   * ===================================================================== */

  function openSidebar() {
    document.body.classList.add('sidebar-open');
    const toggle = $('menuToggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    const toggle = $('menuToggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function setView(view, options) {
    const opts = options || {};
    const target = VIEW_META[view] ? view : 'dashboard';
    state.view = target;

    document.querySelectorAll('.view').forEach(function (section) {
      section.hidden = section.id !== 'view-' + target;
    });

    document.querySelectorAll('.nav-item[data-view]').forEach(function (button) {
      const isActive = button.dataset.view === target;
      button.classList.toggle('is-active', isActive);
      if (isActive) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    });

    const meta = VIEW_META[target];
    const title = $('topbarTitle');
    const subtitle = $('topbarSubtitle');
    if (title) title.textContent = meta.title;
    if (subtitle) subtitle.textContent = meta.subtitle;

    closeSidebar();

    if (target === 'dashboard') {
      renderDashboard();
    } else if (target === 'history') {
      syncHistoryControls();
      renderHistory();
    } else if (target === 'reports') {
      renderReports();
    } else if (target === 'settings') {
      renderSettings();
    } else if (target === 'report') {
      if (!renderCurrentReport()) {
        setView('reports', { focus: false });
        return;
      }
    } else if (target === 'form') {
      updateFormChrome();
    }

    if (opts.focus !== false) {
      window.scrollTo(0, 0);
      if (title && typeof title.focus === 'function') {
        try {
          title.focus({ preventScroll: true });
        } catch (error) {
          title.focus();
        }
      }
    }
  }

  function renderSidebarSchool() {
    const name = $('sidebarSchoolName');
    const meta = $('sidebarSchoolMeta');
    if (name) name.textContent = clean(state.settings.schoolName) || 'Escola não cadastrada';
    const details = [clean(state.settings.schoolUnit), clean(state.settings.city)]
      .filter(Boolean)
      .join(' · ');
    if (meta) meta.textContent = details || 'Configure a identificação da escola';
  }

  function updateStoragePanel() {
    const badge = $('storageStatus');
    const counts = $('storageCounts');
    const usage = $('storageUsage');
    if (!badge || !counts || !usage) return;

    const cloud = state.mode === 'cloud';

    if (cloud) {
      if (state.pendingCloudWrite) {
        badge.className = 'badge badge--warning';
        badge.textContent = 'Gravação pendente';
      } else if (state.cloudLoaded) {
        badge.className = 'badge badge--positive';
        badge.textContent = 'Supabase conectado';
      } else {
        badge.className = 'badge badge--warning';
        badge.textContent = 'Nuvem indisponível';
      }
    } else {
      const available = state.storageAvailable && Storage.isAvailable();
      if (available) {
        badge.className = 'badge badge--positive';
        badge.textContent = 'Disponível';
      } else {
        badge.className = 'badge badge--warning';
        badge.textContent = 'Somente memória';
      }
    }

    const total = state.observations.length;
    const concluded = state.observations.filter(function (record) {
      return record.status === 'concluida';
    }).length;

    counts.textContent =
      total +
      ' ' +
      plural(total, 'registro', 'registros') +
      ' · ' +
      concluded +
      ' ' +
      plural(concluded, 'concluída', 'concluídas');

    if (cloud) {
      usage.textContent = state.cloudLoaded ? 'Supabase' : 'Não confirmado';
      return;
    }

    let usageInfo;
    try {
      usageInfo = Storage.getUsage();
    } catch (error) {
      usageInfo = { bytes: 0, available: false };
    }
    usage.textContent = formatBytes(usageInfo.bytes);
  }

  function setText(id, text) {
    const node = $(id);
    if (node) node.textContent = text;
  }

  // Ajusta textos, controles e identificação visual conforme a fonte de
  // dados ativa (local ou Supabase). Nada aqui altera os registros.
  function applyModeUi() {
    const cloud = state.mode === 'cloud';
    document.body.classList.toggle('mode-cloud', cloud);

    const chip = $('dataModeChip');
    const label = $('dataModeLabel');
    const iconUse = $('dataModeIconUse');
    if (label) label.textContent = cloud ? 'Dados na nuvem' : 'Dados locais';
    if (chip) {
      chip.classList.toggle('local-chip--cloud', cloud);
      chip.title = cloud
        ? 'Os registros são lidos e gravados no Supabase após a autenticação.'
        : 'Os registros desta versão ficam no armazenamento local deste navegador.';
    }
    if (iconUse) iconUse.setAttribute('href', cloud ? '#i-database' : '#i-lock');

    const sessionBox = $('sessionBox');
    if (sessionBox) sessionBox.hidden = !(cloud && state.user);
    setText('sessionEmail', state.user && state.user.email ? state.user.email : '—');

    setText('storageTitle', cloud ? 'Armazenamento na nuvem' : 'Armazenamento local');
    setText(
      'storageSubtitle',
      cloud
        ? 'Conta autenticada, origem dos dados, backup e limpeza.'
        : 'Dados desta versão, backup e limpeza.'
    );
    setText(
      'storageDescription',
      cloud
        ? 'Os registros são lidos e gravados no Supabase. O navegador mantém apenas a sessão ' +
            'e os registros antigos do modo local, que podem ser migrados sem serem apagados.'
        : 'O localStorage guarda os dados apenas neste navegador, neste computador. Ele não é ' +
            'um banco de dados institucional: não oferece controle de acesso, auditoria ou ' +
            'compartilhamento entre máquinas.'
    );
    setText('storageUsageLabel', cloud ? 'Origem dos dados' : 'Espaço aproximado');
    setText(
      'backupHelp',
      cloud
        ? 'O backup JSON continua disponível como cópia de segurança. Importar um backup na ' +
            'nuvem mescla e atualiza os registros por identificador, sem apagar os existentes.'
        : 'O backup é um arquivo JSON com todos os registros e a identificação da escola. ' +
            'A importação substitui os dados atuais deste navegador após confirmação.'
    );
    setText('dangerTitle', cloud ? 'Apagar dados da nuvem' : 'Apagar todos os dados');
    setText(
      'dangerText',
      cloud
        ? 'Remove observações e configurações desta conta no Supabase. Os registros antigos ' +
            'deste navegador são preservados.'
        : 'Remove observações e configurações deste navegador. Esta ação não pode ser desfeita.'
    );
    setText('dangerButtonLabel', cloud ? 'Apagar dados da nuvem' : 'Apagar dados');

    setText(
      'sidebarStorageNote',
      cloud
        ? 'Sessão autenticada: os registros são protegidos por login e pelas políticas RLS do Supabase.'
        : 'Nesta versão local, os dados ficam salvos apenas neste navegador e não são compartilhados automaticamente.'
    );

    setText(
      'privacyItemExternal',
      cloud
        ? 'Os registros são enviados ao Supabase somente quando você está autenticado e com conexão. Não há sincronização offline fictícia.'
        : 'Os registros não são enviados a serviços externos nesta versão.'
    );
    setText(
      'privacyItemBrowser',
      cloud
        ? 'O acesso depende da sua conta e das políticas RLS do banco. Ao usar computadores compartilhados, encerre a sessão ao terminar.'
        : 'Qualquer pessoa com acesso a este navegador e a este computador pode consultar os dados armazenados.'
    );
    setText(
      'privacyItemBackup',
      cloud
        ? 'Exporte backups regularmente. O backup JSON é independente do banco e deve ser guardado em local seguro.'
        : 'Exporte backups regularmente e guarde o arquivo em local seguro.'
    );
    setText(
      'pwaSecurityItem',
      cloud
        ? 'O PWA não substitui o login nem as permissões do banco. Offline, o cache contém apenas arquivos da interface; os registros da nuvem não podem ser consultados nem gravados.'
        : 'O PWA não oferece login, autenticação nem proteção institucional. Qualquer pessoa com acesso a este navegador pode consultar os dados locais.'
    );
    setText(
      'helpPrivacyNote',
      cloud
        ? 'Os registros são armazenados no Supabase e protegidos por login e RLS. O cache offline guarda apenas a interface. Exporte backups e encerre a sessão em computadores compartilhados.'
        : 'Os dados desta versão ficam no armazenamento local deste navegador. Faça backup em Configurações e não use o sistema como único repositório institucional. O PWA não oferece login nem proteção institucional.'
    );
    setText(
      'futureText',
      cloud
        ? 'A versão 1.2.0 usa Supabase Auth (com cadastro público) e PostgreSQL com Row Level Security. A análise ' +
            'continua baseada em regras explícitas de JavaScript e exige revisão humana. ' +
            'Não há sincronização offline fictícia nem integração com IA.'
        : 'Esta versão foi organizada em camadas simples (configuração, armazenamento, análise, ' +
            'relatório e interface). Para uso institucional, configure a integração com o ' +
            'Supabase descrita em INSTRUCOES_SUPABASE.md. Nenhuma integração fictícia com ' +
            'servidores ou inteligência artificial foi implementada.'
    );

    const footer = $('appFooterText');
    if (footer) {
      footer.textContent =
        'ObservaEdu · Versão ' +
        (CONFIG.version || '1.2.0') +
        ' · ' +
        (cloud
          ? 'Registros salvos na nuvem (Supabase).'
          : 'Dados salvos apenas neste navegador.');
    }

    const cloudCard = $('cloudCard');
    if (cloudCard) cloudCard.hidden = !cloud;

    const cloudStatus = $('cloudStatus');
    if (cloudStatus) {
      if (state.pendingCloudWrite) {
        cloudStatus.className = 'badge badge--warning';
        cloudStatus.textContent = 'Gravação pendente';
      } else {
        cloudStatus.className = 'badge badge--positive';
        cloudStatus.textContent = state.cloudLoaded ? 'Conectado' : 'Sem dados carregados';
      }
    }
    setText(
      'cloudAccountEmail',
      state.user && state.user.email ? state.user.email : 'Conta não identificada'
    );

    updateStoragePanel();
    updateMigrationPreview();
  }

  function updateMigrationPreview() {
    const preview = $('migrationPreview');
    if (!preview) return;

    if (state.mode !== 'cloud') {
      preview.textContent = '';
      return;
    }

    const local = Storage.getLocalRecords();
    let count = 0;
    let text;

    if (!local.ok) {
      text =
        'Não foi possível ler os registros locais deste navegador. Nada será migrado: ' +
        (local.error || 'verifique as permissões do armazenamento.');
    } else {
      count = local.records.length;
      text = count
        ? 'Há ' +
          count +
          ' ' +
          plural(count, 'registro local', 'registros locais') +
          ' neste navegador. A migração valida e envia os itens ausentes; registros com o ' +
          'mesmo identificador na nuvem são ignorados e nada é apagado do navegador.'
        : 'Não há registros locais antigos neste navegador para migrar.';
    }

    preview.textContent = text;

    const button = $('migrateButton');
    if (button) button.disabled = state.migrationBusy || !local.ok || count === 0;
  }

  function resetPrivateState() {
    state.observations = [];
    state.settings = normalizeSettings({});
    state.user = null;
    state.cloudLoaded = false;
    state.pendingCloudWrite = false;
    state.currentReportId = null;
    state.reportSnapshot = null;
    state.filters = {
      search: '',
      disciplina: '',
      turma: '',
      status: '',
      from: '',
      to: ''
    };
    state.reportsSearch = '';
    discardForm();
  }

  async function enterApp(session) {
    state.mode = 'cloud';
    state.user = session && session.user ? session.user : null;
    hideBanner();
    await loadData();
    applyModeUi();
    renderSidebarSchool();
    renderSettings();
    setView('dashboard', { focus: false });
  }

  function leaveApp() {
    resetPrivateState();
    applyModeUi();
    renderAll();
    syncHistoryControls();
    renderSettings();
    updateStoragePanel();
    if (state.view !== 'dashboard') setView('dashboard', { focus: false });
  }


  function openHelpDialog() {
    const dialog = $('helpDialog');
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeHelpDialog() {
    const dialog = $('helpDialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  function wireStaticEvents() {
    const menuToggle = $('menuToggle');
    const sidebarClose = $('sidebarClose');
    const sidebarBackdrop = $('sidebarBackdrop');
    const bannerDismiss = $('bannerDismiss');
    const formPrev = $('formPrev');
    const formNext = $('formNext');
    const settingsForm = $('settingsForm');
    const importFileInput = $('importFileInput');

    if (menuToggle) menuToggle.addEventListener('click', openSidebar);
    if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);
    if (bannerDismiss) bannerDismiss.addEventListener('click', hideBanner);

    if (formPrev) {
      formPrev.addEventListener('click', function () {
        setFormStep(state.formStep - 1);
      });
    }
    if (formNext) {
      formNext.addEventListener('click', function () {
        if (state.formStep < 7) setFormStep(state.formStep + 1);
      });
    }

    if (settingsForm) settingsForm.addEventListener('submit', handleSettingsSubmit);
    if (importFileInput) importFileInput.addEventListener('change', handleImportFile);

    const historySearch = $('historySearch');
    if (historySearch) {
      historySearch.addEventListener('input', function (event) {
        state.filters.search = event.target.value;
        window.clearTimeout(historyTimer);
        historyTimer = window.setTimeout(renderHistory, 180);
      });
    }

    const filterMap = {
      filterDisciplina: 'disciplina',
      filterTurma: 'turma',
      filterStatus: 'status',
      filterFrom: 'from',
      filterTo: 'to'
    };
    Object.keys(filterMap).forEach(function (id) {
      const input = $(id);
      if (!input) return;
      input.addEventListener('change', function () {
        state.filters[filterMap[id]] = input.value;
        renderHistory();
      });
    });

    const reportsSearch = $('reportsSearch');
    if (reportsSearch) {
      reportsSearch.addEventListener('input', function (event) {
        state.reportsSearch = event.target.value;
        window.clearTimeout(reportsTimer);
        reportsTimer = window.setTimeout(renderReports, 180);
      });
    }

    const confirmOk = $('confirmOk');
    const confirmCancel = $('confirmCancel');
    const confirmDialog = $('confirmDialog');
    if (confirmOk) confirmOk.addEventListener('click', function () { finishConfirm(true); });
    if (confirmCancel) confirmCancel.addEventListener('click', function () { finishConfirm(false); });
    if (confirmDialog) {
      confirmDialog.addEventListener('close', function () {
        if (confirmResolver) finishConfirm(false);
      });
    }

    const helpClose = $('helpClose');
    const helpOk = $('helpOk');
    if (helpClose) helpClose.addEventListener('click', closeHelpDialog);
    if (helpOk) helpOk.addEventListener('click', closeHelpDialog);

    const panels = $('formStepPanels');
    if (panels) panels.addEventListener('input', handleFormInput);

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeSidebar();
    });

    const updateLater = $('pwaUpdateLater');
    if (updateLater) updateLater.addEventListener('click', hideUpdateBar);

    // Acima de 1024px o menu lateral é fixo; fecha o estado de gaveta.
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1024) closeSidebar();
    });

    window.addEventListener('beforeunload', function (event) {
      if (!state.formDirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  /* =======================================================================
   * 2.1.1 APLICATIVO INSTALÁVEL (PWA)
   * ===================================================================== */

  function isStandaloneMode() {
    const displayMode = window.matchMedia
      ? window.matchMedia('(display-mode: standalone)').matches
      : false;
    return displayMode || window.navigator.standalone === true;
  }

  function showUpdateBar() {
    const bar = $('pwaUpdateBar');
    if (bar) bar.hidden = false;
  }

  function hideUpdateBar() {
    const bar = $('pwaUpdateBar');
    if (bar) bar.hidden = true;
  }

  function updatePwaUi() {
    const statusBadge = $('pwaStatus');
    const statusText = $('pwaStatusText');
    const updateButton = $('pwaUpdateButton');
    const installButtons = [$('pwaInstallButton'), $('pwaInstallSidebar')];
    const standalone = isStandaloneMode();
    const canInstall = Boolean(pwaInstallPrompt) && !standalone;

    installButtons.forEach(function (button) {
      if (button) button.hidden = !canInstall;
    });
    if (updateButton) updateButton.hidden = !pwaUpdateWorker;

    let badgeText = 'Verificando';
    let badgeClass = 'badge';
    let message = '';

    if (!window.isSecureContext) {
      badgeText = 'Requer HTTPS';
      badgeClass = 'badge badge--warning';
      message =
        'A instalação e o modo offline exigem HTTPS (ou localhost). Abra o sistema por um endereço seguro para habilitar o PWA. ' +
        'Neste endereço, os registros continuam funcionando apenas neste navegador.';
    } else if (!('serviceWorker' in navigator)) {
      badgeText = 'Sem suporte';
      badgeClass = 'badge badge--warning';
      message =
        'Este navegador não oferece suporte a service workers. O ObservaEdu continua funcionando, mas sem instalação nem modo offline. ' +
        'Mantenha o backup em JSON atualizado.';
    } else if (standalone) {
      badgeText = 'Instalado';
      badgeClass = 'badge badge--positive';
      message =
        'O ObservaEdu está aberto como aplicativo instalado. Os arquivos da interface ficam em cache para uso offline depois do primeiro carregamento; ' +
        'os registros permanecem no armazenamento local deste navegador.';
    } else if (canInstall) {
      badgeText = 'Pronto para instalar';
      badgeClass = 'badge badge--positive';
      message =
        'Este navegador permite instalar o ObservaEdu. Use o botão "Instalar aplicativo" ou o ícone de instalação na barra de endereço. ' +
        'A instalação não envia registros para servidores.';
    } else {
      badgeText = 'Abrir no navegador';
      badgeClass = 'badge';
      message =
        'A instalação automática não está disponível neste navegador. No Android (Chrome ou Edge), use o menu e escolha "Instalar aplicativo" ou ' +
        '"Adicionar à tela inicial". No iPhone e iPad (Safari), use Compartilhar e depois "Adicionar à Tela de Início". ' +
        'O modo offline só funciona depois que o site for aberto ao menos uma vez neste dispositivo.';
    }

    if (pwaUpdateWorker) {
      message += ' Há uma nova versão disponível: use "Atualizar aplicativo" quando for conveniente. Os registros serão mantidos.';
    }

    if (statusBadge) {
      statusBadge.className = badgeClass;
      statusBadge.textContent = badgeText;
    }
    if (statusText) statusText.textContent = message;
  }

  function handleInstallApp() {
    if (isStandaloneMode()) {
      showToast('O ObservaEdu já está sendo usado como aplicativo instalado.', 'info');
      return;
    }
    if (!pwaInstallPrompt) {
      showToast(
        'A instalação automática não está disponível. No Android, use o menu do navegador; no iPhone ou iPad, use Compartilhar > Adicionar à Tela de Início.',
        'info'
      );
      return;
    }

    const prompt = pwaInstallPrompt;
    pwaInstallPrompt = null;
    updatePwaUi();

    try {
      prompt.prompt();
      if (prompt.userChoice && typeof prompt.userChoice.then === 'function') {
        prompt.userChoice
          .then(function (choice) {
            if (choice && choice.outcome === 'accepted') {
              showToast('Instalação iniciada pelo navegador.', 'success');
            } else {
              showToast('Instalação cancelada. Você pode tentar novamente pelo menu do navegador.', 'info');
            }
            updatePwaUi();
          })
          .catch(function () {
            updatePwaUi();
          });
      }
    } catch (error) {
      console.warn('ObservaEdu: não foi possível abrir a instalação do aplicativo.', error);
      showToast('Não foi possível abrir a instalação. Use o menu do navegador.', 'warning');
      updatePwaUi();
    }
  }

  function handleUpdateApp() {
    if (pwaUpdateWorker) {
      pwaReloading = true;
      hideUpdateBar();
      try {
        pwaUpdateWorker.postMessage({ type: 'SKIP_WAITING' });
      } catch (error) {
        pwaReloading = false;
        console.warn('ObservaEdu: não foi possível ativar a nova versão.', error);
        showToast('Não foi possível aplicar a atualização agora. Recarregue a página e tente novamente.', 'warning');
      }
      return;
    }

    if (pwaRegistration && typeof pwaRegistration.update === 'function') {
      showToast('Verificando se há uma nova versão...', 'info');
      pwaRegistration.update().catch(function () {
        showToast('Não foi possível verificar atualizações agora.', 'warning');
      });
      return;
    }

    showToast('Nenhuma atualização pendente neste navegador.', 'info');
  }

  function watchServiceWorkerUpdate(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) {
      pwaUpdateWorker = registration.waiting;
      updatePwaUi();
      showUpdateBar();
    }

    registration.addEventListener('updatefound', function () {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          pwaUpdateWorker = worker;
          updatePwaUi();
          showUpdateBar();
        }
      });
    });
  }

  function initPwa() {
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      pwaInstallPrompt = event;
      updatePwaUi();
    });

    window.addEventListener('appinstalled', function () {
      pwaInstallPrompt = null;
      updatePwaUi();
      showToast('ObservaEdu instalado. Os registros continuam salvos apenas neste navegador.', 'success');
    });

    updatePwaUi();

    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!pwaReloading) return;
      pwaReloading = false;
      window.location.reload();
    });

    // Registro único do service worker para toda a aplicação.
    navigator.serviceWorker
      .register('service-worker.js')
      .then(function (registration) {
        pwaRegistration = registration;
        watchServiceWorkerUpdate(registration);
        updatePwaUi();
      })
      .catch(function (error) {
        console.warn('ObservaEdu: não foi possível registrar o service worker.', error);
        updatePwaUi();
      });
  }

  /* =======================================================================
   * 2.2 ENTRADA DE DADOS DO FORMULÁRIO
   * ===================================================================== */

  function markFormDirty() {
    state.formDirty = true;
  }

  function clearFieldError(key) {
    const error = document.querySelector('[data-error-for="' + key + '"]');
    if (error) error.textContent = '';
  }

  function handleFormInput(event) {
    if (!state.form) return;
    const target = event.target;
    if (!target) return;

    if (target.dataset && target.dataset.field) {
      const key = target.dataset.field;
      state.form.identificacao[key] = target.value;
      clearFieldError(key);
      markFormDirty();
      updateFormChrome();
      return;
    }

    if (target.dataset && target.dataset.question) {
      if (target.type === 'radio' && !target.checked) return;
      const questionId = target.dataset.question;
      state.form.respostas[questionId] = target.value;

      const card = document.querySelector('[data-question-card="' + questionId + '"]');
      if (card) {
        card.classList.add('is-answered');
        card.classList.remove('is-missing');
      }

      refreshQuestionUI();
      markFormDirty();
      updateFormChrome();
      return;
    }

    if (target.dataset && target.dataset.comment) {
      state.form.comentarios[target.dataset.comment] = target.value;
      markFormDirty();
      return;
    }

    if (target.dataset && target.dataset.complementary) {
      state.form.complementares[target.dataset.complementary] = target.value;
      markFormDirty();
      return;
    }

    if (target.dataset && target.dataset.analysis) {
      if (!state.form.analise) {
        state.form.analise = Analysis.createAnalysisRecord(state.form);
      }
      state.form.analise.narratives[target.dataset.analysis] = target.value;
      state.form.analise.manuallyEdited = true;
      state.form.analise.editedAt = nowIso();
      if (!state.form.analise.sourceSignature) {
        state.form.analise.sourceSignature = Analysis.signature(state.form);
      }
      markFormDirty();
      renderAnalysisStatus();
    }
  }

  async function handleDocumentClick(event) {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    if (actionElement.disabled) return;
    try {
      await runAction(actionElement);
    } catch (error) {
      console.error('ObservaEdu: erro inesperado em uma ação.', error);
      showToast('Ocorreu um erro inesperado. Tente novamente ou recarregue a página.', 'error');
    }
  }

  async function init() {
    buildFormStructure();
    wireStaticEvents();
    initPwa();
    renderSidebarSchool();
    state.storageAvailable = Storage.checkAvailability();

    if (!Auth || !Auth.isConfigured()) {
      state.mode = 'local';
      await loadData();
      applyModeUi();
      renderSettings();
      updateStoragePanel();
      setView('dashboard', { focus: false });
      return;
    }

    state.mode = 'cloud';
    applyModeUi();
    renderSettings();

    const result = await Auth.init({
      onSignedIn: async function (session) {
        await enterApp(session);
      },
      onSignedOut: function () {
        leaveApp();
      }
    });

    if (result.ok) {
      await enterApp(result.session);
    } else {
      state.cloudLoaded = false;
      updateStoragePanel();
    }
  }

  /* =======================================================================
   * 3. PAINEL, HISTÓRICO, RELATÓRIOS E CONFIGURAÇÕES
   * ===================================================================== */

  function renderAll() {
    state.observations.sort(sortByUpdated);
    renderSidebarSchool();
    renderDashboard();
    renderHistory();
    renderReports();
    updateStoragePanel();
    if (state.view === 'settings') renderSettings();
    if (state.view === 'report') renderCurrentReport();
  }

  function buildEmptyState(config) {
    const wrapper = el('div', 'empty-state');
    const iconWrap = el('div', 'empty-icon');
    iconWrap.appendChild(svgIcon(config.icon || 'i-file'));
    wrapper.appendChild(iconWrap);
    wrapper.appendChild(el('h3', null, config.title || 'Nenhum registro'));
    wrapper.appendChild(el('p', null, config.text || ''));
    if (config.actions && config.actions.length) {
      const actions = el('div', 'empty-actions');
      config.actions.forEach(function (item) {
        actions.appendChild(
          makeButton(
            item.label,
            item.action,
            item.dataset,
            item.variant || (item.primary ? 'btn-primary' : 'btn-secondary'),
            item.icon
          )
        );
      });
      wrapper.appendChild(actions);
    }
    return wrapper;
  }

  function buildRecentItem(record) {
    const identification = record.identificacao || {};
    const item = el('div', 'recent-item');

    item.appendChild(el('span', 'person-avatar', initials(identification.professor)));

    const body = el('div', 'recent-body');
    body.appendChild(
      el('p', 'recent-name', clean(identification.professor) || 'Professor(a) não informado')
    );

    const sub = el('p', 'recent-sub');
    sub.appendChild(
      el('span', null, clean(identification.disciplina) || 'Disciplina não informada')
    );
    sub.appendChild(el('span', 'recent-dot'));
    sub.appendChild(el('span', null, clean(identification.turma) || 'Turma não informada'));
    body.appendChild(sub);
    item.appendChild(body);

    const right = el('div', 'recent-right');
    right.appendChild(statusBadge(record.status));
    right.appendChild(el('span', 'recent-date', formatDateBR(identification.data)));
    item.appendChild(right);

    const link = el(
      'button',
      'link-button',
      record.status === 'concluida' ? 'Ver relatório' : 'Continuar'
    );
    link.type = 'button';
    link.dataset.action = record.status === 'concluida' ? 'open-report' : 'open-record';
    link.dataset.id = record.id;
    item.appendChild(link);

    return item;
  }

  function renderDashboard() {
    const totalElement = $('statTotal');
    const ongoingElement = $('statOngoing');
    const completedElement = $('statCompleted');
    const recentList = $('recentList');
    if (!totalElement || !ongoingElement || !completedElement || !recentList) return;

    const total = state.observations.length;
    const ongoing = state.observations.filter(function (record) {
      return record.status !== 'concluida';
    }).length;
    const completed = state.observations.filter(function (record) {
      return record.status === 'concluida';
    }).length;

    totalElement.textContent = String(total);
    ongoingElement.textContent = String(ongoing);
    completedElement.textContent = String(completed);

    clearNode(recentList);
    const recent = sortedObservations().slice(0, 5);

    if (!recent.length) {
      recentList.appendChild(
        buildEmptyState({
          icon: 'i-file',
          title: 'Nenhuma observação registrada',
          text: 'Comece uma nova observação para ver os registros recentes aqui.',
          actions: [
            {
              label: 'Nova observação',
              action: 'new-observation',
              primary: true,
              icon: 'i-plus'
            }
          ]
        })
      );
      return;
    }

    recent.forEach(function (record) {
      recentList.appendChild(buildRecentItem(record));
    });
  }

  function uniqueValues(key) {
    const values = state.observations
      .map(function (record) {
        return clean(record.identificacao && record.identificacao[key]);
      })
      .filter(Boolean);
    return Array.from(new Set(values)).sort(function (a, b) {
      return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    });
  }

  function populateSelect(select, values, allLabel) {
    if (!select) return;
    clearNode(select);
    const allOption = el('option', null, allLabel);
    allOption.value = '';
    select.appendChild(allOption);
    values.forEach(function (value) {
      const option = el('option', null, value);
      option.value = value;
      select.appendChild(option);
    });
  }

  function syncHistoryControls() {
    const search = $('historySearch');
    if (search && document.activeElement !== search) search.value = state.filters.search;

    populateSelect($('filterDisciplina'), uniqueValues('disciplina'), 'Todas as disciplinas');
    populateSelect($('filterTurma'), uniqueValues('turma'), 'Todas as turmas');

    const discipline = $('filterDisciplina');
    if (discipline) {
      discipline.value = state.filters.disciplina;
      if (discipline.value !== state.filters.disciplina) {
        state.filters.disciplina = '';
        discipline.value = '';
      }
    }

    const turma = $('filterTurma');
    if (turma) {
      turma.value = state.filters.turma;
      if (turma.value !== state.filters.turma) {
        state.filters.turma = '';
        turma.value = '';
      }
    }

    const status = $('filterStatus');
    if (status) status.value = state.filters.status;

    const from = $('filterFrom');
    if (from) from.value = state.filters.from;

    const to = $('filterTo');
    if (to) to.value = state.filters.to;
  }

  function activeFilterCount() {
    return ['search', 'disciplina', 'turma', 'status', 'from', 'to'].filter(function (key) {
      return !!state.filters[key];
    }).length;
  }

  function matchesFilters(record) {
    const identification = record.identificacao || {};
    const filters = state.filters;

    if (
      filters.search &&
      searchKey(identification.professor).indexOf(searchKey(filters.search)) === -1
    ) {
      return false;
    }
    if (filters.disciplina && clean(identification.disciplina) !== filters.disciplina) {
      return false;
    }
    if (filters.turma && clean(identification.turma) !== filters.turma) {
      return false;
    }
    if (filters.status && record.status !== filters.status) {
      return false;
    }

    const date = clean(identification.data);
    if (filters.from && (!date || date < filters.from)) return false;
    if (filters.to && (!date || date > filters.to)) return false;

    return true;
  }

  function resetFilters() {
    state.filters = {
      search: '',
      disciplina: '',
      turma: '',
      status: '',
      from: '',
      to: ''
    };
    state.reportsSearch = '';
    syncHistoryControls();
    renderHistory();
    renderReports();
  }

  function buildMetaItem(label, value) {
    const item = el('div', 'record-meta-item');
    item.appendChild(el('span', 'record-meta-label', label));
    item.appendChild(el('span', 'record-meta-value', value || 'Não informado'));
    return item;
  }

  function buildRecordCard(record, mode) {
    const identification = record.identificacao || {};
    const card = el('article', 'record-card');

    const header = el('div', 'record-card-header');
    const person = el('div', 'record-person');
    person.appendChild(el('span', 'person-avatar', initials(identification.professor)));

    const textWrap = el('div');
    textWrap.appendChild(
      el('h3', 'record-title', clean(identification.professor) || 'Professor(a) não informado')
    );

    const subtitle = el('p', 'record-subtitle');
    subtitle.appendChild(
      el(
        'span',
        'record-tag record-tag--discipline',
        clean(identification.disciplina) || 'Disciplina não informada'
      )
    );
    subtitle.appendChild(
      el('span', 'record-tag', clean(identification.turma) || 'Turma não informada')
    );
    subtitle.appendChild(el('span', 'record-tag', formatDateBR(identification.data)));
    textWrap.appendChild(subtitle);
    person.appendChild(textWrap);

    header.appendChild(person);
    header.appendChild(statusBadge(record.status));
    card.appendChild(header);

    const meta = el('div', 'record-meta');
    meta.appendChild(buildMetaItem('Data', formatDateBR(identification.data)));
    meta.appendChild(
      buildMetaItem('Horário', clean(identification.horario) || 'Não informado')
    );
    meta.appendChild(
      buildMetaItem(
        'Orientador(a)',
        clean(identification.observador) || 'Não informado'
      )
    );
    meta.appendChild(
      buildMetaItem('Respostas', getAnsweredCount(record) + ' de ' + TOTAL_QUESTIONS)
    );
    card.appendChild(meta);

    if (clean(identification.tema)) {
      card.appendChild(el('p', 'record-objective', 'Tema ou objetivo: ' + clean(identification.tema)));
    }

    const footer = el('div', 'record-footer');
    const updated = el('span', 'record-updated');
    updated.appendChild(document.createTextNode('Atualizado em '));
    updated.appendChild(el('strong', null, formatDateTimeBR(record.updatedAt)));
    footer.appendChild(updated);

    const actions = el('div', 'record-actions');

    if (record.status === 'concluida') {
      actions.appendChild(
        makeButton('Visualizar', 'open-report', { id: record.id }, 'btn-secondary', 'i-eye')
      );
      actions.appendChild(
        makeButton('Editar', 'edit-record', { id: record.id }, 'btn-ghost', 'i-edit')
      );
      if (mode === 'reports') {
        actions.appendChild(
          makeButton('Imprimir', 'print-record', { id: record.id }, 'btn-ghost', 'i-printer')
        );
      }
    } else {
      actions.appendChild(
        makeButton('Continuar', 'open-record', { id: record.id }, 'btn-secondary', 'i-arrow-right')
      );
      actions.appendChild(
        makeButton('Prévia', 'open-report', { id: record.id }, 'btn-ghost', 'i-eye')
      );
    }

    if (mode === 'history') {
      actions.appendChild(
        makeButton('Excluir', 'delete-record', { id: record.id }, 'btn-ghost', 'i-trash')
      );
    }

    footer.appendChild(actions);
    card.appendChild(footer);
    return card;
  }

  function renderHistory() {
    const list = $('historyList');
    const countLabel = $('historyCount');
    if (!list || !countLabel) return;

    const all = sortedObservations();
    const filtered = all.filter(matchesFilters);
    const active = activeFilterCount();

    countLabel.textContent = active
      ? filtered.length + ' de ' + all.length + ' ' + plural(all.length, 'observação', 'observações')
      : all.length + ' ' + plural(all.length, 'observação', 'observações');

    clearNode(list);

    if (!all.length) {
      list.appendChild(
        buildEmptyState({
          icon: 'i-history',
          title: 'Nenhuma observação registrada',
          text: 'Os registros salvos neste navegador aparecerão aqui. Comece uma nova observação.',
          actions: [
            {
              label: 'Nova observação',
              action: 'new-observation',
              primary: true,
              icon: 'i-plus'
            }
          ]
        })
      );
      return;
    }

    if (!filtered.length) {
      list.appendChild(
        buildEmptyState({
          icon: 'i-search',
          title: 'Nenhum registro encontrado',
          text: 'Não há observações que correspondam aos filtros informados. Ajuste a busca ou limpe os filtros.',
          actions: [
            {
              label: 'Limpar filtros',
              action: 'clear-filters',
              icon: 'i-refresh'
            }
          ]
        })
      );
      return;
    }

    filtered.forEach(function (record) {
      list.appendChild(buildRecordCard(record, 'history'));
    });
  }

  function syncReportsControl() {
    const search = $('reportsSearch');
    if (search && document.activeElement !== search) {
      search.value = state.reportsSearch;
    }
  }

  function renderReports() {
    const list = $('reportsList');
    const countLabel = $('reportsCount');
    if (!list || !countLabel) return;

    syncReportsControl();

    const concluded = sortedObservations().filter(function (record) {
      return record.status === 'concluida';
    });
    const term = searchKey(state.reportsSearch);
    const filtered = concluded.filter(function (record) {
      return !term || searchKey(record.identificacao && record.identificacao.professor).indexOf(term) !== -1;
    });

    countLabel.textContent =
      filtered.length +
      ' ' +
      plural(filtered.length, 'relatório', 'relatórios') +
      (term ? ' de ' + concluded.length : '');

    clearNode(list);

    if (!concluded.length) {
      list.appendChild(
        buildEmptyState({
          icon: 'i-file',
          title: 'Nenhum relatório concluído',
          text: 'Conclua uma observação para gerar um relatório. Rascunhos ficam disponíveis no histórico.',
          actions: [
            {
              label: 'Nova observação',
              action: 'new-observation',
              primary: true,
              icon: 'i-plus'
            },
            {
              label: 'Consultar histórico',
              action: 'nav',
              dataset: { view: 'history' },
              icon: 'i-history'
            }
          ]
        })
      );
      return;
    }

    if (!filtered.length) {
      list.appendChild(
        buildEmptyState({
          icon: 'i-search',
          title: 'Nenhum relatório encontrado',
          text: 'Não há relatórios concluídos com esse nome de professor(a).',
          actions: [
            {
              label: 'Limpar busca',
              action: 'clear-reports-search',
              icon: 'i-refresh'
            }
          ]
        })
      );
      return;
    }

    filtered.forEach(function (record) {
      list.appendChild(buildRecordCard(record, 'reports'));
    });
  }

  function renderSettings() {
    const nameInput = $('settingsSchoolName');
    const unitInput = $('settingsSchoolUnit');
    const cityInput = $('settingsCity');
    if (!nameInput || !unitInput || !cityInput) return;

    nameInput.value = state.settings.schoolName || '';
    unitInput.value = state.settings.schoolUnit || '';
    cityInput.value = state.settings.city || '';

    renderSidebarSchool();
    updateStoragePanel();
  }

  async function handleSettingsSubmit(event) {
    event.preventDefault();
    state.settings = normalizeSettings({
      schoolName: clean($('settingsSchoolName').value),
      schoolUnit: clean($('settingsSchoolUnit').value),
      city: clean($('settingsCity').value)
    });
    const saved = await saveSettingsToStorage();
    renderSidebarSchool();
    renderSettings();

    if (saved) {
      showToast(
        state.mode === 'cloud'
          ? 'Configurações salvas no servidor. A identificação da escola será usada nos relatórios.'
          : 'Configurações salvas. A identificação da escola será usada nos próximos relatórios.',
        'success'
      );
      return;
    }

    showToast(
      state.mode === 'cloud'
        ? 'As configurações valem apenas nesta sessão: o servidor não confirmou a gravação.'
        : 'Configurações aplicadas apenas nesta sessão. Não foi possível gravar no navegador.',
      'error'
    );
  }

  /* =======================================================================
   * 3.1 BACKUP, IMPORTAÇÃO E LIMPEZA
   * ===================================================================== */

  function downloadBackup(backup, prefix) {
    const text = JSON.stringify(backup, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = (prefix || 'observaedu-backup-') + stamp + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function handleExportBackup() {
    const backup = Storage.createBackup(state.observations, state.settings);
    downloadBackup(backup, 'observaedu-backup-');

    showToast(
      (state.mode === 'cloud' ? 'Backup dos registros da nuvem exportado com ' : 'Backup exportado com ') +
        state.observations.length +
        ' ' +
        plural(state.observations.length, 'registro', 'registros') +
        '.',
      'success'
    );
  }

  // Exporta exclusivamente os registros antigos do localStorage, mesmo no
  // modo nuvem, para que a migração nunca dependa de uma única cópia.
  function handleExportLocalBackup() {
    const local = Storage.getLocalRecords();
    if (!local.ok) {
      showToast(
        local.error || 'Não foi possível ler os registros locais deste navegador.',
        'error'
      );
      return;
    }

    const settings = Storage.loadSettings();
    const backup = Storage.createBackup(local.records, settings.ok ? settings.data : {});
    downloadBackup(backup, 'observaedu-dados-locais-');

    showToast(
      'Backup dos dados locais exportado com ' +
        local.records.length +
        ' ' +
        plural(local.records.length, 'registro', 'registros') +
        '. Nada foi apagado.',
      'success'
    );
  }

  async function processImportedBackup(text) {
    const parsed = Storage.parseBackup(text);
    if (!parsed.ok) {
      showToast(parsed.error, 'error');
      return;
    }

    const records = dedupeRecords(parsed.data.observations.map(normalizeRecord));
    const exportedAt = parsed.data.exportedAt
      ? formatDateTimeBR(parsed.data.exportedAt)
      : 'data não informada';
    const settings = normalizeSettings(parsed.data.settings);
    const hasSettings =
      parsed.data.settings && Object.keys(parsed.data.settings).length > 0;
    const cloud = state.mode === 'cloud';

    const confirmed = await askConfirm({
      title: cloud ? 'Importar backup para a nuvem' : 'Importar backup',
      message: cloud
        ? 'O arquivo contém ' +
          records.length +
          ' ' +
          plural(records.length, 'registro', 'registros') +
          ' (exportado em ' +
          exportedAt +
          '). A importação vai MESCLAR os registros por identificador no Supabase: ' +
          'itens com o mesmo id serão atualizados e os demais serão mantidos. ' +
          (hasSettings ? 'As configurações da escola do arquivo também serão gravadas. ' : '') +
          'Nada será apagado automaticamente. Deseja continuar?'
        : 'O arquivo contém ' +
          records.length +
          ' ' +
          plural(records.length, 'registro', 'registros') +
          ' (exportado em ' +
          exportedAt +
          '). A importação substituirá todos os registros e configurações atuais deste navegador. Deseja continuar?',
      confirmLabel: cloud ? 'Mesclar na nuvem' : 'Importar e substituir',
      danger: !cloud
    });
    if (!confirmed) return;

    if (cloud) {
      const result = await Storage.saveObservationsAsync(records);
      let settingsSaved = true;

      if (hasSettings) {
        state.settings = settings;
        settingsSaved = await saveSettingsToStorage();
      }

      await loadData();
      renderAll();
      syncHistoryControls();
      renderSettings();
      applyModeUi();

      if (!result.ok) {
        showToast(
          'Importação parcial: ' +
            result.saved +
            ' ' +
            plural(result.saved, 'registro gravado', 'registros gravados') +
            ', ' +
            result.failed +
            ' falharam. Consulte os avisos e tente novamente.',
          'error'
        );
        showBanner(
          (result.errors && result.errors[0] && result.errors[0].error) ||
            'Alguns registros não foram gravados no servidor. Nenhum dado local foi apagado.'
        );
        return;
      }

      showToast(
        'Backup mesclado na nuvem: ' +
          result.saved +
          ' ' +
          plural(result.saved, 'registro gravado', 'registros gravados') +
          (settingsSaved ? '.' : ' (configurações não confirmadas).'),
        settingsSaved ? 'success' : 'warning'
      );
      return;
    }

    state.observations = records.sort(sortByUpdated);
    state.settings = settings;
    state.currentReportId = null;
    state.reportSnapshot = null;
    discardForm();
    state.filters = {
      search: '',
      disciplina: '',
      turma: '',
      status: '',
      from: '',
      to: ''
    };
    state.reportsSearch = '';

    const observationsSaved = await saveObservationsToStorage();
    const settingsSaved = await saveSettingsToStorage();
    renderAll();
    syncHistoryControls();
    renderSettings();
    applyModeUi();

    const fullySaved = observationsSaved && settingsSaved;
    showToast(
      fullySaved
        ? 'Backup importado. ' + records.length + ' ' + plural(records.length, 'registro restaurado', 'registros restaurados') + '.'
        : 'Backup carregado apenas nesta sessão. Não foi possível gravar no navegador.',
      fullySaved ? 'success' : 'error'
    );
  }

  function handleImportFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function () {
      processImportedBackup(String(reader.result || '')).finally(function () {
        input.value = '';
      });
    };
    reader.onerror = function () {
      showToast('Não foi possível ler o arquivo selecionado.', 'error');
      input.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  async function handleClearData() {
    const cloud = state.mode === 'cloud';
    const confirmed = await askConfirm({
      title: cloud ? 'Apagar dados da nuvem' : 'Apagar todos os dados',
      message: cloud
        ? 'Todos os registros e configurações desta conta no Supabase serão apagados. ' +
          'Os registros antigos salvos neste navegador serão PRESERVADOS e continuarão ' +
          'disponíveis para migração. Esta ação não pode ser desfeita. Recomendamos exportar ' +
          'um backup antes. Deseja continuar?'
        : 'Todos os registros e configurações deste navegador serão apagados. ' +
          'Esta ação não pode ser desfeita. Recomendamos exportar um backup antes. Deseja continuar?',
      confirmLabel: cloud ? 'Apagar dados da nuvem' : 'Apagar todos os dados',
      danger: true
    });
    if (!confirmed) return;

    if (cloud) {
      const result = await Storage.clearCloudData();
      if (!result.ok) {
        showBanner(
          (result.error || 'Não foi possível apagar os dados da nuvem.') +
            ' Nenhum registro foi removido da interface.'
        );
        showToast('A nuvem não confirmou a limpeza. Tente novamente.', 'error');
        return;
      }

      state.observations = [];
      state.settings = normalizeSettings({});
      state.currentReportId = null;
      state.reportSnapshot = null;
      discardForm();
      state.filters = {
        search: '',
        disciplina: '',
        turma: '',
        status: '',
        from: '',
        to: ''
      };
      state.reportsSearch = '';
      state.pendingCloudWrite = false;

      renderAll();
      syncHistoryControls();
      renderSettings();
      applyModeUi();
      showToast(
        'Dados da nuvem apagados. Os registros locais deste navegador foram preservados.',
        'success'
      );
      return;
    }

    const result = Storage.clearAll();
    state.observations = [];
    state.settings = normalizeSettings({});
    state.currentReportId = null;
    state.reportSnapshot = null;
    discardForm();
    state.filters = {
      search: '',
      disciplina: '',
      turma: '',
      status: '',
      from: '',
      to: ''
    };
    state.reportsSearch = '';

    renderAll();
    syncHistoryControls();
    renderSettings();
    applyModeUi();

    if (result.ok) {
      showToast('Todos os dados deste navegador foram apagados.', 'success');
    } else {
      showBanner(
        (result.error || 'Não foi possível apagar os dados do armazenamento.') +
          ' Os dados desta sessão foram removidos da memória; recarregue a página para conferir o navegador.'
      );
      showToast('Dados da sessão removidos, mas o navegador não confirmou a limpeza.', 'error');
    }
  }

  /* =======================================================================
   * 3.2 MIGRAÇÃO EXPLÍCITA DOS REGISTROS LOCAIS PARA A NUVEM
   * ===================================================================== */

  async function handleMigrateLocal() {
    if (state.mode !== 'cloud') {
      showToast('A migração exige a integração com o Supabase configurada e uma sessão ativa.', 'warning');
      return;
    }
    if (state.migrationBusy) return;

    const local = Storage.getLocalRecords();
    if (!local.ok) {
      showToast(
        local.error || 'Não foi possível ler os registros locais deste navegador.',
        'error'
      );
      return;
    }

    const count = local.records.length;
    if (!count) {
      showToast('Não há registros locais antigos para migrar.', 'info');
      return;
    }

    const confirmed = await askConfirm({
      title: 'Migrar registros locais',
      message:
        'Foram encontrados ' +
        count +
        ' ' +
        plural(count, 'registro local', 'registros locais') +
        '. Eles serão validados e enviados ao Supabase. Registros com o mesmo identificador ' +
        'já existente na nuvem serão ignorados. Os dados locais NÃO serão apagados e você ' +
        'pode continuar usando o sistema durante a migração. Deseja migrar agora?',
      confirmLabel: 'Migrar para a nuvem'
    });
    if (!confirmed) return;

    state.migrationBusy = true;
    const button = $('migrateButton');
    const buttonLabel = $('migrateButtonLabel');
    if (button) button.disabled = true;
    if (buttonLabel) buttonLabel.textContent = 'Migrando...';

    try {
      const result = await Storage.migrateLocalToCloud();
      await loadData();
      renderAll();
      syncHistoryControls();
      renderSettings();
      applyModeUi();

      if (!result.ok && !result.imported && !result.skipped && !result.failed) {
        showToast(result.error || 'A migração não foi concluída.', 'error');
        showBanner(result.error || 'A migração não foi concluída. Nenhum dado local foi apagado.');
        return;
      }

      showToast(
        'Migração concluída: ' +
          result.imported +
          ' importado(s), ' +
          result.skipped +
          ' já existente(s), ' +
          result.failed +
          ' com falha. Dados locais preservados.',
        result.failed ? 'warning' : 'success'
      );

      if (result.failed) {
        const firstError = result.errors && result.errors[0];
        showBanner(
          'Alguns registros não puderam ser migrados. ' +
            (firstError ? 'Exemplo (' + firstError.id + '): ' + firstError.error : '') +
            ' Os dados locais foram preservados; você pode tentar novamente.'
        );
      }
    } finally {
      state.migrationBusy = false;
      if (buttonLabel) buttonLabel.textContent = 'Migrar registros locais';
      updateMigrationPreview();
    }
  }


  /* =======================================================================
   * 4. FORMULÁRIO: ESTRUTURA, NAVEGAÇÃO E SALVAMENTO
   * ===================================================================== */

  function buildFormStructure() {
    buildStepper();
    CONFIG.sections.forEach(buildQuestionSection);
    buildComplementaryFields();
    buildAnalysisFields();
  }

  function buildStepper() {
    const container = $('formStepper');
    if (!container) return;
    clearNode(container);

    STEPS.forEach(function (step) {
      const section = CONFIG.sections.find(function (item) {
        return item.step === step.number;
      });
      const hint = section ? section.questions.length + ' perguntas' : step.hint;

      const button = el('button', 'step-button');
      button.type = 'button';
      button.dataset.action = 'goto-step';
      button.dataset.step = String(step.number);
      button.appendChild(el('span', 'step-number', String(step.number)));

      const text = el('span', 'step-text');
      text.appendChild(el('strong', null, step.title));
      text.appendChild(el('small', null, hint));
      button.appendChild(text);
      container.appendChild(button);
    });
  }

  function buildQuestionSection(section) {
    const panel = document.querySelector(
      '#formStepPanels .form-step[data-step="' + section.step + '"]'
    );
    if (!panel) return;
    clearNode(panel);

    const heading = el('div', 'section-heading');
    const headingText = el('div');
    headingText.appendChild(el('p', 'eyebrow', 'Etapa ' + section.step));
    headingText.appendChild(el('h2', 'section-title', section.title));
    headingText.appendChild(el('p', 'section-description', section.description));
    heading.appendChild(headingText);
    panel.appendChild(heading);

    const card = el('div', 'card form-card');

    const sectionHeader = el('div', 'question-section-heading');
    const sectionHeaderText = el('div');
    sectionHeaderText.appendChild(
      el('h3', null, section.title + ' — ' + section.questions.length + ' perguntas')
    );
    sectionHeaderText.appendChild(
      el(
        'p',
        null,
        'Escolha uma resposta para cada pergunta. "Não observado / Não se aplica" não é tratado como falha.'
      )
    );
    sectionHeader.appendChild(sectionHeaderText);

    const answered = el(
      'span',
      'answered-count',
      '0/' + section.questions.length + ' respondidas'
    );
    answered.dataset.count = section.id;
    sectionHeader.appendChild(answered);
    card.appendChild(sectionHeader);

    section.questions.forEach(function (question, index) {
      const questionCard = el('div', 'question-card');
      questionCard.dataset.questionCard = question.id;

      const header = el('div', 'question-header');
      header.appendChild(el('span', 'question-number', String(index + 1)));
      header.appendChild(el('p', 'question-text', question.text));
      questionCard.appendChild(header);

      const answers = el('div', 'answers');
      answers.setAttribute('role', 'radiogroup');
      answers.setAttribute('aria-label', question.text);

      CONFIG.answerOptions.forEach(function (option) {
        const label = el('label', 'answer-option');
        label.dataset.tone = option.tone;

        const input = el('input');
        input.type = 'radio';
        input.name = 'answer_' + question.id;
        input.value = option.value;
        input.id = 'answer_' + question.id + '_' + option.value;
        input.dataset.question = question.id;
        input.setAttribute(
          'aria-label',
          option.label + ' — ' + question.text
        );

        label.appendChild(input);
        label.appendChild(el('span', 'answer-pill', option.label));
        answers.appendChild(label);
      });

      questionCard.appendChild(answers);
      card.appendChild(questionCard);
    });

    const comments = el('div', 'comments-block');
    const commentsField = el('div', 'field');
    const commentsLabel = el('label', null, section.commentLabel);
    commentsLabel.htmlFor = 'comment_' + section.id;

    const commentsArea = el('textarea');
    commentsArea.id = 'comment_' + section.id;
    commentsArea.rows = 4;
    commentsArea.maxLength = 4000;
    commentsArea.dataset.comment = section.id;
    commentsArea.placeholder = section.commentPlaceholder;

    commentsField.appendChild(commentsLabel);
    commentsField.appendChild(commentsArea);
    commentsField.appendChild(
      el('p', 'field-help', 'Opcional. Registre apenas evidências e contextos observados.')
    );
    comments.appendChild(commentsField);
    card.appendChild(comments);

    panel.appendChild(card);
  }

  function buildComplementaryFields() {
    const container = $('complementaryFields');
    if (!container) return;
    clearNode(container);

    CONFIG.complementaryFields.forEach(function (field) {
      const wrapper = el('div', 'field');
      const label = el('label', null, field.label);
      label.htmlFor = 'comp_' + field.key;

      const textarea = el('textarea');
      textarea.id = 'comp_' + field.key;
      textarea.rows = 4;
      textarea.maxLength = 4000;
      textarea.dataset.complementary = field.key;
      textarea.placeholder = field.placeholder;

      wrapper.appendChild(label);
      wrapper.appendChild(textarea);
      wrapper.appendChild(
        el('p', 'field-help', 'Opcional. Use apenas informações registradas durante a observação.')
      );
      container.appendChild(wrapper);
    });
  }

  function buildAnalysisFields() {
    const container = $('analysisFields');
    if (!container) return;
    clearNode(container);

    CONFIG.analysisFields.forEach(function (field) {
      const wrapper = el(
        'div',
        'analysis-field' + (field.key === 'sintese' ? ' analysis-field--sintese' : '')
      );
      const label = el('label', null, field.label);
      label.htmlFor = 'analysis_' + field.key;

      const textarea = el('textarea');
      textarea.id = 'analysis_' + field.key;
      textarea.rows = field.key === 'sintese' ? 8 : 6;
      textarea.maxLength = 12000;
      textarea.dataset.analysis = field.key;

      wrapper.appendChild(label);
      wrapper.appendChild(textarea);
      wrapper.appendChild(el('p', 'field-help', field.help));
      container.appendChild(wrapper);
    });
  }

  function fillFormFromState() {
    if (!state.form) return;
    const record = state.form;

    document.querySelectorAll('[data-field]').forEach(function (input) {
      input.value = stringValue(record.identificacao[input.dataset.field]);
    });

    document.querySelectorAll('[data-question]').forEach(function (input) {
      input.checked = record.respostas[input.dataset.question] === input.value;
    });

    document.querySelectorAll('[data-comment]').forEach(function (textarea) {
      textarea.value = stringValue(record.comentarios[textarea.dataset.comment]);
    });

    document.querySelectorAll('[data-complementary]').forEach(function (textarea) {
      textarea.value = stringValue(record.complementares[textarea.dataset.complementary]);
    });

    refreshQuestionUI();
    clearFormErrors();
    ensureAnalysis();
    setAnalysisFieldValues();
    renderAnalysisFacts();
    renderAnalysisStatus();
    renderReportSummary();
    setFormStep(state.formStep, { scroll: false });
    updateFormChrome();
  }

  function refreshQuestionUI() {
    if (!state.form) return;
    CONFIG.sections.forEach(function (section) {
      let answered = 0;
      section.questions.forEach(function (question) {
        const value = state.form.respostas[question.id];
        if (answerIsValid(value)) answered += 1;

        const card = document.querySelector(
          '[data-question-card="' + question.id + '"]'
        );
        if (card) card.classList.toggle('is-answered', answerIsValid(value));
      });

      const counter = document.querySelector('[data-count="' + section.id + '"]');
      if (counter) {
        counter.textContent =
          answered + '/' + section.questions.length + ' respondidas';
      }
    });
  }

  function isStepComplete(step) {
    if (!state.form) return false;
    const record = state.form;

    if (step === 1) {
      return missingRequiredFields(record).length === 0;
    }

    const section = CONFIG.sections.find(function (item) {
      return item.step === step;
    });
    if (section) {
      return section.questions.every(function (question) {
        return answerIsValid(record.respostas[question.id]);
      });
    }

    if (step === 5) {
      return CONFIG.complementaryFields.some(function (field) {
        return clean(record.complementares[field.key]);
      });
    }
    if (step === 6) return !!record.analise;
    if (step === 7) return record.status === 'concluida';
    return false;
  }

  function getStepHint(step) {
    if (!state.form) return '';
    if (step === 1) {
      const missing = missingRequiredFields(state.form).length;
      return missing
        ? missing + ' ' + plural(missing, 'campo obrigatório pendente', 'campos obrigatórios pendentes')
        : 'Campos obrigatórios preenchidos';
    }

    const section = CONFIG.sections.find(function (item) {
      return item.step === step;
    });
    if (section) {
      const total = section.questions.length;
      const answered = section.questions.filter(function (question) {
        return answerIsValid(state.form.respostas[question.id]);
      }).length;
      return answered + ' de ' + total + ' perguntas respondidas';
    }

    if (step === 5) return 'Todos os campos são opcionais';
    if (step === 6) return 'Revise os textos da análise antes de concluir';
    if (step === 7) {
      const validation = getValidation(state.form);
      return validation.valid
        ? 'Tudo pronto para gerar o relatório'
        : 'Ainda há pendências para concluir';
    }
    return '';
  }

  function updateStepper() {
    document.querySelectorAll('#formStepper .step-button').forEach(function (button) {
      const step = Number(button.dataset.step);
      const isActive = step === state.formStep;
      button.classList.toggle('is-active', isActive);
      button.classList.toggle('is-complete', !isActive && isStepComplete(step));
      if (isActive) {
        button.setAttribute('aria-current', 'step');
      } else {
        button.removeAttribute('aria-current');
      }
    });
  }

  function updateFormChrome() {
    if (!state.form) return;
    const record = state.form;
    const identification = record.identificacao || {};
    const meta = CONFIG.statuses[record.status] || CONFIG.statuses.rascunho;

    const eyebrow = $('formEyebrow');
    const title = $('formTitle');
    const subtitle = $('formSubtitle');
    const badge = $('formStatusBadge');

    if (eyebrow) {
      eyebrow.textContent = state.formIsNew
        ? 'Nova observação'
        : record.status === 'concluida'
          ? 'Editando observação concluída'
          : 'Editando observação';
    }

    if (title) {
      title.textContent = clean(identification.professor)
        ? 'Observação — ' + clean(identification.professor)
        : 'Registro de observação';
    }

    if (subtitle) {
      const details = [clean(identification.disciplina), clean(identification.turma)]
        .filter(Boolean)
        .join(' · ');
      subtitle.textContent =
        (details || 'Preencha a identificação e as etapas da observação.') +
        (state.formDirty ? ' · Alterações não salvas' : '');
    }

    if (badge) {
      badge.className = 'badge badge--' + meta.tone;
      badge.textContent = meta.label;
    }

    const answered = getAnsweredCount(record);
    const percent = TOTAL_QUESTIONS
      ? Math.round((answered / TOTAL_QUESTIONS) * 100)
      : 0;
    const progressText = $('progressText');
    const progressPercent = $('progressPercent');
    const progressBar = $('progressBar');
    const progressTrack = $('progressTrack');

    if (progressText) {
      progressText.textContent =
        answered + ' de ' + TOTAL_QUESTIONS + ' perguntas respondidas';
    }
    if (progressPercent) progressPercent.textContent = percent + '%';
    if (progressBar) progressBar.style.width = percent + '%';
    if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(percent));

    const saveLabel = document.querySelector('[data-action="save-draft"] span');
    if (saveLabel) {
      saveLabel.textContent =
        record.status === 'concluida' ? 'Salvar alterações' : 'Salvar rascunho';
    }

    const prev = $('formPrev');
    const next = $('formNext');
    const nextLabel = next ? next.querySelector('span') : null;
    const hint = $('formNavHint');

    if (prev) prev.disabled = state.formStep <= 1;
    if (next) next.disabled = state.formStep >= 7;
    if (nextLabel) {
      nextLabel.textContent =
        state.formStep === 6 ? 'Revisar' : state.formStep >= 7 ? 'Última etapa' : 'Próximo';
    }
    if (hint) hint.textContent = getStepHint(state.formStep);

    updateStepper();
  }

  function setFormStep(step, options) {
    if (!state.form) return;
    const target = Math.max(1, Math.min(7, Number(step) || 1));
    state.formStep = target;

    document.querySelectorAll('#formStepPanels .form-step').forEach(function (panel) {
      panel.hidden = Number(panel.dataset.step) !== target;
    });

    if (target === 6) {
      ensureAnalysis();
      renderAnalysisFacts();
      setAnalysisFieldValues();
      renderAnalysisStatus();
    }
    if (target === 7) {
      renderReportSummary();
    }

    updateFormChrome();

    const opts = options || {};
    if (opts.scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function clearFormErrors() {
    const box = $('formErrors');
    if (box) {
      box.hidden = true;
      clearNode(box);
    }
    document.querySelectorAll('[data-error-for]').forEach(function (error) {
      error.textContent = '';
    });
    document.querySelectorAll('.question-card.is-missing').forEach(function (card) {
      card.classList.remove('is-missing');
    });
  }

  function showFormErrors(validation) {
    const box = $('formErrors');
    if (!box) return;

    validation.missingRequired.forEach(function (field) {
      const error = document.querySelector('[data-error-for="' + field.key + '"]');
      if (error) error.textContent = 'Campo obrigatório para concluir a observação.';
    });

    validation.unanswered.forEach(function (item) {
      const card = document.querySelector(
        '[data-question-card="' + item.question.id + '"]'
      );
      if (card) card.classList.add('is-missing');
    });

    clearNode(box);
    box.hidden = false;
    box.appendChild(el('h3', null, 'Não foi possível concluir o relatório'));
    const list = el('ul');

    if (validation.missingRequired.length) {
      list.appendChild(
        el(
          'li',
          null,
          'Campos obrigatórios não preenchidos: ' +
            validation.missingRequired
              .map(function (field) {
                return field.label;
              })
              .join('; ') +
            '.'
        )
      );
    }

    if (validation.unanswered.length) {
      list.appendChild(
        el(
          'li',
          null,
          validation.unanswered.length +
            ' ' +
            plural(
              validation.unanswered.length,
              'pergunta ainda está sem resposta',
              'perguntas ainda estão sem resposta'
            ) +
            '. A conclusão exige uma resposta para cada pergunta, inclusive "Não observado / Não se aplica".'
        )
      );
    }

    box.appendChild(list);
    box.appendChild(
      makeButton(
        'Ir para a primeira pendência',
        'goto-step',
        { step: String(validation.firstStep) },
        'btn-secondary btn-sm',
        'i-arrow-right'
      )
    );

    if (typeof box.focus === 'function') box.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function activateForm(record, options) {
    if (!record) return;
    const opts = options || {};
    const existing = state.form && state.form.id === record.id;

    if (!existing) {
      state.form = normalizeRecord(clone(record));
      state.formIsNew = !state.observations.some(function (item) {
        return item.id === record.id;
      });
      state.formDirty = false;
    }

    state.formStep = Math.max(1, Math.min(7, Number(opts.step) || 1));
    if (state.view !== 'form') {
      state.formReturnView = opts.returnView || (state.view === 'report' ? 'reports' : state.view);
    }
    state.reportSnapshot = null;
    fillFormFromState();
    setView('form');
  }

  function startNewObservation() {
    activateForm(createBlankRecord(), {
      step: 1,
      returnView: state.view === 'form' ? state.formReturnView : state.view
    });
  }

  async function persistForm() {
    if (!state.form) return false;
    const record = state.form;

    record.updatedAt = nowIso();
    if (!record.createdAt) record.createdAt = record.updatedAt;
    if (record.status !== 'concluida') record.status = 'rascunho';

    // A análise automática é atualizada sempre que as respostas mudam,
    // a menos que o orientador tenha editado os textos manualmente.
    if (!record.analise || !record.analise.manuallyEdited) {
      record.analise = Analysis.createAnalysisRecord(record);
    }

    const copy = clone(record);
    const index = state.observations.findIndex(function (item) {
      return item.id === record.id;
    });
    if (index >= 0) {
      state.observations[index] = copy;
    } else {
      state.observations.push(copy);
    }
    state.observations.sort(sortByUpdated);
    state.formIsNew = false;

    let saved = false;

    if (state.mode === 'cloud') {
      const result = await Storage.saveObservation(copy);
      saved = !!(result && result.ok);
      state.pendingCloudWrite = !saved;

      if (!saved) {
        state.formDirty = true;
        showBanner(
          (result && result.error
            ? result.error
            : 'O servidor não confirmou a gravação do registro.') +
            ' O conteúdo permanece no formulário e na memória desta sessão; ' +
            'use "Salvar rascunho" novamente quando a conexão voltar.'
        );
      }
    } else {
      saved = await saveObservationsToStorage();
      state.pendingCloudWrite = false;
    }

    if (saved) state.formDirty = false;

    renderAll();
    setAnalysisFieldValues();
    renderAnalysisFacts();
    renderAnalysisStatus();
    renderReportSummary();
    updateFormChrome();
    return saved;
  }

  async function handleSaveDraft() {
    if (!state.form) return;
    const wasConcluded = state.form.status === 'concluida';
    const saved = await persistForm();

    if (!saved) {
      showToast(
        state.mode === 'cloud'
          ? 'A gravação no servidor NÃO foi confirmada. O conteúdo continua neste formulário; tente novamente.'
          : 'Não foi possível gravar no armazenamento do navegador. Os dados continuam apenas nesta sessão.',
        'error'
      );
      return;
    }

    showToast(
      wasConcluded
        ? 'Alterações salvas. Abra o relatório novamente para visualizar a versão atualizada.'
        : state.mode === 'cloud'
          ? 'Rascunho salvo no servidor. Você pode continuar depois pelo Histórico.'
          : 'Rascunho salvo neste navegador. Você pode continuar depois pelo Histórico.',
      'success'
    );
  }

  async function handleCancelForm() {
    const returnView = state.formReturnView || 'dashboard';
    const canLeave = await confirmDiscardForm();
    if (!canLeave) return;
    setView(returnView === 'form' ? 'dashboard' : returnView);
  }

  /* =======================================================================
   * 5. ANÁLISE AUTOMÁTICA E RESUMO FINAL
   * ===================================================================== */

  function ensureAnalysis() {
    if (!state.form) return;
    const current = state.form.analise;

    if (!current) {
      state.form.analise = Analysis.createAnalysisRecord(state.form);
      return;
    }

    // Se o orientador não editou os textos, a análise acompanha as respostas.
    if (!current.manuallyEdited) {
      const signature = Analysis.signature(state.form);
      if (current.sourceSignature !== signature) {
        state.form.analise = Analysis.createAnalysisRecord(state.form);
      }
    }
  }

  function setAnalysisFieldValues() {
    if (!state.form) return;
    CONFIG.analysisFields.forEach(function (field) {
      const textarea = document.querySelector(
        '[data-analysis="' + field.key + '"]'
      );
      if (!textarea) return;
      const value =
        state.form.analise && state.form.analise.narratives
          ? state.form.analise.narratives[field.key]
          : '';
      if (document.activeElement !== textarea) {
        textarea.value = stringValue(value);
      }
    });
  }

  function buildAnalysisDetails(title, entries, emptyText) {
    const details = el('details', 'analysis-details');
    details.appendChild(el('summary', null, title));

    const list = el('ul');
    if (!entries.length) {
      list.appendChild(el('li', null, emptyText));
    } else {
      entries.forEach(function (entry) {
        const item = el('li');
        if (entry.badge) {
          item.appendChild(
            el(
              'span',
              'analysis-list-badge analysis-list-badge--' + entry.tone,
              entry.badge
            )
          );
        }
        item.appendChild(el('span', null, entry.text));
        list.appendChild(item);
      });
    }

    details.appendChild(list);
    return details;
  }

  function renderAnalysisFacts() {
    const container = $('analysisFacts');
    if (!container || !state.form) return;

    const result = Analysis.analyze(state.form);
    const totals = result.totals;

    clearNode(container);

    const summary = el('div', 'fact-summary-grid');
    [
      { label: 'Aplicáveis', value: totals.applicable, tone: '' },
      { label: 'Sim', value: totals.sim, tone: 'fact-summary--green' },
      { label: 'Parcialmente', value: totals.parcial, tone: 'fact-summary--amber' },
      { label: 'Não', value: totals.nao, tone: '' },
      { label: 'Não obs. / N/A', value: totals.na, tone: 'fact-summary--gray' },
      { label: 'Sem resposta', value: totals.unanswered, tone: 'fact-summary--gray' }
    ].forEach(function (item) {
      const box = el('div', 'fact-summary ' + item.tone);
      box.appendChild(el('span', null, item.label));
      box.appendChild(el('strong', null, String(item.value)));
      summary.appendChild(box);
    });
    container.appendChild(summary);

    const tableWrap = el('div', 'facts-table-wrap');
    const table = el('table', 'facts-table');
    table.appendChild(
      el('caption', 'sr-only', 'Quantidade de respostas por etapa da observação')
    );

    const thead = el('thead');
    const headRow = el('tr');
    ['Etapa', 'Sim', 'Parc.', 'Não', 'N/NA', 'Aplic.'].forEach(function (label) {
      headRow.appendChild(el('th', null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    result.sections.forEach(function (section) {
      const row = el('tr');
      row.appendChild(el('th', null, section.title));
      row.appendChild(el('td', null, String(section.counts.sim)));
      row.appendChild(el('td', null, String(section.counts.parcial)));
      row.appendChild(el('td', null, String(section.counts.nao)));
      row.appendChild(el('td', null, String(section.counts.na)));
      row.appendChild(el('td', null, String(section.counts.applicable)));
      tbody.appendChild(row);
    });

    const totalRow = el('tr', 'facts-total');
    totalRow.appendChild(el('th', null, 'Total'));
    totalRow.appendChild(el('td', null, String(totals.sim)));
    totalRow.appendChild(el('td', null, String(totals.parcial)));
    totalRow.appendChild(el('td', null, String(totals.nao)));
    totalRow.appendChild(el('td', null, String(totals.na)));
    totalRow.appendChild(el('td', null, String(totals.applicable)));
    tbody.appendChild(totalRow);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);

    container.appendChild(
      el(
        'p',
        'analysis-caption',
        'N/NA = Não observado / Não se aplica. Essas respostas aparecem no relatório, mas não são contabilizadas como práticas negativas.'
      )
    );

    const positives = [];
    const attention = [];
    const notObserved = [];
    const unanswered = [];

    result.sections.forEach(function (section) {
      section.positives.forEach(function (question) {
        positives.push({ text: '[' + section.title + '] ' + question.text });
      });
      section.attention.forEach(function (item) {
        attention.push({
          badge: item.value === 'parcial' ? 'Parcial' : 'Não',
          tone: item.value === 'parcial' ? 'warning' : 'danger',
          text: '[' + section.title + '] ' + item.question.text
        });
      });
      section.notObserved.forEach(function (question) {
        notObserved.push({ text: '[' + section.title + '] ' + question.text });
      });
      section.unanswered.forEach(function (question) {
        unanswered.push({ text: '[' + section.title + '] ' + question.text });
      });
    });

    container.appendChild(
      buildAnalysisDetails(
        'Práticas assinaladas como "Sim" (' + positives.length + ')',
        positives,
        'Nenhuma prática foi assinalada como "Sim" nos registros atuais.'
      )
    );
    container.appendChild(
      buildAnalysisDetails(
        'Respostas "Parcialmente" ou "Não" (' + attention.length + ')',
        attention,
        'Nenhuma resposta foi assinalada como "Parcialmente" ou "Não".'
      )
    );
    container.appendChild(
      buildAnalysisDetails(
        'Não observado / Não se aplica (' + notObserved.length + ')',
        notObserved,
        'Nenhuma resposta foi assinalada como "Não observado / Não se aplica".'
      )
    );
    container.appendChild(
      buildAnalysisDetails(
        'Perguntas sem resposta (' + unanswered.length + ')',
        unanswered,
        'Todas as perguntas foram respondidas.'
      )
    );
  }

  function renderAnalysisStatus() {
    const container = $('analysisStatus');
    if (!container || !state.form) return;

    clearNode(container);
    const analysis = state.form.analise;
    const result = Analysis.analyze(state.form);
    const stale = Analysis.isStale(state.form);

    let tone = '';
    let icon = 'i-info';
    let title = 'Análise automática por regras.';
    let message =
      'Gerada a partir de ' +
      result.totals.answered +
      ' ' +
      plural(result.totals.answered, 'resposta registrada', 'respostas registradas') +
      '. Não utiliza inteligência artificial externa.';

    if (!analysis) {
      tone = 'analysis-status--warning';
      icon = 'i-alert';
      title = 'Análise ainda não gerada.';
      message = 'Use "Recalcular análise" para gerar os textos a partir das respostas atuais.';
    } else if (stale) {
      tone = 'analysis-status--danger';
      icon = 'i-alert';
      title = 'Análise desatualizada.';
      message =
        'As respostas foram alteradas depois da edição manual da análise. ' +
        'Revise os textos ou use "Recalcular análise" antes de concluir o relatório.';
    } else if (analysis.manuallyEdited) {
      tone = 'analysis-status--warning';
      icon = 'i-edit';
      title = 'Textos editados manualmente.';
      message =
        'A análise automática foi revisada pelo orientador em ' +
        formatDateTimeBR(analysis.editedAt || analysis.generatedAt) +
        '. As respostas originais continuam transcritas nas seções 2 a 4 do relatório.';
    } else if (result.totals.answered === 0) {
      tone = 'analysis-status--warning';
      icon = 'i-alert';
      title = 'Ainda não há respostas registradas.';
      message =
        'A análise registra essa ausência de dados e não faz conclusões sobre práticas não observadas. ' +
        'Responda às perguntas para gerar uma leitura mais completa.';
    } else if (analysis && analysis.generatedAt) {
      message =
        'Gerada em ' +
        formatDateTimeBR(analysis.generatedAt) +
        ' a partir de ' +
        result.totals.answered +
        ' ' +
        plural(result.totals.answered, 'resposta registrada', 'respostas registradas') +
        '. Não utiliza inteligência artificial externa.';
    }

    const box = el('div', 'analysis-status ' + tone);
    box.appendChild(svgIcon(icon));
    const text = el('div');
    const paragraph = el('p');
    paragraph.appendChild(el('strong', null, title + ' '));
    paragraph.appendChild(document.createTextNode(message));
    text.appendChild(paragraph);
    if (result.totals.na > 0 && !stale) {
      text.appendChild(
        el(
          'p',
          null,
          'As ' +
            result.totals.na +
            ' ' +
            plural(result.totals.na, 'resposta', 'respostas') +
            ' "Não observado / Não se aplica" não foram tratadas como falha.'
        )
      );
    }
    box.appendChild(text);
    container.appendChild(box);
  }

  function summaryTile(label, value, small, tone, icon) {
    const tile = el('div', 'summary-tile' + (tone ? ' summary-tile--' + tone : ''));
    const labelElement = el('span', 'summary-tile-label');
    labelElement.appendChild(svgIcon(icon || 'i-info', 'icon'));
    labelElement.appendChild(document.createTextNode(label));
    tile.appendChild(labelElement);
    tile.appendChild(el('strong', null, value));
    if (small) tile.appendChild(el('small', null, small));
    return tile;
  }

  function renderReportSummary() {
    const container = $('reportSummary');
    if (!container || !state.form) return;

    const record = state.form;
    const validation = getValidation(record);
    const answered = getAnsweredCount(record);
    const totals = Analysis.analyze(record).totals;
    const meta = CONFIG.statuses[record.status] || CONFIG.statuses.rascunho;
    const identification = record.identificacao || {};

    clearNode(container);

    const grid = el('div', 'summary-grid');
    grid.appendChild(
      summaryTile(
        'Situação',
        meta.label,
        'Atualizado em ' + formatDateTimeBR(record.updatedAt),
        record.status === 'concluida' ? 'positive' : 'warning',
        record.status === 'concluida' ? 'i-check' : 'i-clock'
      )
    );
    grid.appendChild(
      summaryTile(
        'Respostas',
        answered + ' de ' + TOTAL_QUESTIONS,
        totals.unanswered
          ? totals.unanswered + ' ' + plural(totals.unanswered, 'sem resposta', 'sem resposta')
          : 'Todas respondidas',
        totals.unanswered ? 'warning' : 'positive',
        'i-file'
      )
    );
    grid.appendChild(
      summaryTile(
        'Identificação',
        validation.missingRequired.length
          ? validation.missingRequired.length +
            ' ' +
            plural(validation.missingRequired.length, 'pendência', 'pendências')
          : 'Completa',
        (REQUIRED_FIELDS.length - validation.missingRequired.length) +
          ' de ' +
          REQUIRED_FIELDS.length +
          ' campos obrigatórios',
        validation.missingRequired.length ? 'warning' : 'positive',
        'i-user'
      )
    );
    grid.appendChild(
      summaryTile(
        'Análise',
        record.analise && record.analise.manuallyEdited ? 'Editada' : 'Automática',
        record.analise
          ? 'Gerada em ' + formatDateTimeBR(record.analise.generatedAt)
          : 'Ainda não gerada',
        '',
        'i-sparkles'
      )
    );
    container.appendChild(grid);

    if (validation.missingRequired.length || validation.unanswered.length) {
      const alert = el('div', 'summary-alert');
      alert.appendChild(svgIcon('i-alert'));
      const message = el('div');
      const textParts = [];

      if (validation.missingRequired.length) {
        textParts.push(
          'Campos obrigatórios pendentes: ' +
            validation.missingRequired
              .map(function (field) {
                return field.label;
              })
              .join('; ') +
            '.'
        );
      }

      if (validation.unanswered.length) {
        const bySection = CONFIG.sections
          .map(function (section) {
            const count = validation.unanswered.filter(function (item) {
              return item.section.id === section.id;
            }).length;
            return count ? section.title + ': ' + count : '';
          })
          .filter(Boolean)
          .join('; ');
        textParts.push(
          validation.unanswered.length +
            ' ' +
            plural(
              validation.unanswered.length,
              'pergunta sem resposta',
              'perguntas sem resposta'
            ) +
            ' (' +
            bySection +
            ').'
        );
      }

      message.appendChild(el('p', null, textParts.join(' ')));
      message.appendChild(
        makeButton(
          'Corrigir pendências',
          'goto-step',
          { step: String(validation.firstStep) },
          'btn-secondary btn-sm',
          'i-arrow-right'
        )
      );
      alert.appendChild(message);
      container.appendChild(alert);
    } else {
      const ready = el('div', 'analysis-status');
      ready.appendChild(svgIcon('i-check'));
      const text = el('p');
      text.appendChild(el('strong', null, 'Todos os campos e respostas estão preenchidos. '));
      text.appendChild(
        document.createTextNode(
          'Você pode visualizar o relatório como rascunho antes de concluir. A conclusão só ocorre ao clicar em "Gerar relatório".'
        )
      );
      ready.appendChild(text);
      container.appendChild(ready);
    }

    const progressWrap = el('div', 'facts-table-wrap');
    const table = el('table', 'facts-table');
    table.appendChild(el('caption', 'sr-only', 'Progresso das respostas por etapa'));
    const thead = el('thead');
    const headRow = el('tr');
    ['Etapa', 'Respondidas', 'Total', 'Pendentes'].forEach(function (label) {
      headRow.appendChild(el('th', null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    CONFIG.sections.forEach(function (section) {
      const total = section.questions.length;
      const done = section.questions.filter(function (question) {
        return answerIsValid(record.respostas[question.id]);
      }).length;
      const row = el('tr');
      row.appendChild(el('th', null, section.title));
      row.appendChild(el('td', null, String(done)));
      row.appendChild(el('td', null, String(total)));
      row.appendChild(el('td', null, String(total - done)));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    progressWrap.appendChild(table);
    container.appendChild(progressWrap);

    container.appendChild(
      el(
        'p',
        'analysis-caption',
        'A conclusão exige os campos obrigatórios e uma resposta para cada pergunta. ' +
          'As opções "Não observado / Não se aplica" contam como resposta e não são tratadas como falha.'
      )
    );

    if (validation.valid && !clean(identification.professor)) {
      container.appendChild(
        el('p', 'analysis-caption', 'Revise os dados de identificação antes de gerar o documento.')
      );
    }
  }

  async function handleRecalculateAnalysis() {
    if (!state.form) return;

    if (state.form.analise && state.form.analise.manuallyEdited) {
      const confirmed = await askConfirm({
        title: 'Recalcular a análise',
        message:
          'Os textos editados manualmente serão substituídos pela análise gerada por regras a partir das respostas atuais. Deseja continuar?',
        confirmLabel: 'Recalcular e substituir'
      });
      if (!confirmed) return;
    }

    state.form.analise = Analysis.createAnalysisRecord(state.form);
    markFormDirty();
    renderAnalysisFacts();
    setAnalysisFieldValues();
    renderAnalysisStatus();
    renderReportSummary();
    updateFormChrome();
    showToast('Análise recalculada a partir das respostas atuais.', 'success');
  }

  /* =======================================================================
   * 5.1 RELATÓRIO: VISUALIZAÇÃO, EDIÇÃO E IMPRESSÃO
   * ===================================================================== */

  function getCurrentReportRecord() {
    if (
      state.form &&
      state.currentReportId &&
      state.form.id === state.currentReportId
    ) {
      return state.form;
    }
    const saved = state.currentReportId ? getRecord(state.currentReportId) : null;
    if (saved) return saved;
    if (
      state.reportSnapshot &&
      state.reportSnapshot.id === state.currentReportId
    ) {
      return state.reportSnapshot;
    }
    return null;
  }

  function openReportForRecord(record) {
    if (!record) return false;
    state.currentReportId = record.id;
    state.reportSnapshot = clone(record);
    setView('report');
    return true;
  }

  function renderCurrentReport() {
    const container = $('reportDocumentContainer');
    const notice = $('reportPageNotice');
    if (!container) return false;

    const record = getCurrentReportRecord();
    if (!record) {
      showToast('O relatório solicitado não foi encontrado.', 'error');
      return false;
    }

    let analysis;
    try {
      analysis = Analysis.analyze(record);
      Report.render(container, record, state.settings, analysis);
    } catch (error) {
      console.error('ObservaEdu: erro ao montar o relatório.', error);
      showToast('Não foi possível montar o relatório. Recarregue a página e tente novamente.', 'error');
      clearNode(container);
      return false;
    }

    if (notice) {
      clearNode(notice);
      if (record.status !== 'concluida') {
        notice.hidden = false;
        notice.appendChild(svgIcon('i-alert'));
        const paragraph = el('p');
        paragraph.appendChild(el('strong', null, 'Prévia de rascunho. '));
        paragraph.appendChild(
          document.createTextNode(
            'Este registro ainda não foi concluído. Campos não preenchidos aparecem como "Não informado". ' +
              'Volte ao formulário para completar as pendências antes de usar o documento.'
          )
        );
        notice.appendChild(paragraph);
      } else if (state.mode === 'cloud' && state.pendingCloudWrite) {
        notice.hidden = false;
        notice.appendChild(svgIcon('i-alert'));
        notice.appendChild(
          el(
            'p',
            null,
            'A última gravação deste registro NÃO foi confirmada pelo servidor. ' +
              'O documento foi montado com os dados desta sessão. Exporte um backup e use ' +
              '"Salvar rascunho" novamente quando a conexão voltar.'
          )
        );
      } else if (state.mode === 'local' && !state.storageAvailable) {
        notice.hidden = false;
        notice.appendChild(svgIcon('i-alert'));
        notice.appendChild(
          el(
            'p',
            null,
            'Este relatório está disponível na memória desta sessão, mas o navegador não confirmou a gravação no armazenamento local. Exporte um backup antes de fechar a página.'
          )
        );
      } else {
        notice.hidden = true;
      }
    }

    return true;
  }

  async function handlePreviewReport() {
    if (!state.form) return;
    const validation = getValidation(state.form);
    const hadData = hasAnyData(state.form);

    // Evita perder o que já foi preenchido: a prévia salva um rascunho
    // quando existe qualquer conteúdo no formulário.
    let saved = true;
    if (hadData) saved = await persistForm();

    openReportForRecord(state.form);

    if (hadData && !saved && state.mode === 'cloud') {
      showToast(
        'Prévia gerada, mas a gravação no servidor NÃO foi confirmada. O conteúdo continua no formulário.',
        'error'
      );
      return;
    }

    if (!validation.valid) {
      showToast(
        'Prévia de rascunho: há campos ou respostas pendentes. O documento não está concluído.',
        'warning'
      );
    }
  }

  async function handleGenerateReport() {
    if (!state.form) return;

    const validation = getValidation(state.form);
    if (!validation.valid) {
      showFormErrors(validation);
      setFormStep(validation.firstStep, { scroll: true });
      showToast(
        'Para concluir, preencha os campos obrigatórios e responda a todas as perguntas.',
        'error'
      );
      return;
    }

    if (Analysis.isStale(state.form)) {
      const keep = await askConfirm({
        title: 'Análise desatualizada',
        message:
          'As respostas foram alteradas depois da edição manual da análise. ' +
          'Você pode voltar para revisar os textos ou manter a análise atual e concluir mesmo assim. ' +
          'O relatório exibirá um aviso sobre essa diferença.',
        confirmLabel: 'Manter e concluir'
      });
      if (!keep) {
        setFormStep(6, { scroll: true });
        showToast('Revise a análise antes de concluir o relatório.', 'info');
        return;
      }
    }

    clearFormErrors();
    state.form.status = 'concluida';
    state.form.updatedAt = nowIso();

    const saved = await persistForm();
    openReportForRecord(state.form);

    if (saved) {
      showToast(
        state.mode === 'cloud'
          ? 'Observação concluída e gravada no servidor. Relatório gerado.'
          : 'Observação concluída e relatório gerado.',
        'success'
      );
      return;
    }

    showToast(
      state.mode === 'cloud'
        ? 'Relatório gerado nesta sessão, mas o servidor NÃO confirmou a conclusão. Use "Salvar rascunho" para tentar novamente.'
        : 'Relatório gerado, mas não foi possível gravar o registro no navegador.',
      'error'
    );
  }

  function handleBackToForm() {
    const record = getCurrentReportRecord();
    if (!record) {
      showToast('Não há um formulário associado a este relatório.', 'error');
      setView('reports');
      return;
    }
    activateForm(record, { step: 7, returnView: 'reports' });
  }

  function handleEditReport() {
    const record = getCurrentReportRecord();
    if (!record) {
      showToast('Não há um formulário associado a este relatório.', 'error');
      setView('reports');
      return;
    }
    activateForm(record, { step: 6, returnView: 'reports' });
  }

  function printDocument(title) {
    const originalTitle = document.title;
    let restored = false;

    const restore = function () {
      if (restored) return;
      restored = true;
      document.title = originalTitle;
      window.removeEventListener('afterprint', restore);
    };

    document.title = String(title || 'Relatório')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    window.addEventListener('afterprint', restore);
    window.setTimeout(restore, 120000);

    showToast(
      'Na janela de impressão, escolha "Salvar como PDF" para gerar o arquivo. O sistema não baixa o PDF automaticamente.',
      'info'
    );

    try {
      window.print();
    } catch (error) {
      restore();
      showToast('O navegador não permitiu abrir a janela de impressão.', 'error');
    }
  }

  function handlePrintReport() {
    if (state.view !== 'report') {
      showToast('Abra um relatório antes de imprimir.', 'warning');
      return;
    }
    const record = getCurrentReportRecord();
    if (!record) {
      showToast('O relatório não está disponível para impressão.', 'error');
      return;
    }

    const identification = record.identificacao || {};
    const title =
      'Relatório - ' +
      (clean(identification.professor) || 'observação pedagógica') +
      ' - ' +
      (clean(identification.data) ? formatDateBR(identification.data) : 'sem data');
    printDocument(title);
  }

  function handlePrintRecord(id) {
    const record = getRecord(id);
    if (!record) {
      showToast('O registro solicitado não foi encontrado.', 'error');
      return;
    }
    openReportForRecord(record);
    window.setTimeout(handlePrintReport, 300);
  }

  /* =======================================================================
   * 6. AÇÕES DE NAVEGAÇÃO E GERENCIAMENTO
   * ===================================================================== */

  async function openRecordById(id) {
    if (state.view === 'form') {
      const canLeave = await confirmDiscardForm();
      if (!canLeave) return;
    }
    const record = getRecord(id);
    if (!record) {
      showToast('O registro solicitado não foi encontrado.', 'error');
      return;
    }
    activateForm(record, {
      step: suggestStep(record),
      returnView: state.view === 'report' ? 'reports' : state.view
    });
  }

  async function editRecordById(id) {
    if (state.view === 'form') {
      const canLeave = await confirmDiscardForm();
      if (!canLeave) return;
    }
    const record = getRecord(id);
    if (!record) {
      showToast('O registro solicitado não foi encontrado.', 'error');
      return;
    }
    activateForm(record, {
      step: 1,
      returnView: state.view === 'report' ? 'reports' : state.view
    });
  }

  function openReportById(id) {
    const record = getRecord(id);
    if (!record) {
      showToast('O registro solicitado não foi encontrado.', 'error');
      return;
    }
    openReportForRecord(record);
  }

  async function deleteRecordById(id) {
    const record = getRecord(id);
    if (!record) {
      showToast('O registro solicitado não foi encontrado.', 'error');
      return;
    }

    const professor =
      clean(record.identificacao && record.identificacao.professor) ||
      'professor(a) não informado';
    const confirmed = await askConfirm({
      title: 'Excluir observação',
      message:
        'Excluir definitivamente o registro de ' +
        professor +
        ' (' +
        formatDateBR(record.identificacao && record.identificacao.data) +
        ')?' +
        (state.mode === 'cloud'
          ? ' O registro será removido do servidor Supabase.'
          : ' Esta ação não pode ser desfeita.'),
      confirmLabel: 'Excluir registro',
      danger: true
    });
    if (!confirmed) return;

    if (state.mode === 'cloud') {
      const result = await Storage.deleteObservationAsync(id);
      if (!result.ok) {
        showToast(result.error || 'O servidor não confirmou a exclusão.', 'error');
        return;
      }
    } else {
      const remaining = state.observations.filter(function (item) {
        return item.id !== id;
      });
      const local = Storage.saveObservations(remaining);
      if (!local.ok) {
        state.storageAvailable = false;
        showBanner(
          (local.error || 'Não foi possível gravar a exclusão no navegador.') +
            ' O registro foi mantido para evitar perda de dados.'
        );
        showToast('A exclusão não foi confirmada pelo navegador.', 'error');
        return;
      }
      state.storageAvailable = true;
    }

    state.observations = state.observations.filter(function (item) {
      return item.id !== id;
    });

    if (state.currentReportId === id) {
      state.currentReportId = null;
      state.reportSnapshot = null;
    }
    if (state.form && state.form.id === id) {
      discardForm();
    }

    syncHistoryControls();
    renderAll();
    updateStoragePanel();

    if (state.view === 'report' && !getCurrentReportRecord()) {
      setView('reports', { focus: false });
    }

    showToast(
      state.mode === 'cloud'
        ? 'Observação excluída do servidor.'
        : 'Observação excluída deste navegador.',
      'success'
    );
  }

  async function handleLogout() {
    if (!Auth || state.mode !== 'cloud') return;

    const confirmed = await askConfirm({
      title: 'Sair da conta',
      message:
        'Você será desconectado. Os registros permanecem no servidor e só poderão ser ' +
        'acessados após um novo login com sua conta. Deseja sair?',
      confirmLabel: 'Sair da conta'
    });
    if (!confirmed) return;

    const result = await Auth.logout();
    if (!result.ok) {
      showToast(result.error || 'Não foi possível encerrar a sessão.', 'error');
      return;
    }

    leaveApp();
    Auth.showGate(
      'Sessão encerrada. Entre novamente para acessar os registros.',
      'info'
    );
  }

  async function runAction(actionElement) {
    const action = actionElement.dataset.action;
    const id = actionElement.dataset.id;

    switch (action) {
      case 'nav': {
        const target = actionElement.dataset.view;
        if (!target) return;
        if (state.view === 'form' && target !== 'form') {
          const canLeave = await confirmDiscardForm();
          if (!canLeave) return;
        }
        setView(target);
        break;
      }

      case 'new-observation': {
        if (state.view === 'form') {
          const canLeave = await confirmDiscardForm();
          if (!canLeave) return;
        }
        startNewObservation();
        break;
      }

      case 'open-history': {
        state.filters.status = actionElement.dataset.status || '';
        syncHistoryControls();
        setView('history');
        break;
      }

      case 'save-draft':
        await handleSaveDraft();
        break;

      case 'cancel-form':
        await handleCancelForm();
        break;

      case 'goto-step':
        if (state.form) setFormStep(actionElement.dataset.step, { scroll: true });
        break;

      case 'recalc-analysis':
        await handleRecalculateAnalysis();
        break;

      case 'preview-report':
        await handlePreviewReport();
        break;

      case 'generate-report':
        await handleGenerateReport();
        break;

      case 'back-to-reports':
        setView('reports');
        break;

      case 'back-to-form':
        handleBackToForm();
        break;

      case 'edit-report':
        handleEditReport();
        break;

      case 'print-report':
        handlePrintReport();
        break;

      case 'clear-filters':
        resetFilters();
        break;

      case 'clear-reports-search':
        state.reportsSearch = '';
        syncReportsControl();
        renderReports();
        break;

      case 'export-backup':
        handleExportBackup();
        break;

      case 'import-backup': {
        const fileInput = $('importFileInput');
        if (fileInput) fileInput.click();
        break;
      }

      case 'clear-data':
        await handleClearData();
        break;

      case 'migrate-local':
        await handleMigrateLocal();
        break;

      case 'export-local-backup':
        handleExportLocalBackup();
        break;

      case 'logout':
        await handleLogout();
        break;

      case 'open-help':
        openHelpDialog();
        break;

      case 'open-record':
        await openRecordById(id);
        break;

      case 'edit-record':
        await editRecordById(id);
        break;

      case 'open-report':
        openReportById(id);
        break;

      case 'print-record':
        handlePrintRecord(id);
        break;

      case 'delete-record':
        await deleteRecordById(id);
        break;

      case 'install-app':
        handleInstallApp();
        break;

      case 'update-app':
        handleUpdateApp();
        break;

      default:
        console.warn('ObservaEdu: ação não reconhecida.', action);
        break;
    }
  }

  /* =======================================================================
   * 7. INÍCIO DA APLICAÇÃO
   * ===================================================================== */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

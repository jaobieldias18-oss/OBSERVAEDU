/*
 * ObservaEdu — Interface e fluxo da aplicação
 * -------------------------------------------
 * Este arquivo liga o formulário, o armazenamento (local ou Supabase),
 * a análise por regras e o relatório. A ordem de carregamento dos scripts é:
 * No head: vendor/supabase-js -> supabase-config.js -> supabase.js.
 * No body: questions.js -> storage.js -> analysis.js -> report.js -> auth.js -> app.js.
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
  const Performance = window.ObservaEduPerformance;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const TOTAL_QUESTIONS =
    CONFIG.sections.reduce(function (total, section) {
      return total + section.questions.length;
    }, 0) + (CONFIG.openingQuestions ? CONFIG.openingQuestions.length : 0);

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
    performance: {
      title: 'Desempenho dos Professores',
      subtitle: 'Indicadores descritivos, sem ranking nem nota automática'
    },
    report: {
      title: 'Relatório',
      subtitle: 'Visualização, revisão e impressão do documento'
    },
    settings: {
      title: 'Configurações',
      subtitle: 'Escola, conta e organização dos dados'
    }
  };

  // Campos necessários para concluir uma observação.
  const REQUIRED_FIELDS = [
    { key: 'professor', label: 'Professor(a) observado(a)' },
    { key: 'disciplina', label: 'Disciplina' },
    { key: 'etapa', label: 'Etapa de ensino' },
    { key: 'serie', label: 'Ano ou série' },
    { key: 'turma', label: 'Turma' },
    { key: 'data', label: 'Data da observação' },
    { key: 'observador', label: 'Orientador responsável' }
  ];

  const STEPS = [
    { number: 1, title: 'Identificação', hint: 'Dados essenciais' },
    { number: 2, title: 'Introdução', hint: 'Abertura + 6 perguntas' },
    { number: 3, title: 'Desenvolvimento', hint: '12 perguntas' },
    { number: 4, title: 'Conclusão', hint: '7 perguntas' },
    { number: 5, title: 'Complementares', hint: 'Textos opcionais' },
    { number: 6, title: 'Análise', hint: 'Revisão dos textos' },
    { number: 7, title: 'Observações para o professor', hint: 'Texto da devolutiva' }
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

    performanceFilters: {
      teacherGroup: '',
      year: '',
      etapa: '',
      serie: '',
      turma: '',
      from: '',
      to: ''
    },

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

  function createTeacherId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'tch_' + window.crypto.randomUUID();
    }
    return (
      'tch_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 9)
    );
  }

  function accountLabel() {
    if (!state.user) return '';
    const metadata = state.user.user_metadata || {};
    const name = clean(metadata.full_name) || clean(metadata.name);
    return name || clean(state.user.email);
  }

  // Nome do observador: configuração explícita, nome da conta ou e-mail.
  // Nunca é o nome do professor observado.
  function effectiveObserverName() {
    return clean(state.settings.displayName) || accountLabel();
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

  function openingValue(record, questionId) {
    const entry = record && record.abertura ? record.abertura[questionId] : null;
    if (!entry) return '';
    return typeof entry === 'object' ? entry.valor : entry;
  }

  function openingNote(record, questionId) {
    const entry = record && record.abertura ? record.abertura[questionId] : null;
    return entry && typeof entry === 'object' ? stringValue(entry.nota) : '';
  }

  function getOpeningAnsweredCount(record) {
    if (!record) return 0;
    return (CONFIG.openingQuestions || []).filter(function (question) {
      return answerIsValid(openingValue(record, question.id));
    }).length;
  }

  function getAnsweredCount(record) {
    if (!record) return 0;
    let count = getOpeningAnsweredCount(record);
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
    (CONFIG.openingQuestions || []).forEach(function (question) {
      if (!answerIsValid(openingValue(record, question.id))) {
        list.push({
          section: { id: 'abertura', step: 2, title: 'Abertura da aula' },
          question: question,
          opening: true
        });
      }
    });
    CONFIG.sections.forEach(function (section) {
      section.questions.forEach(function (question) {
        const value = record && record.respostas ? record.respostas[question.id] : '';
        if (!answerIsValid(value)) {
          list.push({ section: section, question: question, opening: false });
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
      clean(identificacao.professorId) ||
      clean(identificacao.professor) ||
      clean(identificacao.disciplina) ||
      clean(identificacao.etapa) ||
      clean(identificacao.serie) ||
      clean(identificacao.turma) ||
      clean(identificacao.data) ||
      clean(identificacao.horario) ||
      clean(identificacao.observador) ||
      clean(identificacao.tema) ||
      clean(record.observacoesProfessor)
    ) {
      return true;
    }
    if (
      (CONFIG.openingQuestions || []).some(function (question) {
        return openingValue(record, question.id) || openingNote(record, question.id);
      })
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
        professorId: '',
        professor: '',
        disciplina: '',
        etapa: '',
        serie: '',
        turma: '',
        data: '',
        horario: '',
        observador: effectiveObserverName(),
        tema: ''
      },
      abertura: {},
      respostas: {},
      comentarios: {},
      complementares: {},
      observacoesProfessor: '',
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
    (CONFIG.openingQuestions || []).forEach(function (question) {
      record.abertura[question.id] = { valor: '', nota: '' };
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

  function normalizeAbertura(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const abertura = {};
    (CONFIG.openingQuestions || []).forEach(function (question) {
      const entry = source[question.id];
      if (entry && typeof entry === 'object') {
        const value = answerIsValid(entry.valor) ? entry.valor : '';
        abertura[question.id] = { valor: value, nota: stringValue(entry.nota) };
      } else if (answerIsValid(entry)) {
        // Compatibilidade com um eventual formato antigo que guardava só o valor.
        abertura[question.id] = { valor: entry, nota: '' };
      } else {
        abertura[question.id] = { valor: '', nota: '' };
      }
    });
    return abertura;
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
        professorId: stringValue(identification.professorId),
        professor: stringValue(identification.professor),
        disciplina: stringValue(identification.disciplina),
        etapa: stringValue(identification.etapa),
        serie: stringValue(identification.serie),
        turma: stringValue(identification.turma),
        data: stringValue(identification.data),
        horario: stringValue(identification.horario),
        observador: stringValue(identification.observador),
        tema: stringValue(identification.tema)
      },
      abertura: normalizeAbertura(source.abertura),
      respostas: {},
      comentarios: {},
      complementares: {},
      observacoesProfessor: stringValue(source.observacoesProfessor),
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

  function normalizeNameKey(value) {
    return clean(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function normalizeTeachers(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const result = [];
    const ids = new Set();
    const names = new Set();

    list.forEach(function (item) {
      const source = item && typeof item === 'object' ? item : {};
      const name = stringValue(source.name);
      if (!name) return;
      const nameKey = normalizeNameKey(name);
      let id = clean(source.id);
      if (!id || ids.has(id)) id = createTeacherId();
      // Ignora duplicatas de nome, mantendo o cadastro mais antigo.
      if (names.has(nameKey)) return;
      ids.add(id);
      names.add(nameKey);
      result.push({
        id: id,
        name: name,
        disciplina: stringValue(source.disciplina),
        active: source.active === false ? false : true,
        createdAt: validIso(source.createdAt) || nowIso()
      });
    });

    return result;
  }

  function normalizeEarlyGroups(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const result = [];
    const seen = new Set();
    list.forEach(function (item) {
      const name = stringValue(item);
      if (!name) return;
      const key = normalizeNameKey(name);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(name);
    });
    return result;
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return Object.assign({}, source, {
      schoolName: stringValue(source.schoolName),
      schoolUnit: stringValue(source.schoolUnit),
      city: stringValue(source.city),
      displayName: stringValue(source.displayName),
      teachers: normalizeTeachers(source.teachers),
      earlyChildhoodGroups: normalizeEarlyGroups(source.earlyChildhoodGroups)
    });
  }

  function findTeacher(id) {
    const target = clean(id);
    if (!target) return null;
    return (state.settings.teachers || []).find(function (teacher) {
      return teacher.id === target;
    }) || null;
  }

  function teacherByName(name) {
    const key = normalizeNameKey(name);
    if (!key) return null;
    return (state.settings.teachers || []).find(function (teacher) {
      return normalizeNameKey(teacher.name) === key;
    }) || null;
  }

  function addTeacher(teacher) {
    const name = clean(teacher && teacher.name);
    if (!name) return { ok: false, error: 'Informe o nome do professor(a).' };
    const existing = teacherByName(name);
    if (existing) {
      // Cadastro novo não reativa professor removido: a reativação é uma
      // ação explícita do cadastro ativo.
      return { ok: false, error: 'Já existe um professor cadastrado com esse nome.' };
    }
    const entry = {
      id: createTeacherId(),
      name: name,
      disciplina: clean(teacher.disciplina),
      active: true,
      createdAt: nowIso()
    };
    state.settings.teachers = (state.settings.teachers || []).concat(entry);
    return { ok: true, teacher: entry };
  }

  function renameTeacher(id, values) {
    const teacher = findTeacher(id);
    if (!teacher) return { ok: false, error: 'Professor(a) não encontrado.' };
    const name = clean(values && values.name);
    if (!name) return { ok: false, error: 'Informe o nome do professor(a).' };
    const key = normalizeNameKey(name);
    const duplicate = (state.settings.teachers || []).some(function (item) {
      return item.id !== id && normalizeNameKey(item.name) === key;
    });
    if (duplicate) {
      return { ok: false, error: 'Já existe outro professor cadastrado com esse nome.' };
    }
    teacher.name = name;
    teacher.disciplina = clean(values.disciplina);
    return { ok: true, teacher: teacher };
  }

  function removeTeacher(id) {
    const teacher = findTeacher(id);
    if (!teacher) return false;
    teacher.active = false;
    return true;
  }

  function restoreTeacher(id) {
    const teacher = findTeacher(id);
    if (!teacher) return false;
    teacher.active = true;
    return true;
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
          'Não foi possível carregar os registros. ' +
            (observations.error || 'Verifique a conexão e tente novamente.')
        );
      }

      if (settings.ok) {
        state.settings = normalizeSettings(settings.data);
      } else {
        state.settings = normalizeSettings({});
        problems.push(
          'Não foi possível carregar as configurações. ' +
            (settings.error || 'As configurações atuais não foram alteradas.')
        );
      }

      state.pendingCloudWrite = false;

      if (!state.storageAvailable) {
        problems.push(
          'O navegador bloqueou o acesso aos dados. A sessão pode não permanecer ' +
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
        'O navegador bloqueou o acesso aos dados. Você ainda pode usar o sistema nesta sessão, ' +
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
              : 'Não foi possível gravar os dados na sua conta.')) +
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
          (result.error || 'Não foi possível gravar as configurações na sua conta.') +
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
    } else if (target === 'performance') {
      renderPerformance();
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
        badge.textContent = 'Conectado';
      } else {
        badge.className = 'badge badge--warning';
        badge.textContent = 'Sem conexão';
      }
    } else {
      const available = state.storageAvailable && Storage.isAvailable();
      if (available) {
        badge.className = 'badge badge--positive';
        badge.textContent = 'Disponível';
      } else {
        badge.className = 'badge badge--warning';
        badge.textContent = 'Indisponível';
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
      usage.textContent = state.cloudLoaded ? 'Sua conta' : 'Não confirmado';
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
        ? 'Os registros desta conta ficam salvos na nuvem.'
        : 'Os registros ficam salvos neste navegador.';
    }
    if (iconUse) iconUse.setAttribute('href', cloud ? '#i-database' : '#i-lock');

    const sessionBox = $('sessionBox');
    if (sessionBox) sessionBox.hidden = !(cloud && state.user);
    setText('sessionEmail', state.user && state.user.email ? state.user.email : '—');

    setText('storageTitle', cloud ? 'Registros na nuvem' : 'Registros deste navegador');
    setText(
      'storageSubtitle',
      cloud
        ? 'Conta ativa, origem dos dados, backup e limpeza.'
        : 'Dados salvos neste navegador, backup e limpeza.'
    );
    setText(
      'storageDescription',
      cloud
        ? 'Os registros são salvos na sua conta e protegidos pelo login. Faça backup regularmente.'
        : 'Os registros ficam salvos neste navegador. Faça backup em arquivo e guarde em local seguro.'
    );
    setText('storageUsageLabel', cloud ? 'Origem dos dados' : 'Espaço aproximado');
    setText(
      'backupHelp',
      'O backup é um arquivo de segurança com todos os registros e a identificação da escola. ' +
        'A importação substitui os dados atuais após confirmação.'
    );
    setText('dangerTitle', 'Apagar meus dados');
    setText(
      'dangerText',
      cloud
        ? 'Remove os registros e as configurações desta conta. Os registros salvos neste navegador são preservados.'
        : 'Remove os registros e as configurações deste navegador. Esta ação não pode ser desfeita.'
    );
    setText('dangerButtonLabel', 'Apagar meus dados');

    setText(
      'sidebarStorageNote',
      cloud
        ? 'Sessão ativa: os registros ficam protegidos pelo login desta conta.'
        : 'Os dados ficam salvos apenas neste navegador e não são compartilhados automaticamente.'
    );

    setText(
      'privacyItemExternal',
      cloud
        ? 'Os registros são salvos na sua conta e enviados ao servidor somente quando você está autenticado e com conexão.'
        : 'Os registros ficam neste navegador e não são compartilhados com outras pessoas.'
    );
    setText(
      'privacyItemBrowser',
      cloud
        ? 'O acesso depende da sua conta. Ao usar computadores compartilhados, encerre a sessão ao terminar.'
        : 'Qualquer pessoa com acesso a este navegador e a este computador pode consultar os dados salvos.'
    );
    setText(
      'privacyItemBackup',
      'Exporte backups regularmente e guarde o arquivo em local seguro.'
    );
    setText(
      'pwaSecurityItem',
      cloud
        ? 'O aplicativo não substitui o login. Offline, o cache guarda apenas os arquivos do sistema.'
        : 'O aplicativo não substitui o login nem a proteção institucional. Qualquer pessoa com acesso a este navegador pode consultar os dados salvos.'
    );
    setText(
      'helpPrivacyNote',
      cloud
        ? 'Os registros são salvos na sua conta e protegidos pelo login. Exporte backups e encerre a sessão em computadores compartilhados.'
        : 'Os dados ficam salvos neste navegador. Faça backup em Configurações e não use o sistema como único repositório institucional. O aplicativo não substitui o login nem a proteção institucional.'
    );

    setText(
      'dataNoteTitle',
      cloud ? 'Sobre os dados da sua conta' : 'Sobre os dados deste navegador'
    );
    setText(
      'statHintRecords',
      cloud ? 'registros na sua conta' : 'registros salvos neste navegador'
    );
    setText(
      'dataNoteText',
      cloud
        ? 'Os registros ficam na sua conta e são protegidos pelo login. Eles não são compartilhados com outras contas.'
        : 'Os registros ficam salvos neste navegador e não são compartilhados com outras pessoas.'
    );
    setText(
      'historyDescription',
      cloud
        ? 'Pesquise, filtre, abra e edite os registros salvos na sua conta.'
        : 'Pesquise, filtre, abra e edite os registros salvos neste navegador.'
    );
    setText(
      'settingsDescription',
      'Identificação da escola, cadastro de professores, grupos da Educação Infantil e organização dos dados.'
    );
    setText(
      'pwaStorageItem',
      'Atualizações: quando houver uma nova versão, o sistema avisa. A atualização mantém os dados salvos.'
    );
    setText(
      'futureText',
      'Esta versão usa regras claras para a análise e exige revisão humana antes de gerar o relatório. ' +
        'Não há integração com inteligência artificial nem sincronização automática.'
    );

    const footer = $('appFooterText');
    if (footer) {
      footer.textContent =
        'ObservaEdu · Versão ' +
        (CONFIG.version || '2.0.0') +
        ' · ' +
        (cloud ? 'Registros salvos na sua conta.' : 'Dados salvos neste navegador.');
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

  function openTeacherDialog(teacherId) {
    const dialog = $('teacherDialog');
    if (!dialog) return;
    const teacher = teacherId ? findTeacher(teacherId) : null;
    const idInput = $('teacherDialogId');
    const nameInput = $('teacherDialogName');
    const disciplineInput = $('teacherDialogDisciplina');
    const errorBox = $('teacherDialogError');
    const title = $('teacherDialogTitle');
    const saveLabel = $('teacherDialogSaveLabel');

    if (idInput) idInput.value = teacher ? teacher.id : '';
    if (nameInput) nameInput.value = teacher ? teacher.name : '';
    if (disciplineInput) disciplineInput.value = teacher ? teacher.disciplina : '';
    if (errorBox) errorBox.textContent = '';
    if (title) {
      title.textContent = teacher ? 'Editar professor(a)' : 'Adicionar professor(a)';
    }
    if (saveLabel) saveLabel.textContent = teacher ? 'Salvar alterações' : 'Salvar professor';

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    if (nameInput && typeof nameInput.focus === 'function') {
      window.setTimeout(function () {
        nameInput.focus();
      }, 30);
    }
  }

  function closeTeacherDialog() {
    const dialog = $('teacherDialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  async function handleTeacherDialogSubmit(event) {
    event.preventDefault();
    const idInput = $('teacherDialogId');
    const nameInput = $('teacherDialogName');
    const disciplineInput = $('teacherDialogDisciplina');
    const errorBox = $('teacherDialogError');
    const id = clean(idInput && idInput.value);
    const values = {
      name: clean(nameInput && nameInput.value),
      disciplina: clean(disciplineInput && disciplineInput.value)
    };

    const result = id ? renameTeacher(id, values) : addTeacher(values);
    if (!result.ok) {
      if (errorBox) errorBox.textContent = result.error;
      if (nameInput && typeof nameInput.focus === 'function') nameInput.focus();
      return;
    }

    const saved = await saveSettingsToStorage();
    closeTeacherDialog();

    // Ao cadastrar a partir do formulário, já seleciona o novo professor.
    if (!id && state.form && !clean(state.form.identificacao.professorId)) {
      state.form.identificacao.professorId = result.teacher.id;
      state.form.identificacao.professor = result.teacher.name;
      if (
        result.teacher.disciplina &&
        !clean(state.form.identificacao.disciplina)
      ) {
        state.form.identificacao.disciplina = result.teacher.disciplina;
      }
      syncTeacherSelect(state.form);
      const disciplineInput = $('fieldDisciplina');
      if (disciplineInput) {
        disciplineInput.value = state.form.identificacao.disciplina;
      }
      clearFieldError('professor');
      markFormDirty();
      updateFormChrome();
    } else if (state.form) {
      syncTeacherSelect(state.form);
    }

    renderSettings();
    renderPerformance();
    showToast(
      saved
        ? id
          ? 'Professor(a) atualizado(a). As observações antigas mantêm o histórico.'
          : 'Professor(a) cadastrado(a).'
        : 'Cadastro atualizado(a) apenas nesta sessão. A confirmação no servidor não foi recebida.',
      saved ? 'success' : 'error'
    );
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

    const performanceMap = {
      performanceTeacher: 'teacherGroup',
      performanceYear: 'year',
      performanceEtapa: 'etapa',
      performanceSerie: 'serie',
      performanceTurma: 'turma',
      performanceFrom: 'from',
      performanceTo: 'to'
    };
    Object.keys(performanceMap).forEach(function (id) {
      const input = $(id);
      if (!input) return;
      input.addEventListener('change', function () {
        state.performanceFilters[performanceMap[id]] = input.value;
        if (id === 'performanceEtapa') {
          state.performanceFilters.serie = '';
        }
        renderPerformance();
      });
    });

    const confirmOk = $('confirmOk');
    const confirmCancel = $('confirmCancel');
    const confirmDialog = $('confirmDialog');
    if (confirmOk) confirmOk.addEventListener('click', function () { finishConfirm(true); });
    if (confirmCancel) confirmCancel.addEventListener('click', function () { finishConfirm(false); });
    if (confirmDialog) {
      confirmDialog.addEventListener('close', function () {
        if (confirmResolver) finishConfirm(false);
      });
      confirmDialog.addEventListener('click', function (event) {
        if (event.target === confirmDialog) finishConfirm(false);
      });
    }

    const helpDialog = $('helpDialog');
    if (helpDialog) {
      helpDialog.addEventListener('click', function (event) {
        if (event.target === helpDialog) closeHelpDialog();
      });
    }

    const helpClose = $('helpClose');
    const helpOk = $('helpOk');
    if (helpClose) helpClose.addEventListener('click', closeHelpDialog);
    if (helpOk) helpOk.addEventListener('click', closeHelpDialog);

    const teacherForm = $('teacherDialogForm');
    if (teacherForm) teacherForm.addEventListener('submit', handleTeacherDialogSubmit);
    const teacherCancel = $('teacherDialogCancel');
    if (teacherCancel) teacherCancel.addEventListener('click', closeTeacherDialog);
    const teacherDialog = $('teacherDialog');
    if (teacherDialog) {
      teacherDialog.addEventListener('click', function (event) {
        if (event.target === teacherDialog) closeTeacherDialog();
      });
    }

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
        'os dados permanecem salvos neste navegador.';
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
      showToast(
        state.mode === 'cloud'
          ? 'ObservaEdu instalado. Seus dados continuam salvos na sua conta.'
          : 'ObservaEdu instalado. Seus dados continuam salvos neste navegador.',
        'success'
      );
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

    if (target.dataset && target.dataset.teacherSelect !== undefined) {
      const value = target.value;
      if (!value) {
        state.form.identificacao.professorId = '';
        state.form.identificacao.professor = '';
      } else if (value.indexOf('name:') === 0) {
        const option = target.options[target.selectedIndex];
        state.form.identificacao.professorId = '';
        state.form.identificacao.professor = clean(option && option.dataset.name)
          || value.slice(5);
      } else {
        const teacher = findTeacher(value);
        state.form.identificacao.professorId = value;
        state.form.identificacao.professor = teacher ? teacher.name : value;
        if (teacher && teacher.disciplina && !clean(state.form.identificacao.disciplina)) {
          state.form.identificacao.disciplina = teacher.disciplina;
          const disciplineInput = $('fieldDisciplina');
          if (disciplineInput) disciplineInput.value = teacher.disciplina;
        }
      }
      clearFieldError('professor');
      markFormDirty();
      updateFormChrome();
      return;
    }

    if (target.dataset && target.dataset.schoolSelect) {
      const key = target.dataset.schoolSelect;
      if (key === 'etapa') {
        state.form.identificacao.etapa = target.value;
        state.form.identificacao.serie = '';
        state.form.identificacao.turma = '';
        renderSerieOptions(target.value, '');
        renderTurmaOptions('', false);
        const help = $('serieHelp');
        const level = levelByValue(target.value);
        if (help) {
          help.textContent =
            level && level.seriesMode === 'earlyChildhoodGroups'
              ? (state.settings.earlyChildhoodGroups || []).length
                ? 'Grupos configurados em Configurações.'
                : 'Nenhum grupo configurado. Cadastre os grupos da Educação Infantil em Configurações.'
              : 'As opções dependem da etapa escolhida.';
        }
        if (level && level.seriesMode === 'earlyChildhoodGroups' &&
            !(state.settings.earlyChildhoodGroups || []).length) {
          showToast(
            'Cadastre os grupos da Educação Infantil em Configurações para escolher o ano/série.',
            'warning'
          );
        }
      } else if (key === 'serie') {
        state.form.identificacao.serie = target.value;
        if (!target.value) {
          state.form.identificacao.turma = '';
        }
        renderTurmaOptions(state.form.identificacao.turma, !!target.value);
      } else if (key === 'turma') {
        state.form.identificacao.turma = target.value;
      }
      clearFieldError(key);
      markFormDirty();
      updateFormChrome();
      return;
    }

    if (target.dataset && target.dataset.opening) {
      if (target.type === 'radio' && !target.checked) return;
      const questionId = target.dataset.opening;
      if (!state.form.abertura[questionId]) {
        state.form.abertura[questionId] = { valor: '', nota: '' };
      }
      state.form.abertura[questionId].valor = target.value;

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

    if (target.dataset && target.dataset.openingNote) {
      const questionId = target.dataset.openingNote;
      if (!state.form.abertura[questionId]) {
        state.form.abertura[questionId] = { valor: '', nota: '' };
      }
      state.form.abertura[questionId].nota = target.value;
      markFormDirty();
      return;
    }

    if (target.dataset && target.dataset.teacherNote !== undefined) {
      state.form.observacoesProfessor = target.value;
      markFormDirty();
      return;
    }

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

      // Sem chave pública válida não há nuvem: remove qualquer bloqueio
      // deixado pela verificação inicial e deixa o modo local explícito.
      document.documentElement.classList.remove('auth-pending');
      document.body.classList.remove('auth-locked');
      const banner = $('appBanner');
      const previous =
        banner && !banner.hidden && $('appBannerMessage')
          ? $('appBannerMessage').textContent || ''
          : '';
      const status = Auth && typeof Auth.configuration === 'function' ? Auth.configuration() : null;
      const baseNotice = 'Modo local: os dados ficam apenas neste navegador.';
      const notice = baseNotice;
      // O aviso do modo local já vem no HTML para evitar deslocamento de
      // layout. Se ele já estiver na tela, substitui pelo texto completo;
      // se houver outro aviso (armazenamento), acrescenta sem apagar.
      const combined =
        !previous || previous.indexOf(baseNotice) === 0 ? notice : previous + ' ' + notice;
      showBanner(combined);
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
      // O Auth.init já executou enterApp(session) pelo callback onSignedIn,
      // mantendo a tela de entrada visível até os dados da conta carregarem.
      applyModeUi();
      return;
    }

    state.cloudLoaded = false;
    updateStoragePanel();
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
    renderPerformance();
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
    sub.appendChild(el('span', null, Performance.classLabel(identification)));
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

    const quickTeacherCount = $('quickTeacherCount');
    if (quickTeacherCount) {
      const directory = teacherDirectory();
      quickTeacherCount.textContent =
        directory.list.length +
        ' ' +
        plural(directory.list.length, 'professor no diretório', 'professores no diretório');
    }

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
      el('span', 'record-tag', Performance.classLabel(identification))
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

  /* =======================================================================
   * 3.0 DESEMPENHO POR PROFESSOR(A)
   * ===================================================================== */

  function toneForAnswer(value) {
    const option = CONFIG.answerOptions.find(function (item) {
      return item.value === value;
    });
    return option ? option.tone : 'neutral';
  }

  function buildHorizontalBars(items, ariaLabel) {
    const chart = el('div', 'bar-chart');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', ariaLabel || 'Gráfico de barras');

    const max = items.reduce(function (top, item) {
      return Math.max(top, item.count);
    }, 0);

    items.forEach(function (item) {
      const row = el('div', 'bar-row');
      row.appendChild(el('span', 'bar-label', item.label));

      const track = el('div', 'bar-track');
      const fill = el('div', 'bar-fill bar-fill--' + (item.tone || 'neutral'));
      fill.style.width = max ? Math.round((item.count / max) * 100) + '%' : '0%';
      track.appendChild(fill);
      row.appendChild(track);

      const value = el(
        'span',
        'bar-value',
        item.valueText !== undefined ? item.valueText : String(item.count)
      );
      row.appendChild(value);
      chart.appendChild(row);
    });

    return chart;
  }

  function performanceDirectoryOptions() {
    return teacherDirectory().list;
  }

  function syncPerformanceControls(options) {
    const teacherSelect = $('performanceTeacher');
    const etapaSelect = $('performanceEtapa');
    const fromInput = $('performanceFrom');
    const toInput = $('performanceTo');

    if (teacherSelect && !(options && options.skipTeacher)) {
      clearNode(teacherSelect);
      const all = el('option', null, 'Todos os professores');
      all.value = '';
      teacherSelect.appendChild(all);
      performanceDirectoryOptions().forEach(function (entry) {
        const option = el(
          'option',
          null,
          entry.name + (entry.active ? '' : ' (histórico)')
        );
        option.value = entry.groupKey;
        teacherSelect.appendChild(option);
      });
      teacherSelect.value = state.performanceFilters.teacherGroup;
      if (teacherSelect.value !== state.performanceFilters.teacherGroup) {
        state.performanceFilters.teacherGroup = '';
        teacherSelect.value = '';
      }
    }

    if (etapaSelect) {
      const current = state.performanceFilters.etapa;
      clearNode(etapaSelect);
      const all = el('option', null, 'Todas as etapas');
      all.value = '';
      etapaSelect.appendChild(all);
      CONFIG.educationLevels.forEach(function (level) {
        const option = el('option', null, level.label);
        option.value = level.value;
        etapaSelect.appendChild(option);
      });
      etapaSelect.value = current;
      if (etapaSelect.value !== current) {
        state.performanceFilters.etapa = '';
        etapaSelect.value = '';
      }
    }

    const yearSelect = $('performanceYear');
    const serieSelect = $('performanceSerie');
    const turmaSelect = $('performanceTurma');
    const yearOptions = {};
    state.observations.forEach(function (record) {
      const year = Performance.academicYear(record.identificacao && record.identificacao.data);
      if (year) yearOptions[year] = true;
    });
    if (yearSelect) {
      const current = state.performanceFilters.year;
      clearNode(yearSelect);
      const all = el('option', null, 'Todos os anos');
      all.value = '';
      yearSelect.appendChild(all);
      Object.keys(yearOptions).sort().reverse().forEach(function (year) {
        const option = el('option', null, year);
        option.value = year;
        yearSelect.appendChild(option);
      });
      yearSelect.value = current;
      if (yearSelect.value !== current) {
        state.performanceFilters.year = '';
        yearSelect.value = '';
      }
    }

    if (serieSelect) {
      const current = state.performanceFilters.serie;
      const series = seriesOptionsFor(state.performanceFilters.etapa);
      clearNode(serieSelect);
      const all = el('option', null, state.performanceFilters.etapa ? 'Todas as séries desta etapa' : 'Todas as séries');
      all.value = '';
      serieSelect.appendChild(all);
      const seen = new Set();
      series.forEach(function (name) {
        seen.add(name);
        const option = el('option', null, name);
        option.value = name;
        serieSelect.appendChild(option);
      });
      state.observations.forEach(function (record) {
        const ident = record.identificacao || {};
        const serie = clean(ident.serie);
        if (!serie || seen.has(serie)) return;
        if (state.performanceFilters.etapa && clean(ident.etapa) !== state.performanceFilters.etapa) return;
        seen.add(serie);
        const option = el('option', null, serie);
        option.value = serie;
        serieSelect.appendChild(option);
      });
      serieSelect.value = current;
      if (serieSelect.value !== current) {
        state.performanceFilters.serie = '';
        serieSelect.value = '';
      }
    }

    if (turmaSelect) {
      const current = state.performanceFilters.turma;
      clearNode(turmaSelect);
      const all = el('option', null, 'Todas as turmas');
      all.value = '';
      turmaSelect.appendChild(all);
      CONFIG.classOptions.forEach(function (name) {
        const option = el('option', null, name);
        option.value = name;
        turmaSelect.appendChild(option);
      });
      turmaSelect.value = current;
      if (turmaSelect.value !== current) {
        state.performanceFilters.turma = '';
        turmaSelect.value = '';
      }
    }

    if (fromInput) fromInput.value = state.performanceFilters.from;
    if (toInput) toInput.value = state.performanceFilters.to;
  }

  function buildPerformanceStat(label, value, detail, tone) {
    const card = el('div', 'performance-stat performance-stat--' + (tone || 'blue'));
    card.appendChild(el('p', 'performance-stat-label', label));
    card.appendChild(el('p', 'performance-stat-value', value));
    card.appendChild(el('p', 'performance-stat-detail', detail));
    return card;
  }

  function renderPerformanceStats(result) {
    const container = $('performanceStats');
    if (!container) return;
    clearNode(container);

    container.appendChild(
      buildPerformanceStat(
        'Observações concluídas',
        String(result.sampleSize),
        result.sampleSize === result.allConcludedCount
          ? 'Todas as concluídas'
          : 'de ' + result.allConcludedCount + ' concluídas no total',
        'blue'
      )
    );
    container.appendChild(
      buildPerformanceStat(
        'Professores no recorte',
        String(result.teachersInScope),
        result.directory.list.length + ' no diretório',
        'gray'
      )
    );
    container.appendChild(
      buildPerformanceStat(
        'Turmas observadas',
        String(result.classesObserved.length),
        result.classesObserved.length ? result.classesObserved.slice(0, 4).join(' · ') : 'Nenhuma neste recorte',
        'amber'
      )
    );
    container.appendChild(
      buildPerformanceStat(
        'Perguntas de abertura',
        result.recordsWithOpening + ' de ' + result.sampleSize,
        'Registros com pontualidade ou chamada',
        'green'
      )
    );
  }

  function renderPerformanceNotice(result) {
    const container = $('performanceNotice');
    if (!container) return;
    clearNode(container);

    if (!result.hasData) {
      container.appendChild(
        buildEmptyState({
          icon: 'i-chart',
          title: 'Nenhuma observação concluída neste recorte',
          text: 'Os indicadores usam apenas observações concluídas. Ajuste os filtros ou conclua uma observação.',
          actions: [
            {
              label: 'Limpar filtros',
              action: 'clear-performance-filters',
              icon: 'i-refresh'
            }
          ]
        })
      );
      return;
    }

    if (result.sampleSize < 5) {
      const notice = el('div', 'card performance-notice performance-notice--warning');
      notice.appendChild(svgIcon('i-alert'));
      notice.appendChild(
        el(
          'p',
          null,
          'Amostra pequena: ' +
            result.sampleSize +
            ' ' +
            plural(result.sampleSize, 'observação concluída', 'observações concluídas') +
            ' no recorte. Evite conclusões sobre o desempenho de professores com poucos registros.'
        )
      );
      container.appendChild(notice);
    }

    if (result.recordsWithOpening < result.sampleSize) {
      const missing = result.sampleSize - result.recordsWithOpening;
      const notice = el('div', 'card performance-notice');
      notice.appendChild(svgIcon('i-info'));
      notice.appendChild(
        el(
          'p',
          null,
          'As perguntas de abertura estão registradas em ' +
            result.recordsWithOpening +
            ' de ' +
            result.sampleSize +
            ' ' +
            plural(result.sampleSize, 'observação', 'observações') +
            '. ' +
            (missing > 0
              ? missing + ' registro(s) anterior(es) não têm essas respostas e não entram nesse indicador.'
              : '')
        )
      );
      container.appendChild(notice);
    }
  }

  function renderSingleOpeningChart(container, item, emptyLegacyText) {
    if (!container) return;
    clearNode(container);
    if (!item) {
      container.appendChild(el('p', 'chart-empty', 'Nenhuma pergunta de abertura configurada.'));
      return;
    }
    const answered = item.answered;
    const total = item.counts.total;
    if (!answered) {
      container.appendChild(
        el(
          'p',
          'chart-empty',
          total
            ? emptyLegacyText
            : 'Não há observações concluídas neste recorte.'
        )
      );
      container.appendChild(
        el(
          'p',
          'chart-footnote',
          'Denominador: 0 respostas registradas em ' + total + ' ' +
            plural(total, 'observação concluída', 'observações concluídas') +
            '. Respostas não observadas não são tratadas como negativas.'
        )
      );
      return;
    }

    const rows = window.ObservaEduSchool.openingOptions().map(function (option) {
      const count = item.counts[option.value] || 0;
      const percent = Math.round((count / answered) * 100);
      return {
        label: option.label,
        count: count,
        tone: option.tone,
        valueText: count + ' (' + percent + '%)'
      };
    });
    container.appendChild(
      buildHorizontalBars(rows, item.text + '. Denominador ' + answered + '.')
    );
    container.appendChild(
      el(
        'p',
        'chart-footnote',
        'Denominador: ' +
          answered +
          ' ' +
          plural(answered, 'resposta registrada', 'respostas registradas') +
          ' em ' +
          total +
          ' ' +
          plural(total, 'observação concluída', 'observações concluídas') +
          (item.counts.missing
            ? ' · ' + item.counts.missing + ' sem essa pergunta (registros anteriores)'
            : '') +
          '. "Não foi possível observar" não entra como resultado negativo.'
      )
    );
  }

  function renderPerformanceDistribution(result) {
    const container = $('distributionChart');
    if (!container) return;
    clearNode(container);

    if (!result.hasData) {
      container.appendChild(
        el('p', 'chart-empty', 'Nenhuma observação concluída neste recorte para distribuir respostas.')
      );
      return;
    }

    const answered = result.totals ? result.totals.answered : 0;
    if (!answered) {
      container.appendChild(
        el('p', 'chart-empty', 'Não há respostas registradas para distribuir neste recorte.')
      );
      container.appendChild(
        el(
          'p',
          'chart-footnote',
          'A distribuição considera apenas respostas registradas. Registros sem resposta não entram no denominador.'
        )
      );
      return;
    }

    const items = [];
    (CONFIG.answerOptions || []).forEach(function (option) {
      const count = result.totals ? result.totals[option.value] || 0 : 0;
      items.push({
        label: option.label,
        count: count,
        tone: option.tone,
        valueText: count + ' (' + Math.round((count / answered) * 100) + '%)'
      });
    });

    container.appendChild(
      buildHorizontalBars(
        items,
        'Distribuição de respostas. Denominador: ' + answered + ' respostas registradas.'
      )
    );

    container.appendChild(
      el(
        'p',
        'chart-footnote',
        'Amostra: ' +
          result.sampleSize +
          ' ' +
          plural(result.sampleSize, 'observação concluída', 'observações concluídas') +
          ' no recorte. Percentuais calculados sobre ' +
          answered +
          ' ' +
          plural(answered, 'resposta registrada', 'respostas registradas') +
          '. "Não observado / Não se aplica" não é tratado como resposta negativa.'
      )
    );
  }

  function renderMonthlyChart(result) {
    const container = $('monthlyChart');
    if (!container) return;
    clearNode(container);

    if (!result.monthly.length) {
      container.appendChild(
        el('p', 'chart-empty', 'Não há datas válidas para distribuir as observações por mês.')
      );
      return;
    }

    const max = result.monthly.reduce(function (top, month) {
      return Math.max(top, month.count);
    }, 0);

    const chart = el('div', 'column-chart');
    chart.setAttribute('role', 'img');
    chart.setAttribute(
      'aria-label',
      'Observações concluídas por mês: ' +
        result.monthly
          .map(function (month) {
            return month.label + ' ' + month.count;
          })
          .join(', ')
    );

    result.monthly.forEach(function (month) {
      const column = el('div', 'column');
      const value = el('span', 'column-value', String(month.count));
      const barWrap = el('div', 'column-bar-wrap');
      const bar = el('div', 'column-bar');
      bar.style.height = max ? Math.max(2, Math.round((month.count / max) * 100)) + '%' : '2%';
      barWrap.appendChild(bar);
      column.appendChild(value);
      column.appendChild(barWrap);
      column.appendChild(el('span', 'column-label', month.label));
      chart.appendChild(column);
    });

    container.appendChild(chart);

    const table = el('table', 'data-table data-table--compact');
    const thead = el('thead');
    const headRow = el('tr');
    ['Mês', 'Observações', 'Indicadores'].forEach(function (label) {
      headRow.appendChild(el('th', null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el('tbody');
    result.monthly.forEach(function (month) {
      const row = el('tr');
      row.appendChild(el('td', null, month.label));
      row.appendChild(el('td', null, String(month.count)));
      row.appendChild(
        el(
          'td',
          null,
          month.trendEligible
            ? 'Pontualidade Sim ' +
              month.pontualidadeSim +
              '/' +
              month.pontualidadeAnswered +
              ' · Chamada Sim ' +
              month.chamadaSim +
              '/' +
              month.chamadaAnswered
            : month.count
              ? 'Menos de 3 registros — tendência não exibida'
              : 'Sem registros'
        )
      );
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    container.appendChild(
      el(
        'p',
        'chart-footnote',
        'Total: ' +
          result.sampleSize +
          ' ' +
          plural(result.sampleSize, 'observação concluída', 'observações concluídas') +
          '. Tendência mensal somente com 3 ou mais registros no mês' +
          (result.missingDate
            ? ' · ' + result.missingDate + ' sem data válida'
            : '') +
          '.'
      )
    );
  }

  function renderAnnualChart(result) {
    const container = $('annualChart');
    if (!container) return;
    clearNode(container);

    const annual = (result && result.annual) || [];
    if (!annual.length) {
      container.appendChild(
        el('p', 'chart-empty', 'Não há observações concluídas para acompanhar por ano letivo neste recorte.')
      );
      return;
    }

    const max = annual.reduce(function (top, item) {
      return Math.max(top, item.count);
    }, 0);

    const chart = el('div', 'column-chart');
    chart.setAttribute('role', 'img');
    chart.setAttribute(
      'aria-label',
      'Observações concluídas por ano letivo: ' +
        annual.map(function (item) {
          return item.year + ' ' + item.count;
        }).join(', ')
    );

    annual.forEach(function (item) {
      const column = el('div', 'column');
      const value = el('span', 'column-value', String(item.count));
      const barWrap = el('div', 'column-bar-wrap');
      const bar = el('div', 'column-bar');
      bar.style.height = max ? Math.max(2, Math.round((item.count / max) * 100)) + '%' : '2%';
      barWrap.appendChild(bar);
      column.appendChild(value);
      column.appendChild(barWrap);
      column.appendChild(el('span', 'column-label', item.year));
      chart.appendChild(column);
    });

    container.appendChild(chart);

    const total = annual.reduce(function (top, item) {
      return top + item.count;
    }, 0);
    container.appendChild(
      el(
        'p',
        'chart-footnote',
        'Total no recorte: ' +
          total +
          ' ' +
          plural(total, 'observação concluída', 'observações concluídas') +
          '. Evolução anual com base em anos letivos identificados nas datas das observações.'
      )
    );
  }

  function renderPerformanceTable(result) {
    const container = $('performanceTeacherTable');
    if (!container) return;
    clearNode(container);

    if (!result.perTeacher.length) {
      container.appendChild(
        el('p', 'chart-empty', 'Nenhum professor no diretório ou no recorte selecionado.')
      );
      return;
    }

    const wrap = el('div', 'data-table-wrap');
    const table = el('table', 'data-table');
    const caption = el('caption', 'sr-only', 'Resumo descritivo por professor, sem ranking');
    table.appendChild(caption);

    const thead = el('thead');
    const headRow = el('tr');
    ['Professor', 'Observações', 'Turmas observadas', 'Última observação', 'Pontualidade', 'Chamada', ''].forEach(
      function (label) {
        headRow.appendChild(el('th', null, label));
      }
    );
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    result.perTeacher.forEach(function (row) {
      const tr = el('tr');
      if (row.active === false) tr.className = 'is-history';

      const nameCell = el('td');
      nameCell.appendChild(el('strong', null, row.name));
      if (row.active === false) {
        nameCell.appendChild(el('span', 'badge badge--neutral', 'Fora do cadastro'));
      }
      if (row.lowSample) {
        nameCell.appendChild(el('span', 'badge badge--warning', 'Amostra pequena'));
      }
      tr.appendChild(nameCell);

      tr.appendChild(
        el(
          'td',
          null,
          row.count + ' ' + plural(row.count, 'concluída', 'concluídas')
        )
      );
      tr.appendChild(
        el('td', null, row.classes && row.classes.length ? row.classes.join(', ') : '—')
      );
      tr.appendChild(el('td', null, row.lastDate ? formatDateBR(row.lastDate) : '—'));
      tr.appendChild(
        el(
          'td',
          null,
          row.opening.pontualidade.answered
            ? row.opening.pontualidade.sim + ' Sim / ' + row.opening.pontualidade.answered
            : 'Sem dado'
        )
      );
      tr.appendChild(
        el(
          'td',
          null,
          row.opening.chamada.answered
            ? row.opening.chamada.sim + ' Sim / ' + row.opening.chamada.answered
            : 'Sem dado'
        )
      );

      const actionCell = el('td', 'data-table-action');
      if (row.count) {
        actionCell.appendChild(
          makeButton(
            'Histórico',
            'select-teacher',
            { key: row.groupKey },
            'btn-ghost btn-sm',
            'i-history'
          )
        );
      }
      tr.appendChild(actionCell);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    container.appendChild(
      el(
        'p',
        'chart-footnote',
        'Os números são contagens descritivas dos registros concluídos. Não há nota, média de desempenho nem classificação.'
      )
    );
  }

  function renderTeacherHistory(result) {
    const container = $('teacherHistory');
    if (!container) return;
    clearNode(container);

    const groupKey = state.performanceFilters.teacherGroup;
    if (!groupKey) {
      container.appendChild(
        el(
          'p',
          'chart-empty',
          'Selecione um professor(a) no filtro ou na tabela para ver o histórico individual.'
        )
      );
      return;
    }

    const entry = result.directory.list.find(function (item) {
      return item.groupKey === groupKey;
    });
    const history = Performance.teacherHistory(
      state.observations,
      result.directory,
      groupKey,
      {
        etapa: state.performanceFilters.etapa,
        serie: state.performanceFilters.serie,
        turma: state.performanceFilters.turma,
        year: state.performanceFilters.year,
        from: state.performanceFilters.from,
        to: state.performanceFilters.to
      }
    );

    const summary = el('div', 'teacher-history-summary');
    summary.appendChild(
      el(
        'p',
        null,
        (entry ? entry.name : 'Professor(a)') +
          ' · ' +
          history.total +
          ' ' +
          plural(history.total, 'registro', 'registros') +
          ' (' +
          history.concluded +
          ' concluído(s), ' +
          history.drafts +
          ' em andamento)'
      )
    );
    container.appendChild(summary);

    if (!history.records.length) {
      container.appendChild(
        el('p', 'chart-empty', 'Nenhuma observação encontrada para este professor no recorte.')
      );
      return;
    }

    const list = el('div', 'records-list');
    history.records.forEach(function (record) {
      list.appendChild(buildRecordCard(record, 'reports'));
    });
    container.appendChild(list);
  }

  function renderPerformance() {
    const view = $('view-performance');
    if (!view) return;

    syncPerformanceControls();
    const result = Performance.compute(
      state.observations,
      state.settings,
      state.performanceFilters
    );

    const count = $('performanceCount');
    if (count) {
      count.textContent =
        result.sampleSize +
        ' ' +
        plural(result.sampleSize, 'observação concluída', 'observações concluídas') +
        ' no recorte';
    }

    renderPerformanceNotice(result);
    renderPerformanceStats(result);
    renderSingleOpeningChart(
      $('punctualityChart'),
      result.openingById.abertura_pontualidade,
      'As observações deste recorte não têm a pergunta de pontualidade. Valores não foram inventados.'
    );
    renderSingleOpeningChart(
      $('attendanceChart'),
      result.openingById.abertura_chamada,
      'As observações deste recorte não têm a pergunta de chamada. Valores não foram inventados.'
    );
    renderPerformanceDistribution(result);
    renderMonthlyChart(result);
    renderAnnualChart(result);
    renderPerformanceTable(result);
    renderTeacherHistory(result);
  }

  function resetPerformanceFilters() {
    state.performanceFilters = {
      teacherGroup: '',
      year: '',
      etapa: '',
      serie: '',
      turma: '',
      from: '',
      to: ''
    };
    syncPerformanceControls();
    renderPerformance();
  }

  async function handleAddEarlyGroup() {
    const input = $('earlyGroupInput');
    if (!input) return;
    const name = clean(input.value);
    if (!name) {
      showToast('Informe o nome do grupo da Educação Infantil.', 'warning');
      input.focus();
      return;
    }
    const exists = (state.settings.earlyChildhoodGroups || []).some(function (item) {
      return normalizeNameKey(item) === normalizeNameKey(name);
    });
    if (exists) {
      showToast('Esse grupo já está cadastrado.', 'warning');
      return;
    }
    state.settings.earlyChildhoodGroups = (state.settings.earlyChildhoodGroups || []).concat(name);
    input.value = '';
    const saved = await saveSettingsToStorage();
    renderSettings();
    if (state.form) {
      syncSchoolSelects(state.form);
    }
    showToast(
      saved ? 'Grupo adicionado.' : 'Grupo adicionado apenas nesta sessão.',
      saved ? 'success' : 'error'
    );
  }

  async function handleRemoveEarlyGroup(name) {
    const target = clean(name);
    if (!target) return;
    const confirmed = await askConfirm({
      title: 'Remover grupo',
      message:
        'Remover o grupo "' +
        target +
        '" do seletor da Educação Infantil? As observações já registradas não serão alteradas.',
      confirmLabel: 'Remover grupo',
      danger: true
    });
    if (!confirmed) return;

    state.settings.earlyChildhoodGroups = (state.settings.earlyChildhoodGroups || []).filter(
      function (item) {
        return normalizeNameKey(item) !== normalizeNameKey(target);
      }
    );
    const saved = await saveSettingsToStorage();
    renderSettings();
    if (state.form) {
      syncSchoolSelects(state.form);
    }
    showToast(
      saved ? 'Grupo removido.' : 'Grupo removido apenas nesta sessão.',
      saved ? 'success' : 'error'
    );
  }

  async function handleRemoveTeacher(id) {
    const teacher = findTeacher(id);
    if (!teacher) return;
    const confirmed = await askConfirm({
      title: 'Remover professor(a)',
      message:
        'Remover "' +
        teacher.name +
        '" da lista ativa? O identificador e o histórico de observações são preservados. Nenhum registro será apagado.',
      confirmLabel: 'Remover da lista ativa',
      danger: true
    });
    if (!confirmed) return;

    removeTeacher(id);
    const saved = await saveSettingsToStorage();
    renderSettings();
    if (state.form) syncTeacherSelect(state.form);
    renderPerformance();
    showToast(
      saved
        ? 'Professor removido da lista ativa. O histórico foi preservado.'
        : 'Remoção aplicada apenas nesta sessão. A confirmação no servidor não foi recebida.',
      saved ? 'success' : 'error'
    );
  }

  async function handleRestoreTeacher(id) {
    if (!restoreTeacher(id)) return;
    const saved = await saveSettingsToStorage();
    renderSettings();
    if (state.form) syncTeacherSelect(state.form);
    renderPerformance();
    showToast(
      saved ? 'Professor reativado na lista.' : 'Reativação aplicada apenas nesta sessão. A confirmação no servidor não foi recebida.',
      saved ? 'success' : 'error'
    );
  }

  function renderSettings() {
    const nameInput = $('settingsSchoolName');
    const unitInput = $('settingsSchoolUnit');
    const cityInput = $('settingsCity');
    const displayNameInput = $('settingsDisplayName');
    if (!nameInput || !unitInput || !cityInput) return;

    nameInput.value = state.settings.schoolName || '';
    unitInput.value = state.settings.schoolUnit || '';
    cityInput.value = state.settings.city || '';
    if (displayNameInput) {
      displayNameInput.value = state.settings.displayName || accountLabel();
    }

    renderTeacherList();
    renderEarlyGroups();
    renderSidebarSchool();
    updateStoragePanel();
  }

  function renderTeacherList() {
    const list = $('teacherList');
    const count = $('teacherCount');
    if (!list) return;
    clearNode(list);
    const teachers = state.settings.teachers || [];
    const activeCount = teachers.filter(function (teacher) {
      return teacher.active !== false;
    }).length;

    if (count) {
      count.textContent =
        activeCount +
        ' ' +
        plural(activeCount, 'ativo', 'ativos') +
        ' · ' +
        teachers.length +
        ' no cadastro';
    }

    if (!teachers.length) {
      list.appendChild(
        buildEmptyState({
          icon: 'i-users',
          title: 'Nenhum professor cadastrado',
          text: 'Cadastre os professores para manter um identificador estável e acompanhar o histórico.',
          actions: [
            {
              label: 'Adicionar professor',
              action: 'add-teacher',
              primary: true,
              icon: 'i-plus'
            }
          ]
        })
      );
      return;
    }

    teachers.forEach(function (teacher) {
      const row = el('div', 'teacher-row');
      row.appendChild(el('span', 'person-avatar', initials(teacher.name)));

      const body = el('div', 'teacher-row-body');
      body.appendChild(el('p', 'teacher-row-name', teacher.name));
      body.appendChild(
        el(
          'p',
          'teacher-row-meta',
          (clean(teacher.disciplina) || 'Disciplina não informada') +
            (teacher.active === false ? ' · Fora da lista ativa' : '')
        )
      );
      row.appendChild(body);
      if (teacher.active === false) row.classList.add('is-inactive');

      const actions = el('div', 'teacher-row-actions');
      const edit = makeButton(
        'Editar',
        'edit-teacher',
        { id: teacher.id },
        'btn-secondary btn-sm',
        'i-edit'
      );
      edit.setAttribute('aria-label', 'Editar ' + teacher.name);
      actions.appendChild(edit);
      if (teacher.active === false) {
        const restore = makeButton(
          'Reativar',
          'restore-teacher',
          { id: teacher.id },
          'btn-secondary btn-sm',
          'i-refresh'
        );
        restore.setAttribute('aria-label', 'Reativar ' + teacher.name);
        actions.appendChild(restore);
      } else {
        const remove = makeButton(
          'Remover',
          'remove-teacher',
          { id: teacher.id },
          'btn-danger-outline btn-sm',
          'i-trash'
        );
        remove.setAttribute('aria-label', 'Remover ' + teacher.name);
        actions.appendChild(remove);
      }
      row.appendChild(actions);

      list.appendChild(row);
    });
  }

  function renderEarlyGroups() {
    const list = $('earlyGroupList');
    if (!list) return;
    clearNode(list);
    const groups = state.settings.earlyChildhoodGroups || [];

    if (!groups.length) {
      list.appendChild(
        el('p', 'field-help', 'Nenhum grupo cadastrado. A Educação Infantil ficará indisponível no formulário até que ao menos um grupo seja adicionado.')
      );
      return;
    }

    groups.forEach(function (name) {
      const tag = el('span', 'tag');
      tag.appendChild(el('span', null, name));
      const remove = el('button', 'tag-remove');
      remove.type = 'button';
      remove.dataset.action = 'remove-early-group';
      remove.dataset.name = name;
      remove.setAttribute('aria-label', 'Remover grupo ' + name);
      remove.textContent = '\u00d7';
      tag.appendChild(remove);
      list.appendChild(tag);
    });
  }

  async function handleSettingsSubmit(event) {
    event.preventDefault();
    const displayName = clean($('settingsDisplayName') ? $('settingsDisplayName').value : '');
    state.settings = normalizeSettings(
      Object.assign({}, state.settings, {
        schoolName: clean($('settingsSchoolName').value),
        schoolUnit: clean($('settingsSchoolUnit').value),
        city: clean($('settingsCity').value),
        displayName: displayName
      })
    );
    const saved = await saveSettingsToStorage();
    renderSidebarSchool();
    renderSettings();

    if (saved) {
      showToast(
        'Configurações salvas. A identificação da escola e o nome do orientador serão usados nos próximos registros.',
        'success'
      );
      return;
    }

    showToast(
      'Não foi possível salvar as configurações. Elas valem apenas nesta sessão; tente novamente quando a conexão voltar.',
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
      (state.mode === 'cloud' ? 'Backup da conta exportado com ' : 'Backup exportado com ') +
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
      title: cloud ? 'Importar backup' : 'Importar backup',
      message: cloud
        ? 'O arquivo contém ' +
          records.length +
          ' ' +
          plural(records.length, 'registro', 'registros') +
          ' (exportado em ' +
          exportedAt +
          '). A importação vai combinar os registros por identificador: ' +

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
            'Alguns registros não puderam ser salvos. Nenhum dado local foi apagado.'
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
      title: 'Apagar meus dados',
      message: cloud
        ? 'Todos os registros e configurações desta conta serão apagados. Os registros salvos neste navegador serão PRESERVADOS e continuarão disponíveis para migração. Esta ação não pode ser desfeita. Recomendamos exportar um backup antes. Deseja continuar?'
        : 'Todos os registros e configurações deste navegador serão apagados. Esta ação não pode ser desfeita. Recomendamos exportar um backup antes. Deseja continuar?',
      confirmLabel: 'Apagar meus dados',
      danger: true
    });
    if (!confirmed) return;

    if (cloud) {
      const result = await Storage.clearCloudData();
      if (!result.ok) {
        showBanner(
          (result.error || 'Não foi possível apagar os dados desta conta.') +
            ' Nenhum registro foi removido da interface.'
        );
        showToast('Não foi possível confirmar a exclusão. Tente novamente.', 'error');
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
        'Dados da conta apagados. Os registros salvos neste navegador foram preservados.',
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
        (result.error || 'Não foi possível apagar os dados deste navegador.') +
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
      showToast('A migração está disponível apenas para contas com dados salvos na nuvem.', 'warning');
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
        '. Eles serão validados e salvos na sua conta. Registros com o mesmo identificador ' +
        'já existentes serão ignorados. Os dados locais não serão apagados e você ' +
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
      const hint = section ? (step.number === 2 ? step.hint : section.questions.length + ' perguntas') : step.hint;

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

  function buildOpeningQuestions(panel) {
    const questions = CONFIG.openingQuestions || [];
    if (!questions.length) return;

    const heading = el('div', 'section-heading');
    const headingText = el('div');
    headingText.appendChild(el('p', 'eyebrow', 'Abertura'));
    headingText.appendChild(el('h2', 'section-title', 'Início da aula'));
    headingText.appendChild(
      el(
        'p',
        'section-description',
        'Duas perguntas obrigatórias sobre o começo da aula. A observação curta é opcional.'
      )
    );
    heading.appendChild(headingText);
    panel.appendChild(heading);

    const card = el('div', 'card form-card opening-card-list');

    const header = el('div', 'question-section-heading');
    const headerText = el('div');
    headerText.appendChild(el('h3', null, 'Abertura — ' + questions.length + ' perguntas obrigatórias'));
    headerText.appendChild(
      el('p', null, '"Não foi possível observar" não é tratado como resposta negativa.')
    );
    header.appendChild(headerText);
    const counter = el('span', 'answered-count', '0/' + questions.length + ' respondidas');
    counter.dataset.count = 'abertura';
    header.appendChild(counter);
    card.appendChild(header);

    questions.forEach(function (question, index) {
      const questionCard = el('div', 'question-card opening-question-card');
      questionCard.dataset.questionCard = question.id;
      questionCard.dataset.openingCard = question.id;

      const questionHeader = el('div', 'question-header');
      questionHeader.appendChild(el('span', 'question-number', 'A' + (index + 1)));
      questionHeader.appendChild(el('p', 'question-text', question.text));
      questionCard.appendChild(questionHeader);

      const answers = el('div', 'answers');
      answers.setAttribute('role', 'radiogroup');
      answers.setAttribute('aria-label', question.text);

      (window.ObservaEduSchool.openingOptions()).forEach(function (option) {
        const label = el('label', 'answer-option');
        label.dataset.tone = option.tone;

        const input = el('input');
        input.type = 'radio';
        input.name = 'opening_' + question.id;
        input.value = option.value;
        input.id = 'opening_' + question.id + '_' + option.value;
        input.dataset.opening = question.id;
        input.setAttribute('aria-label', option.label + ' — ' + question.text);

        label.appendChild(input);
        label.appendChild(el('span', 'answer-pill', option.label));
        answers.appendChild(label);
      });

      questionCard.appendChild(answers);

      const noteField = el('div', 'field opening-note-field');
      const noteId = 'opening_note_' + question.id;
      const noteLabel = el('label', null, question.noteLabel || 'Observação curta (opcional)');
      noteLabel.htmlFor = noteId;
      const note = el('textarea');
      note.id = noteId;
      note.rows = 2;
      note.maxLength = 500;
      note.dataset.openingNote = question.id;
      note.placeholder = question.notePlaceholder || '';
      noteField.appendChild(noteLabel);
      noteField.appendChild(note);
      questionCard.appendChild(noteField);

      card.appendChild(questionCard);
    });

    panel.appendChild(card);
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

    if (section.step === 2) buildOpeningQuestions(panel);

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

  function teacherDirectory() {
    return Performance.buildDirectory(state.settings.teachers, state.observations);
  }

  function teacherSelectionValue(entry) {
    if (entry.id) return entry.id;
    return 'name:' + entry.name;
  }

  function syncTeacherSelect(record) {
    const select = $('fieldProfessor');
    if (!select) return;
    const identification = (record && record.identificacao) || {};
    const currentId = clean(identification.professorId);
    const currentName = clean(identification.professor);
    const directory = teacherDirectory();

    clearNode(select);
    const placeholder = el('option', null, 'Selecione um professor(a)');
    placeholder.value = '';
    select.appendChild(placeholder);

    const seen = new Set();
    directory.list.forEach(function (entry) {
      if (seen.has(entry.groupKey)) return;
      const isCurrent =
        (currentId && entry.id === currentId) ||
        (currentName && normalizeNameKey(entry.name) === normalizeNameKey(currentName));
      if (!entry.active && !isCurrent) return;
      seen.add(entry.groupKey);
      const option = el(
        'option',
        null,
        entry.name + (entry.active ? '' : ' (histórico)')
      );
      option.value = teacherSelectionValue(entry);
      option.dataset.name = entry.name;
      option.dataset.disciplina = entry.disciplina || '';
      select.appendChild(option);
    });

    // Rascunho antigo com nome livre ainda não presente no diretório.
    if (
      currentName &&
      !directory.list.some(function (entry) {
        return normalizeNameKey(entry.name) === normalizeNameKey(currentName);
      })
    ) {
      const legacy = el('option', null, currentName + ' (não cadastrado)');
      legacy.value = 'name:' + currentName;
      legacy.dataset.name = currentName;
      legacy.dataset.disciplina = clean(identification.disciplina);
      select.appendChild(legacy);
    }

    let target = '';
    if (currentId && findTeacher(currentId)) {
      target = currentId;
    } else if (currentId && directory.byId.has(currentId)) {
      target = currentId;
    } else if (currentName) {
      const match = directory.list.find(function (entry) {
        return normalizeNameKey(entry.name) === normalizeNameKey(currentName);
      });
      target = match ? teacherSelectionValue(match) : 'name:' + currentName;
    }
    select.value = target;
  }

  function levelByValue(value) {
    return CONFIG.educationLevels.find(function (level) {
      return level.value === clean(value);
    }) || null;
  }

  function seriesOptionsFor(etapa) {
    const level = levelByValue(etapa);
    if (!level) return [];
    if (level.seriesMode === 'earlyChildhoodGroups') {
      return (state.settings.earlyChildhoodGroups || []).slice();
    }
    return (level.series || []).slice();
  }

  function renderSerieOptions(etapa, selectedSerie) {
    const select = $('fieldSerie');
    if (!select) return;
    clearNode(select);

    const level = levelByValue(etapa);
    const placeholder = el('option');
    placeholder.value = '';

    if (!level) {
      placeholder.textContent = 'Selecione a etapa primeiro';
      select.appendChild(placeholder);
      select.disabled = true;
      return;
    }

    if (level.seriesMode === 'earlyChildhoodGroups') {
      const groups = state.settings.earlyChildhoodGroups || [];
      if (!groups.length) {
        placeholder.textContent = 'Configure os grupos da Educação Infantil';
        select.appendChild(placeholder);
        select.disabled = true;
        return;
      }
      placeholder.textContent = 'Selecione o grupo';
    } else {
      placeholder.textContent = 'Selecione o ano/série';
    }

    select.appendChild(placeholder);
    select.disabled = false;
    const options = seriesOptionsFor(etapa);
    options.forEach(function (name) {
      const option = el('option', null, name);
      option.value = name;
      select.appendChild(option);
    });
    const selected = clean(selectedSerie);
    if (selected && options.indexOf(selected) < 0) {
      const legacy = el('option', null, selected + ' (registro anterior)');
      legacy.value = selected;
      select.appendChild(legacy);
    }
    select.value = selected || '';
  }

  function renderTurmaOptions(selectedTurma, hasSerie) {
    const select = $('fieldTurma');
    if (!select) return;
    clearNode(select);
    const selected = clean(selectedTurma);
    const placeholder = el('option', null, hasSerie || selected ? 'Selecione a turma' : 'Selecione a série primeiro');
    placeholder.value = '';
    select.appendChild(placeholder);
    CONFIG.classOptions.forEach(function (name) {
      const option = el('option', null, name);
      option.value = name;
      select.appendChild(option);
    });
    if (selected && CONFIG.classOptions.indexOf(selected) < 0) {
      const legacy = el('option', null, selected + ' (registro anterior)');
      legacy.value = selected;
      select.appendChild(legacy);
    }
    select.disabled = !(hasSerie || selected);
    select.value = selected;
  }

  function syncSchoolSelects(record) {
    const etapaSelect = $('fieldEtapa');
    if (!etapaSelect) return;
    const identification = (record && record.identificacao) || {};

    clearNode(etapaSelect);
    const placeholder = el('option', null, 'Selecione a etapa');
    placeholder.value = '';
    etapaSelect.appendChild(placeholder);
    CONFIG.educationLevels.forEach(function (level) {
      const option = el('option', null, level.label);
      option.value = level.value;
      etapaSelect.appendChild(option);
    });

    const etapa = clean(identification.etapa);
    if (etapa && !levelByValue(etapa)) {
      const legacyEtapa = el('option', null, etapa + ' (registro anterior)');
      legacyEtapa.value = etapa;
      etapaSelect.appendChild(legacyEtapa);
    }
    etapaSelect.value = etapa;
    renderSerieOptions(etapaSelect.value, identification.serie);
    renderTurmaOptions(identification.turma, !!clean(identification.serie));

    const help = $('serieHelp');
    if (help) {
      const level = levelByValue(etapaSelect.value);
      if (level && level.seriesMode === 'earlyChildhoodGroups') {
        help.textContent = (state.settings.earlyChildhoodGroups || []).length
          ? 'Grupos configurados em Configurações.'
          : 'Nenhum grupo configurado. Cadastre os grupos da Educação Infantil em Configurações.';
      } else {
        help.textContent = 'As opções dependem da etapa escolhida.';
      }
    }
  }

  function fillFormFromState() {
    if (!state.form) return;
    const record = state.form;

    document.querySelectorAll('[data-field]').forEach(function (input) {
      input.value = stringValue(record.identificacao[input.dataset.field]);
    });

    // O observador é sempre quem está usando a conta, nunca o professor.
    if (!clean(record.identificacao.observador)) {
      record.identificacao.observador = effectiveObserverName();
    }
    const observerInput = $('fieldObservador');
    if (observerInput) observerInput.value = record.identificacao.observador;

    syncTeacherSelect(record);
    syncSchoolSelects(record);

    document.querySelectorAll('[data-opening]').forEach(function (input) {
      input.checked = openingValue(record, input.dataset.opening) === input.value;
    });
    document.querySelectorAll('[data-opening-note]').forEach(function (textarea) {
      textarea.value = openingNote(record, textarea.dataset.openingNote);
    });
    (CONFIG.openingQuestions || []).forEach(function (question) {
      if (!record.abertura[question.id]) {
        record.abertura[question.id] = { valor: '', nota: '' };
      }
    });

    const teacherNote = $('fieldObservacoesProfessor');
    if (teacherNote) teacherNote.value = stringValue(record.observacoesProfessor);

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
    const openingQuestions = CONFIG.openingQuestions || [];
    let openingAnswered = 0;
    openingQuestions.forEach(function (question) {
      const value = openingValue(state.form, question.id);
      if (answerIsValid(value)) openingAnswered += 1;
      const card = document.querySelector(
        '[data-question-card="' + question.id + '"]'
      );
      if (card) card.classList.toggle('is-answered', answerIsValid(value));
    });

    const openingCounter = document.querySelector('[data-count="abertura"]');
    if (openingCounter) {
      openingCounter.textContent =
        openingAnswered + '/' + openingQuestions.length + ' respondidas';
    }

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

    if (step === 2) {
      const openingComplete = (CONFIG.openingQuestions || []).every(function (question) {
        return answerIsValid(openingValue(record, question.id));
      });
      const section = CONFIG.sections.find(function (item) {
        return item.step === 2;
      });
      return (
        openingComplete &&
        (!section ||
          section.questions.every(function (question) {
            return answerIsValid(record.respostas[question.id]);
          }))
      );
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

    if (step === 2) {
      const openingTotal = (CONFIG.openingQuestions || []).length;
      const openingAnswered = getOpeningAnsweredCount(state.form);
      const section = CONFIG.sections.find(function (item) {
        return item.step === 2;
      });
      const sectionTotal = section ? section.questions.length : 0;
      const sectionAnswered = section
        ? section.questions.filter(function (question) {
            return answerIsValid(state.form.respostas[question.id]);
          }).length
        : 0;
      return (
        'Abertura ' + openingAnswered + '/' + openingTotal +
        ' · ' + sectionAnswered + ' de ' + sectionTotal + ' perguntas'
      );
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
      const details = [
        clean(identification.disciplina),
        Performance.classLabel(identification)
      ]
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
            : 'Não foi possível confirmar a gravação do registro.') +
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
          : 'Não foi possível salvar o rascunho neste navegador. Os dados continuam apenas nesta sessão.',
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
    const unansweredCount = validation.unanswered.length;
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
        unansweredCount
          ? unansweredCount + ' ' + plural(unansweredCount, 'sem resposta', 'sem resposta')
          : 'Todas respondidas',
        unansweredCount ? 'warning' : 'positive',
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
        const groups = [
          {
            id: 'abertura',
            title: 'Abertura da aula',
            count: validation.unanswered.filter(function (item) {
              return item.section.id === 'abertura';
            }).length
          }
        ].concat(
          CONFIG.sections.map(function (section) {
            return {
              id: section.id,
              title: section.title,
              count: validation.unanswered.filter(function (item) {
                return item.section.id === section.id;
              }).length
            };
          })
        );
        const bySection = groups
          .filter(function (group) {
            return group.count;
          })
          .map(function (group) {
            return group.title + ': ' + group.count;
          })
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
    const openingTotal = (CONFIG.openingQuestions || []).length;
    const openingDone = getOpeningAnsweredCount(record);
    const openingRow = el('tr');
    openingRow.appendChild(el('th', null, 'Abertura da aula'));
    openingRow.appendChild(el('td', null, String(openingDone)));
    openingRow.appendChild(el('td', null, String(openingTotal)));
    openingRow.appendChild(el('td', null, String(openingTotal - openingDone)));
    tbody.appendChild(openingRow);
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
            'A última gravação deste registro não foi confirmada. ' +
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
            'Este relatório está disponível apenas nesta sessão; exporte um backup antes de fechar a página.'
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
        'Prévia gerada, mas a gravação não foi confirmada. O conteúdo continua no formulário.',
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
      showToast('Observação concluída e relatório gerado.', 'success');
      return;
    }

    showToast(
      'Relatório gerado, mas a conclusão não foi confirmada. Use "Salvar rascunho" para tentar novamente.',
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
          ? ' O registro será removido da sua conta.'

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

      case 'add-teacher':
        openTeacherDialog('');
        break;

      case 'edit-teacher':
        openTeacherDialog(id);
        break;

      case 'remove-teacher':
        await handleRemoveTeacher(id);
        break;

      case 'restore-teacher':
        await handleRestoreTeacher(id);
        break;

      case 'add-early-group':
        await handleAddEarlyGroup();
        break;

      case 'remove-early-group':
        await handleRemoveEarlyGroup(actionElement.dataset.name);
        break;

      case 'clear-performance-filters':
        resetPerformanceFilters();
        break;

      case 'select-teacher':
        state.performanceFilters.teacherGroup = actionElement.dataset.key || '';
        syncPerformanceControls();
        renderPerformance();
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

  window.ObservaEduDomain = {
    normalizeRecord: normalizeRecord,
    normalizeSettings: normalizeSettings,
    normalizeTeachers: normalizeTeachers,
    normalizeAbertura: normalizeAbertura,
    createTeacherId: createTeacherId
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

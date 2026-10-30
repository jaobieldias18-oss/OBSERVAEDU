/*
 * ObservaEdu — Cálculos do painel de desempenho
 * ----------------------------------------------
 * Este arquivo contém apenas funções de leitura e agregação. Ele não
 * grava dados, não classifica professores e não inventa informações:
 * todos os números vêm dos registros concluídos e das configurações
 * existentes. Amostras pequenas são sinalizadas para evitar leituras
 * apressadas.
 *
 * A separação também permite testar os cálculos fora do navegador.
 */

window.ObservaEduPerformance = (function () {
  'use strict';

  const CONFIG = window.OBSERVAEDU_CONFIG;
  const MONTHS = [
    'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
    'jul', 'ago', 'set', 'out', 'nov', 'dez'
  ];

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function searchKey(value) {
    return clean(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function answerIsValid(value) {
    return CONFIG.answerOptions.some(function (option) {
      return option.value === value;
    });
  }

  function answerTone(value) {
    const option = CONFIG.answerOptions.find(function (item) {
      return item.value === value;
    });
    return option ? option.tone : 'neutral';
  }

  function stageLabel(value) {
    const level = CONFIG.educationLevels.find(function (item) {
      return item.value === clean(value);
    });
    return level ? level.label : clean(value) || 'Etapa não informada';
  }

  // Rótulo de exibição da turma. Registros antigos guardavam apenas um texto
  // livre em `turma`; os novos guardam etapa, série e turma (A/B).
  function classLabel(identification) {
    const ident = identification || {};
    const serie = clean(ident.serie);
    const turma = clean(ident.turma);
    if (serie && turma) return serie + ' · ' + turma;
    return serie || turma || 'Turma não informada';
  }

  function teacherGroupKey(identification) {
    const ident = identification || {};
    const id = clean(ident.professorId);
    if (id) return 'id:' + id;
    const name = clean(ident.professor);
    return name ? 'name:' + searchKey(name) : '';
  }

  function normalizedTeacherId(teachers) {
    const used = new Set();
    (teachers || []).forEach(function (teacher) {
      const id = clean(teacher && teacher.id);
      if (id) used.add(id);
    });
    return used;
  }

  /*
   * Monta o diretório de professores combinando o cadastro atual com os
   * nomes encontrados nas observações. Assim, um professor removido do
   * cadastro continua tendo seu histórico preservado, e registros antigos
   * sem identificador continuam agrupados pelo nome.
   */
  function buildDirectory(teachers, observations) {
    const list = [];
    const byId = new Map();
    const byName = new Map();
    const usedIds = normalizedTeacherId(teachers);

    (teachers || []).forEach(function (raw) {
      const teacher = raw && typeof raw === 'object' ? raw : {};
      const name = clean(teacher.name);
      if (!name) return;
      const key = searchKey(name);
      if (byName.has(key)) return;
      const id = clean(teacher.id);
      const entry = {
        id: id,
        name: name,
        disciplina: clean(teacher.disciplina),
        active: teacher.active !== false,
        history: teacher.active === false,
        legacy: false,
        groupKey: id ? 'id:' + id : 'name:' + key
      };
      list.push(entry);
      byName.set(key, entry);
      if (id) byId.set(id, entry);
    });

    const sorted = (observations || []).slice().sort(function (a, b) {
      return (new Date(b.updatedAt).getTime() || 0) - (new Date(a.updatedAt).getTime() || 0);
    });

    sorted.forEach(function (record) {
      const ident = (record && record.identificacao) || {};
      const name = clean(ident.professor);
      if (!name) return;
      const key = searchKey(name);
      const id = clean(ident.professorId);

      // Professor cadastrado e ainda ativo: usa o nome atual do cadastro.
      if (id && byId.has(id)) return;
      // Registro antigo cujo nome corresponde a um professor cadastrado.
      if (!id && byName.has(key)) return;

      if (id) {
        if (byId.has(id)) return;
        const entry = {
          id: id,
          name: name,
          disciplina: clean(ident.disciplina),
          active: false,
          history: true,
          legacy: false,
          groupKey: 'id:' + id
        };
        list.push(entry);
        byId.set(id, entry);
        if (!byName.has(key)) byName.set(key, entry);
        return;
      }

      if (byName.has(key)) return;
      const entry = {
        id: '',
        name: name,
        disciplina: clean(ident.disciplina),
        active: false,
        history: false,
        legacy: true,
        groupKey: 'name:' + key
      };
      list.push(entry);
      byName.set(key, entry);
    });

    list.sort(function (a, b) {
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    });

    return { list: list, byId: byId, byName: byName, usedIds: usedIds };
  }

  function resolveGroupKey(identification, directory) {
    const ident = identification || {};
    const id = clean(ident.professorId);
    if (id && directory && directory.byId.has(id)) {
      return directory.byId.get(id).groupKey;
    }
    const name = clean(ident.professor);
    if (name && directory && directory.byName.has(searchKey(name))) {
      return directory.byName.get(searchKey(name)).groupKey;
    }
    return teacherGroupKey(ident);
  }

  function isConcluded(record) {
    return !!record && record.status === 'concluida';
  }

  function emptyCounts() {
    return {
      sim: 0,
      parcial: 0,
      nao: 0,
      na: 0,
      unanswered: 0,
      answered: 0,
      applicable: 0,
      total: 0
    };
  }

  function addAnswers(counts, answers) {
    const source = answers && typeof answers === 'object' ? answers : {};
    CONFIG.sections.forEach(function (section) {
      section.questions.forEach(function (question) {
        const value = source[question.id];
        counts.total += 1;
        if (!answerIsValid(value)) {
          counts.unanswered += 1;
          return;
        }
        counts.answered += 1;
        if (value === 'sim') counts.sim += 1;
        else if (value === 'parcial') counts.parcial += 1;
        else if (value === 'nao') counts.nao += 1;
        else if (value === 'na') counts.na += 1;
      });
    });
    counts.applicable = counts.sim + counts.parcial + counts.nao;
    return counts;
  }

  function answerTotals(records) {
    const counts = emptyCounts();
    (records || []).forEach(function (record) {
      addAnswers(counts, record.respostas);
    });
    counts.applicable = counts.sim + counts.parcial + counts.nao;
    return counts;
  }

  function distribution(counts) {
    return [
      { key: 'sim', label: 'Sim', count: counts.sim, tone: answerTone('sim') },
      { key: 'parcial', label: 'Parcialmente', count: counts.parcial, tone: answerTone('parcial') },
      { key: 'nao', label: 'Não', count: counts.nao, tone: answerTone('nao') },
      { key: 'na', label: 'Não observado / N/A', count: counts.na, tone: answerTone('na') },
      { key: 'unanswered', label: 'Sem resposta', count: counts.unanswered, tone: 'neutral' }
    ];
  }

  function openingSummary(records) {
    return (CONFIG.openingQuestions || []).map(function (question) {
      const counts = { sim: 0, parcial: 0, nao: 0, na: 0, total: 0, missing: 0, notes: 0 };
      (records || []).forEach(function (record) {
        const entry = record.abertura && record.abertura[question.id];
        const value = entry && typeof entry === 'object' ? entry.valor : entry;
        counts.total += 1;
        if (answerIsValid(value)) {
          counts[value] += 1;
          if (entry && clean(entry.nota)) counts.notes += 1;
        } else {
          counts.missing += 1;
        }
      });
      return {
        id: question.id,
        text: question.text,
        counts: counts,
        answered: counts.total - counts.missing
      };
    });
  }

  function parseMonth(value) {
    const match = /^(\d{4})-(\d{2})/.exec(clean(value));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return { year: year, month: month };
  }

  function monthKey(parts) {
    return parts.year + '-' + String(parts.month).padStart(2, '0');
  }

  function monthLabel(parts) {
    return MONTHS[parts.month - 1] + '/' + String(parts.year).slice(-2);
  }

  function openingValue(record, questionId) {
    const entry = record && record.abertura ? record.abertura[questionId] : null;
    if (!entry) return '';
    return typeof entry === 'object' ? entry.valor : entry;
  }

  function emptyOpeningCounts() {
    return { sim: 0, parcial: 0, nao: 0, na: 0, missing: 0, answered: 0, total: 0 };
  }

  function addOpeningValue(counts, value) {
    counts.total += 1;
    if (!answerIsValid(value)) {
      counts.missing += 1;
      return;
    }
    counts.answered += 1;
    if (counts[value] !== undefined) counts[value] += 1;
  }

  function openingDistribution(counts) {
    const options = CONFIG.openingOptions || CONFIG.answerOptions || [];
    return options.map(function (option) {
      return {
        key: option.value,
        label: option.label,
        count: counts[option.value] || 0,
        tone: option.tone || answerTone(option.value)
      };
    });
  }

  // Série mensal com meses intermediários preenchidos com zero para não
  // sugerir continuidade onde não há registros. Limita a janela a `maxMonths`.
  // Indicadores de abertura só entram na tendência quando o mês tem 3+ registros.
  function monthlySeries(records, maxMonths) {
    const map = new Map();
    let missingDate = 0;

    (records || []).forEach(function (record) {
      const parts = parseMonth(record.identificacao && record.identificacao.data);
      if (!parts) {
        missingDate += 1;
        return;
      }
      const key = monthKey(parts);
      if (!map.has(key)) {
        map.set(key, {
          key: key,
          label: monthLabel(parts),
          year: parts.year,
          month: parts.month,
          count: 0,
          trendEligible: false,
          pontualidadeAnswered: 0,
          pontualidadeSim: 0,
          chamadaAnswered: 0,
          chamadaSim: 0
        });
      }
      const bucket = map.get(key);
      bucket.count += 1;
      const pontualidade = openingValue(record, 'abertura_pontualidade');
      if (answerIsValid(pontualidade)) {
        bucket.pontualidadeAnswered += 1;
        if (pontualidade === 'sim') bucket.pontualidadeSim += 1;
      }
      const chamada = openingValue(record, 'abertura_chamada');
      if (answerIsValid(chamada)) {
        bucket.chamadaAnswered += 1;
        if (chamada === 'sim') bucket.chamadaSim += 1;
      }
    });

    const keys = Array.from(map.keys()).sort();
    if (!keys.length) return { series: [], missingDate: missingDate };

    const first = keys[0];
    const last = keys[keys.length - 1];
    const firstParts = { year: Number(first.slice(0, 4)), month: Number(first.slice(5, 7)) };
    const lastParts = { year: Number(last.slice(0, 4)), month: Number(last.slice(5, 7)) };

    const series = [];
    let cursor = { year: firstParts.year, month: firstParts.month };
    while (
      cursor.year < lastParts.year ||
      (cursor.year === lastParts.year && cursor.month <= lastParts.month)
    ) {
      const key = monthKey(cursor);
      series.push(
        map.get(key) || {
          key: key,
          label: monthLabel(cursor),
          year: cursor.year,
          month: cursor.month,
          count: 0,
          trendEligible: false,
          pontualidadeAnswered: 0,
          pontualidadeSim: 0,
          chamadaAnswered: 0,
          chamadaSim: 0
        }
      );
      cursor = cursor.month === 12
        ? { year: cursor.year + 1, month: 1 }
        : { year: cursor.year, month: cursor.month + 1 };
    }

    const limit = Number(maxMonths) > 0 ? Number(maxMonths) : 12;
    const trimmed = series.slice(-limit);
    trimmed.forEach(function (month) {
      month.trendEligible = month.count >= 3;
    });
    return { series: trimmed, missingDate: missingDate };
  }

  // Evolução anual: contagem de observações concluídas por ano letivo.
  // Só exibe anos com registros; anos sem observações não são fabricados.
  function annualSeries(records) {
    const counts = new Map();
    (records || []).forEach(function (record) {
      const year = academicYear(record.identificacao && record.identificacao.data);
      if (!year) return;
      if (!counts.has(year)) counts.set(year, { year: year, count: 0 });
      counts.get(year).count += 1;
    });
    return Array.from(counts.values())
      .sort(function (a, b) {
        return Number(b.year) - Number(a.year);
      })
      .map(function (entry) {
        return { year: entry.year, count: entry.count };
      });
  }

  function perTeacher(records, directory, selectedGroup) {
    const groups = new Map();

    function ensure(entry) {
      if (!groups.has(entry.groupKey)) {
        groups.set(entry.groupKey, {
          groupKey: entry.groupKey,
          id: entry.id,
          name: entry.name,
          disciplina: entry.disciplina,
          active: entry.active,
          history: entry.history,
          legacy: entry.legacy,
          count: 0,
          lastDate: '',
          classes: [],
          classSet: new Set(),
          opening: {
            pontualidade: emptyOpeningCounts(),
            chamada: emptyOpeningCounts()
          },
          counts: emptyCounts()
        });
      }
      return groups.get(entry.groupKey);
    }

    directory.list.forEach(function (entry) {
      if (selectedGroup && entry.groupKey !== selectedGroup) return;
      ensure(entry);
    });

    (records || []).forEach(function (record) {
      const key = resolveGroupKey(record.identificacao, directory);
      const entry = directory.list.find(function (item) {
        return item.groupKey === key;
      });
      if (!entry) return;
      if (selectedGroup && key !== selectedGroup) return;
      const row = ensure(entry);
      row.count += 1;
      addAnswers(row.counts, record.respostas);
      addOpeningValue(row.opening.pontualidade, openingValue(record, 'abertura_pontualidade'));
      addOpeningValue(row.opening.chamada, openingValue(record, 'abertura_chamada'));
      const className = classLabel(record.identificacao);
      if (className && !row.classSet.has(className)) {
        row.classSet.add(className);
        row.classes.push(className);
      }
      const date = clean(record.identificacao && record.identificacao.data);
      if (date && date > row.lastDate) row.lastDate = date;
    });

    return Array.from(groups.values()).map(function (row) {
      row.counts.applicable = row.counts.sim + row.counts.parcial + row.counts.nao;
      row.lowSample = row.count > 0 && row.count < 3;
      delete row.classSet;
      return row;
    });
  }

  function academicYear(isoDate) {
    const match = /^(\d{4})/.exec(clean(isoDate));
    return match ? match[1] : '';
  }

  function matchesScope(record, filters, directory) {
    const ident = (record && record.identificacao) || {};
    if (filters.etapa && clean(ident.etapa) !== filters.etapa) return false;
    if (filters.serie && clean(ident.serie) !== filters.serie) return false;
    if (filters.turma && clean(ident.turma) !== filters.turma) return false;
    const date = clean(ident.data);
    if (filters.year && academicYear(date) !== filters.year) return false;
    if (filters.from && (!date || date < filters.from)) return false;
    if (filters.to && (!date || date > filters.to)) return false;
    if (
      filters.teacherGroup &&
      resolveGroupKey(ident, directory) !== filters.teacherGroup
    ) {
      return false;
    }
    return true;
  }

  /*
   * Calcula o recorte do painel. Somente observações concluídas entram nos
   * indicadores; o histórico individual do professor é tratado à parte.
   */
  function compute(observations, settings, filters) {
    const config = filters || {};
    const directory = buildDirectory(
      settings && settings.teachers,
      observations
    );
    const all = (observations || []).filter(isConcluded);
    const filtered = all.filter(function (record) {
      return matchesScope(record, config, directory);
    });

    const totals = answerTotals(filtered);
    const opening = openingSummary(filtered);
    const monthly = monthlySeries(filtered, 12);
    const rows = perTeacher(filtered, directory, config.teacherGroup);

    const groupsInScope = new Set();
    const classSet = new Set();
    const years = new Set();
    filtered.forEach(function (record) {
      const key = resolveGroupKey(record.identificacao, directory);
      if (key) groupsInScope.add(key);
      classSet.add(classLabel(record.identificacao));
      const year = academicYear(record.identificacao && record.identificacao.data);
      if (year) years.add(year);
    });
    (observations || []).forEach(function (record) {
      const year = academicYear(record.identificacao && record.identificacao.data);
      if (year) years.add(year);
    });

    const recordsWithOpening = filtered.filter(function (record) {
      return (CONFIG.openingQuestions || []).some(function (question) {
        const entry = record.abertura && record.abertura[question.id];
        const value = entry && typeof entry === 'object' ? entry.valor : entry;
        return answerIsValid(value);
      });
    }).length;

    const monthsWithSample = monthly.series.filter(function (month) {
      return month.count >= 3;
    }).length;
    const trendAvailable = filtered.length >= 6 && monthsWithSample >= 2;

    const openingById = {};
    opening.forEach(function (item) {
      openingById[item.id] = item;
    });

    return {
      directory: directory,
      allConcludedCount: all.length,
      records: filtered,
      sampleSize: filtered.length,
      totals: totals,
      distribution: distribution(totals),
      opening: opening,
      openingById: openingById,
      recordsWithOpening: recordsWithOpening,
      classesObserved: Array.from(classSet).sort(function (a, b) {
        return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
      }),
      years: Array.from(years).sort().reverse(),
      annual: annualSeries(filtered),
      monthly: monthly.series,
      missingDate: monthly.missingDate,
      trendAvailable: trendAvailable,
      monthsWithSample: monthsWithSample,
      perTeacher: rows,
      teachersInScope: groupsInScope.size,
      hasData: filtered.length > 0
    };
  }

  // Histórico individual: inclui rascunhos e concluídas do professor.
  function teacherHistory(observations, directory, groupKey, filters) {
    const config = filters || {};
    const rows = (observations || []).filter(function (record) {
      const ident = (record && record.identificacao) || {};
      if (resolveGroupKey(ident, directory) !== groupKey) return false;
      if (config.etapa && clean(ident.etapa) !== config.etapa) return false;
      if (config.serie && clean(ident.serie) !== config.serie) return false;
      if (config.turma && clean(ident.turma) !== config.turma) return false;
      const date = clean(ident.data);
      if (config.year && academicYear(date) !== config.year) return false;
      if (config.from && (!date || date < config.from)) return false;
      if (config.to && (!date || date > config.to)) return false;
      return true;
    });

    rows.sort(function (a, b) {
      const aDate = clean(a.identificacao && a.identificacao.data);
      const bDate = clean(b.identificacao && b.identificacao.data);
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return (new Date(b.updatedAt).getTime() || 0) - (new Date(a.updatedAt).getTime() || 0);
    });

    return {
      records: rows,
      total: rows.length,
      concluded: rows.filter(isConcluded).length,
      drafts: rows.filter(function (record) {
        return !isConcluded(record);
      }).length
    };
  }

  return {
    buildDirectory: buildDirectory,
    resolveGroupKey: resolveGroupKey,
    teacherGroupKey: teacherGroupKey,
    classLabel: classLabel,
    stageLabel: stageLabel,
    answerTotals: answerTotals,
    distribution: distribution,
    openingSummary: openingSummary,
    monthlySeries: monthlySeries,
    annualSeries: annualSeries,
    perTeacher: perTeacher,
    compute: compute,
    teacherHistory: teacherHistory,
    searchKey: searchKey,
    academicYear: academicYear,
    openingDistribution: openingDistribution,
    openingValue: openingValue
  };
})();

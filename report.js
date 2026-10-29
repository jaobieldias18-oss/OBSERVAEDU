/*
 * ObservaEdu — Montagem do relatório pedagógico
 * ---------------------------------------------
 * Todo o conteúdo vindo do formulário é inserido com textContent, e não
 * com innerHTML. Isso evita que textos digitados sejam interpretados como
 * HTML e mantém o documento seguro.
 */

window.ObservaEduReport = (function () {
  'use strict';

  const CONFIG = window.OBSERVAEDU_CONFIG;

  function el(tagName, className, content) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (content !== undefined && content !== null) element.textContent = String(content);
    return element;
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

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function formatDate(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(isoDate));
    if (!match) return 'Não informado';
    return match[3] + '/' + match[2] + '/' + match[1];
  }

  function formatTime(value) {
    return /^\d{2}:\d{2}$/.test(clean(value)) ? clean(value) : 'Não informado';
  }

  function formatDateTime(iso) {
    if (!iso) return 'Não informado';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Não informado';
    return (
      date.toLocaleDateString('pt-BR') +
      ' às ' +
      date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    );
  }

  function reportCode(record) {
    const compact = clean(record.id).replace(/[^a-zA-Z0-9]/g, '');
    return compact ? compact.slice(-8).toUpperCase() : '—';
  }

  function answerBadge(value) {
    const option = CONFIG.answerOptions.find(function (item) {
      return item.value === value;
    });
    if (!option) {
      return el('span', 'report-answer report-answer--missing', 'Sem resposta registrada');
    }
    return el('span', 'report-answer report-answer--' + option.tone, option.label);
  }

  function statusBadge(status) {
    const meta = CONFIG.statuses[status] || { label: 'Status não informado', tone: 'neutral' };
    return el('span', 'report-status report-status--' + meta.tone, meta.label);
  }

  function textBlock(parent, value, emptyMessage) {
    const content = clean(value);
    if (content) {
      const paragraph = el('p', 'report-text report-preline', content);
      parent.appendChild(paragraph);
      return paragraph;
    }
    const empty = el('p', 'report-empty', emptyMessage || 'Não informado.');
    parent.appendChild(empty);
    return empty;
  }

  function addSubsection(parent, title, value, options) {
    const settings = options || {};
    const block = el('div', 'report-subsection');
    block.appendChild(el('h3', 'report-subtitle', title));
    if (settings.note) {
      block.appendChild(el('p', 'report-source-note', settings.note));
    }
    textBlock(block, value, settings.emptyMessage);
    if (settings.after) {
      append(block, settings.after);
    }
    parent.appendChild(block);
    return block;
  }

  function addInfoPair(list, label, value) {
    const item = el('div', 'report-id-item');
    item.appendChild(el('dt', 'report-id-label', label));
    item.appendChild(el('dd', 'report-id-value', clean(value) || 'Não informado'));
    list.appendChild(item);
    return item;
  }

  function countFacts(analysis) {
    const wrapper = el('div', 'report-table-wrap');
    const table = el('table', 'report-table');
    const caption = el('caption', 'sr-only', 'Quantidade de respostas por etapa');
    table.appendChild(caption);

    const thead = el('thead');
    const headRow = el('tr');
    ['Etapa', 'Sim', 'Parcialmente', 'Não', 'N/NA', 'Aplicáveis'].forEach(function (label) {
      headRow.appendChild(el('th', null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    analysis.sections.forEach(function (section) {
      const row = el('tr');
      row.appendChild(el('th', null, section.title));
      row.appendChild(el('td', null, String(section.counts.sim)));
      row.appendChild(el('td', null, String(section.counts.parcial)));
      row.appendChild(el('td', null, String(section.counts.nao)));
      row.appendChild(el('td', null, String(section.counts.na)));
      row.appendChild(el('td', null, String(section.counts.applicable)));
      tbody.appendChild(row);
    });

    const totalRow = el('tr', 'report-table-total');
    totalRow.appendChild(el('th', null, 'Total'));
    totalRow.appendChild(el('td', null, String(analysis.totals.sim)));
    totalRow.appendChild(el('td', null, String(analysis.totals.parcial)));
    totalRow.appendChild(el('td', null, String(analysis.totals.nao)));
    totalRow.appendChild(el('td', null, String(analysis.totals.na)));
    totalRow.appendChild(el('td', null, String(analysis.totals.applicable)));
    tbody.appendChild(totalRow);
    table.appendChild(tbody);
    wrapper.appendChild(table);

    wrapper.appendChild(
      el(
        'p',
        'report-table-note',
        'N/NA = Não observado / Não se aplica. Essas respostas não são contabilizadas como práticas negativas.'
      )
    );

    return wrapper;
  }

  function attentionEvidence(parent, analysis) {
    const items = [];
    analysis.sections.forEach(function (section) {
      section.attention.forEach(function (item) {
        items.push({ section: section.title, question: item.question, value: item.value });
      });
    });

    if (items.length === 0) {
      parent.appendChild(
        el('p', 'report-empty', 'Não há respostas assinaladas como "Parcialmente" ou "Não" nos registros disponíveis.')
      );
      return;
    }

    const list = el('ul', 'report-evidence-list');
    items.forEach(function (item) {
      const li = el('li', 'report-evidence-item');
      const top = el('div', 'report-evidence-top');
      top.appendChild(answerBadge(item.value));
      top.appendChild(el('span', 'report-evidence-section', item.section));
      li.appendChild(top);
      li.appendChild(el('p', 'report-evidence-text', item.question.text));
      list.appendChild(li);
    });
    parent.appendChild(list);
  }

  function buildReferenceList(analysis) {
    const commented = analysis.sections.filter(function (section) {
      return section.comment;
    });

    const wrapper = el('div', 'report-reference');
    wrapper.appendChild(el('strong', null, 'Comentários considerados: '));
    wrapper.appendChild(
      document.createTextNode(
        commented.length
          ? commented.map(function (section) { return section.title; }).join(', ') + '.'
          : 'nenhum comentário por etapa registrado.'
      )
    );

    const filled = CONFIG.complementaryFields.filter(function (field) {
      const value = analysisRecordComplementaryValue(analysis, field.key);
      return value;
    });

    wrapper.appendChild(document.createElement('br'));
    wrapper.appendChild(el('strong', null, 'Campos complementares preenchidos: '));
    wrapper.appendChild(
      document.createTextNode(
        filled.length
          ? filled.map(function (field) { return field.label.toLowerCase(); }).join(', ') + '.'
          : 'nenhum.'
      )
    );
    return wrapper;
  }

  // Mantida separada para deixar explícito que os campos complementares
  // são lidos do próprio registro, não inferidos pela análise.
  let currentRecordForReferences = null;
  function analysisRecordComplementaryValue(analysis, key) {
    if (!currentRecordForReferences) return '';
    return clean(currentRecordForReferences.complementares && currentRecordForReferences.complementares[key]);
  }

  function render(container, record, settings, analysis) {
    currentRecordForReferences = record;
    const config = settings || {};
    const sections = analysis.sections;
    const narratives = window.ObservaEduAnalysis.getNarratives(record);
    const analysisMeta = record.analise || {};
    const isDraft = record.status !== 'concluida';
    const isEdited = !!analysisMeta.manuallyEdited;
    const isStale = window.ObservaEduAnalysis.isStale(record);
    const identificacao = record.identificacao || {};
    const complementares = record.complementares || {};

    container.textContent = '';

    const article = el('article', 'report-document');
    article.id = 'reportDocument';
    article.setAttribute('aria-labelledby', 'reportDocumentTitle');

    if (isDraft) {
      const draft = el(
        'div',
        'report-draft-banner',
        'RASCUNHO — este registro ainda não foi concluído. O documento pode estar incompleto.'
      );
      article.appendChild(draft);
    }

    if (isStale) {
      article.appendChild(
        el(
          'div',
          'report-warning',
          'Atenção: as respostas foram alteradas depois da edição manual da análise. Revise a análise antes de utilizar este documento.'
        )
      );
    }

    /* Cabeçalho */
    const header = el('header', 'report-header');
    const brand = el('div', 'report-brand');
    const logo = el('img', 'report-logo');
    logo.src = 'logo.svg';
    logo.alt = '';
    logo.width = 46;
    logo.height = 46;
    logo.setAttribute('aria-hidden', 'true');
    brand.appendChild(logo);

    const brandText = el('div', 'report-brand-text');
    const schoolName = clean(config.schoolName);
    brandText.appendChild(el('p', 'report-school', schoolName || 'Escola não cadastrada'));
    brandText.appendChild(el('p', 'report-system', 'ObservaEdu · Observação Pedagógica'));

    const schoolDetails = [clean(config.schoolUnit), clean(config.city)].filter(Boolean).join(' · ');
    if (schoolDetails) {
      brandText.appendChild(el('p', 'report-school-detail', schoolDetails));
    }
    brand.appendChild(brandText);

    const headerTags = el('div', 'report-header-tags');
    headerTags.appendChild(statusBadge(record.status));
    header.appendChild(brand);
    header.appendChild(headerTags);

    const title = el('h1', 'report-title', 'Relatório de Observação Pedagógica');
    title.id = 'reportDocumentTitle';
    header.appendChild(title);
    header.appendChild(
      el('p', 'report-subtitle', 'Registro e análise de práticas observadas em sala de aula')
    );

    const metaLine = el('div', 'report-meta-line');
    metaLine.appendChild(el('span', null, 'Data da observação: ' + formatDate(identificacao.data)));
    metaLine.appendChild(el('span', null, 'Código do registro: ' + reportCode(record)));
    metaLine.appendChild(el('span', null, 'Situação: ' + ((CONFIG.statuses[record.status] || {}).label || 'Não informado')));
    header.appendChild(metaLine);
    article.appendChild(header);

    /* Identificação */
    const identification = el('section', 'report-identification');
    identification.appendChild(el('h2', 'report-section-title', 'Identificação'));
    const idList = el('dl', 'report-id-grid');
    addInfoPair(idList, 'Professor(a) observado(a)', identificacao.professor);
    addInfoPair(idList, 'Disciplina', identificacao.disciplina);
    addInfoPair(idList, 'Turma / ano escolar', identificacao.turma);
    addInfoPair(idList, 'Data da observação', formatDate(identificacao.data));
    addInfoPair(idList, 'Horário da aula', formatTime(identificacao.horario));
    addInfoPair(idList, 'Orientador(a) / observador(a)', identificacao.observador);
    addInfoPair(idList, 'Escola', schoolName || 'Não cadastrada');
    identification.appendChild(idList);
    article.appendChild(identification);

    /* Seção 1 */
    const objective = el('section', 'report-section');
    objective.appendChild(el('h2', 'report-section-title', '1. Objetivo da observação'));
    textBlock(
      objective,
      identificacao.tema,
      'Não informado. O tema ou objetivo da aula não foi registrado.'
    );
    article.appendChild(objective);

    /* Seções 2 a 4 */
    CONFIG.sections.forEach(function (sectionConfig, index) {
      const result = sections.find(function (section) { return section.id === sectionConfig.id; });
      const sectionNumber = index + 2;
      const section = el('section', 'report-section');
      section.appendChild(
        el('h2', 'report-section-title', sectionNumber + '. ' + sectionConfig.title)
      );
      if (sectionConfig.description) {
        section.appendChild(el('p', 'report-section-description', sectionConfig.description));
      }

      sectionConfig.questions.forEach(function (question, questionIndex) {
        const value = clean(record.respostas && record.respostas[question.id]);
        const block = el('div', 'report-question');
        const questionLine = el('div', 'report-question-line');
        questionLine.appendChild(
          el(
            'p',
            'report-question-text',
            questionIndex + 1 + '. ' + question.text
          )
        );
        questionLine.appendChild(answerBadge(value));
        block.appendChild(questionLine);
        section.appendChild(block);
      });

      const comments = el('div', 'report-comments');
      comments.appendChild(el('h3', 'report-subtitle', 'Comentários da etapa'));
      textBlock(
        comments,
        result && result.comment,
        'Nenhum comentário registrado nesta etapa.'
      );
      section.appendChild(comments);
      article.appendChild(section);
    });

    /* Seção 5 */
    const synthesis = el('section', 'report-section');
    synthesis.appendChild(el('h2', 'report-section-title', '5. Síntese da observação'));
    synthesis.appendChild(
      el(
        'p',
        'report-source-note',
        isEdited
          ? 'Síntese automática gerada por regras e editada pelo orientador antes da geração deste documento.'
          : 'Síntese automática gerada por regras a partir dos registros do formulário. Não foi utilizada inteligência artificial externa.'
      )
    );

    const facts = el('div', 'report-subsection');
    facts.appendChild(el('h3', 'report-subtitle', '5.1 Dados registrados'));
    facts.appendChild(countFacts(analysis));
    if (analysis.totals.unanswered > 0) {
      facts.appendChild(
        el(
          'p',
          'report-table-note',
          'Perguntas sem resposta: ' + analysis.totals.unanswered + '. A análise considera somente os registros disponíveis.'
        )
      );
    }
    facts.appendChild(buildReferenceList(analysis));
    synthesis.appendChild(facts);

    addSubsection(synthesis, '5.2 Síntese geral', narratives.sintese, {
      emptyMessage: 'Não informado. A síntese não foi preenchida.'
    });
    addSubsection(synthesis, '5.3 Práticas registradas positivamente', narratives.positivas, {
      emptyMessage: 'Não informado. Não foram registradas práticas positivas.'
    });
    addSubsection(synthesis, '5.4 Aspectos que merecem atenção', narratives.atencao, {
      emptyMessage: 'Não informado. Não foram registrados aspectos que merecem atenção.'
    });
    synthesis.appendChild(
      el(
        'p',
        'report-footer-note',
        'As sugestões de reflexão pedagógica geradas a partir dos registros estão na seção 8.3.'
      )
    );
    article.appendChild(synthesis);

    /* Seção 6 */
    const strengths = el('section', 'report-section');
    strengths.appendChild(el('h2', 'report-section-title', '6. Pontos fortes'));
    textBlock(
      strengths,
      complementares.pontosFortes,
      'Não informado. O campo de pontos fortes não foi preenchido.'
    );
    strengths.appendChild(
      el(
        'p',
        'report-footer-note',
        analysis.positiveCount > 0
          ? 'As práticas assinaladas como "Sim" estão listadas na seção 5.3.'
          : 'Não há práticas assinaladas como "Sim" nos registros disponíveis.'
      )
    );
    article.appendChild(strengths);

    /* Seção 7 */
    const improvements = el('section', 'report-section');
    improvements.appendChild(el('h2', 'report-section-title', '7. Oportunidades de melhoria'));
    addSubsection(improvements, '7.1 Registros do orientador', complementares.melhorias, {
      emptyMessage: 'Não informado. O campo de oportunidades de melhoria não foi preenchido.'
    });

    const evidence = el('div', 'report-subsection');
    evidence.appendChild(el('h3', 'report-subtitle', '7.2 Evidências nas respostas'));
    attentionEvidence(evidence, analysis);
    evidence.appendChild(
      el(
        'p',
        'report-footer-note',
        'As respostas "Não observado / Não se aplica" não foram incluídas como evidências de melhoria nem tratadas como falhas.'
      )
    );
    improvements.appendChild(evidence);
    article.appendChild(improvements);

    /* Seção 8 */
    const suggestions = el('section', 'report-section');
    suggestions.appendChild(el('h2', 'report-section-title', '8. Sugestões e encaminhamentos'));
    addSubsection(suggestions, '8.1 Sugestões pedagógicas registradas', complementares.sugestoes, {
      emptyMessage: 'Não informado. Não há sugestões pedagógicas registradas.'
    });
    addSubsection(
      suggestions,
      '8.2 Encaminhamentos ou ações futuras',
      complementares.encaminhamentos,
      { emptyMessage: 'Não informado. Não há encaminhamentos registrados.' }
    );
    addSubsection(suggestions, '8.3 Sugestões para reflexão pedagógica', narratives.sugestoes, {
      note: 'Possibilidades de reflexão, não prescrições ou diagnósticos.',
      emptyMessage: 'Não informado. Não foram geradas sugestões para reflexão.'
    });
    addSubsection(suggestions, '8.4 Observações gerais', complementares.observacoesGerais, {
      emptyMessage: 'Não informado. Não há observações gerais registradas.'
    });
    article.appendChild(suggestions);

    /* Rodapé (sem campos de assinatura) */
    const footer = el('footer', 'report-footer');
    footer.appendChild(
      el('p', 'report-local-date', 'Local e data: ______________________________________, ______ / ______ / __________')
    );

    footer.appendChild(
      el(
        'p',
        'report-code',
        'Registro ' + reportCode(record) + ' · Documento gerado pelo ObservaEdu em ' +
        formatDateTime(new Date().toISOString()) +
        '. Os dados desta versão são armazenados localmente no navegador.'
      )
    );
    article.appendChild(footer);

    container.appendChild(article);
    currentRecordForReferences = null;
  }

  return { render: render };
})();

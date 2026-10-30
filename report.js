/*
 * ObservaEdu — Documento curto entregue ao professor
 * ---------------------------------------------------
 * Relatório resumido, preferencialmente em uma página:
 * identificação (professor, turma, série, data), observações para o professor
 * e próximos passos somente quando o orientador tiver registrado.
 *
 * O histórico interno completo permanece na aplicação. Este documento não
 * inclui respostas das sete etapas, análises, indicadores nem diagnósticos.
 *
 * Todo texto é inserido com textContent (nunca innerHTML).
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

  function buildMetaItem(label, value) {
    const item = el('div', 'teacher-report-meta-item');
    item.appendChild(el('span', 'teacher-report-meta-label', label));
    item.appendChild(el('span', 'teacher-report-meta-value', value || 'Não informado'));
    return item;
  }

  function buildTextBlock(title, text, emptyText) {
    const section = el('section', 'teacher-report-block');
    section.appendChild(el('h2', 'teacher-report-block-title', title));

    const body = clean(text);
    if (body) {
      const paragraphs = body.split(/\n{2,}/);
      paragraphs.forEach(function (paragraph) {
        paragraph.split(/\n/).forEach(function (line) {
          if (clean(line)) {
            section.appendChild(el('p', 'teacher-report-text', line));
          }
        });
      });
    } else if (emptyText) {
      section.appendChild(el('p', 'teacher-report-empty', emptyText));
    }

    return section;
  }

  function nextStepsText(record) {
    return clean(record && record.complementares && record.complementares.encaminhamentos);
  }

  function render(container, record, settings) {
    if (!container) return;
    const identification = (record && record.identificacao) || {};
    const school = settings || {};
    const texts = CONFIG.teacherReport || {};
    const nextSteps = nextStepsText(record);

    container.textContent = '';

    const documentElement = el('article', 'report-document teacher-report');

    if (record && record.status !== 'concluida') {
      documentElement.appendChild(
        el(
          'div',
          'report-draft-banner',
          'Prévia de rascunho — documento não concluído'
        )
      );
    }

    const header = el('header', 'report-header teacher-report-header');
    const headerTop = el('div', 'teacher-report-brand');
    headerTop.appendChild(el('p', 'teacher-report-app', clean(CONFIG.appName) || 'ObservaEdu'));
    if (clean(school.schoolName)) {
      headerTop.appendChild(el('p', 'teacher-report-school', clean(school.schoolName)));
    }
    header.appendChild(headerTop);
    header.appendChild(
      el('h1', 'teacher-report-title', texts.title || 'Observação pedagógica')
    );
    documentElement.appendChild(header);

    const meta = el('div', 'teacher-report-meta');
    meta.appendChild(
      buildMetaItem('Professor', clean(identification.professor) || 'Não informado')
    );
    meta.appendChild(
      buildMetaItem('Turma', clean(identification.turma) || 'Não informada')
    );
    meta.appendChild(
      buildMetaItem('Série', clean(identification.serie) || 'Não informada')
    );
    meta.appendChild(
      buildMetaItem('Data', formatDate(identification.data))
    );
    documentElement.appendChild(meta);

    documentElement.appendChild(
      buildTextBlock(
        texts.notesTitle || 'Observações para o professor',
        record && record.observacoesProfessor,
        texts.notesEmpty || 'Nenhuma observação escrita para o professor foi registrada.'
      )
    );

    if (nextSteps) {
      documentElement.appendChild(
        buildTextBlock(texts.nextStepsTitle || 'Próximos passos', nextSteps, '')
      );
    }

    const footer = el('footer', 'teacher-report-footer');
    footer.appendChild(
      el(
        'p',
        null,
        texts.footerNote ||
          'Documento resumido destinado ao professor. O histórico completo permanece interno, com a equipe pedagógica.'
      )
    );
    documentElement.appendChild(footer);

    // Segunda página: acompanhamento dos tópicos da aula.
    documentElement.appendChild(el('div', 'report-page-break'));

    const page2Header = el('header', 'teacher-report-header teacher-report-page2-header');
    const brand2 = el('div', 'teacher-report-brand');
    brand2.appendChild(el('p', 'teacher-report-app', clean(CONFIG.appName) || 'ObservaEdu'));
    if (clean(school.schoolName)) {
      brand2.appendChild(el('p', 'teacher-report-school', clean(school.schoolName)));
    }
    page2Header.appendChild(brand2);
    page2Header.appendChild(
      el('h1', 'teacher-report-title', 'ACOMPANHAMENTO DOS TÓPICOS DA AULA')
    );
    documentElement.appendChild(page2Header);

    const meta2 = el('div', 'teacher-report-meta');
    meta2.appendChild(buildMetaItem('Professor', clean(identification.professor) || 'Não informado'));
    meta2.appendChild(buildMetaItem('Turma', clean(identification.turma) || 'Não informada'));
    meta2.appendChild(buildMetaItem('Série', clean(identification.serie) || 'Não informada'));
    meta2.appendChild(buildMetaItem('Data', formatDate(identification.data)));
    documentElement.appendChild(meta2);

    const topics = collectTopics(record).filter(function (topic) {
      return topic.answer === 'sim' || topic.answer === 'parcial' || topic.answer === 'nao';
    });

    if (topics.length === 0) {
      documentElement.appendChild(
        el('p', 'teacher-report-empty', 'Nenhum tópico com resposta observável para esta seção.')
      );
    } else {
      const table = el('table', 'teacher-report-topics-table');
      const thead = el('thead');
      const headRow = el('tr');
      ['Tópico observado', 'Sim', 'Parcialmente', 'Não'].forEach(function (label) {
        headRow.appendChild(el('th', null, label));
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = el('tbody');
      topics.forEach(function (topic) {
        const row = el('tr');
        row.appendChild(el('td', 'teacher-report-topic-cell', topic.text));
        row.appendChild(el('td', 'teacher-report-mark-cell', topic.answer === 'sim' ? 'X' : ''));
        row.appendChild(el('td', 'teacher-report-mark-cell', topic.answer === 'parcial' ? 'X' : ''));
        row.appendChild(el('td', 'teacher-report-mark-cell', topic.answer === 'nao' ? 'X' : ''));
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      documentElement.appendChild(table);
    }

    const footer2 = el('footer', 'teacher-report-footer');
    footer2.appendChild(
      el(
        'p',
        null,
        'Documento resumido destinado ao professor. O histórico completo permanece interno, com a equipe pedagógica.'
      )
    );
    documentElement.appendChild(footer2);

    append(container, documentElement);
  }

  function collectTopics(record) {
    const topics = [];
    function addTopic(text, answer) {
      topics.push({ text: clean(text) || 'Tópico', answer: answer || '' });
    }
    (CONFIG.openingQuestions || []).forEach(function (question) {
      const entry = record && record.abertura ? record.abertura[question.id] : null;
      const value =
        entry && typeof entry === 'object' ? entry.valor : typeof entry === 'string' ? entry : '';
      addTopic(question.text, value);
    });
    (CONFIG.sections || []).forEach(function (section) {
      (section.questions || []).forEach(function (question) {
        const value = record && record.respostas ? record.respostas[question.id] : '';
        addTopic(question.text, value);
      });
    });
    return topics;
  }

  return { render: render, nextStepsText: nextStepsText };
})();

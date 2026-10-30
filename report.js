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

    append(container, documentElement);
  }

  return { render: render, nextStepsText: nextStepsText };
})();

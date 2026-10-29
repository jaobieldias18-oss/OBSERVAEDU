/*
 * ObservaEdu — Análise automática baseada em regras
 * -------------------------------------------------
 * Esta análise NÃO usa inteligência artificial externa e NÃO inventa fatos.
 * Ela apenas organiza e descreve o que foi registrado no formulário.
 *
 * Princípios aplicados:
 * - "Não observado / Não se aplica" nunca é tratado como resposta negativa.
 * - Respostas "Parcialmente" e "Não" geram aspectos de atenção.
 * - A síntese não classifica professores, não faz diagnósticos e não
 *   afirma que objetivos de aprendizagem foram alcançados sem evidências.
 * - Quando faltam dados, o texto informa explicitamente essa limitação.
 *
 * Para uma futura integração com IA, a interface principal é analyze(record).
 * Basta substituir a geração dos textos por uma chamada ao servidor,
 * mantendo as mesmas regras de privacidade e revisão pelo orientador.
 */

window.ObservaEduAnalysis = (function () {
  'use strict';

  const CONFIG = window.OBSERVAEDU_CONFIG;

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function answerOption(value) {
    return CONFIG.answerOptions.find(function (option) {
      return option.value === value;
    }) || null;
  }

  function answerLabel(value) {
    const option = answerOption(value);
    return option ? option.label : 'Sem resposta registrada';
  }

  function joinPt(items) {
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' e ' + items[1];
    return items.slice(0, -1).join(', ') + ' e ' + items[items.length - 1];
  }

  function plural(count, singular, pluralForm) {
    return count === 1 ? singular : pluralForm;
  }

  /*
   * Assinatura dos dados que influenciam a análise.
   * Serve para detectar quando as respostas mudaram depois de uma edição
   * manual da análise, sem depender de identificação ou data.
   */
  function signature(record) {
    const answers = [];
    const comments = [];
    const complementary = [];

    CONFIG.sections.forEach(function (section) {
      section.questions.forEach(function (question) {
        answers.push([question.id, text(record && record.respostas && record.respostas[question.id])]);
      });
      comments.push([section.id, text(record && record.comentarios && record.comentarios[section.id])]);
    });

    CONFIG.complementaryFields.forEach(function (field) {
      complementary.push([
        field.key,
        text(record && record.complementares && record.complementares[field.key])
      ]);
    });

    return JSON.stringify({ answers: answers, comments: comments, complementary: complementary });
  }

  function analyzeSection(record, section) {
    const counts = { sim: 0, parcial: 0, nao: 0, na: 0, total: 0, applicable: 0, answered: 0 };
    const positives = [];
    const attention = [];
    const notObserved = [];
    const unanswered = [];

    section.questions.forEach(function (question) {
      counts.total += 1;
      const value = text(record && record.respostas && record.respostas[question.id]);
      if (!value) {
        unanswered.push(question);
        return;
      }

      counts.answered += 1;
      if (value === 'sim') {
        counts.sim += 1;
        counts.applicable += 1;
        positives.push(question);
      } else if (value === 'parcial') {
        counts.parcial += 1;
        counts.applicable += 1;
        attention.push({ question: question, value: value });
      } else if (value === 'nao') {
        counts.nao += 1;
        counts.applicable += 1;
        attention.push({ question: question, value: value });
      } else if (value === 'na') {
        counts.na += 1;
        notObserved.push(question);
      }
    });

    return {
      id: section.id,
      step: section.step,
      title: section.title,
      shortTitle: section.shortTitle || section.title,
      description: section.description,
      comment: text(record && record.comentarios && record.comentarios[section.id]),
      counts: counts,
      positives: positives,
      attention: attention,
      notObserved: notObserved,
      unanswered: unanswered
    };
  }

  function sectionSummary(section) {
    const c = section.counts;
    if (c.answered === 0) {
      return 'Na etapa ' + section.title + ', não há respostas registradas; esse aspecto não pode ser analisado com os dados disponíveis.';
    }
    if (c.applicable === 0) {
      return (
        'Na etapa ' + section.title + ', as ' + c.na + ' ' + plural(c.na, 'resposta registrada foi assinalada', 'respostas registradas foram assinaladas') +
        ' como "Não observado / Não se aplica"; não há dados aplicáveis para analisar as práticas desta etapa.'
      );
    }

    let result =
      'Na etapa ' + section.title + ', foram registradas ' + c.applicable + ' ' +
      plural(c.applicable, 'resposta aplicável', 'respostas aplicáveis') + ': ' +
      c.sim + ' como "Sim", ' + c.parcial + ' como "Parcialmente" e ' + c.nao + ' como "Não".';

    if (c.na > 0) {
      result +=
        ' Além disso, ' + c.na + ' ' + plural(c.na, 'resposta foi assinalada', 'respostas foram assinaladas') +
        ' como "Não observado / Não se aplica" e não ' +
        plural(c.na, 'foi tratada', 'foram tratadas') + ' como falha.';
    }
    if (section.unanswered.length > 0) {
      result +=
        ' ' + section.unanswered.length + ' ' + plural(section.unanswered.length, 'pergunta permanece', 'perguntas permanecem') +
        ' sem resposta.';
    }
    return result;
  }

  function generateSynthesis(record, sections, totals) {
    const paragraphs = [];

    if (totals.applicable === 0) {
      paragraphs.push(
        'Não há respostas aplicáveis registradas nas etapas de Introdução, Desenvolvimento e Conclusão. ' +
        'Sem respostas aplicáveis, não há dados suficientes para gerar uma síntese sobre as práticas observadas. ' +
        'As respostas "Não observado / Não se aplica" e as perguntas sem resposta não foram tratadas como falhas.'
      );
    } else {
      let first =
        'Foram registradas ' + totals.applicable + ' ' + plural(totals.applicable, 'resposta aplicável', 'respostas aplicáveis') +
        ' nas três etapas: ' + totals.sim + ' como "Sim", ' + totals.parcial + ' como "Parcialmente" e ' +
        totals.nao + ' como "Não".';
      if (totals.na > 0) {
        first +=
          ' As ' + totals.na + ' ' + plural(totals.na, 'resposta assinalada', 'respostas assinaladas') +
          ' como "Não observado / Não se aplica" foram mantidas no relatório, mas não foram contabilizadas como práticas negativas.';
      }
      if (totals.unanswered > 0) {
        first +=
          ' Há ' + totals.unanswered + ' ' + plural(totals.unanswered, 'pergunta sem resposta', 'perguntas sem resposta') +
          '; a análise considera somente os registros disponíveis.';
      }
      paragraphs.push(first);
      paragraphs.push(sections.map(sectionSummary).join(' '));
    }

    const commented = sections.filter(function (section) {
      return section.comment.length > 0;
    });
    if (commented.length > 0) {
      paragraphs.push(
        'Há comentários registrados nas etapas ' + joinPt(commented.map(function (section) { return section.title; })) +
        '. Eles foram considerados nesta leitura e estão transcritos integralmente nas seções 2 a 4 do relatório.'
      );
    } else {
      paragraphs.push(
        'Não há comentários por etapa registrados. A análise se limita, portanto, às respostas objetivas e aos campos complementares preenchidos.'
      );
    }

    const filledFields = CONFIG.complementaryFields.filter(function (field) {
      return text(record && record.complementares && record.complementares[field.key]).length > 0;
    });
    if (filledFields.length > 0) {
      paragraphs.push(
        'Nos campos complementares, há registros de ' +
        joinPt(filledFields.map(function (field) { return field.label.toLowerCase(); })) +
        '. Esses textos são apresentados nas seções 6 a 8 do relatório e não foram transformados automaticamente em conclusões.'
      );
    } else {
      paragraphs.push('Não há registros nos campos complementares do formulário.');
    }

    paragraphs.push(
      'Esta síntese descreve apenas os registros disponíveis. Ela não avalia o desempenho individual do professor, ' +
      'não estabelece rankings e não permite afirmar que os objetivos de aprendizagem foram alcançados sem evidências específicas.'
    );

    return paragraphs.join('\n\n');
  }

  function generatePositives(sections) {
    const withPositives = sections.filter(function (section) {
      return section.positives.length > 0;
    });

    if (withPositives.length === 0) {
      return (
        'Não há práticas assinaladas como "Sim" nos registros disponíveis. ' +
        'Isso não equivale a uma avaliação negativa: pode haver respostas "Parcialmente", "Não", ' +
        '"Não observado / Não se aplica" ou perguntas sem resposta.'
      );
    }

    const lines = [
      'Foram assinaladas como "Sim" as seguintes práticas, organizadas por etapa:'
    ];

    withPositives.forEach(function (section) {
      lines.push('');
      lines.push(section.title + ':');
      section.positives.forEach(function (question) {
        lines.push('• ' + question.text);
      });
    });

    lines.push('');
    lines.push(
      'Esses registros indicam práticas que o orientador observou e assinalou positivamente. ' +
      'Eles se referem à aula observada e não devem ser generalizados para outros contextos.'
    );

    return lines.join('\n');
  }

  function generateAttention(sections) {
    const withAttention = sections.filter(function (section) {
      return section.attention.length > 0;
    });

    if (withAttention.length === 0) {
      return (
        'Não há respostas assinaladas como "Parcialmente" ou "Não" nos registros disponíveis. ' +
        'Isso não deve ser lido como uma avaliação global positiva, pois a análise se limita ao que foi observado e registrado.'
      );
    }

    const total = withAttention.reduce(function (sum, section) {
      return sum + section.attention.length;
    }, 0);

    const lines = [
      'Foram registrados ' + total + ' ' + plural(total, 'aspecto que merece atenção', 'aspectos que merecem atenção') +
      ', considerando as respostas "Parcialmente" e "Não":'
    ];

    withAttention.forEach(function (section) {
      lines.push('');
      lines.push(section.title + ':');
      section.attention.forEach(function (item) {
        lines.push('• "' + answerLabel(item.value) + '" — ' + item.question.text);
      });
    });

    lines.push('');
    lines.push(
      'Esses registros apontam pontos a considerar na reflexão pedagógica. ' +
      'Eles não constituem, isoladamente, julgamento sobre o professor ou conclusão sobre a qualidade geral da aula.'
    );

    return lines.join('\n');
  }

  function generateSuggestions(sections) {
    const attentionItems = [];
    sections.forEach(function (section) {
      section.attention.forEach(function (item) {
        attentionItems.push({
          section: section.title,
          question: item.question,
          value: item.value
        });
      });
    });

    if (attentionItems.length === 0) {
      return (
        'Não foram geradas sugestões automáticas, pois não há respostas "Parcialmente" ou "Não" registradas. ' +
        'As sugestões pedagógicas e os encaminhamentos do orientador permanecem disponíveis no formulário.'
      );
    }

    const lines = [
      'As sugestões abaixo são possibilidades de reflexão pedagógica geradas a partir das respostas que merecem atenção. ' +
      'Não são prescrições, diagnósticos ou conclusões sobre o professor.'
    ];

    attentionItems.forEach(function (item) {
      lines.push('');
      lines.push(
        '• [' + item.section + '] ' + item.question.text + '\n' +
        '  Resposta registrada: "' + answerLabel(item.value) + '".\n' +
        '  Possibilidade de reflexão: ' + (item.question.reflection || 'Retomar este aspecto no próximo planejamento, considerando o contexto observado.')
      );
    });

    return lines.join('\n');
  }

  function analyze(record) {
    const sections = CONFIG.sections.map(function (section) {
      return analyzeSection(record, section);
    });

    const totals = {
      sim: 0,
      parcial: 0,
      nao: 0,
      na: 0,
      total: 0,
      applicable: 0,
      answered: 0,
      unanswered: 0
    };

    sections.forEach(function (section) {
      totals.sim += section.counts.sim;
      totals.parcial += section.counts.parcial;
      totals.nao += section.counts.nao;
      totals.na += section.counts.na;
      totals.total += section.counts.total;
      totals.applicable += section.counts.applicable;
      totals.answered += section.counts.answered;
      totals.unanswered += section.unanswered.length;
    });

    const narratives = {
      sintese: generateSynthesis(record, sections, totals),
      positivas: generatePositives(sections),
      atencao: generateAttention(sections),
      sugestoes: generateSuggestions(sections)
    };

    return {
      sections: sections,
      totals: totals,
      narratives: narratives,
      attentionCount: totals.parcial + totals.nao,
      positiveCount: totals.sim
    };
  }

  function createAnalysisRecord(record, generatedAt) {
    const result = analyze(record);
    return {
      narratives: result.narratives,
      generatedAt: generatedAt || new Date().toISOString(),
      sourceSignature: signature(record),
      manuallyEdited: false,
      editedAt: null
    };
  }

  function isStale(record) {
    const analysis = record && record.analise;
    if (!analysis || !analysis.manuallyEdited || !analysis.sourceSignature) return false;
    return analysis.sourceSignature !== signature(record);
  }

  /*
   * Retorna os textos que devem aparecer no relatório.
   * Se a análise foi editada manualmente, respeita exatamente o que o
   * orientador escreveu (inclusive campos deixados em branco).
   */
  function getNarratives(record) {
    const generated = analyze(record).narratives;
    const analysis = record && record.analise;
    if (!analysis || !analysis.manuallyEdited || !analysis.narratives) {
      return generated;
    }
    return {
      sintese: text(analysis.narratives.sintese),
      positivas: text(analysis.narratives.positivas),
      atencao: text(analysis.narratives.atencao),
      sugestoes: text(analysis.narratives.sugestoes)
    };
  }

  return {
    analyze: analyze,
    signature: signature,
    createAnalysisRecord: createAnalysisRecord,
    isStale: isStale,
    getNarratives: getNarratives,
    answerLabel: answerLabel,
    answerOption: answerOption
  };
})();

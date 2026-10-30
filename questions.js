/*
 * ObservaEdu — Configuração do formulário pedagógico
 * ---------------------------------------------------
 * Este arquivo concentra as perguntas e os textos do formulário.
 * Para ajustar o instrumento de observação da escola, edite apenas
 * este arquivo. Mantenha os "id" das perguntas únicos e estáveis:
 * eles são usados para salvar as respostas e para gerar o relatório.
 */

window.OBSERVAEDU_CONFIG = {
  appName: 'ObservaEdu',
  version: '2.0.0',

  // Chaves usadas no localStorage. Não altere sem necessidade:
  // mudar a chave faz o sistema "perder de vista" os dados antigos.
  storageKey: 'observaedu.observations.v1',
  settingsKey: 'observaedu.settings.v1',

  // Opções de resposta. "na" = Não observado / Não se aplica.
  answerOptions: [
    { value: 'sim', label: 'Sim', tone: 'positive' },
    { value: 'parcial', label: 'Parcialmente', tone: 'warning' },
    { value: 'nao', label: 'Não', tone: 'danger' },
    { value: 'na', label: 'Não observado / Não se aplica', tone: 'neutral' }
  ],

  statuses: {
    rascunho: { label: 'Em andamento', tone: 'warning' },
    concluida: { label: 'Concluída', tone: 'positive' }
  },

  // Etapas de ensino e séries. Os seletores do formulário são dependentes:
  // a etapa define as séries disponíveis e a turma (A/B) é escolhida depois.
  // "Educação Infantil" usa os grupos configuráveis em Configurações.
  educationLevels: [
    {
      value: 'infantil',
      label: 'Educação Infantil',
      seriesMode: 'earlyChildhoodGroups'
    },
    {
      value: 'fundamental1',
      label: 'Ensino Fundamental — Anos Iniciais',
      series: ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano']
    },
    {
      value: 'fundamental2',
      label: 'Ensino Fundamental — Anos Finais',
      series: ['6º ano', '7º ano', '8º ano', '9º ano']
    },
    {
      value: 'medio',
      label: 'Ensino Médio',
      series: ['1º ano', '2º ano', '3º ano']
    }
  ],

  classOptions: ['A', 'B'],

  // Opções das duas perguntas obrigatórias de abertura. O valor "na"
  // continua o mesmo das demais perguntas para não quebrar registros já salvos.
  openingOptions: [
    { value: 'sim', label: 'Sim', tone: 'positive' },
    { value: 'nao', label: 'Não', tone: 'danger' },
    { value: 'parcial', label: 'Parcialmente', tone: 'warning' },
    { value: 'na', label: 'Não foi possível observar', tone: 'neutral' }
  ],

  // Duas perguntas obrigatórias de abertura, com comentário curto opcional.
  // Ficam em record.abertura, sem alterar o campo respostas já existente.
  openingQuestions: [
    {
      id: 'abertura_pontualidade',
      text: 'O professor inicia a aula no horário programado?',
      noteLabel: 'Comentário curto (opcional)',
      notePlaceholder: 'Ex.: início após a entrada dos estudantes.'
    },
    {
      id: 'abertura_chamada',
      text: 'O professor realiza a chamada dos alunos?',
      noteLabel: 'Comentário curto (opcional)',
      notePlaceholder: 'Ex.: chamada realizada no início da aula.'
    }
  ],

  // Textos do documento curto entregue ao professor.
  teacherReport: {
    title: 'Observação pedagógica',
    subtitle: '',
    notesTitle: 'Observações para o professor',
    notesEmpty: 'Nenhuma observação escrita para o professor foi registrada.',
    nextStepsTitle: 'Próximos passos',
    footerNote:
      'Documento resumido destinado ao professor. O histórico completo permanece interno, com a equipe pedagógica.'
  },

  // Cada etapa tem perguntas e um campo de comentários.
  // "reflection" é uma possibilidade de reflexão sugerida quando a
  // resposta for "Parcialmente" ou "Não". Não é uma conclusão sobre
  // o trabalho do professor.
  sections: [
    {
      id: 'inicio',
      step: 2,
      title: 'Início da aula',
      shortTitle: 'Início',
      description: 'Acolhimento, organização e preparação para a aula.',
      commentLabel: 'Observações sobre o início da aula',
      commentPlaceholder: 'Registre evidências, exemplos e contextos observados nesta etapa.',
      questions: [
        {
          id: 'inicio_1',
          text: 'Acolhimento e organização. Recebe os estudantes com respeito e organiza a sala.',
          reflection: 'Vale refletir sobre como a acolhida e a organização inicial podem favorecer o clima da aula.'
        },
        {
          id: 'inicio_2',
          text: 'Apresentação da aula. Explica os objetivos e apresenta uma atividade inicial que desperte interesse.',
          reflection: 'Considere planejar uma situação-problema, pergunta ou disparador que mobilize a curiosidade dos estudantes.'
        },
        {
          id: 'inicio_3',
          text: 'Frequência e pontualidade. Realiza a chamada e inicia a aula no horário previsto.',
          reflection: 'Pode ser útil organizar a chamada e o início da aula de forma que o tempo seja aproveitado.'
        },
        {
          id: 'inicio_4',
          text: 'Preparação da atividade. Organiza os recursos necessários para começar a aula.',
          reflection: 'Vale pensar no planejamento prévio dos recursos e materiais.'
        }
      ]
    },
    {
      id: 'desenvolvimento',
      step: 3,
      title: 'Desenvolvimento da aula',
      shortTitle: 'Desenvolvimento',
      description: 'Condução do conteúdo, participação e acompanhamento da turma.',
      commentLabel: 'Observações sobre o desenvolvimento da aula',
      commentPlaceholder: 'Registre evidências, exemplos e contextos observados nesta etapa.',
      questions: [
        {
          id: 'desenvolvimento_1',
          text: 'Domínio do conteúdo. Demonstra conhecimento e explica o conteúdo com clareza.',
          reflection: 'Reflita sobre a estrutura da explicação: sequência, exemplos e linguagem podem tornar o conteúdo mais acessível.'
        },
        {
          id: 'desenvolvimento_2',
          text: 'Estratégias de ensino. Utiliza estratégias adequadas e considera os conhecimentos prévios dos estudantes.',
          reflection: 'Considere avaliar quais estratégias se articulam melhor aos objetivos da aula.'
        },
        {
          id: 'desenvolvimento_3',
          text: 'Participação dos estudantes. Incentiva a participação, interação e colaboração.',
          reflection: 'Reflita sobre estratégias que ampliem a participação de todos os estudantes.'
        },
        {
          id: 'desenvolvimento_4',
          text: 'Acompanhamento da aprendizagem. Identifica dificuldades, esclarece dúvidas e atende os estudantes quando necessário.',
          reflection: 'Vale planejar momentos de checagem de compreensão e atendimento aos estudantes.'
        },
        {
          id: 'desenvolvimento_5',
          text: 'Organização e gestão. Administra o tempo, os recursos e possíveis situações de conflito.',
          reflection: 'Pode ser útil planejar a distribuição do tempo e estratégias de mediação.'
        }
      ]
    },
    {
      id: 'fechamento',
      step: 4,
      title: 'Fechamento da aula',
      shortTitle: 'Fechamento',
      description: 'Retomada, orientações futuras e encerramento.',
      commentLabel: 'Observações sobre o fechamento da aula',
      commentPlaceholder: 'Registre evidências, exemplos e contextos observados nesta etapa.',
      questions: [
        {
          id: 'fechamento_1',
          text: 'Retomada da aprendizagem. Retoma ou sistematiza os principais conteúdos trabalhados.',
          reflection: 'Reflita sobre como uma retomada breve pode ajudar a consolidar o que foi trabalhado.'
        },
        {
          id: 'fechamento_2',
          text: 'Orientações futuras. Apresenta tarefas, atividades ou orientações para as próximas aulas, quando necessário.',
          reflection: 'Vale avaliar se tarefas de continuidade são necessárias e como serão explicadas.'
        },
        {
          id: 'fechamento_3',
          text: 'Organização final. Organiza o espaço e os materiais para a continuidade das atividades.',
          reflection: 'Considere a organização do espaço e dos materiais ao final da aula.'
        },
        {
          id: 'fechamento_4',
          text: 'Encerramento. Finaliza a aula adequadamente, respeitando o horário e esclarecendo dúvidas.',
          reflection: 'Reflita sobre a organização do encerramento e a disponibilidade para dúvidas.'
        }
      ]
    }
  ],

  // Campos de texto livre ao final do formulário.
  complementaryFields: [
    {
      key: 'pontos_positivos',
      label: 'Pontos positivos',
      placeholder: 'Aspectos positivos observados na aula.'
    },
    {
      key: 'pontos_atencao',
      label: 'Pontos de atenção',
      placeholder: 'Aspectos que precisam de atenção.'
    },
    {
      key: 'sugestoes_acao',
      label: 'Sugestões e plano de ação',
      placeholder: 'Orientações práticas para as próximas aulas.'
    }
  ],

  // Textos padrão dos campos editáveis da análise automática.
  analysisFields: [
    {
      key: 'sintese',
      label: 'Síntese geral',
      help: 'Resumo construído exclusivamente a partir das respostas e dos registros.'
    },
    {
      key: 'positivas',
      label: 'Práticas registradas positivamente',
      help: 'Práticas assinaladas como "Sim" pelo orientador.'
    },
    {
      key: 'atencao',
      label: 'Aspectos que merecem atenção',
      help: 'Respostas "Parcialmente" ou "Não", sem transformar ausência de observação em falha.'
    },
    {
      key: 'sugestoes',
      label: 'Sugestões para reflexão pedagógica',
      help: 'Possibilidades de reflexão, não prescrições ou diagnósticos.'
    }
  ]
};

window.ObservaEduSchool = (function () {
  'use strict';

  const CONFIG = window.OBSERVAEDU_CONFIG;

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function levelByValue(value) {
    return (CONFIG.educationLevels || []).find(function (level) {
      return level.value === clean(value);
    }) || null;
  }

  function seriesFor(etapa, earlyChildhoodGroups) {
    const level = levelByValue(etapa);
    if (!level) return [];
    if (level.seriesMode === 'earlyChildhoodGroups') {
      return Array.isArray(earlyChildhoodGroups) ? earlyChildhoodGroups.slice() : [];
    }
    return (level.series || []).slice();
  }

  function classesFor() {
    return (CONFIG.classOptions || []).slice();
  }

  function isValidCombination(etapa, serie, turma, earlyChildhoodGroups) {
    const level = levelByValue(etapa);
    if (!level) return false;
    const series = seriesFor(etapa, earlyChildhoodGroups);
    if (series.indexOf(clean(serie)) < 0) return false;
    return classesFor().indexOf(clean(turma)) >= 0;
  }

  function academicYear(isoDate) {
    const match = /^(\d{4})/.exec(clean(isoDate));
    return match ? match[1] : '';
  }

  function openingOptions() {
    return CONFIG.openingOptions || CONFIG.answerOptions || [];
  }

  function openingValueIsValid(value) {
    return openingOptions().some(function (option) {
      return option.value === value;
    });
  }

  return {
    levelByValue: levelByValue,
    seriesFor: seriesFor,
    classesFor: classesFor,
    isValidCombination: isValidCombination,
    academicYear: academicYear,
    openingOptions: openingOptions,
    openingValueIsValid: openingValueIsValid
  };
})();

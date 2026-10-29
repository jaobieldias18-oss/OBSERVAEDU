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
  version: '1.2.0',

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

  // Cada etapa tem perguntas e um campo de comentários.
  // "reflection" é uma possibilidade de reflexão sugerida quando a
  // resposta for "Parcialmente" ou "Não". Não é uma conclusão sobre
  // o trabalho do professor.
  sections: [
    {
      id: 'introducao',
      step: 2,
      title: 'Introdução',
      shortTitle: 'Introdução',
      description: 'Acolhimento, abertura da aula e conexão com o que a turma já sabe.',
      commentLabel: 'Comentários sobre a introdução',
      commentPlaceholder: 'Registre evidências, exemplos e contextos observados nesta etapa.',
      questions: [
        {
          id: 'intro_1',
          text: 'O professor cumprimentou e acolheu os alunos?',
          reflection: 'Vale refletir sobre como a acolhida inicial pode ser planejada para criar um clima favorável à aula.'
        },
        {
          id: 'intro_2',
          text: 'Apresentou um disparador para despertar o interesse pela aula?',
          reflection: 'Considere planejar uma situação-problema, pergunta, imagem ou outro disparador que mobilize a curiosidade dos estudantes.'
        },
        {
          id: 'intro_3',
          text: 'Retomou conhecimentos prévios ou conteúdos trabalhados anteriormente?',
          reflection: 'Pode ser útil reservar um momento inicial para resgatar o que a turma já sabe e conectar esse repertório ao novo conteúdo.'
        },
        {
          id: 'intro_4',
          text: 'Apresentou o tema e os objetivos da aula?',
          reflection: 'Reflita sobre formas de explicitar o tema e os objetivos da aula de maneira acessível, para que os estudantes saibam o que se espera daquele encontro.'
        },
        {
          id: 'intro_5',
          text: 'Relacionou o conteúdo com situações do cotidiano?',
          reflection: 'Considere buscar exemplos ou situações do cotidiano que aproximem o conteúdo da experiência dos estudantes.'
        },
        {
          id: 'intro_6',
          text: 'Organizou a turma e preparou os materiais necessários?',
          reflection: 'Vale pensar no planejamento prévio da organização da turma e dos materiais, antecipando o que pode interferir no início da aula.'
        }
      ]
    },
    {
      id: 'desenvolvimento',
      step: 3,
      title: 'Desenvolvimento',
      shortTitle: 'Desenvolvimento',
      description: 'Condução do conteúdo, atividades, participação e acompanhamento da turma.',
      commentLabel: 'Comentários sobre o desenvolvimento',
      commentPlaceholder: 'Registre evidências, exemplos e contextos observados nesta etapa.',
      questions: [
        {
          id: 'des_1',
          text: 'O professor explicou o conteúdo de forma clara e organizada?',
          reflection: 'Reflita sobre a estrutura da explicação: sequência, exemplos e linguagem podem tornar o conteúdo mais acessível.'
        },
        {
          id: 'des_2',
          text: 'Utilizou materiais didáticos ou recursos tecnológicos de forma pertinente?',
          reflection: 'Considere avaliar quais recursos se articulam melhor aos objetivos da aula e como serão usados para apoiar a aprendizagem.'
        },
        {
          id: 'des_3',
          text: 'Propôs atividades coerentes com os objetivos da aula?',
          reflection: 'Pode ser útil explicitar a relação entre cada atividade proposta e os objetivos da aula.'
        },
        {
          id: 'des_4',
          text: 'Estimulou a participação dos alunos?',
          reflection: 'Reflita sobre estratégias que ampliem a participação de todos, não apenas de alguns estudantes.'
        },
        {
          id: 'des_5',
          text: 'Incentivou o pensamento crítico e a autonomia dos estudantes?',
          reflection: 'Considere propor perguntas abertas, escolhas ou pequenos desafios que convidem à argumentação e à autonomia.'
        },
        {
          id: 'des_6',
          text: 'Verificou se os estudantes estavam compreendendo o conteúdo?',
          reflection: 'Vale planejar momentos curtos de checagem de compreensão ao longo da aula, e não apenas ao final.'
        },
        {
          id: 'des_7',
          text: 'Circulou pela sala e acompanhou a realização das atividades?',
          reflection: 'Reflita sobre como a circulação pela sala pode favorecer o acompanhamento próximo das atividades.'
        },
        {
          id: 'des_8',
          text: 'Esclareceu dúvidas e ofereceu orientações?',
          reflection: 'Considere formas de tornar as orientações e o esclarecimento de dúvidas acessíveis a toda a turma.'
        },
        {
          id: 'des_9',
          text: 'Gerenciou adequadamente o tempo e o ritmo da aula?',
          reflection: 'Pode ser útil planejar a distribuição do tempo por etapa e prever ajustes de ritmo durante a aula.'
        },
        {
          id: 'des_10',
          text: 'Mediou conflitos com respeito e imparcialidade, quando necessário?',
          reflection: 'Reflita sobre estratégias de mediação que preservem o respeito e a imparcialidade em situações de conflito.'
        },
        {
          id: 'des_11',
          text: 'Considerou diferentes necessidades e ritmos de aprendizagem?',
          reflection: 'Considere planejar adaptações ou apoios que considerem diferentes ritmos e necessidades de aprendizagem.'
        },
        {
          id: 'des_12',
          text: 'Promoveu um ambiente respeitoso e favorável à aprendizagem?',
          reflection: 'Vale refletir sobre ações que contribuam para um clima de respeito e participação, considerando o contexto observado.'
        }
      ]
    },
    {
      id: 'conclusao',
      step: 4,
      title: 'Conclusão',
      shortTitle: 'Conclusão',
      description: 'Fechamento da aula, retomada dos objetivos e continuidade.',
      commentLabel: 'Comentários sobre a conclusão',
      commentPlaceholder: 'Registre evidências, exemplos e contextos observados nesta etapa.',
      questions: [
        {
          id: 'con_1',
          text: 'Retomou os principais pontos trabalhados?',
          reflection: 'Reflita sobre como uma retomada breve dos principais pontos pode ajudar a consolidar o que foi trabalhado.'
        },
        {
          id: 'con_2',
          text: 'Verificou se os objetivos da aula foram alcançados?',
          reflection: 'Considere planejar evidências ou momentos de verificação que permitam acompanhar se os objetivos foram alcançados, sem concluir apenas pela impressão da aula.'
        },
        {
          id: 'con_3',
          text: 'Propôs uma atividade de síntese ou verificação da aprendizagem?',
          reflection: 'Pode ser útil prever uma atividade curta de síntese ou verificação ao final da aula.'
        },
        {
          id: 'con_4',
          text: 'Deu espaço para dúvidas finais?',
          reflection: 'Reflita sobre reservar um momento final para dúvidas e esclarecimentos.'
        },
        {
          id: 'con_5',
          text: 'Relacionou o conteúdo com a próxima aula, quando pertinente?',
          reflection: 'Considere explicitar possíveis conexões com a próxima aula, quando fizer sentido para o planejamento.'
        },
        {
          id: 'con_6',
          text: 'Orientou tarefas ou atividades de continuidade, quando necessário?',
          reflection: 'Vale avaliar se tarefas de continuidade são necessárias e como serão explicadas e acompanhadas.'
        },
        {
          id: 'con_7',
          text: 'Encerrou a aula de forma organizada?',
          reflection: 'Reflita sobre a organização do encerramento, incluindo a indicação do que foi trabalhado e do que vem a seguir.'
        }
      ]
    }
  ],

  // Campos de texto livre ao final do formulário.
  complementaryFields: [
    {
      key: 'pontosFortes',
      label: 'Pontos fortes observados',
      placeholder: 'Descreva práticas, atitudes ou situações concretas observadas que se destacaram.'
    },
    {
      key: 'melhorias',
      label: 'Oportunidades de melhoria',
      placeholder: 'Registre aspectos que podem ser aprimorados, com base no que foi observado.'
    },
    {
      key: 'sugestoes',
      label: 'Sugestões pedagógicas',
      placeholder: 'Sugestões que possam contribuir com o planejamento e a prática pedagógica.'
    },
    {
      key: 'encaminhamentos',
      label: 'Encaminhamentos ou ações futuras',
      placeholder: 'Combinados, acompanhamentos ou próximos passos, quando houver.'
    },
    {
      key: 'observacoesGerais',
      label: 'Observações gerais',
      placeholder: 'Outras informações relevantes sobre o contexto da observação.'
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

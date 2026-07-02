/* ==========================================================================
   Cotação de Plano de Saúde — lógica do aplicativo
   Fluxo tipo "app": uma pergunta por vez, com barra de progresso,
   validação, microinterações e envio final para o WhatsApp.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Configuração
   * ------------------------------------------------------------------ */
  const WHATSAPP_NUMBER = '5591998307032'; // +55 91 99830-7032

  // Ordem das telas do fluxo (sem contar welcome/loading/final)
  const QUESTION_SCREENS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'];

  // Lista estática dos 27 estados brasileiros (sigla + nome), usada como
  // fallback caso a API do IBGE não esteja acessível.
  const ESTADOS_FALLBACK = [
    { sigla: 'AC', nome: 'Acre' }, { sigla: 'AL', nome: 'Alagoas' },
    { sigla: 'AP', nome: 'Amapá' }, { sigla: 'AM', nome: 'Amazonas' },
    { sigla: 'BA', nome: 'Bahia' }, { sigla: 'CE', nome: 'Ceará' },
    { sigla: 'DF', nome: 'Distrito Federal' }, { sigla: 'ES', nome: 'Espírito Santo' },
    { sigla: 'GO', nome: 'Goiás' }, { sigla: 'MA', nome: 'Maranhão' },
    { sigla: 'MT', nome: 'Mato Grosso' }, { sigla: 'MS', nome: 'Mato Grosso do Sul' },
    { sigla: 'MG', nome: 'Minas Gerais' }, { sigla: 'PA', nome: 'Pará' },
    { sigla: 'PB', nome: 'Paraíba' }, { sigla: 'PR', nome: 'Paraná' },
    { sigla: 'PE', nome: 'Pernambuco' }, { sigla: 'PI', nome: 'Piauí' },
    { sigla: 'RJ', nome: 'Rio de Janeiro' }, { sigla: 'RN', nome: 'Rio Grande do Norte' },
    { sigla: 'RS', nome: 'Rio Grande do Sul' }, { sigla: 'RO', nome: 'Rondônia' },
    { sigla: 'RR', nome: 'Roraima' }, { sigla: 'SC', nome: 'Santa Catarina' },
    { sigla: 'SP', nome: 'São Paulo' }, { sigla: 'SE', nome: 'Sergipe' },
    { sigla: 'TO', nome: 'Tocantins' }
  ];

  const IBGE_ESTADOS_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome';
  const IBGE_MUNICIPIOS_URL = (uf) => `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`;

  /* ------------------------------------------------------------------ *
   * Estado da aplicação
   * ------------------------------------------------------------------ */
  const answers = {
    nome: '',
    estadoSigla: '',
    estadoNome: '',
    cidade: '',
    idade: '',
    pessoas: '',
    tipoPlano: '',
    planoAtual: '',
    prioridade: '',
    operadora: ''
  };

  let estadosCache = null;
  let municipiosCache = {}; // por UF

  /* ------------------------------------------------------------------ *
   * Utilidades de DOM
   * ------------------------------------------------------------------ */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  const screensEl = $('#screens');
  const progressHeader = $('#progressHeader');
  const progressFill = $('#progressFill');
  const progressDot = $('#progressDot');
  const progressLabel = $('#progressLabel');
  const progressPercent = $('#progressPercent');

  function getScreen(name) {
    return $(`.screen[data-screen="${name}"]`);
  }

  function normalize(str) {
    return (str || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /* ------------------------------------------------------------------ *
   * Navegação entre telas
   * ------------------------------------------------------------------ */
  function showScreen(name) {
    const current = $('.screen.is-active');
    const next = getScreen(name);
    if (!next || next === current) return;

    if (current) {
      current.classList.add('is-leaving');
      current.classList.remove('is-active');
      setTimeout(() => current.classList.remove('is-leaving'), 380);
    }

    next.classList.add('is-active');
    updateProgress(name);

    // Foco automático em campos de texto para telas de pergunta
    const autoInput = next.querySelector('input.text-input:not([disabled])');
    if (autoInput && (name === 'q1')) {
      setTimeout(() => autoInput.focus(), 350);
    }
  }

  function updateProgress(name) {
    const idx = QUESTION_SCREENS.indexOf(name);
    if (idx === -1) {
      progressHeader.hidden = true;
      return;
    }
    progressHeader.hidden = false;
    const total = QUESTION_SCREENS.length;
    const percent = Math.round(((idx + 1) / total) * 100);
    progressFill.style.width = percent + '%';
    progressDot.style.left = percent + '%';
    progressLabel.textContent = `Pergunta ${idx + 1} de ${total}`;
    progressPercent.textContent = percent + '%';
  }

  function nextAfter(name) {
    if (name === 'welcome') return 'q1';
    const idx = QUESTION_SCREENS.indexOf(name);
    if (idx > -1 && idx < QUESTION_SCREENS.length - 1) return QUESTION_SCREENS[idx + 1];
    if (name === QUESTION_SCREENS[QUESTION_SCREENS.length - 1]) return 'loading';
    return null;
  }

  function advanceFrom(name) {
    const next = nextAfter(name);
    if (next) showScreen(next);
    if (next === 'loading') runLoadingSequence();
  }

  function runLoadingSequence() {
    setTimeout(() => showScreen('final'), 1000);
  }

  /* ------------------------------------------------------------------ *
   * Validação com mensagens elegantes
   * ------------------------------------------------------------------ */
  function showError(fieldSelector, errorId) {
    const field = $(fieldSelector);
    const error = $('#' + errorId);
    if (field) field.classList.add('has-error');
    if (error) error.classList.add('is-visible');
  }
  function clearError(fieldSelector, errorId) {
    const field = $(fieldSelector);
    const error = $('#' + errorId);
    if (field) field.classList.remove('has-error');
    if (error) error.classList.remove('is-visible');
  }

  /* ------------------------------------------------------------------ *
   * Ripple effect nos botões
   * ------------------------------------------------------------------ */
  function attachRipple(el) {
    el.addEventListener('click', (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX ? e.clientX - rect.left : rect.width / 2);
      const y = (e.clientY ? e.clientY - rect.top : rect.height / 2);
      el.style.setProperty('--rx', x + 'px');
      el.style.setProperty('--ry', y + 'px');
      el.classList.remove('is-rippling');
      // eslint-disable-next-line no-unused-expressions
      void el.offsetWidth; // reflow para reiniciar animação
      el.classList.add('is-rippling');
    });
  }
  $all('.ripple').forEach(attachRipple);

  /* ==================================================================== *
   * PERGUNTA 1 — Nome
   * ==================================================================== */
  const inputNome = $('#inputNome');
  $('[data-next="q1"]').addEventListener('click', () => {
    const value = inputNome.value.trim();
    if (!value) {
      showError('#inputNome', 'errorNome');
      inputNome.focus();
      return;
    }
    clearError('#inputNome', 'errorNome');
    answers.nome = value;
    advanceFrom('q1');
  });
  inputNome.addEventListener('input', () => clearError('#inputNome', 'errorNome'));
  inputNome.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('[data-next="q1"]').click();
  });

  /* ==================================================================== *
   * PERGUNTA 2 — Estado (select pesquisável)
   * ==================================================================== */
  const inputEstadoSearch = $('#inputEstadoSearch');
  const estadoDropdown = $('#estadoDropdown');

  function renderEstadoDropdown(filter) {
    const list = estadosCache || ESTADOS_FALLBACK;
    const filtered = filter
      ? list.filter(e => normalize(e.nome).includes(normalize(filter)) || normalize(e.sigla).includes(normalize(filter)))
      : list;

    estadoDropdown.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty';
      empty.textContent = 'Nenhum estado encontrado.';
      estadoDropdown.appendChild(empty);
    } else {
      filtered.forEach(e => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.textContent = `${e.nome} (${e.sigla})`;
        item.tabIndex = 0;
        item.addEventListener('click', () => selectEstado(e));
        item.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') selectEstado(e); });
        estadoDropdown.appendChild(item);
      });
    }
    estadoDropdown.hidden = false;
  }

  function selectEstado(estado) {
    answers.estadoSigla = estado.sigla;
    answers.estadoNome = estado.nome;
    inputEstadoSearch.value = `${estado.nome} (${estado.sigla})`;
    estadoDropdown.hidden = true;
    clearError('#estadoSelect', 'errorEstado');
    loadMunicipios(estado.sigla);
  }

  inputEstadoSearch.addEventListener('focus', () => renderEstadoDropdown(''));
  inputEstadoSearch.addEventListener('input', () => {
    answers.estadoSigla = '';
    answers.estadoNome = '';
    renderEstadoDropdown(inputEstadoSearch.value);
  });
  document.addEventListener('click', (e) => {
    if (!$('#estadoSelect').contains(e.target)) estadoDropdown.hidden = true;
  });

  $('[data-next="q2"]').addEventListener('click', () => {
    if (!answers.estadoSigla) {
      showError('#estadoSelect', 'errorEstado');
      return;
    }
    clearError('#estadoSelect', 'errorEstado');
    advanceFrom('q2');
  });

  async function fetchEstados() {
    try {
      const res = await fetch(IBGE_ESTADOS_URL);
      if (!res.ok) throw new Error('IBGE indisponível');
      const data = await res.json();
      estadosCache = data.map(d => ({ sigla: d.sigla, nome: d.nome }));
    } catch (err) {
      estadosCache = ESTADOS_FALLBACK;
    }
  }

  /* ==================================================================== *
   * PERGUNTA 3 — Cidade (carrega municípios do estado escolhido)
   * ==================================================================== */
  const inputCidadeSearch = $('#inputCidadeSearch');
  const cidadeDropdown = $('#cidadeDropdown');
  const cidadeHint = $('#cidadeHint');

  async function loadMunicipios(uf) {
    inputCidadeSearch.disabled = true;
    inputCidadeSearch.value = '';
    answers.cidade = '';
    cidadeHint.textContent = 'Carregando cidades...';
    cidadeHint.classList.remove('is-hidden');

    if (municipiosCache[uf]) {
      finishLoadMunicipios(uf);
      return;
    }

    try {
      const res = await fetch(IBGE_MUNICIPIOS_URL(uf));
      if (!res.ok) throw new Error('IBGE indisponível');
      const data = await res.json();
      municipiosCache[uf] = data.map(d => d.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    } catch (err) {
      municipiosCache[uf] = null; // sinaliza falha
    }
    finishLoadMunicipios(uf);
  }

  function finishLoadMunicipios(uf) {
    const list = municipiosCache[uf];
    inputCidadeSearch.disabled = false;
    if (list && list.length) {
      cidadeHint.textContent = `${list.length} cidades carregadas para ${answers.estadoNome}.`;
      inputCidadeSearch.placeholder = 'Buscar cidade...';
    } else {
      // Fallback: permite digitar a cidade manualmente caso a API não responda
      cidadeHint.textContent = 'Não foi possível carregar a lista automática. Digite o nome da sua cidade.';
      inputCidadeSearch.placeholder = 'Digite sua cidade';
    }
  }

  function renderCidadeDropdown(filter) {
    const uf = answers.estadoSigla;
    const list = uf ? municipiosCache[uf] : null;
    if (!list) { cidadeDropdown.hidden = true; return; }

    const filtered = filter
      ? list.filter(c => normalize(c).includes(normalize(filter)))
      : list.slice(0, 50);

    cidadeDropdown.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty';
      empty.textContent = 'Nenhuma cidade encontrada.';
      cidadeDropdown.appendChild(empty);
    } else {
      filtered.slice(0, 80).forEach(nomeCidade => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.textContent = nomeCidade;
        item.tabIndex = 0;
        item.addEventListener('click', () => selectCidade(nomeCidade));
        item.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') selectCidade(nomeCidade); });
        cidadeDropdown.appendChild(item);
      });
    }
    cidadeDropdown.hidden = false;
  }

  function selectCidade(nome) {
    answers.cidade = nome;
    inputCidadeSearch.value = nome;
    cidadeDropdown.hidden = true;
    clearError('#cidadeSelect', 'errorCidade');
  }

  inputCidadeSearch.addEventListener('focus', () => renderCidadeDropdown(''));
  inputCidadeSearch.addEventListener('input', () => {
    const uf = answers.estadoSigla;
    const list = uf ? municipiosCache[uf] : null;
    if (list) {
      answers.cidade = '';
      renderCidadeDropdown(inputCidadeSearch.value);
    } else {
      // modo texto livre (fallback offline)
      answers.cidade = inputCidadeSearch.value.trim();
    }
  });
  document.addEventListener('click', (e) => {
    if (!$('#cidadeSelect').contains(e.target)) cidadeDropdown.hidden = true;
  });

  $('[data-next="q3"]').addEventListener('click', () => {
    if (!answers.cidade.trim()) {
      showError('#cidadeSelect', 'errorCidade');
      return;
    }
    clearError('#cidadeSelect', 'errorCidade');
    advanceFrom('q3');
  });

  /* ==================================================================== *
   * PERGUNTA 4 — Faixa etária (chips em grade)
   * ==================================================================== */
  const FAIXAS_IDADE = ['0–18', '19–23', '24–28', '29–33', '34–38', '39–43', '44–48', '49–53', '54–58', '59+'];

  function buildOptionGrid(containerId, options, field, screenName, errorId) {
    const container = $('#' + containerId);
    options.forEach(opt => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'option-chip';
      chip.textContent = opt;
      chip.addEventListener('click', () => {
        $all('.option-chip', container).forEach(c => c.classList.remove('is-selected'));
        chip.classList.add('is-selected');
        answers[field] = opt;
        clearError('#' + containerId, errorId);
        setTimeout(() => advanceFrom(screenName), 260);
      });
      container.appendChild(chip);
    });
  }

  buildOptionGrid('idadeOptions', FAIXAS_IDADE, 'idade', 'q4', 'errorIdade');

  /* ==================================================================== *
   * Helper: gera lista de opções (radio-style, avanço automático)
   * ==================================================================== */
  function buildOptionList(containerId, options, field, screenName, errorId) {
    const container = $('#' + containerId);
    options.forEach(opt => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'option-row';
      row.innerHTML = `<span class="option-radio" aria-hidden="true"></span><span class="option-label"></span>`;
      row.querySelector('.option-label').textContent = opt;
      row.addEventListener('click', () => {
        $all('.option-row', container).forEach(r => r.classList.remove('is-selected'));
        row.classList.add('is-selected');
        answers[field] = opt;
        clearError('#' + containerId, errorId);
        setTimeout(() => advanceFrom(screenName), 260);
      });
      container.appendChild(row);
    });
  }

  buildOptionList('pessoasOptions', ['Apenas eu', '2 pessoas', '3 pessoas', '4 ou mais'], 'pessoas', 'q5', 'errorPessoas');
  buildOptionList('tipoPlanoOptions', ['Individual', 'Familiar', 'Empresarial', 'Ainda não sei'], 'tipoPlano', 'q6', 'errorTipoPlano');
  buildOptionList('planoAtualOptions', ['Não', 'Sim, mas quero trocar', 'Sim, apenas pesquisando'], 'planoAtual', 'q7', 'errorPlanoAtual');
  buildOptionList('prioridadeOptions', ['Menor preço', 'Melhor rede hospitalar', 'Cobertura nacional', 'Atendimento rápido', 'Ainda não sei'], 'prioridade', 'q8', 'errorPrioridade');
  buildOptionGrid('operadoraOptions', ['Hapvida', 'Unimed', 'Amil', 'Bradesco Saúde', 'SulAmérica', 'Porto Dias', 'Amazônia Saúde', 'Select', 'Nenhuma específica'], 'operadora', 'q9', 'errorOperadora');

  /* ==================================================================== *
   * Início do fluxo
   * ==================================================================== */
  $('#startBtn').addEventListener('click', () => {
    showScreen('q1');
    fetchEstados(); // carrega estados em segundo plano assim que o fluxo começa
  });

  /* ==================================================================== *
   * Tela final — envio para o WhatsApp
   * ==================================================================== */
  $('#whatsappBtn').addEventListener('click', () => {
    const msg =
      `Olá!\n\n` +
      `Acabei de preencher a cotação no site.\n\n` +
      `Nome: ${answers.nome}\n` +
      `Estado: ${answers.estadoNome}\n` +
      `Cidade: ${answers.cidade}\n` +
      `Idade: ${answers.idade}\n` +
      `Quantidade de pessoas: ${answers.pessoas}\n` +
      `Tipo de plano: ${answers.tipoPlano}\n` +
      `Plano atual: ${answers.planoAtual}\n` +
      `Prioridade: ${answers.prioridade}\n` +
      `Operadora de interesse: ${answers.operadora}\n\n` +
      `Gostaria de receber minha cotação.`;

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  });

  $('#restartBtn').addEventListener('click', () => {
    // Reseta respostas e campos visuais, volta para a tela inicial
    Object.keys(answers).forEach(k => { answers[k] = ''; });
    inputNome.value = '';
    inputEstadoSearch.value = '';
    inputCidadeSearch.value = '';
    inputCidadeSearch.disabled = true;
    $all('.option-chip.is-selected, .option-row.is-selected').forEach(el => el.classList.remove('is-selected'));
    [['#inputNome','errorNome'],['#estadoSelect','errorEstado'],['#cidadeSelect','errorCidade']].forEach(([sel, id]) => clearError(sel, id));
    showScreen('welcome');
  });

})();

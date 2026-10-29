/*
 * ObservaEdu — Autenticação, cadastro e bloqueio da área interna
 * ---------------------------------------------------------------
 * Responsabilidades:
 *   - exibir a tela de entrada quando o Supabase está configurado;
 *   - permitir cadastro público com e-mail e senha (Supabase Auth);
 *   - tratar confirmação de e-mail quando habilitada no projeto;
 *   - restaurar a sessão salva ao abrir/recarregar a aplicação;
 *   - impedir o uso da área interna sem sessão válida;
 *   - validar campos, mostrar erros claros e permitir logout.
 *
 * Não existe lista manual de autorizados nem papel de administrador no
 * navegador. O isolamento é feito pelas políticas RLS
 * (owner_id = auth.uid()) no PostgreSQL. A administração do projeto
 * (contas, banco, políticas) acontece apenas no painel do Supabase.
 */

window.ObservaEduAuth = (function () {
  'use strict';

  const Supabase = window.ObservaEduSupabase;
  const MIN_PASSWORD = 6;
  const MAX_PASSWORD = 72; // limite do bcrypt usado pelo Supabase Auth

  let callbacks = { onSignedIn: null, onSignedOut: null };
  let wired = false;
  let busy = false;
  let manualSignOut = false;
  let subscribed = false;
  let mode = 'signin'; // 'signin' | 'signup'
  let pendingEmail = '';

  function $(id) {
    return document.getElementById(id);
  }

  function configuration() {
    return Supabase
      ? Supabase.configuration()
      : { configured: false, reason: 'O módulo do Supabase não foi carregado.' };
  }

  function isConfigured() {
    const status = configuration();
    return !!status.configured;
  }

  function setGate(visible) {
    const gate = $('authGate');
    const shell = $('appShell');
    if (!gate) return;

    gate.hidden = !visible;
    document.body.classList.toggle('auth-locked', visible);
    document.documentElement.classList.toggle('auth-pending', visible);

    if (shell) {
      if (visible) {
        shell.setAttribute('aria-hidden', 'true');
        if ('inert' in shell) shell.inert = true;
      } else {
        shell.removeAttribute('aria-hidden');
        if ('inert' in shell) shell.inert = false;
      }
    }

    if (visible) {
      window.setTimeout(function () {
        const email = $('authEmail');
        const form = $('authForm');
        if (email && form && !form.hidden) email.focus();
      }, 60);
    }
  }

  function setLoading(loading) {
    const form = $('authForm');
    const loadingBox = $('authLoading');
    const submit = $('authSubmit');
    if (form) form.hidden = !!loading;
    if (loadingBox) loadingBox.hidden = !loading;
    if (submit) submit.disabled = !!loading || busy;
  }

  function setMessage(text, tone) {
    const box = $('authMessage');
    if (!box) return;
    if (!text) {
      box.hidden = true;
      box.textContent = '';
      box.className = 'auth-message';
      return;
    }
    box.hidden = false;
    box.textContent = text;
    box.className = 'auth-message auth-message--' + (tone || 'error');
  }

  function clearFieldErrors() {
    ['authEmail', 'authPassword'].forEach(function (id) {
      const field = $(id);
      if (field) field.removeAttribute('aria-invalid');
    });
    ['authEmailError', 'authPasswordError'].forEach(function (id) {
      const box = $(id);
      if (box) {
        box.hidden = true;
        box.textContent = '';
      }
    });
  }

  function setFieldError(fieldId, errorId, message) {
    const field = $(fieldId);
    const box = $(errorId);
    if (field) field.setAttribute('aria-invalid', 'true');
    if (box) {
      box.hidden = false;
      box.textContent = message;
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validate(email, password) {
    clearFieldErrors();
    let valid = true;

    if (!email) {
      setFieldError('authEmail', 'authEmailError', 'Informe o e-mail da conta.');
      valid = false;
    } else if (!isValidEmail(email)) {
      setFieldError('authEmail', 'authEmailError', 'Informe um e-mail válido.');
      valid = false;
    }

    if (!password) {
      setFieldError(
        'authPassword',
        'authPasswordError',
        mode === 'signup' ? 'Crie uma senha para sua conta.' : 'Informe a senha.'
      );
      valid = false;
    } else if (password.length < MIN_PASSWORD) {
      setFieldError(
        'authPassword',
        'authPasswordError',
        'A senha deve ter pelo menos ' + MIN_PASSWORD + ' caracteres.'
      );
      valid = false;
    } else if (password.length > MAX_PASSWORD) {
      setFieldError(
        'authPassword',
        'authPasswordError',
        'A senha deve ter no máximo ' + MAX_PASSWORD + ' caracteres.'
      );
      valid = false;
    }

    if (!valid) {
      setMessage(
        mode === 'signup'
          ? 'Revise os campos destacados para criar a conta.'
          : 'Revise os campos destacados para entrar.',
        'error'
      );
    }
    return valid;
  }

  function submitLabel() {
    if (busy) return mode === 'signup' ? 'Criando conta...' : 'Entrando...';
    return mode === 'signup' ? 'Criar minha conta' : 'Entrar';
  }

  function setBusy(value) {
    busy = !!value;
    const submit = $('authSubmit');
    const label = $('authSubmitLabel');
    const resend = $('authResend');
    const form = $('authForm');
    if (label) label.textContent = submitLabel();
    if (submit) submit.disabled = busy;
    if (resend) resend.disabled = busy;
    if (form) form.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function setMode(next, options) {
    const opts = options || {};
    mode = next === 'signup' ? 'signup' : 'signin';

    document.querySelectorAll('[data-auth-mode]').forEach(function (button) {
      const isActive = button.dataset.authMode === mode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    const title = $('authTitle');
    const subtitle = $('authSubtitle');
    const help = $('authHelp');
    const password = $('authPassword');
    const passwordError = $('authPasswordError');
    const resend = $('authResend');

    if (title) {
      title.textContent =
        mode === 'signup' ? 'Criar conta no ObservaEdu' : 'Entrar no ObservaEdu';
    }
    if (subtitle) {
      subtitle.textContent =
        mode === 'signup'
          ? 'Cadastre-se com e-mail e senha. Leva menos de um minuto.'
          : 'Acesse seus registros, relatórios e configurações.';
    }
    if (help) {
      help.textContent =
        mode === 'signup'
          ? 'Ao criar a conta, você concorda em usar o ObservaEdu apenas para registros pedagógicos. ' +
            'Cada conta acessa somente os próprios dados.'
          : 'Ainda não tem conta? Use “Criar minha conta”. Os dados de cada conta são isolados ' +
            'pelas políticas de segurança do banco.';
    }
    if (password) {
      password.setAttribute(
        'autocomplete',
        mode === 'signup' ? 'new-password' : 'current-password'
      );
    }
    if (passwordError) {
      passwordError.hidden = true;
      passwordError.textContent = '';
    }
    if (resend) resend.hidden = true;

    if (!opts.keepEmail) {
      const email = $('authEmail');
      if (email && !opts.keepValue) email.value = '';
    }
    if (password && !opts.keepPassword) password.value = '';

    clearFieldErrors();
    setMessage('', '');
    setBusy(busy); // atualiza o rótulo do botão sem mudar o estado ocupado
  }

  function showGate(message, tone) {
    setLoading(false);
    setGate(true);
    setMessage(message || '', tone || 'error');
  }

  function hideGate() {
    setMessage('', '');
    setGate(false);
  }

  function showResend(email) {
    pendingEmail = email;
    const resend = $('authResend');
    if (resend) resend.hidden = false;
  }

  function handleSignedIn(session) {
    // Depois de qualquer entrada bem-sucedida, a próxima tela deve ser "Entrar".
    setMode('signin', { keepValue: true });
    setMessage('', '');
    subscribeToAuthEvents();

    const resend = $('authResend');
    if (resend) resend.hidden = true;
    pendingEmail = '';

    const password = $('authPassword');
    if (password) password.value = '';

    if (typeof callbacks.onSignedIn === 'function') {
      // Mantém o bloqueio visível até os dados da conta serem carregados.
      return Promise.resolve(callbacks.onSignedIn(session)).then(function () {
        hideGate();
      });
    }

    hideGate();
    return Promise.resolve();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;

    const email = String(($('authEmail') && $('authEmail').value) || '').trim();
    const password = String(($('authPassword') && $('authPassword').value) || '');
    setMessage('', '');

    if (!validate(email, password)) return;

    setBusy(true);
    try {
      if (mode === 'signup') {
        const signup = await Supabase.signUp(email, password);
        if (!signup.ok) {
          setMessage(signup.error || 'Não foi possível criar a conta. Tente novamente.', 'error');
          return;
        }

        if (signup.needsConfirmation) {
          setMode('signin', { keepValue: true });
          const emailInput = $('authEmail');
          if (emailInput) emailInput.value = email;
          showResend(email);
          setMessage(
            'Conta criada. Enviamos um link de confirmação para ' +
              email +
              '. Abra o link no mesmo navegador e depois entre com sua senha. ' +
              'Se não encontrar o e-mail, verifique a caixa de spam.',
            'success'
          );
          return;
        }

        await handleSignedIn(signup.session);
        return;
      }

      const login = await Supabase.signIn(email, password);
      if (!login.ok) {
        setMessage(login.error || 'Não foi possível entrar. Tente novamente.', 'error');
        return;
      }

      await handleSignedIn(login.session);
    } catch (error) {
      setGate(true);
      setMessage(
        Supabase.friendlyError(error) || 'Não foi possível concluir a operação. Tente novamente.',
        'error'
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (busy) return;
    const emailInput = $('authEmail');
    const email = String((emailInput && emailInput.value) || pendingEmail || '').trim();

    clearFieldErrors();
    if (!email || !isValidEmail(email)) {
      setFieldError('authEmail', 'authEmailError', 'Informe um e-mail válido para reenviar.');
      setMessage('Revise o e-mail destacado para reenviar a confirmação.', 'error');
      return;
    }

    setBusy(true);
    setMessage('Reenviando e-mail de confirmação...', 'info');
    try {
      const result = await Supabase.resendConfirmation(email);
      if (!result.ok) {
        setMessage(result.error || 'Não foi possível reenviar a confirmação.', 'error');
        return;
      }
      setMessage(
        'Se houver uma conta pendente para ' + email + ', um novo link de confirmação foi enviado.',
        'success'
      );
    } catch (error) {
      setMessage(Supabase.friendlyError(error) || 'Não foi possível reenviar a confirmação.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Erros de confirmação/recuperação podem voltar na URL. Lê, mostra uma
  // mensagem clara e limpa os parâmetros para não reaparecerem no reload.
  function cleanAuthUrl() {
    try {
      const url = new URL(window.location.href);
      ['error', 'error_code', 'error_description', 'code', 'state'].forEach(function (key) {
        url.searchParams.delete(key);
      });
      if (url.hash) {
        const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
        [
          'error',
          'error_code',
          'error_description',
          'access_token',
          'refresh_token',
          'token_type',
          'expires_in',
          'type'
        ].forEach(function (key) {
          hash.delete(key);
        });
        const rest = hash.toString();
        url.hash = rest ? '#' + rest : '';
      }
      window.history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || ''));
    } catch (error) {
      // Sem histórico disponível (file://, por exemplo): apenas ignora.
    }
  }

  function translateRedirectError(text) {
    const value = String(text || '').trim();
    if (!value) return '';
    if (/expired|invalid/i.test(value)) return 'o link expirou ou já foi utilizado.';
    if (/access denied|not authorized|forbidden/i.test(value)) {
      return 'o acesso foi negado pelo Supabase.';
    }
    return /[.!?]$/.test(value) ? value : value + '.';
  }

  function readRedirectError() {
    let hashParams = null;
    let queryParams = null;
    try {
      hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      queryParams = new URLSearchParams(window.location.search.replace(/^\?/, ''));
    } catch (error) {
      return '';
    }

    const description =
      hashParams.get('error_description') ||
      queryParams.get('error_description') ||
      hashParams.get('error') ||
      queryParams.get('error') ||
      '';

    if (!description) return '';

    cleanAuthUrl();
    return translateRedirectError(description);
  }

  function hadConfirmationCode() {
    try {
      const params = new URLSearchParams(window.location.search.replace(/^\?/, ''));
      return params.has('code') || /access_token=/.test(window.location.hash);
    } catch (error) {
      return false;
    }
  }

  function wire() {
    if (wired) return;
    wired = true;

    const form = $('authForm');
    if (form) form.addEventListener('submit', handleSubmit);

    document.querySelectorAll('[data-auth-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (busy) return;
        setMode(button.dataset.authMode);
        const email = $('authEmail');
        if (email && mode === 'signup') email.focus();
      });
    });

    const resend = $('authResend');
    if (resend) resend.addEventListener('click', handleResend);

    document.addEventListener('online', function () {
      const box = $('authMessage');
      if (box && !box.hidden && /conexão|internet/i.test(box.textContent || '')) {
        setMessage('Conexão restabelecida. Tente novamente.', 'info');
      }
    });
  }

  function subscribeToAuthEvents() {
    if (subscribed || !Supabase || !Supabase.isConfigured()) return;
    subscribed = true;

    try {
      Supabase.onAuthStateChange(function (event) {
        if (event !== 'SIGNED_OUT' || manualSignOut) return;

        // Fora do callback síncrono do Supabase: limpa a interface e
        // volta ao bloqueio de login quando a sessão expira ou é revogada.
        window.setTimeout(function () {
          showGate('Sua sessão terminou. Entre novamente para acessar os registros.', 'warning');
          if (typeof callbacks.onSignedOut === 'function') callbacks.onSignedOut();
        }, 0);
      });
    } catch (error) {
      console.error('ObservaEdu: não foi possível monitorar a sessão.', error);
    }
  }

  async function init(options) {
    callbacks = Object.assign({ onSignedIn: null, onSignedOut: null }, options || {});
    wire();
    setMode('signin', { keepValue: true });

    if (!isConfigured()) {
      setLoading(false);
      hideGate();
      return {
        ok: false,
        mode: 'local',
        reason: configuration().reason
      };
    }

    const redirectError = readRedirectError();
    const confirmationReturn = hadConfirmationCode();

    setGate(true);
    setLoading(true);
    setMessage('Verificando sessão...', 'info');

    try {
      const session = await Supabase.getSession();

      if (session) {
        setLoading(false);
        subscribeToAuthEvents();
        cleanAuthUrl();
        hideGate();
        return { ok: true, mode: 'cloud', session: session };
      }

      setLoading(false);

      if (redirectError) {
        setMessage(
          'Não foi possível concluir a confirmação: ' +
            redirectError +
            ' Se o e-mail já estiver confirmado, entre com e-mail e senha.',
          'error'
        );
        return { ok: false, mode: 'cloud', reason: 'redirect-error' };
      }

      if (confirmationReturn) {
        // O código de confirmação já foi processado (ou falhou). Remove da URL
        // para a mensagem não reaparecer a cada recarregamento.
        cleanAuthUrl();
        setMessage(
          'O link de confirmação foi aberto, mas a sessão não pôde ser concluída neste navegador. ' +
            'Se o e-mail já estiver confirmado, entre com e-mail e senha. ' +
            'Se ainda não estiver, peça um novo link em “Reenviar e-mail de confirmação”.',
          'warning'
        );
        showResend('');
        return { ok: false, mode: 'cloud', reason: 'confirmation-pending' };
      }

      setMessage('Entre com sua conta ou crie uma nova para acessar os registros.', 'info');
      return { ok: false, mode: 'cloud', reason: 'no-session' };
    } catch (error) {
      setLoading(false);
      setMessage(
        Supabase.friendlyError(error) || 'Não foi possível verificar a sessão.',
        'error'
      );
      return { ok: false, mode: 'cloud', reason: 'error' };
    }
  }

  async function logout() {
    manualSignOut = true;
    try {
      const result = await Supabase.signOut();
      return result;
    } finally {
      // O evento SIGNED_OUT pode chegar logo depois da promessa; mantenha a
      // marca por alguns segundos para não exibir um aviso duplicado.
      window.setTimeout(function () {
        manualSignOut = false;
      }, 3000);
    }
  }

  function currentConfiguration() {
    return configuration();
  }

  return {
    init: init,
    logout: logout,
    showGate: showGate,
    hideGate: hideGate,
    isConfigured: isConfigured,
    configuration: currentConfiguration
  };
})();

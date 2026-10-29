/*
 * ObservaEdu — Autenticação e bloqueio da área interna
 * ----------------------------------------------------
 * Responsabilidades:
 *   - exibir a tela de login quando o Supabase está configurado;
 *   - restaurar a sessão salva ao abrir/recarregar a aplicação;
 *   - impedir o uso da área interna sem sessão válida e autorizada;
 *   - validar os campos, mostrar erros claros e permitir logout.
 *
 * Não há cadastro público nesta tela. A conta é criada e autorizada
 * manualmente pelo responsável do projeto no painel do Supabase.
 */

window.ObservaEduAuth = (function () {
  'use strict';

  const Supabase = window.ObservaEduSupabase;
  let callbacks = { onSignedIn: null, onSignedOut: null };
  let wired = false;
  let busy = false;
  let manualSignOut = false;
  let subscribed = false;

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
        if (email && !$('authForm').hidden) email.focus();
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
    const email = $('authEmail');
    const password = $('authPassword');
    const emailError = $('authEmailError');
    const passwordError = $('authPasswordError');

    if (email) email.removeAttribute('aria-invalid');
    if (password) password.removeAttribute('aria-invalid');
    if (emailError) {
      emailError.hidden = true;
      emailError.textContent = '';
    }
    if (passwordError) {
      passwordError.hidden = true;
      passwordError.textContent = '';
    }
  }

  function setFieldError(field, errorBox, message) {
    if (field) field.setAttribute('aria-invalid', 'true');
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = message;
    }
  }

  function validate(email, password) {
    clearFieldErrors();
    let valid = true;

    if (!email) {
      setFieldError($('authEmail'), $('authEmailError'), 'Informe o e-mail da conta.');
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError($('authEmail'), $('authEmailError'), 'Informe um e-mail válido.');
      valid = false;
    }

    if (!password) {
      setFieldError($('authPassword'), $('authPasswordError'), 'Informe a senha.');
      valid = false;
    } else if (password.length < 6) {
      setFieldError(
        $('authPassword'),
        $('authPasswordError'),
        'A senha deve ter pelo menos 6 caracteres.'
      );
      valid = false;
    }

    if (!valid) setMessage('Revise os campos destacados para entrar.', 'error');
    return valid;
  }

  function setBusy(value) {
    busy = !!value;
    const submit = $('authSubmit');
    const form = $('authForm');
    if (submit) {
      submit.disabled = busy;
      submit.textContent = busy ? 'Entrando...' : 'Entrar';
    }
    if (form) form.setAttribute('aria-busy', busy ? 'true' : 'false');
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

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;

    const email = String(($('authEmail') && $('authEmail').value) || '').trim();
    const password = String(($('authPassword') && $('authPassword').value) || '');
    setMessage('', '');

    if (!validate(email, password)) return;

    setBusy(true);
    try {
      const login = await Supabase.signIn(email, password);
      if (!login.ok) {
        setMessage(login.error || 'Não foi possível entrar. Tente novamente.', 'error');
        return;
      }

      const access = await Supabase.checkAccess();
      if (!access.ok) {
        await Supabase.signOut();
        setMessage(access.error || 'Não foi possível verificar a autorização da conta.', 'error');
        return;
      }

      if (!access.allowed) {
        await Supabase.signOut();
        setMessage(
          'Esta conta foi autenticada, mas não está autorizada a usar o ObservaEdu. ' +
            'Solicite ao responsável a inclusão na lista de usuários autorizados.',
          'error'
        );
        return;
      }

      setMessage('', '');
      subscribeToAuthEvents();

      const passwordInput = $('authPassword');
      if (passwordInput) passwordInput.value = '';

      if (typeof callbacks.onSignedIn === 'function') {
        // Mantém o bloqueio visível até os dados da conta serem carregados.
        await callbacks.onSignedIn(login.session);
      }

      hideGate();
    } catch (error) {
      setGate(true);
      setMessage(
        Supabase.friendlyError(error) || 'Não foi possível entrar. Tente novamente.',
        'error'
      );
    } finally {
      setBusy(false);
    }
  }

  function wire() {
    if (wired) return;
    wired = true;

    const form = $('authForm');
    if (form) form.addEventListener('submit', handleSubmit);

    document.addEventListener('online', function () {
      const box = $('authMessage');
      if (box && !box.hidden && /conexão|internet/i.test(box.textContent || '')) {
        setMessage('Conexão restabelecida. Tente entrar novamente.', 'info');
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

    if (!isConfigured()) {
      setLoading(false);
      hideGate();
      return {
        ok: false,
        mode: 'local',
        reason: configuration().reason
      };
    }

    setGate(true);
    setLoading(true);
    setMessage('Verificando sessão...', 'info');

    try {
      const session = await Supabase.getSession();
      if (!session) {
        setLoading(false);
        setMessage('Entre com a conta autorizada para acessar os registros.', 'info');
        return { ok: false, mode: 'cloud', reason: 'no-session' };
      }

      const access = await Supabase.checkAccess();
      if (!access.ok) {
        setLoading(false);
        setMessage(access.error || 'Não foi possível verificar a autorização da conta.', 'error');
        return { ok: false, mode: 'cloud', reason: 'access-error' };
      }

      if (!access.allowed) {
        await Supabase.signOut();
        setLoading(false);
        setMessage(
          'A sessão existe, mas esta conta não está autorizada. ' +
            'Solicite a inclusão na lista de usuários autorizados do ObservaEdu.',
          'error'
        );
        return { ok: false, mode: 'cloud', reason: 'not-authorized' };
      }

      subscribeToAuthEvents();
      setLoading(false);
      hideGate();
      return { ok: true, mode: 'cloud', session: session };
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

/*
 * ObservaEdu — Service Worker
 * ---------------------------
 * Este service worker guarda apenas os arquivos estáticos da interface:
 * HTML, CSS, JavaScript, biblioteca do Supabase, logo, manifesto e ícones.
 *
 * PRIVACIDADE E NUVEM:
 * - O cache NUNCA contém registros de observação, configurações, backups
 *   JSON, tokens de sessão ou respostas da API do Supabase.
 * - Requisições para outra origem (incluindo *.supabase.co) não são
 *   interceptadas nem armazenadas por este service worker.
 * - Sem internet, a interface pode abrir pelo cache, mas login e dados da
 *   nuvem não funcionam. Não há sincronização offline fictícia.
 *
 * ESTRATÉGIAS:
 * - Navegação: rede primeiro, com o index.html em cache como reserva offline.
 * - Configuração pública: rede primeiro (para propagar troca de chave),
 *   com a última versão em cache como reserva.
 * - Demais arquivos estáticos: cache primeiro, atualizando o cache pela rede.
 */

'use strict';

const VERSION = '1.2.0';
const CACHE_NAME = 'observaedu-static-' + VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=' + VERSION,
  './supabase-config.js?v=' + VERSION,
  './vendor/supabase-js-2.118.0.js?v=' + VERSION,
  './supabase.js?v=' + VERSION,
  './questions.js?v=' + VERSION,
  './storage.js?v=' + VERSION,
  './analysis.js?v=' + VERSION,
  './report.js?v=' + VERSION,
  './auth.js?v=' + VERSION,
  './app.js?v=' + VERSION,
  './logo.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png'
];

const STATIC_DESTINATIONS = ['script', 'style', 'image', 'font', 'manifest'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key.indexOf('observaedu-static-') === 0 && key !== CACHE_NAME;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isNavigation(request) {
  return request.mode === 'navigate';
}

function isStaticAsset(request) {
  return STATIC_DESTINATIONS.indexOf(request.destination) !== -1;
}

async function cachedShell(cache, request) {
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  return cache.match('./index.html');
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // A resposta é o HTML da interface, não dados de observação.
      cache.put(request, response.clone());
      return response;
    }

    // Alguns servidores/proxies respondem 5xx quando estão indisponíveis.
    // Nesses casos, prioriza a interface já armazenada para não perder o uso offline.
    if (response && response.status >= 500) {
      const fallback = await cachedShell(cache, request);
      if (fallback) return fallback;
    }

    return response;
  } catch (error) {
    const fallback = await cachedShell(cache, request);
    if (fallback) return fallback;
    return new Response(
      '<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><title>ObservaEdu offline</title>' +
        '<body style="font-family:system-ui,sans-serif;padding:32px;line-height:1.6">' +
        '<h1>ObservaEdu</h1><p>Esta página ainda não está disponível offline neste navegador.</p>' +
        '<p>Conecte-se à internet, abra o ObservaEdu uma vez e tente novamente.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

function isPublicConfig(request) {
  try {
    return new URL(request.url).pathname.endsWith('/supabase-config.js');
  } catch (error) {
    return false;
  }
}

// A configuração pública pode mudar quando o proprietário cola a chave.
// Por isso usa rede primeiro, mantendo a última cópia apenas como reserva.
async function networkFirstConfig(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Privacidade: somente a própria origem é tratada. Requisições da API do
  // Supabase (outra origem) e tokens nunca entram no Cache Storage.
  if (url.origin !== self.location.origin) return;

  if (isNavigation(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isPublicConfig(request)) {
    event.respondWith(networkFirstConfig(request));
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(cacheFirstStatic(request));
  }
});

/**
 * Pembungkus fetch: timeout, User-Agent, retry, dan pelaporan status yang rapi.
 * Semua modul OSINT memakai ini supaya perilaku jaringan konsisten.
 */

import { config } from '../config.js';

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', body = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch dengan timeout + retry exponential backoff.
 * @param {string} url
 * @param {RequestInit & { timeout?: number, retries?: number, browserUA?: boolean }} opts
 */
export async function request(url, opts = {}) {
  const {
    timeout = config.timeoutMs,
    retries = 1,
    browserUA = false,
    headers = {},
    ...rest
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        ...rest,
        headers: {
          'User-Agent': browserUA ? config.browserUA : config.userAgent,
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
          ...headers,
        },
        signal: ctrl.signal,
      });

      const text = await res.text();

      // 429/5xx layak dicoba ulang, 4xx lain tidak.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastErr = new HttpError(`HTTP ${res.status}`, { status: res.status, url });
        await sleep(500 * 2 ** attempt);
        continue;
      }

      return { status: res.status, url: res.url, text, headers: res.headers };
    } catch (err) {
      lastErr =
        err.name === 'AbortError'
          ? new HttpError(`Timeout ${timeout}ms`, { url })
          : new HttpError(err.message, { url });
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function requestJSON(url, opts = {}) {
  const res = await request(url, {
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers || {}) },
  });
  let json = null;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new HttpError('Respons bukan JSON valid', {
      status: res.status,
      url,
      body: res.text.slice(0, 200),
    });
  }
  return { status: res.status, json, headers: res.headers, url: res.url };
}

/**
 * Jalankan task dengan batas concurrency.
 * Task yang gagal tidak menghentikan proses; hasilnya masuk slot `error`.
 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: err.message };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runner)
  );
  return results;
}

/** Ambil isi tag pertama dari HTML (untuk parsing tanpa DOM library). */
export function matchTag(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = html.match(re);
  return m ? stripTags(m[1]) : null;
}

export const stripTags = (s = '') =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
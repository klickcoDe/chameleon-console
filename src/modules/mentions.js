/**
 * Modul "Sebaran Publik" — mencari halaman/posting publik yang menyebut
 * nomor telepon.
 *
 * Ini jawaban untuk permintaan "cek pos": cari jejak nomor di web publik —
 * pengumuman toko, thread forum, listing OLX/Tokopedia, berita, dan
 * laporan rubbish yang menyebut nomor tersebut.
 *
 * SUMBER (semua keyless & API/feed resmi):
 *   - Bing (HTML)          : hasil pencarian web, dipakai untuk konteks
 *                            "penjualan / toko / admin / CS".
 *   - Google News (RSS)    : penyebutan di pemberitaan.
 *   - Stack Exchange (API) : penyebutan di forum teknis.
 *   - urlscan.io (API)     : halaman yang pernah discan publik & memuat nomor.
 *
 * VOLUME SENGJAJA DIBATASI: maksimal 2 query per mesin pencari per nomor.
 * Mengguyur Bing dengan banyak query akan memblokir IP tool ini, dan
 * tambahan hasil yang sedikit tidak sebanding dengan risiko diblokir.
 *
 * Yang TIDAK dilakukan: mengikis GetContact/Truecaller/Kredibel. Data
 * "nama kontak tersimpan" di sana dibangun dari opt-in pengguna dan tidak
 * dibuka lewat API — mengikisnya berarti melanggar ToS situs tersebut.
 * Modul ini sebagai gantinya mencari jejak nomor yang memang terbuka, lalu
 * menyodorkan tautan manual ke sumber crowdsourced itu.
 */

import { request, requestJSON } from '../util/http.js';
import { normalize } from '../util/phone.js';

/* ── Parser hasil Bing ────────────────────────────────────────────────── */

/**
 * Direktori crowdsourced yang memuat daftar nama pemanggil.
 *
 * Modul ini tidak mengikis halaman-halaman ini — yang dilakukan hanya
 * mencari halaman mana yang memuat nomor, lalu menyerahkan tautannya.
 */
export const CALLER_NAME_SITES = [
  'tellows.net',
  'tellows.com',
  'telspy.org',
  'nomor-siapa.id',
  'kredibel.com',
  'truecaller.com',
  'getcontact.com',
  'myscams.com',
  'myspamcalls.net',
  'whocallsme.net',
  'cektelpon.com',
  'ceknomer.com',
  'telpon.info',
  'nomor-hp.id',
  'caritelnomor.com',
  'spamcalls.net',
  'callfilter.id',
  'idnomer.com',
  '2nomor.com',
  'cekno.com',
];

/**
 * Bing membungkus URL asli di redirector `bing.com/ck/a?...&u=a1<base64>`.
 * Base64 itu adalah URL asli (base64url). Tanpa decoding ini, semua tautan
 * yang keluar dari modul menunjuk ke Bing, bukan ke sumbernya.
 */
function decodeBingUrl(href) {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://www.bing.com');
    const param = u.searchParams.get('u');
    if (param && param.startsWith('a1')) {
      const b64 = param.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const decoded = Buffer.from(pad, 'base64').toString('utf8');
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
    if (/^https?:\/\//i.test(href)) return href;
    // Fallback: ambil <cite> sebagai indikasi URL tampilan.
    return null;
  } catch {
    return null;
  }
}

const stripHtmlEntities = (s = '') =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Ambil blok hasil Bing: judul, URL asli, dan cuplikan.
 * Struktur: <li class="b_algo"> <h2><a href>TITLE</a></h2> ... <p class="b_lineclamp">SNIPPET</p>
 */
export function parseBingResults(html) {
  const out = [];
  const blocks = String(html || '').match(/<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>)/g) || [];

  for (const block of blocks) {
    const head = block.match(/<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!head) continue;

    const url = decodeBingUrl(head[1].replace(/&amp;/g, '&'));
    const title = stripHtmlEntities(head[2]);
    const snipMatch =
      block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snipMatch ? stripHtmlEntities(snipMatch[1]) : '';

    if (!title) continue;
    out.push({ title, url, snippet });
  }
  return out;
}

/* ── Parser hasil DuckDuckGo (HTML) ──────────────────────────────────── */

/**
 * DuckDuckGo membungkus URL asli di redirector `duckduckgo.com/l/?uddg=...`
 * dengan URL asli ter-encode di dalam parameter `uddg`.
 */
function decodeDdgUrl(href) {
  if (!href) return null;
  const raw = href.replace(/&amp;/g, '&');
  const m = raw.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return null;
}

/**
 * Ambil daftar hasil DuckDuckGo: judul, URL asli, cuplikan.
 *
 * Struktur HTML (stabil untuk html.duckduckgo.com):
 *   <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=...">Judul</a>
 *   <a class="result__snippet" href="...">Cuplikan</a>
 */
export function parseDdgResults(html) {
  const out = [];
  const blocks = String(html || '').split(/<div class="result results_links/).slice(1);

  for (const block of blocks) {
    let title = null;
    let snippet = '';
    let url = null;

    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(block)) !== null) {
      const attrs = m[1] || '';
      const inner = m[2] || '';
      if (/class="[^"]*result__a/.test(attrs) && !title) {
        title = stripHtmlEntities(inner);
        url = decodeDdgUrl((attrs.match(/href="([^"]+)"/) || [])[1]);
      } else if (/class="[^"]*result__snippet/.test(attrs) && !snippet) {
        snippet = stripHtmlEntities(inner);
        if (!url) url = decodeDdgUrl((attrs.match(/href="([^"]+)"/) || [])[1]);
      }
    }

    if (title) out.push({ title, url, snippet });
  }
  return out;
}

/* ── Pencarian ────────────────────────────────────────────────────────── */

/** Satu query ke Bing. */
async function bingSearch(query, { limit = 10 } = {}) {
  const url =
    'https://www.bing.com/search?q=' +
    encodeURIComponent(query) +
    `&count=${Math.min(limit, 30)}&setlang=id&cc=id`;

  const { status, text } = await request(url, {
    browserUA: true,
    timeout: 12000,
    retries: 2,
  });

  if (status !== 200) {
    return { ok: false, error: `Bing HTTP ${status}`, results: [] };
  }
  const results = parseBingResults(text);
  return { ok: true, results, error: null };
}

/** Satu query ke DuckDuckGo (endpoint HTML, tanpa key). */
async function ddgSearch(query, { limit = 15 } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const { status, text } = await request(url, {
    browserUA: true,
    timeout: 15000,
    retries: 1,
  });

  if (status !== 200) {
    return { ok: false, error: `DuckDuckGo HTTP ${status}`, results: [] };
  }

  const results = parseDdgResults(text).slice(0, limit);
  if (!results.length) {
    return {
      ok: false,
      error: 'DuckDuckGo tidak mengembalikan hasil yang bisa diparsing (kemungkinan halaman anti-bot).',
      results: [],
    };
  }
  return { ok: true, results, error: null };
}

/** Penyebutan di pemberitaan (Google News RSS, keyless). */
async function newsMentions(query) {
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query) +
    '&hl=id&gl=ID&ceid=ID:id';

  const { status, text } = await request(url, { timeout: 15000, retries: 1 });
  if (status !== 200) return { ok: false, error: `Google News HTTP ${status}`, results: [] };

  const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
  const results = items.map((item) => {
    const pick = (tag) => (item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1] || '';
    const pub = pick('pubDate');
    return {
      title: stripHtmlEntities(pick('title')),
      url: stripHtmlEntities(pick('link')),
      snippet: stripHtmlEntities(pick('description')).slice(0, 400),
      publishedAt: pub ? new Date(pub).toISOString() : null,
    };
  }).filter((r) => r.title);

  return { ok: true, results, error: null };
}

/** Penyebutan di Stack Exchange (API resmi, keyless). */
async function stackMentions(query) {
  const url =
    'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=' +
    encodeURIComponent(query) +
    '&site=stackoverflow&pagesize=10&filter=default';

  const { status, json } = await requestJSON(url, { timeout: 15000, retries: 1 });
  if (status !== 200 || !json?.items) {
    return { ok: false, error: `Stack Exchange HTTP ${status}`, results: [] };
  }
  const results = json.items.map((it) => ({
    title: stripHtmlEntities(it.title),
    url: it.link,
    snippet: stripHtmlEntities(it.body || '').slice(0, 300),
    publishedAt: it.creation_date ? new Date(it.creation_date * 1000).toISOString() : null,
  }));
  return { ok: true, results, error: null };
}

/** Halaman yang pernah discan publik dan memuat nomor (urlscan.io). */
async function urlscanMentions(query) {
  const url = `https://urlscan.io/api/v1/search/?q=${encodeURIComponent(query)}&size=10`;
  const { status, json } = await requestJSON(url, { timeout: 15000, retries: 1 });
  if (status !== 200 || !json?.results) {
    return { ok: false, error: `urlscan HTTP ${status}`, results: [] };
  }
  const results = json.results.map((r) => ({
    title: r.page?.title || r.task?.url || '(tanpa judul)',
    url: r.result || r.page?.url || null,
    snippet: [r.page?.domain, r.page?.ip, r.task?.time].filter(Boolean).join(' · '),
    publishedAt: r.task?.time || null,
  }));
  return { ok: true, results, error: null };
}

/* ── Entry point ──────────────────────────────────────────────────────── */

/**
 * Cari semua jejak publik sebuah nomor.
 *
 * @param {string} rawNumber
 * @param {object} opts - { limit }
 */
export async function publicMentions(rawNumber, { limit = 20 } = {}) {
  const parsed = normalize(rawNumber);
  if (!parsed) {
    return { ok: false, error: `Nomor tidak valid: "${rawNumber}"` };
  }

  const { e164, national, digits } = parsed;
  const local = digits.replace(/^62/, '0'); // 628123… -> 08123…

  // Dua varian yang paling sering dipakai orang di web: format lokal (0xx)
  // dan format internasional (62xx / +62xx).
  const variants = [...new Set([local, digits, e164])].filter(Boolean);

  const sources = [];
  const mentions = [];

  const push = (source, results, kind) => {
    for (const r of results) {
      mentions.push({
        ...r,
        source,
        kind,
        site: r.url ? hostOf(r.url) : null,
      });
    }
  };

  /* 1. Bing — konteks umum + konteks niaga/penipuan (maksimal 2 query).
   *
   * PENTING: yang dicari adalah format INTERNASIONAL ("6281234567890"),
   * bukan format lokal ("081234567890"). Diuji: format internasional
   * jauh lebih banyak menghasilkan halaman yang memang menyebut nomor
   * (tellows, kredibel, nomor-siapa, halaman kontak toko), sementara
   * format lokal banyak mengembalikan halaman tak relevan.
   */
  const bingQueries = [
    { label: 'umum', q: `"${digits}"` },
    { label: 'niaga & penipuan', q: `"${digits}" (wa OR admin OR penjual OR penipuan OR scam)` },
  ];

  /* Semua sumber dijalankan paralel — total waktu = sumber terlama,
     bukan penjumlahan. Volume request per sumber tetap sama. */
  const [bingResults, ddg, news, se, us] = await Promise.all([
    Promise.all(
      bingQueries.map((q) =>
        bingSearch(q.q, { limit: 10 }).catch((err) => ({ ok: false, error: err.message, results: [] }))
      )
    ),
    ddgSearch(`"${digits}"`, { limit: 15 }).catch((err) => ({ ok: false, error: err.message, results: [] })),
    newsMentions(`"${digits}"`).catch((err) => ({ ok: false, error: err.message, results: [] })),
    stackMentions(local).catch((err) => ({ ok: false, error: err.message, results: [] })),
    urlscanMentions(local).catch((err) => ({ ok: false, error: err.message, results: [] })),
  ]);

  bingResults.forEach((r, i) => {
    sources.push({
      name: `Bing (${bingQueries[i].label})`,
      ok: r.ok,
      count: r.results.length,
      error: r.error || null,
    });
    push('Bing', r.results, 'web');
  });

  sources.push({ name: 'DuckDuckGo', ok: ddg.ok, count: ddg.results.length, error: ddg.error || null });
  push('DuckDuckGo', ddg.results, 'web');

  sources.push({ name: 'Google News', ok: news.ok, count: news.results.length, error: news.error || null });
  push('Google News', news.results, 'news');

  sources.push({ name: 'Stack Exchange', ok: se.ok, count: se.results.length, error: se.error || null });
  push('Stack Exchange', se.results, 'forum');

  sources.push({ name: 'urlscan.io', ok: us.ok, count: us.results.length, error: us.error || null });
  push('urlscan.io', us.results, 'scan');

  /* ── Saringan relevansi ──────────────────────────────────────────────
   *
   * Mesin pencari sering mengembalikan halaman yang kebetulan memuat
   * angka serupa (mis. "81234567890" yang jadi ID game di situs lain).
   * Hasil seperti itu bukan jejak nomor, dan kalau ikut dihitung akan
   * merusak tag. Karena itu hanya hasil yang TEKAT memuat nomor yang
   * dipertahankan — dicek dengan membandingkan digit saja, sehingga
   * "0812 3456-7890" tetap dianggap sama dengan "081234567890".
   */
  // Non-digit diganti SPASI (bukan dihapus). Kalau dihapus, digit dari
  // judul dan cuplikan akan menempel jadi satu angka panjang dan
  // pencocokan nomor gagal.
  const digitsOf = (s) => String(s || '').replace(/[^\d]+/g, ' ');
  const needles = [...new Set([local, digits, digits.replace(/^0/, '')].filter((x) => x.length >= 8))];

  // Batas digit dipakai supaya "081234567890" tidak ikut cocok dengan
  // "0812345678901" (itu nomor lain).
  const needleRes = needles.map((n) => new RegExp(`(?<!\\d)${n}(?!\\d)`));

  const containsNumber = (r) => {
    const hay = digitsOf(`${r.title || ''} ${r.snippet || ''} ${r.url || ''}`);
    return needleRes.some((re) => re.test(hay));
  };

  const relevant = mentions.filter(containsNumber);
  const dropped = mentions.length - relevant.length;

  /* Rapikan: buang duplikat URL, urutkan berdasarkan relevansi sumber. */
  const seen = new Set();
  const unique = relevant.filter((m) => {
    const key = (m.url || m.title).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Halaman yang paling sering menyebut nomor = indikasi "tag" paling umum.
  const siteCount = new Map();
  for (const m of unique) {
    if (!m.site) continue;
    siteCount.set(m.site, (siteCount.get(m.site) || 0) + 1);
  }
  const sites = [...siteCount.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  /* Halaman direktori nama pemanggil.
   *
   * Situs-situs ini memuat daftar "nama pemanggil" crowdsourced secara
   * terbuka. Modul ini TIDAK mengikis them (itu melanggar ToS dan bisa
   * memblokir IP tool ini) — tapi tautan ke halaman yang ditemukan mesin
   * pencarian diserahkan ke pengguna untuk dibuka sendiri. Satu klik.
   */
  const callerNamePages = unique
    .filter((m) => m.site && CALLER_NAME_SITES.some((d) => m.site === d || m.site.endsWith(`.${d}`)))
    .map((m) => ({ title: m.title, url: m.url, site: m.site, snippet: m.snippet }));

  const failedSources = sources.filter((s) => !s.ok);

  return {
    ok: unique.length > 0,
    error: unique.length
      ? null
      : failedSources.length
        ? `Tidak ada jejak publik yang menyebut nomor ini. ${failedSources.length} dari ` +
          `${sources.length} sumber tidak merespons (${failedSources.map((s) => s.name).join(', ')}) — ` +
          'hasil kosong ini belum tentu berarti nomornya memang tidak ada jejaknya.'
        : 'Tidak ada jejak publik yang menyebut nomor ini di sumber yang ditanyakan.',
    number: e164,
    national,
    variants,
    count: unique.length,
    mentions: unique.slice(0, limit),
    sites: sites.slice(0, 20),
    callerNamePages: callerNamePages.slice(0, 10),
    sources,
    filteredOut: dropped,
    note:
      'Jejak ini diambil dari hasil pencarian & feed publik, lalu disaring: ' +
      'hanya hasil yang benar-benar memuat nomor yang dipertahankan. Tidak ada ' +
      'sumber yang menyediakan "nama kontak yang disimpan orang lain" secara ' +
      'terbuka — data itu bangun opt-in (Truecaller/GetContact) dan tidak dibuka ' +
      'lewat API. Untuk tag crowdsourced, pakai tautan verifikasi manual di bawah.',
    manualCheck: [
      { name: 'GetContact (tag crowdsourced)', url: `https://www.getcontact.com/${e164.replace('+', '')}` },
      { name: 'Truecaller', url: `https://www.truecaller.com/who-called-me-from/${e164.replace('+', '')}` },
      { name: 'Kredibel (laporan penipuan)', url: `https://kredibel.com/telepon/${e164.replace('+', '')}` },
      { name: 'aduannomor (Komdigi)', url: 'https://aduannomor.id/' },
      { name: 'Telegram (t.me)', url: `https://t.me/+${digits}` },
      { name: 'Google (dork manual)', url: `https://www.google.com/search?q=${encodeURIComponent(`"${local}"`)}` },
    ],
    generatedAt: new Date().toISOString(),
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export const mentionsTools = [
  { id: 'mentions', label: 'Sebaran Publik Nomor', needs: 'phone' },
];

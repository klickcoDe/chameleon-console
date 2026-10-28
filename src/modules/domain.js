/**
 * Modul domain & infrastruktur web.
 *
 * Cakupan:
 *   - DNS        : resolver resmi melalui Google DoH (JSON, tanpa key)
 *   - WHOIS      : RDAP (penerus resmi WHOIS, format terstruktur)
 *   - Subdomain  : Certificate Transparency log (CertSpotter, fallback crt.sh)
 *   - Headers    : probe HTTP HEAD/GET + penilaian header keamanan
 *   - Arsip      : Internet Archive Wayback (CDX)
 *   - Fingerprint: judul, meta, tech yang terdeteksi dari HTML publik
 *
 * Prinsip yang sama seperti modul lain: kalau sumber tidak bisa dihubungi,
 * statusnya dilaporkan apa adanya (unreachable / unconfigured). Tidak ada
 * data yang dikarang supaya laporan terlihat lengkap.
 *
 * Sumber yang dipakai seluruhnya terbuka untuk publik tanpa autentikasi:
 * resolver DNS, log CT, arsip web, dan endpoint RDAP resmi registrar.
 */

import { request, requestJSON, stripTags } from '../util/http.js';

/* ── Validasi input ────────────────────────────────────────────────────── */

const DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+$/;

/**
 * Bersihkan input domain. Menerima input yang diklik pengguna
 * ("https://www.contoh.com/path") dan mengembalikan host-nya saja.
 */
export function parseDomain(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;

  // Buang skema kalau ada.
  s = s.replace(/^[a-z]+:\/\//i, '');
  // Buang path, query, fragment, kredensial, dan port.
  s = s.split(/[/?#]/)[0];
  s = s.replace(/^[^@]*@/, '');
  s = s.replace(/:\d+$/, '');
  // Buang titik di akhir.
  s = s.replace(/\.+$/, '').toLowerCase();

  return DOMAIN_RE.test(s) ? s : null;
}

/** Pecah URL menjadi host + pathname,default ke "/" bila tidak ada. */
function splitUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!DOMAIN_RE.test(u.hostname)) return null;
    return { href: u.href, host: u.hostname, path: u.pathname + u.search };
  } catch {
    return null;
  }
}

/* ── 1. DNS ────────────────────────────────────────────────────────────── */

/** Pemetaan angka tipe DNS → nama yang enak dibaca. */
const DNS_TYPES = {
  A: 'Alamat IPv4',
  AAAA: 'Alamat IPv6',
  CNAME: 'Alias kanonik',
  MX: 'Server mail',
  NS: 'Server name',
  TXT: 'Teks bebas (sering dipakai verifikasi)',
  SOA: 'Otoritas zona',
  PTR: 'Reverse lookup',
  CAA: 'Kebijakan otorisasi sertifikat',
  SRV: 'Layanan',
  DNSKEY: 'Kunci DNSSEC',
};

/**
 * Query DNS lewat Google DoH (https://dns.google/resolve).
 *
 * Dipakai daripada node:dns karena resolver bawaan OS bisa diblokir jaringan
 * atau diarahkan ke DNS ISP yang menyaring. DoH selalu konsisten dan
 * mengembalikan JSON.
 */
export async function dnsLookup(domainRaw, type = 'ANY') {
  const domain = parseDomain(domainRaw);
  if (!domain) {
    return { ok: false, error: `Domain tidak valid: "${domainRaw}"` };
  }

  const wanted = String(type || 'ANY').toUpperCase();
  const types = wanted === 'ANY' ? ['A', 'AAAA', 'MX', 'NS', 'TXT', 'SOA', 'CNAME', 'CAA'] : [wanted];

  const results = await Promise.all(
    types.map(async (t) => {
      const started = Date.now();
      try {
        const { status, json } = await requestJSON(
          `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${t}`,
          { retries: 1, timeout: 10000 }
        );

        if (status !== 200 || !json) {
          return { type: t, label: DNS_TYPES[t] || t, error: `HTTP ${status}`, ms: Date.now() - started };
        }

        const answers = (json.Answer || []).map((a) => ({
          name: a.name,
          ttl: a.TTL,
          data: a.data,
        }));

        return {
          type: t,
          label: DNS_TYPES[t] || t,
          rcode: json.Status,
          // Status 0 = NOERROR. 3 = NXDOMAIN (domain memang tidak ada).
          status: json.Status === 0 ? 'ok' : json.Status === 3 ? 'nxdomain' : 'error',
          answers,
          ms: Date.now() - started,
        };
      } catch (err) {
        return { type: t, label: DNS_TYPES[t] || t, error: err.message, ms: Date.now() - started };
      }
    })
  );

  const hasData = results.some((r) => r.answers?.length);
  const nxdomain = results.every((r) => r.status === 'nxdomain');

  return {
    ok: hasData,
    domain,
    queriedType: wanted,
    resolved: hasData,
    notFound: nxdomain,
    records: results,
    generatedAt: new Date().toISOString(),
    note: hasData
      ? undefined
      : nxdomain
        ? 'Server DNS otoritatif menyatakan domain ini tidak ada (NXDOMAIN).'
        : 'Tidak ada record yang dikembalikan. Bisa domain memakai DNS privat, atau server resolver tidak bisa dijangkau.',
  };
}

/* ── 2. WHOIS via RDAP ─────────────────────────────────────────────────── */

/**
 * Registrasi domain lewat RDAP — penerus resmi protokol WHOIS.
 *
 * Kenapa bukan whois:// ? Protokol WHOIS port 43 diblokir sebagian jaringan
 * dan output-nya tidak terstruktur. RDAP memberi JSON terstruktur dari
 * registrar yang sama, dan inilah yang kini dipakai ICANN sebagai standar.
 */
export async function whoisLookup(domainRaw) {
  const domain = parseDomain(domainRaw);
  if (!domain) {
    return { ok: false, error: `Domain tidak valid: "${domainRaw}"` };
  }

  try {
    const { status, json } = await requestJSON(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      { retries: 1, timeout: 15000 }
    );

    if (status === 404) {
      return {
        ok: false,
        domain,
        error: 'Domain tidak terdaftar (RDAP membalas 404).',
      };
    }
    if (status !== 200 || !json) {
      return { ok: false, domain, error: `RDAP membalas HTTP ${status}` };
    }

    // Tanggal penting disimpan terpisah supaya mudah ditampilkan.
    const events = {};
    for (const e of json.events || []) {
      if (e.eventAction) events[e.eventAction] = e.eventDate;
    }

    // Ambil registrar & NIC dari entitas vCard, bukan dari teks bebas —
    // supaya tidak perlu parsing string yang rapuh. Nilai vCard bisa berupa
    // array (field 'adr' memang begitu di RFC 6350), jadi harus dinormalisasi
    // sebelum diproses sebagai teks.
    const contacts = [];
    for (const ent of json.entities || []) {
      const roles = ent.roles || [];
      const vcard = ent.vcardArray?.[1] || [];
      const field = (key) => {
        const v = vcard.find((f) => f[0] === key)?.[3];
        if (v == null) return '';
        if (Array.isArray(v)) return v.filter(Boolean).join(', ');
        return String(v);
      };
      contacts.push({
        roles,
        handle: ent.handle,
        name: field('fn'),
        email: field('email'),
        phone: field('tel'),
        country: field('adr'),
      });
    }

    const registrar = contacts.find((c) => c.roles.includes('registrar'));

    return {
      ok: true,
      domain,
      handle: json.handle,
      status: json.status,
      events: {
        created: events.registration || null,
        updated: events['last changed'] || null,
        expires: events.expiration || null,
      },
      registrar: registrar
        ? { name: registrar.name || registrar.handle, email: registrar.email, phone: registrar.phone }
        : null,
      contacts: contacts.filter((c) => c.email || c.name),
      nameservers: (json.nameservers || [])
        .map((n) => n.ldhName?.toLowerCase())
        .filter(Boolean),
      secureDns: json.secureDNS ? { delegationSigned: json.secureDNS.delegationSigned } : null,
      source: 'RDAP (protokol resmi penerus WHOIS)',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, domain, error: err.message };
  }
}

/* ── 3. Subdomain dari Certificate Transparency ────────────────────────── */

/**
 * Subdomain dari log Certificate Transparency.
 *
 * CT log adalah ledger publik berisi SETIAP sertifikat yang diterbitkan CA —
 *termasuk sertifikat gratis Let's Encrypt. Jadi daftar di sini adalah jejak
 * nyata dari domain yang aktif, bukan tebakan.
 *
 * CertSpotter dipakai sebagai sumber utama karena stabil dan gratis tanpa
 * key. crt.sh dicoba sebagai cadangan, tapi sering balas 502 sehingga
 * ketersediaannya dilaporkan apa adanya, bukan disembunyikan.
 */
export async function findSubdomains(domainRaw) {
  const domain = parseDomain(domainRaw);
  if (!domain) {
    return { ok: false, error: `Domain tidak valid: "${domainRaw}"` };
  }

  const found = new Set();
  const sources = [];

  /* CertSpotter — sumber utama. */
  try {
    const { status, json } = await requestJSON(
      `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}` +
        '&include_subdomains=true&expand=dns_names&match_wildcards=true',
      { retries: 1, timeout: 25000 }
    );

    if (status === 200 && Array.isArray(json)) {
      for (const row of json) {
        for (const n of row.dns_names || []) {
          const name = String(n).toLowerCase().replace(/^\*\./, '');
          if (name === domain || name.endsWith(`.${domain}`)) found.add(name);
        }
      }
      sources.push({ name: 'CertSpotter (CT Log)', ok: true, rows: json.length });
    } else {
      sources.push({ name: 'CertSpotter (CT Log)', ok: false, error: `HTTP ${status}` });
    }
  } catch (err) {
    sources.push({ name: 'CertSpotter (CT Log)', ok: false, error: err.message });
  }

  /* crt.sh — cadangan. Sering tidak stabil, dilaporkan apa adanya. */
  try {
    const { status, json } = await requestJSON(
      `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json&exclude=expired`,
      { retries: 0, timeout: 30000 }
    );

    if (status === 200 && Array.isArray(json)) {
      for (const row of json) {
        for (const n of row.name_value?.split('\n') || []) {
          const name = n.trim().toLowerCase().replace(/^\*\./, '');
          if (name === domain || name.endsWith(`.${domain}`)) found.add(name);
        }
      }
      sources.push({ name: 'crt.sh (CT Log)', ok: true, rows: json.length });
    } else {
      sources.push({
        name: 'crt.sh (CT Log)',
        ok: false,
        error: `HTTP ${status}${status === 502 ? ' — layanan sedang tidak stabil' : ''}`,
      });
    }
  } catch (err) {
    sources.push({ name: 'crt.sh (CT Log)', ok: false, error: err.message });
  }

  const subdomains = [...found].sort();
  const liveSources = sources.filter((s) => s.ok);

  return {
    ok: subdomains.length > 0,
    domain,
    count: subdomains.length,
    subdomains,
    sources,
    note:
      subdomains.length === 0
        ? liveSources.length === 0
          ? 'Semua sumber CT tidak bisa dihubungi saat ini. Tidak ada kesimpulan tentang domain ini.'
          : 'Tidak ada subdomain di log CT. Host wildcard-only masih mungkin ada tetapi tidak muncul di CT.'
        : 'Subdomain yang pernah tercantum di sertifikat yang dipublikasikan. Host yang mati maupun yang sudah dihapus juga bisa muncul di sini.',
    generatedAt: new Date().toISOString(),
  };
}

/* ── 4. Probe HTTP & header keamanan ───────────────────────────────────── */

/**
 * Daftar header keamanan + apa yang seharusnya ada.
 * Penilaian di sini hanya Deskripsi educate — bukan audit penetrasi.
 */
const SECURITY_HEADERS = [
  { header: 'strict-transport-security', label: 'HSTS', why: 'Memaksa HTTP → HTTPS.', weight: 'high' },
  { header: 'content-security-policy', label: 'CSP', why: 'Membatasi sumber skrip yang boleh dimuat.', weight: 'high' },
  { header: 'x-frame-options', label: 'Anti-clickjacking', why: 'Mencegah situs di-embed dalam iframe.', weight: 'medium' },
  { header: 'x-content-type-options', label: 'Anti-MIME sniff', why: 'Mencegah browser menebak tipe file.', weight: 'medium' },
  { header: 'referrer-policy', label: 'Referrer Policy', why: 'Membatasi data URL yang terkirim ke pihak lain.', weight: 'low' },
  { header: 'permissions-policy', label: 'Permissions Policy', why: 'Membatasi akses ke kamera, mikrofon, geolokasi.', weight: 'low' },
];

/** Probe HTTP: ambil header respons + halaman untuk fingerprinting ringan. */
export async function httpProbe(urlRaw, { followRedirects = true } = {}) {
  const parsed = splitUrl(urlRaw);
  if (!parsed) {
    return { ok: false, error: `URL tidak valid: "${urlRaw}"` };
  }

  const started = Date.now();
  let res;
  try {
    res = await request(parsed.href, {
      method: 'GET',
      browserUA: true,
      retries: 1,
      timeout: 15000,
      redirect: followRedirects ? 'follow' : 'manual',
    });
  } catch (err) {
    return { ok: false, url: parsed.href, error: `Tidak bisa menghubungi target: ${err.message}` };
  }

  const h = res.headers;
  const headerObj = {};
  h.forEach((value, key) => { headerObj[key] = value; });

  /* Penilaian header keamanan. */
  const present = [];
  const missing = [];
  for (const s of SECURITY_HEADERS) {
    const value = h.get(s.header);
    (value ? present : missing).push({ ...s, value: value || null });
  }

  // Skorstarted dari 100, ditimbang per header yang ada.
  const totalWeight = SECURITY_HEADERS.reduce((n, s) => n + ({ high: 30, medium: 12, low: 6 }[s.weight]), 0);
  const gotWeight = present.reduce((n, s) => n + ({ high: 30, medium: 12, low: 6 }[s.weight]), 0);
  const score = Math.round((gotWeight / totalWeight) * 100);

  /* Cookie: catat atribut yang relevan, TIDAK pernah nilai cookie itu sendiri. */
  const cookies = (h.getSetCookie?.() || [])
    .map((c) => {
      const first = c.split(';')[0];
      return {
        name: first.split('=')[0]?.trim() || '(tanpa nama)',
        secure: /;\s*secure/i.test(c),
        httpOnly: /;\s*httponly/i.test(c),
        sameSite: (c.match(/;\s*samesite=([^;]+)/i)?.[1] || '').trim() || null,
      };
    })
    .slice(0, 15);

  return {
    ok: true,
    url: parsed.href,
    finalUrl: res.url,
    host: parsed.host,
    status: res.status,
    elapsedMs: Date.now() - started,
    server: h.get('server') || null,
    poweredBy: h.get('x-powered-by') || null,
    contentType: h.get('content-type') || null,
    contentLength: h.get('content-length') || null,
    lastModified: h.get('last-modified') || null,
    headers: headerObj,
    security: {
      score,
      grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F',
      present,
      missing,
      hsts: h.get('strict-transport-security') || null,
      cookies,
      cookieCount: cookies.length,
      cookiesMissingSecurity: cookies.filter((c) => !c.secure || !c.httpOnly).length,
    },
    note:
      'Penilaian header keamanan bersifat edukatif dan hanya melihat respons publik. ' +
      'Ini bukan audit keamanan dan tidak menguji kerentanan aplikasi.',
    generatedAt: new Date().toISOString(),
  };
}

/* ── 5. Arsip web (Wayback) ────────────────────────────────────────────── */

/**
 * Riwayat tangkapan layar dari Internet Archive.
 * CDX API mengembalikan daftar tangkapan untuk satu URL.
 */
export async function waybackHistory(urlRaw, { limit = 20 } = {}) {
  const parsed = splitUrl(urlRaw);
  if (!parsed) {
    return { ok: false, error: `URL tidak valid: "${urlRaw}"` };
  }

  // Kolom yang diambil sengaja dibatasi supaya respons tidak membengkak.
  const fields = 'timestamp,original,statuscode,mimetype,digest';
  const target = encodeURIComponent(parsed.host + (parsed.path === '/' ? '/' : parsed.path));

  try {
    const { status, json } = await requestJSON(
      `http://web.archive.org/cdx/search/cdx?url=${target}` +
        `&output=json&fl=${fields}&limit=${Math.min(limit, 100)}&collapse=digest`,
      { retries: 1, timeout: 25000 }
    );

    if (status !== 200 || !Array.isArray(json)) {
      return { ok: false, url: parsed.href, error: `CDX API HTTP ${status}` };
    }

    // Baris pertama adalah header kolom.
    const [header, ...rows] = json;
    const col = Object.fromEntries(header.map((h, i) => [h, i]));

    const snapshots = rows.map((r) => ({
      timestamp: r[col.timestamp],
      date: r[col.timestamp]
        ? `${r[col.timestamp].slice(0, 4)}-${r[col.timestamp].slice(4, 6)}-${r[col.timestamp].slice(6, 8)}`
        : null,
      url: r[col.original],
      statusCode: r[col.statuscode],
      mimeType: r[col.mimetype],
      digest: r[col.digest],
      archiveUrl: r[col.timestamp]
        ? `https://web.archive.org/web/${r[col.timestamp]}/${r[col.original]}`
        : null,
    }));

    // CDX mengembalikan hasil urut lama -> baru. Untuk ditampilkan yang
    // lebih berguna adalah terbaru dulu, jadi urutannya dibalik di sini.
    snapshots.reverse();

    return {
      ok: snapshots.length > 0,
      url: parsed.href,
      count: snapshots.length,
      firstSeen: snapshots.at(-1)?.date || null,
      lastSeen: snapshots[0]?.date || null,
      snapshots,
      note: snapshots.length === 0
        ? 'Tidak ada tangkapan layar di Internet Archive untuk URL ini.'
        : 'Hanya URL yang sudah pernah di-archive yang muncul. Halaman yang tak pernah di-crawl tidak berarti tidak pernah ada.',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, url: parsed.href, error: err.message };
  }
}

/* ── 6. Fingerprint situs ──────────────────────────────────────────────── */

const TECH_SIGNATURES = [
  { name: 'WordPress', re: /wp-content|wp-includes|WordPress/i },
  { name: 'Drupal', re: /drupal\.js|sites\/default\/files/i },
  { name: 'Joomla', re: /joomla|com_content/i },
  { name: 'React', re: /data-reactroot|__NEXT_DATA__|react(?:-dom)?(?:\.production)?(?:\.min)?\.js/i },
  { name: 'Next.js', re: /__NEXT_DATA__|next\/static/i },
  { name: 'Vue.js', re: /data-v-[0-9a-f]{8}|vue(?:\.runtime)?(?:\.min)?\.js/i },
  { name: 'Nuxt', re: /__NUXT__/i },
  { name: 'Angular', re: /ng-version|angular(?:\.min)?\.js/i },
  { name: 'Svelte / SvelteKit', re: /svelte-[0-9a-z]{6}|\/__data\.json/i },
  { name: 'jQuery', re: /jquery[-\d.]*\.min\.js|jQuery\.fn\.jquery/i },
  { name: 'Bootstrap', re: /bootstrap[-\d.]*(?:\.min)?\.(?:css|js)/i },
  { name: 'Tailwind CSS', re: /tailwind|class="[^"]*\b(?:bg-|text-|flex\b)[^"]*"/i },
  { name: 'Cloudflare', re: /cloudflare/i },
  { name: 'Google Analytics', re: /google-analytics\.com|gtag\(|ga\(/i },
  { name: 'Google Tag Manager', re: /googletagmanager\.com/i },
  { name: 'Facebook Pixel', re: /connect\.facebook\.net|fbq\(/i },
  { name: 'Hotjar', re: /static\.hotjar\.com|hjSiteSettings/i },
  { name: 'Shopify', re: /cdn\.shopify\.com|Shopify\.theme/i },
  { name: 'WooCommerce', re: /woocommerce/i },
  { name: 'Magento', re: /Magento_|static\.frontend\/Magento/i },
  { name: 'Varnish', re: /varnish/i },
  { name: 'Nginx', re: /nginx/i },
  { name: 'Apache', re: /apache/i },
  { name: 'Litespeed', re: /litespeed/i },
  { name: 'PHP', re: /php(?:info)?(?:version)?\s*[\d.]*|X-Powered-By:\s*PHP/i },
  { name: 'Phpmyadmin', re: /phpmyadmin/i },
];

/** Ekstrak tautan sosial & kontak dari HTML publik. */
function extractLinks(html) {
  const pick = (re) => [...new Set([...html.matchAll(re)].map((m) => m[1]))].slice(0, 25);
  return {
    social: pick(/https?:\/\/(?:www\.)?(?:facebook|fb|instagram|twitter|x|t\.me|tiktok|linkedin|youtube|github|pinterest|reddit|telegram|wa\.me|whatsapp)\.com\/[A-Za-z0-9._\-\/@%]{2,}/gi),
    email: pick(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g).filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e)),
    phone: pick(/(?:\+62|0)\d{2,4}[-\s]?\d{3,4}[-\s]?\d{3,5}/g).slice(0, 10),
  };
}

/**
 * Fingerprint ringan dari halaman publik: judul, meta tag, framework,
 * dan kontak yang tercetak di HTML.
 */
export async function siteFingerprint(urlRaw) {
  const parsed = splitUrl(urlRaw);
  if (!parsed) {
    return { ok: false, error: `URL tidak valid: "${urlRaw}"` };
  }

  let res;
  try {
    res = await request(parsed.href, { browserUA: true, retries: 1, timeout: 15000 });
  } catch (err) {
    return { ok: false, url: parsed.href, error: err.message };
  }

  const html = res.text || '';
  const head = html.slice(0, 200_000); // cukup untuk parsing meta & signature.

  const title = stripTags((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').slice(0, 200);
  const metaContent = (prop) =>
    stripTags(
      (head.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i')) || [])[1] ||
      (head.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i')) || [])[1] ||
      ''
    ).slice(0, 400);

  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  const tech = [
    ...TECH_SIGNATURES.filter((t) => t.re.test(headers['x-powered-by'] || '')).map((t) => t.name),
    ...TECH_SIGNATURES.filter((t) => t.re.test(headers.server || '')).map((t) => t.name),
    ...TECH_SIGNATURES.filter((t) => t.re.test(head)).map((t) => t.name),
  ];

  const generator = metaContent('generator');

  return {
    ok: res.status < 400,
    url: parsed.href,
    finalUrl: res.url,
    status: res.status,
    title: title || null,
    description: metaContent('description') || metaContent('og:description') || null,
    keywords: metaContent('keywords') || null,
    generator: generator || null,
    generatorTag: (head.match(/<meta[^>]+name=["']generator["'][^>]*>/i) || [])[0] || null,
    canonical: metaContent('og:url') || null,
    robots: metaContent('robots') || null,
    lang: (head.match(/<html[^>]+lang=["']([^"']+)["']/i) || [])[1] || null,
    tech: [...new Set(tech)],
    server: headers.server || null,
    poweredBy: headers['x-powered-by'] || null,
    contacts: extractLinks(html),
    htmlSize: html.length,
    generatedAt: new Date().toISOString(),
  };
}

export const domainTools = [
  { id: 'dns', label: 'DNS Records', needs: 'domain' },
  { id: 'whois', label: 'WHOIS / RDAP', needs: 'domain' },
  { id: 'subdomains', label: 'Subdomain (CT Log)', needs: 'domain' },
  { id: 'headers', label: 'HTTP Headers', needs: 'url' },
  { id: 'fingerprint', label: 'Fingerprint Situs', needs: 'url' },
  { id: 'wayback', label: 'Arsip Wayback', needs: 'url' },
];
/**
 * Modul "Nama & Tag Kontak" — menjawab pertanyaan:
 *   "Orang lain biasanya menyimpan nomor ini dengan nama/label apa?"
 *
 * Yang dicari:
 *   - Nama yang muncul bersama nomor di halaman publik (nama pemanggil,
 *     nama toko, nama admin).
 *   - Label peran/kategori: "CS Tokopedia", "admin", "penjual", "akun pinjol".
 *   - Indikasi kategori risiko: "penipu", "spam", "blacklist".
 *
 * BAGAIMANA CARANYA BUKAN DENGAN MENGIKIS TRUECALLER
 * -------------------------------------------------
 * Data "nama kontak tersimpan orang lain" (Truecaller/GetContact) dibangun
 * dari opt-in pengguna dan TIDAK dibuka lewat API — mengikisnya berarti
 * melanggar ToS situs itu dan merusak reputasi tool ini. Modul ini karena
 * itu tidak pernah mengarang nama.
 *
 * Yang dilakukan: mencari jejak nomor di sumber yang memang terbuka
 * (hasil pencarian web, berita, forum, halaman hasil scan publik), lalu
 * MENGHITUNG label mana yang paling sering muncul di SITUS BERBEDA.
 * Setiap tag membawa buktinya (situs + cuplikan + tautan) supaya bisa
 * diverifikasi sendiri.
 *
 * Kalau tag crowdsourced (Truecaller/GetContact/Kredibel) memang dibutuhkan,
 * modul ini menyodorkan tautan pembuka untuk diperiksa manual.
 */

import { normalize } from '../util/phone.js';
import { request, stripTags } from '../util/http.js';
import { publicMentions } from './mentions.js';

/* ── Kamus label ──────────────────────────────────────────────────────── */

/**
 * Setiap entri: pola (regex) -> label + jenis.
 * kind: 'role' (peran/konteks), 'category' (bidang usaha), 'risk' (indikasi negatif).
 */
const LABEL_PATTERNS = [
  // ── Peran ──
  { re: /\bcs\b|customer service|customer\s+support|layanan pelanggan|pusat\s+bantuan|helpdesk|help\s*desk/i, label: 'CS / customer service', kind: 'role' },
  { re: /\badmin\b|administrator|admin\s*(?:toko|store|akun)|pengelola/i, label: 'admin', kind: 'role' },
  { re: /\bsales\b|salesperson|penjual|menjual|berjualan/i, label: 'sales', kind: 'role' },
  { re: /\boperator\b|\bagen\b|\bagent\b|travel/i, label: 'agen / operator', kind: 'role' },
  { re: /\breseller\b|\bdistributor\b|\bgrosir\b|wholesale|supplier/i, label: 'reseller / distributor', kind: 'role' },
  { re: /\brekrutmen\b|\brekrut\b|\blowongan\b|\bkaryawan\b|\bjobi\b|recruit|hiring|we'?re\s+looking/i, label: 'rekrutmen', kind: 'role' },
  { re: /\bkontak baru\b|new contact|\bbaru saja\b|\bcontact\s+us\b|hubungi\s+kami/i, label: 'kontak baru', kind: 'role' },
  { re: /\bowner\b|\bpemilik\b|proprietor/i, label: 'pemilik', kind: 'role' },

  // ── Bidang usaha ──
  { re: /tokopedia|shopee|lazada|bukalapak|blibli|tiktok\s*shop|temtop|shopee\s*pay/i, label: 'toko online', kind: 'category' },
  { re: /product\s+enquiry|product\s+inquiry|katalog|catalog|e-?commerce|checkout|keranjang\s+belanja/i, label: 'toko/katalog online', kind: 'category' },
  { re: /\bwa\.me\b|whatsapp/i, label: 'akun WhatsApp', kind: 'category' },
  { re: /\bdana\b|\bovo\b|gopay|shopeepay|linkaja|\bqris\b|rekening|transfer\s+bank|payment/i, label: 'e-wallet / transfer', kind: 'category' },
  { re: /gojek|grab|ongkir|ojek|driver|kurir|ekspedisi|pengiriman|jne\b|jnl\b|tiki\b|anteraja/i, label: 'layanan transportasi / kurir', kind: 'category' },
  { re: /properti|apartemen|rumah\s+dijual|kos\b|kontrakan|rumah\s+sewa|real\s*estate/i, label: 'properti', kind: 'category' },
  { re: /kursus|bimbel|les\s+private|training|pelatihan|komunitas|learn/i, label: 'kursus / pelatihan', kind: 'category' },
  { re: /berbagi|pinjol|rentenir|kredit|investasi|saham|crypto|trading/i, label: 'pinjol / investasi', kind: 'category' },
  { re: /akun\s+(?:instagram|ig|tiktok|facebook|fb|twitter|x)\s*[\w.]*/i, label: 'akun media sosial', kind: 'category' },
  { re: /instagram|tiktok|facebook|whatsapp\s+business|linkedin/i, label: 'akun media sosial', kind: 'category' },
  { re: /\bkontak\b|\bcontact\b|alamat\s+kami|company\s+profile|tentang\s+kami|about\s+us/i, label: 'halaman kontak bisnis', kind: 'category' },
  { re: /klinik|dokter|rumah\s+sakit|puskesmas|apotik|pharmacy|kesehatan/i, label: 'kesehatan', kind: 'category' },
  { re: /donasi|infak|zarah|qari|wakaf|bantuan/i, label: 'donasi', kind: 'category' },

  // ── Petunjuk: nomor ini muncul di direktori nama pemanggil ──
  { re: /who\s+calls|who'?s\s+calling|nama\s+pemanggil|caller\s+name|penelepon\s+anonim|telepon\s+menelepon|pemanggil|dari\s+nomor|calls\s+by\s+\w+|reverse\s+(?:phone|number)|phone\s+lookup|spyon|cari\s+pemilik/i, label: 'direktori nama pemanggil', kind: 'category' },

  // ── Indikasi negatif ──
  { re: /penipu|scammer|scam\b|fraud|penipuan|spoof|impersonat/i, label: 'indikasi penipuan', kind: 'risk' },
  { re: /spam|kategori\s+spam|block\s*list|blacklist|dilarang|di\s*blokir|harassment|penolakan\s+berulang/i, label: 'indikasi spam / blacklist', kind: 'risk' },
  { re: /judol|togel|slot\s*online|acuan|bocah\s*slot|gambling|betting|casino/i, label: 'indikasi layanan ilegal', kind: 'risk' },
];

/**
 * Pola yang memancing NAMA orang/toko di dekat nomor.
 * Sengaja konservatif: hanya diambil kalau ada pemicu eksplisit
 * ("nama:", "atas nama", "dari <Nama>"), bukan setiap kata kapital.
 */
const NAME_PATTERNS = [
  /nama\s*(?:pemanggil|anggil|penjual|toko|pemilik)?\s*(?:adalah|adlh|:yaitun|yakni|:|-)\s*"?([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})"?/i,
  /atas\s+nama\s+"?([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})"?/i,
  /(?:caller|calling|contact|display)\s*name\s*[:\-]\s*"?([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})"?/i,
  /pemanggil\s*[:\-]\s*"?([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})"?/i,
  /\bfrom\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})\s+(?:calling|whatsapp|wa\b|contact)/i,
  /\bdari\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})\s+(?:menelepon|whatsapp|wa\b|menghubungi|chat)/i,
  /saved\s+as\s+"?([^"'\n]{2,40})"?/i,
  /saved\s+contact\s*[:\-]\s*"?([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})"?/i,
  /(?:adalah|is)\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})\s+(?:dari|of)\s+(?:nomor|number)/i,
  /disimpan(?:\s+kontak)?(?:\s+ini)?\s+sebagai\s+"?([^"'\n]{2,40})"?/i,
];

/**
 * Bersihkan nama yang tertangkap regex.
 * Kalimat pemicu sering diikuti teks lain ("Budi Santoso. Simpan kontak…"),
 * jadi nama dipotong di akhir kalimat dan dibersihkan dari tanda baca.
 */
function cleanName(raw) {
  let n = String(raw || '').split(/[.!?;]\s/)[0].trim();
  n = n.replace(/^["'\s]+|["'\s]+$/g, '');
  n = n.replace(/[.,;:]+$/, '').trim();
  // Buang sisa kata umum di ekor nama.
  const parts = n.split(/\s+/);
  while (parts.length > 1 && NAME_STOPWORDS.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  return parts.join(' ');
}

/** Kata umum yang tidak boleh dianggap sebagai nama orang. */
const NAME_STOPWORDS = new Set([
  'wa', 'whatsapp', 'telegram', 'telepon', 'nomor', 'hp', 'sms', 'call', 'calls',
  'unknown', 'tidak', 'diketahui', 'privat', 'private', 'umum', 'public',
  'indonesia', 'jakarta', 'surabaya', 'bandung', 'the', 'and', 'for', 'from',
  'type', 'of', 'reason', 'calling', 'new', 'rating', 'enter', 'your', 'name',
  'login', 'advantages', 'contact', 'about', 'info', 'admin', 'cs',
]);

/* ── Ekstraksi ────────────────────────────────────────────────────────── */

/**
 * Ambil kandidat nama dari satu cuplikan teks.
 * Mengembalikan array string unik.
 */
export function extractNames(text = '') {
  const out = new Set();
  for (const re of NAME_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const name = cleanName(m[1]);
    if (name.length < 2) continue;
    const first = name.split(' ')[0].toLowerCase();
    if (NAME_STOPWORDS.has(first)) continue;
    out.add(name);
  }
  return [...out];
}

/**
 * Ambil label/kategori yang cocok pada satu cuplikan teks.
 */
export function extractLabels(text = '') {
  const out = new Set();
  for (const p of LABEL_PATTERNS) {
    if (p.re.test(text)) out.add(p.label);
  }
  return [...out];
}

/* ── Telegram: nama tampilan yang dipublikasikan pemilik nomor ────────── */

/**
 * Ambil profil publik Telegram dari t.me/+<nomor>.
 * Ini nama yang DIPILIH sendiri oleh pemilik nomor — bukan tag yang disimpan
 * orang lain, jadi dicatat terpisah.
 */
export async function telegramDisplayName(e164) {
  const digits = e164.replace('+', '');
  const url = `https://t.me/+${digits}`;

  try {
    const { status, text } = await request(url, {
      browserUA: true,
      timeout: 15000,
      retries: 1,
    });
    if (status !== 200) {
      return { available: false, url, note: `t.me HTTP ${status}` };
    }

    const title = (text.match(/tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i) || [])[1];
    const desc = (text.match(/tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i) || [])[1];
    const displayName = stripTags(title || '');
    const bio = stripTags(desc || '');

    // Judul kosong = halaman tanpa isi = nomor kemungkinan tidak terdaftar.
    if (!displayName) {
      return {
        available: true,
        registered: false,
        displayName: null,
        url,
        note: 'Telegram menampilkan halaman kosong — nomor kemungkinan tidak terdaftar.',
      };
    }

    // Telegram memakai judul generik "Chat with +62 812…" kalau pemilik
    // belum menetapkan nama tampilan. Itu BUKAN nama orang, jadi tidak
    // boleh dilaporkan sebagai "nama".
    const isGeneric = /^chat with\b/i.test(displayName);

    if (isGeneric) {
      return {
        available: true,
        registered: true,
        displayName: null,
        bio: bio || null,
        url,
        note:
          'Nomor terdaftar di Telegram, tapi pemilik belum menetapkan nama ' +
          'tampilan — jadi tidak ada nama yang bisa ditampilkan.',
      };
    }

    return {
      available: true,
      registered: true,
      url,
      displayName,
      bio: bio || null,
      note: 'Nama tampilan yang dipublikasikan PEMILIK nomor di profil Telegram publiknya.',
    };
  } catch (err) {
    return {
      available: false,
      url,
      note: `Tidak bisa menghubungi t.me dari jaringan ini (${err.message}). Ini bukan berarti nomor tidak terdaftar.`,
    };
  }
}

/* ── Entry point ──────────────────────────────────────────────────────── */

/**
 * Kumpulkan nama & tag yang dipakai orang lain untuk nomor ini.
 *
 * @param {string} rawNumber
 * @param {object} opts - { limit } batas jumlah jejak yang diproses
 */
export async function contactNames(rawNumber, { limit = 20 } = {}) {
  const parsed = normalize(rawNumber);
  if (!parsed) {
    return { ok: false, error: `Nomor tidak valid: "${rawNumber}"` };
  }

  const { e164, national, digits } = parsed;

  const [mentions, telegram] = await Promise.all([
    publicMentions(rawNumber, { limit }).catch((err) => ({
      ok: false,
      error: err.message,
      mentions: [],
      sites: [],
      sources: [],
      manualCheck: [],
    })),
    telegramDisplayName(e164).catch((err) => ({ available: false, note: err.message })),
  ]);

  // ── Kumpulkan tag per situs ──
  const tags = new Map(); // label -> { label, kind, sites:Set, occurrences, evidence:[] }

  const addTag = (label, kind, mention) => {
    if (!tags.has(label)) {
      tags.set(label, { label, kind, sites: new Set(), occurrences: 0, evidence: [] });
    }
    const t = tags.get(label);
    t.occurrences += 1;
    if (mention.site) t.sites.add(mention.site);
    if (t.evidence.length < 3 && mention.url) {
      t.evidence.push({
        site: mention.site,
        title: mention.title,
        url: mention.url,
        snippet: (mention.snippet || '').slice(0, 220),
      });
    }
  };

  const names = new Map(); // nama -> { name, sites:Set, occurrences, evidence:[] }

  for (const m of mentions.mentions || []) {
    // URL ikut dimasukkan: path "/contact", "/kontak", "/produk" adalah
    // sinyal kuat bahwa halaman itu profil bisnis atau toko.
    const text = `${m.title} ${m.snippet || ''} ${m.url || ''}`;
    for (const label of extractLabels(text)) {
      const kind = LABEL_PATTERNS.find((p) => p.label === label)?.kind || 'category';
      addTag(label, kind, m);
    }
    for (const name of extractNames(text)) {
      if (!names.has(name)) {
        names.set(name, { name, sites: new Set(), occurrences: 0, evidence: [] });
      }
      const n = names.get(name);
      n.occurrences += 1;
      if (m.site) n.sites.add(m.site);
      if (n.evidence.length < 3 && m.url) {
        n.evidence.push({ site: m.site, title: m.title, url: m.url, snippet: (m.snippet || '').slice(0, 220) });
      }
    }
  }

  /**
   * Confidence:
   *   high   : label/nama muncul di >=2 situs berbeda (bukan satu situs dobel)
   *   medium : muncul di 1 situs dengan pemicu eksplisit
   *   low    : hanya dari pola kata kunci tanpa pemicu nama
   */
  const finish = (entry, explicit) => {
    const siteCount = entry.sites.size;
    const confidence = siteCount >= 2 ? 'high' : siteCount === 1 ? (explicit ? 'medium' : 'low') : 'low';
    return {
      label: entry.label,
      kind: entry.kind,
      siteCount,
      occurrences: entry.occurrences,
      confidence,
      evidence: entry.evidence,
    };
  };

  const tagList = [...tags.values()]
    .map((t) => finish(t, true))
    .sort((a, b) => b.siteCount - a.siteCount || b.occurrences - a.occurrences);

  const nameList = [...names.values()]
    .map((n) => finish({ ...n, kind: 'name' }, true))
    .sort((a, b) => b.siteCount - a.siteCount || b.occurrences - a.occurrences);

  // Tag "paling sering dipakai" = yang muncul di situs terbanyak.
  const topTags = tagList.slice(0, 8);
  const topNames = nameList.slice(0, 8);

  // Ringkasan risiko: tag berkind 'risk' yang muncul di >1 situs.
  const riskTags = tagList.filter((t) => t.kind === 'risk');
  const riskLevel = riskTags.length === 0 ? 'none' : riskTags[0].siteCount >= 2 ? 'elevated' : 'low';

  // Sumber yang gagal harus terlihat: hasil kosong karena sumbernya mati
  // berbeda maknanya dengan "memang tidak ada jejaknya".
  const failedSources = (mentions.sources || []).filter((s) => !s.ok);
  const warning = failedSources.length
    ? `${failedSources.length} dari ${(mentions.sources || []).length} sumber pencarian tidak ` +
      `merespons (${failedSources.map((s) => s.name).join(', ')}). Tag di bawah belum ` +
      'tentu lengkap — ulangi beberapa saat lagi.'
    : null;

  return {
    ok: true,
    number: e164,
    national,
    summary: {
      namesFound: nameList.length,
      tagsFound: tagList.length,
      sitesMentioning: (mentions.sites || []).length,
      mentions: mentions.mentions?.length || 0,
      riskLevel,
    },
    topNames,
    topTags,
    riskTags,
    telegram,
    count: mentions.mentions?.length || 0,
    mentions: mentions.mentions || [],
    callerNamePages: mentions.callerNamePages || [],
    sites: mentions.sites || [],
    sources: mentions.sources || [],
    manualCheck: mentions.manualCheck || [],
    warning,
    note:
      'Nama & tag di bawah diambil dari jejak nomor di halaman yang terbuka, lalu ' +
      'dihitung BERRAPA BANYAK SITUS BERBEDA yang memakainya. Tag dengan confidence "high" ' +
      'muncul di >=2 situs independen. Ini bukan database Truecaller/GetContact — ' +
      'data crowdsourced milik dua layanan itu tidak dibuka lewat API, jadi akan ' +
      'dicek manual lewat tautan di bawah.',
    limitation:
      'Nama kontak yang disimpan orang lain HANYA bisa dilihat lewat GetContact / ' +
      'Truecaller / Kredibel (manual, perlu login di sebagian layanan). Modul ini ' +
      'tidak pernah mengarang nama — kalau tidak ada jejak publik, hasilnya kosong ' +
      'dan itu jawaban yang benar.',
    generatedAt: new Date().toISOString(),
  };
}

export const contactTools = [
  { id: 'contact-names', label: 'Nama & Tag Kontak', needs: 'phone' },
];

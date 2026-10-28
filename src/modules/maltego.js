/**
 * Integrasi Maltego.
 *
 * Hanya DUA jalur yang benar-benar didukung Maltego CE, setelah verifikasi
 * terhadap berkas binary Maltego CE 4.13 dan dokumentasi resmi:
 *
 * 1. TRANSFORM PROVIDER  (jalur utama, otomatis)
 *    Protokol Transform: Maltego melakukan POST dengan JSON berisi `entity`
 *    dan `transform.fields.run`; server membalas `transforms` +
 *    `returnedEntities`. Klik kanan entity di graph -> pilih transform ->
 *    Run, dan hasilnya langsung tergambar. Inilah satu-satunya cara resmi
 *    untuk mendorong hasil investigasi ke graph yang SEDANG BERJALAN.
 *
 * 2. IMPOR BERKAS / CLIPBOARD  (untuk hasil offline)
 *    - CSV: didukung Maltego CE lewat "Import Graph (3rd party table)",
 *      dengan pemetaan kolom ke tipe entity DAN konektivitas antar baris,
 *      sehingga link ikut terbentuk.
 *    - Clipboard: tempel teks ke graph; Maltego membuat satu entity per baris.
 *      Format resmi: `Tipe#nilai`. Hanya entity, tanpa link.
 *
 * Yang TIDAK ada (pernah ada di versi awal kode ini, sudah dihapus karena
 * tidak berbasis kenyataan):
 *    - port 61184 sebagai "API push": tidak ada di Maltego CE.
 *    - ekspor ".tab": Maltego CE hanya punya importer csv/xls/xlsx.
 *    - "LinkAnalysis JSON": bukan format Maltego.
 *    - opsi "Enable local transforms": opsi ini tidak ada di Maltego CE.
 */

import { config } from '../config.js';
import { investigatePhone } from './phone.js';
import { searchUsername, platformNames } from './social.js';
import { geocode } from './location.js';
import { buildDorks } from './breach.js';
import { dnsLookup, whoisLookup, findSubdomains, parseDomain } from './domain.js';
import { ipProfile } from './network.js';

/* ── 1. Pembuat entity Maltego ────────────────────────────────────────── */

const prop = (n, v, opts = {}) =>
  v === undefined || v === null || v === '' ? null : { name: n, value: String(v), ...opts };

/**
 * Konversi hasil investigasi nomor -> daftar MaltegoEntity.
 */
export function phoneToEntities(result) {
  const ents = [];

  ents.push({
    type: 'PhoneNumber',
    value: result.e164,
    properties: [
      prop('phonenumber', result.e164),
      prop('countrycode', result.countryCode),
      prop('line-type', result.lineType),
      prop('carrier', result.operator, { hidden: false }),
      prop('nickname', result.display),
    ],
  });

  if (result.operatorLocation) {
    const L = result.operatorLocation;
    ents.push({
      type: 'Location',
      value: `${[L.city, L.region, L.country].filter(Boolean).join(', ')} (perkiraan operator)`,
      properties: [
        prop('locationlatitude', L.lat),
        prop('locationlongitude', L.lon),
        prop('isp', L.isp),
        prop('notes', 'Perkiraan lokasi pendaftaran operator — bukan lokasi pemakaian real-time.'),
      ],
    });
    if (L.city) {
      ents.push({
        type: 'Location',
        value: L.city,
        properties: [prop('countryname', L.country), prop('region', L.region)],
      });
    }
  }

  for (const chk of Object.values(result.checks || {})) {
    if (chk.status === 'registered') {
      ents.push({
        type: 'IMAccount',
        value: chk.url,
        properties: [
          prop('messagingplatform', chk.platform),
          prop('displayname', chk.displayName || ''),
          prop('status', 'terdaftar'),
        ],
      });
    }
  }

  return ents;
}

/** Hasil enumerasi username -> entity + link graph antar platform. */
export function socialToEntities(result) {
  const ents = [
    {
      type: 'Alias',
      value: `@${result.username}`,
      properties: [
        prop('alias', result.username),
        prop('platformcount', result.summary.found, { hidden: true }),
      ],
    },
  ];

  const links = [];
  for (const f of result.found) {
    const e = {
      type: 'Alias',
      value: f.url,
      properties: [
        prop('alias', f.url),
        prop('site', f.platform),
        prop('username', f.username),
      ],
    };
    ents.push(e);
    links.push({ from: `@${result.username}`, to: f.url, label: 'has profile' });
  }

  return { entities: ents, links };
}

/** Hasil geocode -> entity Location. */
export async function locationToEntities(query) {
  const geo = await geocode(query);
  if (!geo.ok) return { entities: [], links: [] };
  return {
    entities: geo.places.slice(0, 10).map((p) => ({
      type: 'Location',
      value: p.displayName || [p.name, p.city, p.country].filter(Boolean).join(', '),
      properties: [
        prop('locationlatitude', p.lat),
        prop('locationlongitude', p.lon),
        prop('countryname', p.country),
        prop('region', p.state),
        prop('city', p.city),
        prop('street', p.street),
        prop('postcode', p.postcode),
        prop('source', p.source),
      ],
    })),
    links: [],
  };
}

/**
 * Hasil investigasi domain -> entity Website/DNS/Nameserver.
 *
 * Tipe entity yang dipakai semuanya tipe bawaan Maltego CE supaya langsung
 * bisa dirender tanpa install model tambahan.
 */
export function domainToEntities(result) {
  const ents = [];
  const links = [];
  const domain = result.domain;
  if (!domain) return { entities: ents, links };

  ents.push({
    type: 'Domain',
    value: domain,
    properties: [
      prop('domain', domain),
      prop('notes', 'Target domain dari input investigator.'),
    ],
  });

  /* WHOIS */
  const w = result.whois;
  if (w?.ok) {
    ents.push({
      type: 'EmailAddress',
      value: w.registrar?.email || `${w.domain}-registrar@unknown`,
      properties: [
        prop('emailaddress', w.registrar?.email || ''),
        prop('displayname', w.registrar?.name || ''),
        prop('notes', `Registrar domain ${w.domain}. Email ini taken dari RDAP registrar, bukan kontak target.`),
      ],
    });
    links.push({ from: domain, to: w.registrar?.email, label: 'dikelola oleh' });

    for (const ns of (w.nameservers || []).slice(0, 8)) {
      ents.push({
        type: 'NameServer',
        value: ns,
        properties: [
          prop('nameserver', ns),
          prop('notes', `Nameserver untuk ${w.domain} (dari RDAP).`),
        ],
      });
      links.push({ from: domain, to: ns, label: 'nameserver' });
    }

    if (w.events?.created) {
      ents.push({
        type: 'Phrase',
        value: `${w.domain} dibuat ${String(w.events.created).slice(0, 10)}`,
        properties: [
          prop('body', `Domain ${w.domain} didaftarkan pada ${w.events.created}.`),
          prop('notes', `Diperbarui terakhir: ${w.events.updated || 'tidak diketahui'}.`),
        ],
      });
    }
  }

  /* DNS */
  const d = result.dns;
  if (d?.resolved) {
    for (const rec of d.records) {
      for (const ans of (rec.answers || []).slice(0, 4)) {
        // Lewati record yang hanya berisi SOA/PTR yang berulang.
        if (rec.type === 'TXT' && String(ans.data).length > 200) continue;

        if (rec.type === 'A' || rec.type === 'AAAA') {
          ents.push({
            type: 'IpAddress',
            value: String(ans.data).replace(/\.$/, ''),
            properties: [prop('ip', String(ans.data).replace(/\.$/, ''))],
          });
          links.push({ from: domain, to: String(ans.data).replace(/\.$/, ''), label: 'resolve ke' });
        } else if (rec.type === 'MX') {
          ents.push({
            type: 'EmailAddress',
            value: String(ans.data).split(' ').pop().replace(/\.$/, ''),
            properties: [prop('emailaddress', String(ans.data).split(' ').pop().replace(/\.$/, ''))],
          });
          links.push({ from: domain, to: String(ans.data).split(' ').pop().replace(/\.$/, ''), label: 'mail exchanger' });
        }
      }
    }
  }

  /* Subdomain dari CT */
  const subs = result.subdomains;
  if (subs?.ok && subs.subdomains?.length) {
    ents.push({
      type: 'Phrase',
      value: `${subs.count} subdomain ditemukan dari Certificate Transparency`,
      properties: [
        prop('body', subs.subdomains.slice(0, 50).join('\n')),
        prop('notes', 'Host yang muncul di sertifikat yang dipublikasikan. Bukan bukti host masih aktif.'),
      ],
    });
    for (const s of subs.subdomains.slice(0, 20)) {
      ents.push({
        type: 'Domain',
        value: s,
        properties: [prop('domain', s), prop('notes', 'Subdomain dari log Certificate Transparency.')],
      });
      links.push({ from: domain, to: s, label: 'punya subdomain' });
    }
  }

  /* Header keamanan */
  const h = result.http;
  if (h?.ok) {
    ents.push({
      type: 'WebSite',
      value: h.url,
      properties: [
        prop('title', 'Probe header keamanan'),
        prop('body', `Skor header keamanan: ${h.security.score}/100 (grade ${h.security.grade}).`),
        prop('notes', `Status ${h.status}. Header yang kurang: ${h.security.missing.map((x) => x.label).join(', ') || 'tidak ada'}.`),
      ],
    });
    links.push({ from: domain, to: h.url, label: 'situs web' });
  }

  return { entities: ents, links };
}

/** Hasil profil IP -> entity IpAddress + lokasi + jaringan. */
export function networkToEntities(result) {
  if (!result?.ok) return { entities: [], links: [] };

  const ents = [
    {
      type: 'IpAddress',
      value: result.ip,
      properties: [
        prop('ip', result.ip),
        prop('notes', `ASN ${result.network.asn || 'tidak diketahui'}. ${result.network.isp || ''}`),
      ],
    },
  ];
  const links = [];

  const g = result.geolocation;
  if (g?.city || g?.country) {
    const loc = [g.city, g.region, g.country].filter(Boolean).join(', ');
    ents.push({
      type: 'Location',
      value: loc,
      properties: [
        prop('locationlatitude', g.lat),
        prop('locationlongitude', g.lon),
        prop('countryname', g.country),
        prop('notes', 'Perkiraan lokasi server, bukan lokasi orang di dalamnya.'),
      ],
    });
    links.push({ from: result.ip, to: loc, label: 'server berada di' });
  }

  if (result.network.reverseDns) {
    ents.push({
      type: 'Domain',
      value: result.network.reverseDns,
      properties: [prop('domain', result.network.reverseDns), prop('notes', 'Reverse DNS (PTR record).')],
    });
    links.push({ from: result.ip, to: result.network.reverseDns, label: 'reverse dns' });
  }

  return { entities: ents, links };
}

/**
 * Bangun graph entity lengkap dari satu hasil investigasi.
 * Mengembalikan { entities, links } — format yang bisa di-push ke Maltego.
 */
export function buildGraph(report) {
  const entities = [];
  const links = [];

  if (report.input?.phone) {
    const r = report.modules.phone;
    if (r?.ok) {
      entities.push(...phoneToEntities(r));
      links.push({
        from: report.input.name || report.input.username || 'INPUT',
        to: r.e164,
        label: 'nomor telepon',
      });
    }
  }

  if (report.input?.username) {
    const r = report.modules.social;
    if (r?.ok) {
      const g = socialToEntities(r);
      entities.push(...g.entities);
      links.push(...g.links);
    }
  }

  if (report.input?.location) {
    // Lokasi dari input sudah diproses oleh modul location dan disimpan di
    // report.modules.location; graph di sini tinggal menyalinnya.
    const geo = report.modules.location;
    if (geo?.ok && geo.places?.length) {
      const top = geo.places[0];
      entities.push({
        type: 'Location',
        value: top.displayName || top.name,
        properties: [
          prop('locationlatitude', top.lat),
          prop('locationlongitude', top.lon),
          prop('countryname', top.country),
          prop('source', top.source),
        ],
      });
      if (report.input?.name) {
        links.push({
          from: report.input.name,
          to: top.displayName || top.name,
          label: 'berada di',
        });
      }
    }
  }

  // Sumber (input) sebagai node root supaya investigator bisa melihat pivot.
  if (report.input?.name) {
    entities.push({
      type: 'Person',
      value: report.input.name,
      properties: [prop('realname', report.input.name), prop('notes', 'Nama dari input investigator — belum diverifikasi.')],
    });
  }

  /* Domain & jaringan */
  if (report.modules?.domain) {
    const g = domainToEntities(report.modules.domain);
    entities.push(...g.entities);
    links.push(...g.links);
  }

  if (report.modules?.network?.ok) {
    const g = networkToEntities(report.modules.network);
    entities.push(...g.entities);
    links.push(...g.links);
  }

  // Domain ikut terhubung ke sumber, supaya graph tidak terlihat terpotong.
  const domainValue = report.modules?.domain?.domain || report.modules?.network?.ip;
  if (domainValue && (report.input?.name || report.input?.username)) {
    links.push({
      from: report.input.name || `@${report.input.username}`,
      to: domainValue,
      label: 'terhubung ke',
    });
  }

  return { entities, links };
}

/* ── 2. Push ke Maltego yang sedang berjalan ──────────────────────────── */
/* ── Ekspor ───────────────────────────────────────────────────────────── */

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * CSV untuk "Import Graph (3rd party table)" milik Maltego CE.
 *
 * Format ini sengaja dirancang agar bisa dipetakan lewat dialog import:
 *   - kolom `value`   -> nilai entity
 *   - kolom `type`    -> tipe entity (PhoneNumber, Location, Alias, ...)
 *   - kolom `link_from` / `link_to` / `link_label`
 *     -> dipakai saat mode konektivitas "Manual"/"Meshed" untuk membuat
 *        link antar baris, sehingga hubungan graph ikut terbawa.
 *
 * Kolom property digabung ke satu sel agar tidak meledakkan jumlah baris;
 * pemetaan per-property dilakukan lewat dialog import bila dibutuhkan.
 */
export function toMaltegoCSV(graph) {
  const rows = [
    ['value', 'type', 'link_from', 'link_to', 'link_label', 'properties'].join(','),
  ];

  //.Index nilai entity agar link bisa ditulis sebagai "nilai asal/nilai tujuan"
  // tanpa harus mengulang tipe.
  for (const e of graph.entities || []) {
    const props = (e.properties || [])
      .map((p) => `${p.name}=${p.value}`)
      .join('; ');

    // Satu baris per link keluar; kalau entity tanpa link, satu baris kosong.
    const outgoing = (graph.links || []).filter((l) => l.from === e.value);
    if (!outgoing.length) {
      rows.push([e.value, e.type, '', '', '', props].map(csvCell).join(','));
      continue;
    }
    for (const l of outgoing) {
      rows.push(
        [e.value, e.type, e.value, l.to, l.label, props].map(csvCell).join(',')
      );
    }
  }
  return rows.join('\n');
}

/**
 * Teks untuk tempel langsung ke graph Maltego (Ctrl+V).
 *
 * Format resmi Maltego: satu entitas per baris, format `Tipe#nilai`.
 * Menghormati baik `value#type` maupun `type#value`, jadi `Type#value` yang
 * dipakai di sini aman. Hanya membuat entity — link tidak ikut terbentuk.
 */
export function toClipboardText(graph) {
  return (graph.entities || [])
    .map((e) => `${e.type}#${e.value}`)
    .join('\n');
}

/** Daftar link siap tempel sebagai referensi (tidak bisa diimpor otomatis). */
export function toLinkText(graph) {
  return (graph.links || [])
    .map((l) => `${l.from}  --[${l.label}]-->  ${l.to}`)
    .join('\n');
}

/** JSON biasa untuk arsip/pivot, bukan format impor Maltego. */
export function toJSON(graph) {
  return JSON.stringify({ generatedAt: new Date().toISOString(), ...graph }, null, 2);
}

/** Petunjuk langkah yang tepat untuk masing-masing jalur impor. */
export const importGuide = {
  transform: [
    'Di Maltego: Tools > Import > Maltego Transform Provider',
    'URL Provider: ' + config.maltego.providerUrl,
    'Aktifkan, lalu klik kanan entity PhoneNumber / Alias / Location di graph',
    'Pilih transform "Chameleon: ..." lalu klik Run — hasil langsung masuk graph',
  ],
  csv: [
    'Di Maltego: Tools > Import > Import Graph (3rd party table)',
    'Pilih berkas CSV hasil ekspor',
    'Petakan kolom: value -> nilai entity, type -> tipe entity',
    'Pada bagian konektivitas pilih "Manual" lalu tentukan kolom link_from/link_to',
  ],
  clipboard: [
    'Buka graph Maltego, letakkan kursor di area kosong',
    'Tekan Ctrl+V',
    'Satu baris = satu entity. Link perlu dibuat manual setelahnya',
  ],
};

/* ── 4. Maltego Transform Protocol server ─────────────────────────────── */

/**
 * Satu entitas Maltego -> daftar transform yang bisa dijalankan ke entity itu.
 * Field `transforms` melakukan setting apa yang muncul di panel Transform.
 */
function transformsFor(entityType) {
  const common = [
    {
      run: 'resolve-osint-phone',
      name: 'Chameleon: Cek Nomor (WA/TG/operator)',
      types: ['PhoneNumber'],
      params: {},
      preview: false,
      min: 1,
      max: 1,
    },
    {
      run: 'osint-search-username',
      name: 'Chameleon: Cari Username di Semua Platform',
      types: ['Alias', 'EmailAddress'],
      params: {},
      preview: false,
      min: 1,
      max: 1,
    },
    {
      run: 'osint-geocode',
      name: 'Chameleon: Geocode Lokasi',
      types: ['Location', 'Phrase'],
      params: {},
      preview: false,
      min: 1,
      max: 1,
    },
    {
      run: 'osint-dorks',
      name: 'Chameleon: Generate Search Dorks',
      types: ['Phrase', 'Person', 'PhoneNumber', 'Alias'],
      params: {},
      preview: false,
      min: 1,
      max: 1,
    },
    {
      run: 'osint-domain-recon',
      name: 'Chameleon: Domain Recon (DNS + WHOIS + Subdomain)',
      types: ['Domain', 'WebSite'],
      params: {},
      preview: false,
      min: 1,
      max: 1,
    },
    {
      run: 'osint-ip-profile',
      name: 'Chameleon: Profil IP',
      types: ['IpAddress'],
      params: {},
      preview: false,
      min: 1,
      max: 1,
    },
  ];
  return common.filter((t) => t.types.includes(entityType));
}

/**
 * Jalankan satu transform. Body yang dikirim Maltego bentuknya:
 *   { entity: {...}, transform: { fields: { run: 'nama-run' } } }
 * Kami mengembalikan returnedEntities supaya Maltego menggambarnya di graph.
 */
async function runTransform(runName, entity, value) {
  switch (runName) {
    case 'resolve-osint-phone': {
      const r = await investigatePhone(value);
      if (!r.ok) return errorEntity(value, r.error);
      return phoneToEntities(r);
    }

    case 'osint-search-username': {
      // Untuk EmailAddress, pakai bagian sebelum '@' sebagai username.
      const handle = entity.type === 'EmailAddress' ? value.split('@')[0] : value;
      const r = await searchUsername(handle);
      if (!r.ok) return errorEntity(value, r.error);
      const g = socialToEntities(r);
      return g.entities;
    }

    case 'osint-geocode': {
      const r = await locationToEntities(value);
      return r.entities.length ? r.entities : errorEntity(value, 'Lokasi tidak ditemukan.');
    }

    case 'osint-dorks': {
      const r = buildDorks({ phone: value, name: value, username: value, location: value });
      // Dork dikirim sebagai entity WebSite berisi tautan pencarian.
      return r.dorks.map((d) => ({
        type: 'WebSite',
        value: d.googleUrl,
        properties: [
          prop('title', d.label),
          prop('body', d.query),
          prop('notes', d.why),
          prop('link', d.bingUrl),
        ],
      }));
    }

    case 'osint-domain-recon': {
      // Untuk entity WebSite, ambil host-nya dulu; untuk Domain, pakai nilai.
      const host = entity.type === 'WebSite'
        ? (value.match(/^https?:\/\/([^/?#]+)/i)?.[1] || value)
        : value;

      const [dns, whois, subs] = await Promise.all([
        dnsLookup(host).catch(() => ({ ok: false })),
        whoisLookup(host).catch(() => ({ ok: false })),
        findSubdomains(host).catch(() => ({ ok: false })),
      ]);

      const g = domainToEntities({ domain: parseDomain(host), dns, whois, subdomains: subs });
      return g.entities.length ? g.entities : errorEntity(value, 'Domain tidak ditemukan atau tidak bisa diperiksa.');
    }

    case 'osint-ip-profile': {
      const r = await ipProfile(value);
      if (!r.ok) return errorEntity(value, r.error);
      return networkToEntities(r).entities;
    }

    default:
      return [];
  }
}

function errorEntity(value, message) {
  return {
    type: 'Phrase',
    value: `[Chameleon Console] ${value}`,
    properties: [prop('body', message)],
  };
}

/**
 * Handle POST dari Maltego ke transform provider.
 *
 * Dua mode:
 *  - tanpa `transform.fields.run`: Maltego sedang meminta daftar transform
 *    yang tersedia untuk tipe entity ini.
 *  - dengan `transform.fields.run`: Maltego meminta transform dieksekusi.
 */
export async function handleTransform(body) {
  const entity = body?.entity || {};
  const type = entity.type || 'Unknown';
  const value = entity.value || '';
  const runName = body?.transform?.fields?.run || body?.run;

  if (!runName) {
    return { transforms: transformsFor(type), returnedEntities: [], utx: undefined };
  }

  try {
    const returnedEntities = await runTransform(runName, entity, value);
    return {
      transforms: transformsFor(type),
      returnedEntities,
      // Status_type 0 = sukses, 1 = error dengan pesan.
      status_message: `Selesai: ${returnedEntities.length} entity dikembalikan.`,
      status_type: 0,
    };
  } catch (err) {
    return {
      transforms: transformsFor(type),
      returnedEntities: [],
      status_message: `Gagal menjalankan transform: ${err.message}`,
      status_type: 1,
    };
  }
}

/**
 * Metadata untuk UI. Menyertakan langkah pemasangan Transform Provider
 * supaya instruksinya tidak perlu ditebak-tebak di frontend.
 */
export const maltegoMeta = {
  providerUrl: config.maltego.providerUrl,
  platforms: platformNames,
  methods: [
    {
      id: 'transform',
      title: 'Transform Provider (otomatis ke graph yang sedang berjalan)',
      supported: true,
      steps: importGuide.transform,
    },
    {
      id: 'csv',
      title: 'Impor CSV (3rd party table)',
      supported: true,
      steps: importGuide.csv,
    },
    {
      id: 'clipboard',
      title: 'Tempel ke clipboard (entity saja, tanpa link)',
      supported: true,
      steps: importGuide.clipboard,
    },
  ],
  unavailable: [
    'Push via port 61184 — port tersebut tidak ada di Maltego CE.',
    'Ekspor ".tab" — Maltego CE tidak punya importer .tab.',
    '"LinkAnalysis JSON" — bukan format milik Maltego.',
  ],
};
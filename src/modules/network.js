/**
 * Modul jaringan: profil IP, ASN, reverse DNS, dan situs pada IP yang sama.
 *
 * Sumber yang dipakai:
 *   - ip-api.com  : detail IP + flag proxy/hosting (gratis, 45 req/menit)
 *   - ipinfo.io   : pelengkap lokasi & nama host, gratis tanpa token
 *   - RDAP (IP)   : kepemilikan blok alamat, resmi dari ripe/arin/apnic
 *   - hackertarget: host yang resolving ke satu IP (reverse IP)
 *   - urlscan.io  : riwayat scan publik untuk IP / domain
 *
 * Catatan: modul ini hanya MEMBACA data yang sudah dipublikasikan. Tidak ada
 * pemindaian port, tidak ada percobaan masuk, tidak ada kerentanan yang dicari.
 */

import { request, requestJSON } from '../util/http.js';

/* ── Validasi IP ───────────────────────────────────────────────────────── */

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Validasi alamat IP. IPv6 sengaja dibuat longgar karena bentuknya sangat
 * beragam (kompresi, prefiks panjang, IPv4-mapped) — validasi ketat akan
 * menolak alamat valid, dan membiarkan alamat tidak valid lolos lebih buruk.
 */
export function parseIP(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (IPV4_RE.test(s)) return { ip: s, version: 4 };
  if (/^[0-9a-f:]+$/i.test(s) && s.includes(':') && /^[0-9a-f:.]{2,45}$/i.test(s)) {
    return { ip: s, version: 6 };
  }
  return null;
}

/** Buang '.' dan ':' dari nama host (format whois). */
const whoisSafe = (v) => String(v).replace(/[^\w.:-]/g, '');

/* ── 1. Profil IP ──────────────────────────────────────────────────────── */

/**
 * Profil lengkap satu alamat IP.
 *
 * Dua sumber digabung karena kelemahannya berbeda: ip-api cepat dan punya
 * flag proxy/hosting, ipinfo sering punya nama host lebih akurat. Keduanya
 * gratis tanpa token; kalau salah satu mati, modul tetap jalan dengan data
 * dari yang lain.
 */
export async function ipProfile(rawIp) {
  const parsed = parseIP(rawIp);
  if (!parsed) {
    return { ok: false, error: `Alamat IP tidak valid: "${rawIp}"` };
  }

  const { ip, version } = parsed;

  const [ipApi, ipInfo] = await Promise.all([
    requestJSON(
      `http://ip-api.com/json/${whoisSafe(ip)}?` +
        'fields=status,message,query,country,countryCode,regionName,city,zip,lat,lon,' +
        // Catatan: 'query' hanya boleh SEKALI di daftar field. Jika ditulis dua
        // kali, ip-api membalas objek tanpa key "status", dan seluruh
        // pemeriksaan `json.status === 'success'` ikut gagal diam-diam.
        'timezone,isp,org,as,asname,reverse,mobile,proxy,hosting',
      { retries: 1, timeout: 10000 }
    ).catch((err) => ({ status: 0, json: null, error: err.message })),

    requestJSON(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
      retries: 1,
      timeout: 10000,
    }).catch((err) => ({ status: 0, json: null, error: err.message })),
  ]);

  const a = ipApi.status === 200 && ipApi.json?.status === 'success' ? ipApi.json : null;
  const b = ipInfo.status === 200 && ipInfo.json?.ip ? ipInfo.json : null;

  if (!a && !b) {
    return {
      ok: false,
      ip,
      error: `Kedua sumber IP tidak bisa dihubungi. ${ipApi.error || ipApi.json?.message || ''} ${ipInfo.error || ''}`.trim(),
    };
  }

  // ipinfo menulis "org" sebagai "AS15169 Google LLC" — pisahkan ke asn + nama.
  const orgParts = (b?.org || '').match(/^(AS\d+)\s*(.*)$/i);

  return {
    ok: true,
    ip: a?.query || b?.ip || ip,
    version,
    geolocation: a
      ? {
          country: a.country,
          countryCode: a.countryCode,
          region: a.regionName,
          city: a.city,
          zip: a.zip,
          lat: a.lat,
          lon: a.lon,
          timezone: a.timezone,
        }
      : b
        ? {
            country: b.country,
            countryCode: b.country,
            region: b.region,
            city: b.city,
            zip: b.postal,
            lat: b.loc ? Number(String(b.loc).split(',')[0]) : null,
            lon: b.loc ? Number(String(b.loc).split(',')[1]) : null,
            timezone: b.timezone,
          }
        : null,
    network: {
      isp: a?.isp || null,
      org: a?.org || b?.org || null,
      asn: a?.as || (orgParts ? orgParts[1] : null),
      asName: a?.asname || (orgParts?.[2] || null),
      reverseDns: a?.reverse || b?.hostname || null,
    },
    flags: a
      ? {
          mobile: a.mobile,
          proxy: a.proxy,
          hosting: a.hosting,
          note:
            a.proxy || a.hosting
              ? 'Ditandai sebagai proxy atau hosting — IP ini milik penyedia, bukan pengguna rumahan.'
              : 'Tidak ditandai proxy atau hosting. Profilnya terlihat seperti IP rumah tangga.',
        }
      : { available: false, note: 'ip-api tidak merespons, jadi flag proxy/hosting tidak diketahui.' },
    anycast: b?.anycast === true,
    sources: [
      ipApi.status === 200 && ipApi.json?.status === 'success'
        ? { name: 'ip-api.com', ok: true }
        : {
            name: 'ip-api.com',
            ok: false,
            // ip-api membalas rate limit dengan HTTP 200 + {"status":"fail"},
            // jadi harus dibaca dari body — bukan dari status HTTP saja.
            error:
              ipApi.json?.message ||
              ipApi.error ||
              `HTTP ${ipApi.status}` +
                (ipApi.json?.status === 'fail' ? ' (respons gagal dari API)' : ''),
          },
      b
        ? { name: 'ipinfo.io', ok: true }
        : { name: 'ipinfo.io', ok: false, error: ipInfo.error || `HTTP ${ipInfo.status}` },
    ],
    note:
      'Lokasi IP adalah perkiraan lokasi SERVER, bukan lokasi orang di dalamnya. ' +
      'Untuk IP rumah, biasanya menunjuk ke kota pusat ISP, bukan alamat sebenarnya.',
    generatedAt: new Date().toISOString(),
  };
}

/* ── 2. Detail kepemilikan blok IP (RDAP) ──────────────────────────────── */

/**
 * Siapa yang memiliki blok alamat ini, dari RDAP resmi (arin/ripe/apnic/lacnic).
 * Ini sumber otoritatif untuk kepemilikan, berbeda dari estimasi GeoIP.
 */
export async function ipOwnership(rawIp) {
  const parsed = parseIP(rawIp);
  if (!parsed) {
    return { ok: false, error: `Alamat IP tidak valid: "${rawIp}"` };
  }

  try {
    const { status, json } = await requestJSON(
      `https://rdap.org/ip/${encodeURIComponent(parsed.ip)}`,
      { retries: 1, timeout: 15000 }
    );

    if (status !== 200 || !json) {
      return { ok: false, ip: parsed.ip, error: `RDAP HTTP ${status}` };
    }

    // Nama organisasi diambil dari vCard entitas, bukan dari teks bebas.
    //
    // Catatan: nilai vCard bukan selalu string. Field 'adr' misalnya berupa
    // array (["", "", "", "", "org", ...]) sesuai RFC 6350. Karena itu setiap
    // nilai harus dinormalisasi dulu sebelum .trim() — tanpa ini, satu entitas
    // dengan adr array akan membuat seluruh request gagal dengan TypeError.
    const orgs = [];
    for (const ent of json.entities || []) {
      const vcard = ent.vcardArray?.[1] || [];
      const field = (key) => {
        const v = vcard.find((f) => f[0] === key)?.[3];
        if (v == null) return '';
        if (Array.isArray(v)) return v.filter(Boolean).join(', ');
        return String(v);
      };
      const name = field('fn');
      const email = field('email');
      if (name || email) {
        orgs.push({ name, email, country: field('adr'), roles: ent.roles || [] });
      }
    }

    const remarks = (json.remarks || [])
      .flatMap((r) => r.description || [])
      .map(stripHtml)
      .slice(0, 5);

    return {
      ok: true,
      ip: parsed.ip,
      handle: json.handle,
      range: json.startAddress && json.endAddress ? `${json.startAddress} — ${json.endAddress}` : null,
      cidr: (json.cidr0_cidrs || [])
        .map((c) => (c.v4prefix ? `${c.v4prefix}/${c.length}` : c.v6prefix ? `${c.v6prefix}/${c.length}` : null))
        .filter(Boolean)
        .slice(0, 10),
      name: json.name || null,
      type: json.type || null,
      country: json.country || null,
      registry: json.port43 || null,
      organizations: orgs,
      remarks,
      events: (json.events || []).map((e) => ({ action: e.eventAction, date: e.eventDate })),
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, ip: parsed.ip, error: err.message };
  }
}

const stripHtml = (s) => String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/* ── 3. Situs lain pada IP yang sama (reverse IP) ─────────────────────── */

/**
 * Host lain yang resolve ke IP sama — berguna untuk memetakan infrastruktur
 * satu organisasi dari satu IP.
 *
 * Batas yang jujur: pada hosting bersama hasilnya bisa sangat banyak dan
 * bisa jadi tidak lengkap. Ini bukan daftar lengkap, dan banyak host
 * memang tidak muncul karena reverse DNS-nya tidak dikonfigurasi.
 */
export async function reverseIP(rawIp) {
  const parsed = parseIP(rawIp);
  if (!parsed) {
    return { ok: false, error: `Alamat IP tidak valid: "${rawIp}"` };
  }

  try {
    const { status, text } = await request(
      `https://api.hackertarget.com/reverseiplookup/?q=${encodeURIComponent(parsed.ip)}`,
      { retries: 1, timeout: 20000 }
    );

    if (status !== 200) {
      return { ok: false, ip: parsed.ip, error: `hackertarget HTTP ${status}` };
    }

    // API ini membalas pesan error sebagai teks biasa dengan status 200.
    const trimmed = text.trim();
    if (/error|API count exceeded|invalid/i.test(trimmed)) {
      return { ok: false, ip: parsed.ip, error: trimmed.slice(0, 200) };
    }

    const hosts = trimmed.split('\n').map((h) => h.trim()).filter(Boolean).sort();

    return {
      ok: hosts.length > 0,
      ip: parsed.ip,
      count: hosts.length,
      hosts,
      note:
        hosts.length === 0
          ? 'Tidak ada host yang ditemukan untuk IP ini. Bisa berarti memang tidak ada, atau reverse DNS-nya tidak dikonfigurasi.'
          : 'Daftar ini TIDAK lengkap — hanya host yang punya reverse DNS yang muncul. Pada hosting bersama hasilnya bisa sangat banyak.',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, ip: parsed.ip, error: err.message };
  }
}

/* ── 4. Jejak scan publik (urlscan.io) ────────────────────────────────── */

/**
 * Riwayat scan publik dari urlscan.io untuk IP atau domain.
 * Hanya scan yang disubmit dan berstatus publik yang terlihat di sini.
 */
export async function scanHistory(targetRaw, { size = 20 } = {}) {
  const raw = String(targetRaw || '').trim();
  if (!raw) return { ok: false, error: 'Target kosong.' };

  const isIp = Boolean(parseIP(raw));
  const query = isIp ? `ip:${raw}` : `domain:${raw.replace(/^https?:\/\//i, '').split('/')[0]}`;

  try {
    const { status, json } = await requestJSON(
      `https://urlscan.io/api/v1/search/?q=${encodeURIComponent(query)}&size=${Math.min(size, 50)}`,
      { retries: 1, timeout: 20000 }
    );

    if (status !== 200 || !json?.results) {
      return { ok: false, target: raw, error: `urlscan HTTP ${status}` };
    }

    const results = json.results.map((r) => ({
      url: r.page?.url || r.task?.url || null,
      domain: r.page?.domain || null,
      ip: r.page?.ip || null,
      country: r.page?.country || null,
      asn: r.page?.asn || null,
      asnname: r.page?.asnname || null,
      server: r.page?.server || null,
      title: r.page?.title || null,
      date: r.task?.time || null,
      visibility: r.task?.visibility,
      urlscanUrl: r.result || null,
    }));

    return {
      ok: results.length > 0,
      target: raw,
      mode: isIp ? 'ip' : 'domain',
      count: results.length,
      total: json.total ?? null,
      results,
      note:
        results.length === 0
          ? 'Tidak ada scan publik untuk target ini. Tidak berarti target tidak aktif — hanya tidak pernah discan orang lain secara publik.'
          : 'Hanya scan berstatus publik yang terlihat. Banyak aktivitas tidak pernah muncul di sini.',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, target: raw, error: err.message };
  }
}

export const networkTools = [
  { id: 'ip-profile', label: 'Profil IP', needs: 'ip' },
  { id: 'ip-owner', label: 'Kepemilikan IP (RDAP)', needs: 'ip' },
  { id: 'reverse-ip', label: 'Host pada IP', needs: 'ip' },
  { id: 'scan-history', label: 'Riwayat Scan', needs: 'ip|domain' },
];
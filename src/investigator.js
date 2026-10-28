/**
 * Orkestrator: menerima input dari form, menjalankan modul yang relevan,
 * dan menyusun satu laporan investigasi yang bisa diekspor ke Maltego.
 *
 * Prinsip: setiap modul berdiri sendiri (bisa dipanggil via API terpisah),
 * dan orkestrator hanya merangkai. Kegagalan satu modul tidak menggagalkan
 * modul lain — laporan tetap keluar lengkap dengan status per modul.
 */

import { investigatePhone } from './modules/phone.js';
import { searchUsername } from './modules/social.js';
import { geocode, geolocateIP } from './modules/location.js';
import { checkBreach, checkPassword, buildDorks } from './modules/breach.js';
import { dnsLookup, whoisLookup, findSubdomains, httpProbe } from './modules/domain.js';
import { phoneReputation } from './modules/reputation.js';
import { phoneInfo } from './modules/phoneinfo.js';
import { contactNames } from './modules/contacts.js';
import { fullWebPosture, checkExposedPaths } from './modules/websec.js';
import { traceWallet } from './modules/threatintel.js';
import { ipProfile } from './modules/network.js';
import { buildGraph } from './modules/maltego.js';
import { validateUsername } from './modules/social.js';
import { normalize } from './util/phone.js';
import { appendHistory } from './store.js';

/** Bersihkan input form: string, trim, batasi panjang. */
const clean = (v, max = 120) =>
  typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).trim().slice(0, max);

/**
 * Ambil nama domain dari URL bebas ("https://www.contoh.com/path").
 * Mengembalikan null bila input bukan URL atau tidak punya host yang masuk akal.
 */
function domainFromUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} raw - { name, username, phone, email, location, domain, url, options }
 * @param {object} ctx  - { ip } untuk jejak audit
 */
export async function investigate(raw = {}, ctx = {}) {
  const input = {
    name: clean(raw.name, 100),
    username: clean(raw.username, 60),
    phone: clean(raw.phone, 30),
    email: clean(raw.email, 120),
    location: clean(raw.location, 150),
    domain: clean(raw.domain, 120),
    url: clean(raw.url, 200),
    wallet: clean(raw.wallet, 80),
    notes: clean(raw.notes, 1000),
  };

  const options = {
    checkPhone: raw.checkPhone !== false,
    checkSocial: raw.checkSocial !== false,
    checkLocation: raw.checkLocation !== false,
    checkBreach: raw.checkBreach !== false,
    // Profil nomor (negara, area, zona waktu) — murah, offline, dan jadi
    // dasar dari fitur "lokasi". Wajar nyala secara bawaan.
    checkPhoneInfo: raw.checkPhoneInfo !== false,
    // Nama & tag kontak: mencari jejak nomor di halaman publik lalu
    // menghitung label yang paling sering dipakai. Butuh beberapa request
    // ke mesin pencari, jadi bisa dimatikan lewat checkbox.
    checkContacts: raw.checkContacts !== false,
    // Modul domain & jaringan. Nonaktif secara bawaan karena menambah
    // beberapa detik dan sering tidak relevan bila form tidak diisi
    // domain atau URL.
    checkDomain: raw.checkDomain === true,
    checkNetwork: raw.checkNetwork === true,
    checkWebsec: raw.checkWebsec === true,
    onlyPlatforms: Array.isArray(raw.onlyPlatforms) ? raw.onlyPlatforms : [],
  };

  const errors = [];
  const modules = {};

  /* Validasi awal: jangan jalankan apa pun kalau tidak ada input. */
  const hasAny =
    input.phone || input.username || input.email || input.location || input.name ||
    input.domain || input.url || input.wallet;
  if (!hasAny) {
    return {
      ok: false,
      error:
        'Isi minimal satu field: nomor WhatsApp/HP, username, email, domain, URL, IP, alamat dompet, atau lokasi.',
      input,
    };
  }

  /* Nama lengkap + lokasi: validasi kombinasi untuk identity resolution. */
  if (input.name && input.name.length < 3) {
    errors.push('Nama lengkap terlalu pendek (minimal 3 karakter).');
  }

  /* ── 1. Nomor telepon (WhatsApp / operator / Telegram) ── */
  if (input.phone && options.checkPhone) {
    if (!normalize(input.phone)) {
      errors.push(`Nomor "${input.phone}" tidak bisa dinormalisasi — cek formatnya.`);
      modules.phone = { ok: false, error: 'Format nomor tidak valid.' };
    } else {
      modules.phone = await investigatePhone(input.phone).catch((err) => {
        errors.push(`Modul phone gagal: ${err.message}`);
        return { ok: false, error: err.message };
      });

      // Reputasi/spam langsung menempel di hasil modul nomor supaya
      // investigator tidak perlu menjalankan tool terpisah.
      modules.reputation = await phoneReputation(input.phone, { ip: ctx.ip }).catch((err) => ({
        ok: false,
        error: err.message,
      }));

      // Profil nomor & area/zona waktu pendaftaran (phone_number_cheker).
      modules.phoneInfo = await phoneInfo(input.phone).catch((err) => ({
        ok: false,
        error: err.message,
      }));

      // Nama & tag yang dipakai orang lain untuk nomor ini.
      if (options.checkContacts) {
        modules.contacts = await contactNames(input.phone).catch((err) => {
          errors.push(`Modul contacts gagal: ${err.message}`);
          return { ok: false, error: err.message };
        });
      }
    }
  }

  /* ── 2. Username media sosial ── */
  if (input.username && options.checkSocial) {
    if (!validateUsername(input.username)) {
      errors.push(`Username "${input.username}" tidak valid (a-z, 0-9, ., _, -, maks 30).`);
      modules.social = { ok: false, error: 'Format username tidak valid.' };
    } else {
      modules.social = await searchUsername(input.username, options.onlyPlatforms).catch(
        (err) => {
          errors.push(`Modul social gagal: ${err.message}`);
          return { ok: false, error: err.message };
        }
      );
    }
  }

  /* ── 3. Lokasi ── */
  if (input.location && options.checkLocation) {
    modules.location = await geocode(input.location).catch((err) => {
      errors.push(`Modul location gagal: ${err.message}`);
      return { ok: false, error: err.message };
    });
  }

  /* ── 4. Kebocoran data ── */
  if (input.email && options.checkBreach) {
    modules.breach = await checkBreach(input.email).catch((err) => {
      errors.push(`Modul breach gagal: ${err.message}`);
      return { ok: false, error: err.message };
    });
  }

  /* ── 5. Domain & infrastruktur web ── */
  //
  // Kalau user mengisi URL tapi tidak domain, host-nya tetap bisa diambil.
  const effectiveDomain = input.domain || domainFromUrl(input.url);

  if (effectiveDomain && options.checkDomain) {
    // Ketiganya bisa berjalan bersamaan karena sumbernya berbeda
    // (DNS resolver, RDAP, log CT) dan tidak saling bergantung.
    const [dns, whois, subs] = await Promise.all([
      dnsLookup(effectiveDomain).catch((err) => ({ ok: false, error: err.message })),
      whoisLookup(effectiveDomain).catch((err) => ({ ok: false, error: err.message })),
      findSubdomains(effectiveDomain).catch((err) => ({ ok: false, error: err.message })),
    ]);

    modules.domain = { domain: effectiveDomain, dns, whois, subdomains: subs };

    if (input.url) {
      modules.domain.http = await httpProbe(input.url).catch((err) => ({ ok: false, error: err.message }));
    }

    // Kelemahan website: hanya dijalankan kalau URL diberi DAN opsi diaktifkan.
    // Modul ini pasif (satu GET per path) tapi menambah ~12 request, jadi
    // tidak boleh berjalan diam-diam.
    if (input.url && options.checkWebsec) {
      modules.websec = await fullWebPosture(input.url).catch((err) => {
        errors.push(`Modul websec gagal: ${err.message}`);
        return { ok: false, error: err.message };
      });

      // Path sensitif terpisah karena butuh banyak request.
      modules.websec.paths = await checkExposedPaths(input.url).catch((err) => ({
        ok: false, error: err.message, checked: 0, summary: {},
      }));
    }
  }

  /* ── 7. Jejak dompet kripto ── */
  if (input.wallet) {
    modules.threat = await traceWallet(input.wallet).catch((err) => {
      errors.push(`Modul threat gagal: ${err.message}`);
      return { ok: false, error: err.message };
    });
  }

  /* ── 6. Profil IP ── */
  //
  // IP bisa datang langsung dari form, atau diambil dari hasil DNS supaya
  // investigator tidak perlu searchable ulang kalau sudah punya domain.
  const ipTarget = clean(raw.ip, 45);
  if ((ipTarget || (effectiveDomain && options.checkNetwork)) && options.checkNetwork) {
    let target = ipTarget;
    if (!target && modules.domain?.dns?.resolved) {
      // Ambil record A pertama yang ditemukan.
      target = modules.domain.dns.records
        .flatMap((r) => r.answers || [])
        .map((a) => a.data)
        .find((d) => /^\d{1,3}(\.\d{1,3}){3}$/.test(d));
    }

    if (target) {
      modules.network = await ipProfile(target).catch((err) => {
        errors.push(`Modul network gagal: ${err.message}`);
        return { ok: false, error: err.message };
      });
    }
  }

  /* ── 5. Dork gabungan (selalu berguna kalau ada >=2 field) ── */
  const fieldCount = [input.name, input.username, input.phone, input.location].filter(Boolean).length;
  if (fieldCount >= 2) {
    modules.dorks = buildDorks(input);
  }

  /* ── 6. Graph Maltego ── */
  const graph = buildGraph({ input, modules });
  modules.maltego = { entityCount: graph.entities.length, linkCount: graph.links.length };

  const report = {
    ok: true,
    id: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    input,
    investigator: {
      ip: ctx.ip || null,
      at: new Date().toISOString(),
    },
    errors,
    modules,
    graph,
  };

  appendHistory(report);
  return report;
}

export { investigatePhone, searchUsername, geocode, geolocateIP, checkBreach, checkPassword, buildDorks };
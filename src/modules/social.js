/**
 * Enumerasi username lintas platform (gaya Sherlock/maigret).
 *
 * Cara kerja: setiap platform dicek dengan GET ke URL profilnya, lalu
 * ditentukan ada/tidak dari kombinasi HTTP status + tanda khas di HTML.
 *
 * Catatan etis & teknis:
 * - Hanya memeriksa halaman publik. Tidak ada login, tidak ada bypass,
 *   tidak ada akses ke konten privat.
 * - Rate limit: diperiksa dengan concurrency terbatas (config.concurrency).
 * - Sebagian situs (Instagram, TikTok, Threads) memblokir UA bot, jadi
 *   hasilnya bisa false negative. Modul ini melaporkannya secara jujur
 *   lewat status "blocked".
 */

import { config } from '../config.js';
import { request, requestJSON, mapLimit, stripTags } from '../util/http.js';

/**
 * Definisi platform.
 * detect(html, status, headers) -> true | false | 'blocked'
 *   true  = profil ditemukan
 *   false = profil tidak ada
 *   'blocked' = situs menolak UA bot, tidak bisa disimpulkan
 */
export const PLATFORMS = [
  {
    name: 'GitHub',
    url: (u) => `https://github.com/${u}`,
    check: async (u) => {
      const { status, json } = await requestJSON(`https://api.github.com/users/${u}`, {
        browserUA: false,
        retries: 1,
        timeout: 10000,
      });
      if (status === 200 && json?.login) {
        return {
          found: true,
          extra: {
            followers: json.followers,
            repos: json.public_repos,
            bio: json.bio || null,
            location: json.location || null,
            blog: json.blog || null,
            createdAt: json.created_at,
          },
        };
      }
      if (status === 404) return { found: false };
      return { found: false, note: `HTTP ${status}` };
    },
  },

  {
    name: 'Instagram',
    url: (u) => `https://www.instagram.com/${u}`,
    check: async (u) => {
      const { status, text } = await request(`https://www.instagram.com/${u}/`, {
        browserUA: true,
        timeout: 12000,
      });
      if (status === 404) return { found: false };
      if (status === 429 || /loginForm|checkpoint/i.test(text)) return { found: 'blocked' };
      const m = text.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i);
      const followers = m && m[1].match(/([\d.,]+[KM]?)\s+Followers/i);
      return {
        found: status === 200,
        extra: followers ? { followers: followers[1] } : undefined,
        note: status === 200 ? 'Instagram sering memblokir scrape; verifikasi manual bila ragu.' : undefined,
      };
    },
  },

  {
    name: 'TikTok',
    url: (u) => `https://www.tiktok.com/@${u}`,
    check: async (u) => {
      const { status, text } = await request(`https://www.tiktok.com/@${u}`, {
        browserUA: true,
        timeout: 12000,
      });
      if (status === 404 || /Couldn't find this account/i.test(text)) return { found: false };
      if (status === 429 || /verify/i.test(text.slice(0, 3000))) return { found: 'blocked' };
      const sig = text.match(/<title[^>]*>([^<]*)<\/title>/i);
      return {
        found: status === 200 && /TikTok/i.test(sig?.[1] || ''),
        extra: sig ? { pageTitle: stripTags(sig[1]) } : undefined,
        note: status === 200 ? 'TikTok aktifChallenges bot — verifikasi manual bila ragu.' : undefined,
      };
    },
  },

  { name: 'Facebook',   url: (u) => `https://www.facebook.com/${u}` },
  { name: 'Twitter / X',url: (u) => `https://x.com/${u}` },
  { name: 'Threads',    url: (u) => `https://www.threads.net/@${u}` },
  { name: 'Pinterest',  url: (u) => `https://www.pinterest.com/${u}/` },
  { name: 'Reddit',     url: (u) => `https://www.reddit.com/user/${u}` },
  { name: 'Tumblr',     url: (u) => `https://${u}.tumblr.com` },
  { name: 'Medium',     url: (u) => `https://medium.com/@${u}` },
  { name: 'Dev.to',     url: (u) => `https://dev.to/${u}` },
  { name: 'Hashnode',   url: (u) => `https://hashnode.com/@${u}` },
  { name: 'HackerOne',  url: (u) => `https://hackerone.com/${u}` },
  { name: 'Bugcrowd',   url: (u) => `https://bugcrowd.com/${u}` },
  { name: 'Replit',     url: (u) => `https://replit.com/@${u}` },
  { name: 'Kaggle',     url: (u) => `https://www.kaggle.com/${u}` },
  { name: 'Keybase',    url: (u) => `https://keybase.io/${u}` },
  { name: 'About.me',   url: (u) => `https://about.me/${u}` },
  { name: 'Linktree',   url: (u) => `https://linktr.ee/${u}` },
  { name: 'Behance',    url: (u) => `https://www.behance.net/${u}` },
  { name: 'Dribbble',   url: (u) => `https://dribbble.com/${u}` },
  { name: 'Flickr',     url: (u) => `https://www.flickr.com/people/${u}` },
  { name: 'Last.fm',    url: (u) => `https://www.last.fm/user/${u}` },
  { name: 'SoundCloud', url: (u) => `https://soundcloud.com/${u}` },
  { name: 'Bandcamp',   url: (u) => `https://${u}.bandcamp.com` },
  { name: 'Mixcloud',   url: (u) => `https://www.mixcloud.com/${u}/` },
  { name: 'Vimeo',      url: (u) => `https://vimeo.com/${u}` },
  { name: 'Wattpad',    url: (u) => `https://www.wattpad.com/user/${u}` },
  { name: 'Roblox',     url: (u) => `https://www.roblox.com/user.aspx?username=${u}` },
  { name: 'Steam',      url: (u) => `https://steamcommunity.com/id/${u}` },
  { name: 'Chess.com',  url: (u) => `https://www.chess.com/member/${u}` },
  { name: 'Lichess',    url: (u) => `https://lichess.org/@/${u}` },
  { name: 'Gravatar',   url: (u) => `https://gravatar.com/${u}` },
  { name: 'Ko-fi',      url: (u) => `https://ko-fi.com/${u}` },
  { name: 'BuyMeACoffee', url: (u) => `https://buymeacoff.ee/${u}` },
  { name: 'Patreon',    url: (u) => `https://www.patreon.com/${u}` },
  { name: 'Xbox Gamertag', url: (u) => `https://xboxgamertag.com/search/${u}` },
  { name: 'PSNProfiles',url: (u) => `https://psnprofiles.com/${u}` },
  { name: 'Strava',     url: (u) => `https://www.strava.com/athletes/${u}` },
  { name: 'Untappd',    url: (u) => `https://untappd.com/user/${u}` },
  { name: 'Goodreads',  url: (u) => `https://www.goodreads.com/${u}` },
  { name: 'Archive.org',url: (u) => `https://archive.org/details/@${u}` },
  { name: 'Fiverr',     url: (u) => `https://www.fiverr.com/${u}` },
  { name: 'Etsy',       url: (u) => `https://www.etsy.com/shop/${u}` },
  { name: 'Trello',     url: (u) => `https://trello.com/${u}` },
  {
    // Halaman profil Telegram hanya menampilkan nama tampilan bila nomor
    // terdaftar. Untuk username yang tidak ada, judulnya persis
    // "Telegram: Contact @username" — itu sinyal negatif yang andal.
    name: 'Telegram',
    url: (u) => `https://t.me/${u}`,
    check: async (u) => {
      const { status, text } = await request(`https://t.me/${u}`, { browserUA: true, timeout: 12000 });
      if (status === 404) return { found: false };
      const title = stripTags((text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
      if (new RegExp(`contact\\s*@${escapeRe(u)}\\b`, 'i').test(title)) {
        return { found: false };
      }
      const displayName = stripTags(
        (text.match(/tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || ''
      );
      if (displayName) return { found: true, extra: { displayName } };
      return { found: 'blocked', note: 'Judul halaman tidak menampilkan nama profil — verifikasi manual.' };
    },
  },

  // Aplikasi web berikut memuat data profil lewat JavaScript, jadi HTML
  // awal tidak pernah memuat username. Status 200 di sana TIDAK berarti
  // profil ada, sehingga hasilnya ditandai "tak pasti", bukan "ditemukan".
  {
    name: 'Spotify',
    url: (u) => `https://open.spotify.com/user/${u}`,
    check: async () => ({ found: 'blocked', note: 'Spotify memuat profil via JavaScript. Cek manual: buka tautannya, atau pakai app Spotify.' }),
  },
  {
    name: 'Duolingo',
    url: (u) => `https://www.duolingo.com/profile/${u}`,
    check: async () => ({ found: 'blocked', note: 'Duolingo memuat profil via JavaScript — verifikasi manual.' }),
  },
  {
    name: 'Trakt',
    url: (u) => `https://trakt.tv/users/${u}`,
    check: async () => ({ found: 'blocked', note: 'Trakt memuat profil via JavaScript — verifikasi manual.' }),
  },

  { name: 'Snapchat',   url: (u) => `https://www.snapchat.com/add/${u}` },
];

/** Escape untuk pemakaian di dalam RegExp. */
const escapeRe = (s = '') => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Cek generik berbasis HTTP status + verifikasi isi halaman.
 *
 * Status 200 saja TIDAK cukup. Banyak situs (Bandcamp, Spotify, Trello,
 * Fiverr, dsb.) selalu membalas 200 bahkan untuk halaman yang tidak ada, sehingga
 * muncul false positive yang tidak diketahui. Karena itu kita wajib
 * memastikan username benar-benar muncul di HTML sebelum menyebut "ADA".
 */
async function genericCheck(platform, username) {
  const url = platform.url(username);
  const { status, text } = await request(url, { browserUA: true, timeout: 11000 });

  if (status === 404 || status === 410) return { found: false };
  if (status === 429 || status === 403 || status === 401) return { found: 'blocked' };

// Tanda "tidak ditemukan" SERING muncul jauh di dalam dokumen (biasanya
  // di dalam <title> atau pesan error di bagian akhir), makanya seluruh HTML
  // diperiksa — bukan hanya 5 KB pertama.
  const notFoundHints =
    /(user|page|profile|account|band|board|domain|collection|artist)\s+not\s+found|not\s+found|notfound|doesn'?t\s+exist|does\s+not\s+exist|no\s+longer\s+exists|specified\s+profile|404\s*(error|not\s+found)|isn'?t\s+available|tak\s+ditemukan|konten\s+ini\s+tidak\s+tersedia|this\s+is\s+not\s+a\s+valid/i;
  if (notFoundHints.test(text)) return { found: false };

  const title = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
  const pageTitle = stripTags(title || '');
  const ogTitle = stripTags(
    (text.match(/og:title"[^>]*content="([^"]*)"/i) || [])[1] || ''
  );

  // Judul kosong atau generik (login wall / landing page) tidak membuktikan apa pun.
  if (pageTitle && /^(error|404|page not found|sign ?up|log ?in|reddit|bandcamp)$/i.test(pageTitle)) {
    return { found: false };
  }

  // Dinding pendaftaran: halaman sama untuk username ada maupun tidak.
  // Tidak bisa dipakai sebagai sinyal positif.
  const wallPattern =
    /^(sign ?up|log ?in|login|register|join|create an account|redirecting|just a moment|attention required)/i;
  if (wallPattern.test(ogTitle) || wallPattern.test(pageTitle)) {
    return {
      found: 'blocked',
      note:
        'Situs menampilkan halaman pendaftaran/pembatas (login wall) — ' +
        'tidak bisa dipastikan otomatis, verifikasi manual.',
    };
  }

  // Verifikasi konten: username harus benar-benar ada di halaman.
  const needle = username.toLowerCase();
  const haystack = text.toLowerCase();
  const mentionsUser = haystack.includes(needle);

  if (!mentionsUser) {
    // Beberapa situs memuat username lewat JS sehingga tidak ada di HTML awal.
    // Jangan langsung bilang "tidak ada" — beri status tak pasti.
    return {
      found: 'blocked',
      note:
        'Halaman membalas 200 tetapi username tidak muncul di HTML awal. ' +
        'Kemungkinan profil ada dan dimuat via JavaScript — verifikasi manual.',
    };
  }

  return {
    found: true,
    extra: pageTitle ? { pageTitle: pageTitle.slice(0, 120) } : undefined,
  };
}

async function checkPlatform(platform, username) {
  const profileUrl = platform.url(username);
  const started = Date.now();
  try {
    const result = platform.check
      ? await platform.check(username)
      : await genericCheck(platform, username);

    const found = result.found;
    return {
      platform: platform.name,
      username,
      url: profileUrl,
      status: found === true ? 'found' : found === 'blocked' ? 'blocked' : 'not_found',
      ms: Date.now() - started,
      ...(result.extra ? { extra: result.extra } : {}),
      ...(result.note ? { note: result.note } : {}),
    };
  } catch (err) {
    return {
      platform: platform.name,
      username,
      url: profileUrl,
      status: 'error',
      error: err.message,
      ms: Date.now() - started,
    };
  }
}

export function validateUsername(u = '') {
  const s = String(u).trim().replace(/^@/, '');
  // 1–30 karakter: huruf, angka, titik, garis bawah, tanda hubung.
  return /^[a-zA-Z0-9._-]{1,30}$/.test(s) ? s : null;
}

/**
 * Jalankan enumerasi username.
 * @param {string} rawUsername
 * @param {string[]} onlyPlatforms - batasi ke daftar nama platform tertentu
 */
export async function searchUsername(rawUsername, onlyPlatforms = []) {
  const username = validateUsername(rawUsername);
  if (!username) {
    return {
      ok: false,
      error: `Username tidak valid: "${rawUsername}". Hanya boleh 1-30 karakter a-z, 0-9, titik, _ atau -.`,
    };
  }

  const targets = onlyPlatforms.length
    ? PLATFORMS.filter((p) => onlyPlatforms.includes(p.name))
    : PLATFORMS;

  const results = await mapLimit(targets, config.concurrency, (p) =>
    checkPlatform(p, username)
  );

  const found = results.filter((r) => r.status === 'found');
  const blocked = results.filter((r) => r.status === 'blocked');
  const errors = results.filter((r) => r.status === 'error');

  return {
    ok: true,
    username,
    totalChecked: results.length,
    summary: {
      found: found.length,
      blocked: blocked.length,
      notFound: results.length - found.length - blocked.length - errors.length,
      errors: errors.length,
    },
    found,
    blocked,
    results,
    generatedAt: new Date().toISOString(),
  };
}

/** Daftar nama platform (untuk filter di UI). */
export const platformNames = PLATFORMS.map((p) => p.name);
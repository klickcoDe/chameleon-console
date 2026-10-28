/**
 * Modul lokasi: geocoding nama tempat, dan geolokasi IP.
 *
 * Batas etis yang disengaja: modul ini MENCOCOKKAN lokasi yang diberikan
 * pengguna (mis. "Bandung, Jawa Barat") ke koordinat, dan memetakan IP milik
 * pengguna sendiri. Modul ini TIDAK mencoba mencari alamat rumah seseorang
 * dari kombinasi nama + kota. Kalau butuh fitur seperti itu, pahami dulu
 * implikasi hukum dan korbannya di yurisdiksi Anda.
 */

import { config } from '../config.js';
import { requestJSON } from '../util/http.js';

/**
 * Geocode satu query ke dua penyedia (Photon + Nominatim) lalu gabungkan.
 * Photon biasanya lebih cepat; Nominatim punya cakupan lebih luas.
 */
export async function geocode(query) {
  const q = String(query || '').trim();
  if (q.length < 3) {
    return { ok: false, error: 'Query lokasi terlalu pendek (minimal 3 karakter).' };
  }

  const [photon, nominatim] = await Promise.allSettled([
    requestJSON(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`,
      { retries: 1, timeout: 10000 }
    ),
    requestJSON(
      `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=5`,
      // Usage policy Nominatim mewajibkan User-Agent yang mengidentifikasi aplikasi.
      { retries: 1, timeout: 10000 }
    ),
  ]);

  const places = [];

  if (photon.status === 'fulfilled' && photon.value.status === 200) {
    for (const f of photon.value.json?.features || []) {
      const p = f.properties || {};
      places.push({
        source: 'Photon/OpenStreetMap',
        name: p.name,
        type: p.type,
        country: p.country,
        countryCode: p.countrycode,
        state: p.state,
        city: p.city,
        street: p.street,
        postcode: p.postcode,
        lat: f.geometry?.coordinates?.[1],
        lon: f.geometry?.coordinates?.[0],
        osmId: p.osm_id,
        mapUrl: `https://www.openstreetmap.org/?mlat=${f.geometry?.coordinates?.[1]}&mlon=${f.geometry?.coordinates?.[0]}#map=16/${f.geometry?.coordinates?.[1]}/${f.geometry?.coordinates?.[0]}`,
      });
    }
  }

  if (nominatim.status === 'fulfilled' && nominatim.value.status === 200) {
    for (const r of nominatim.value.json || []) {
      places.push({
        source: 'Nominatim/OpenStreetMap',
        name: r.name || r.display_name?.split(',')[0],
        type: r.type,
        country: r.address?.country,
        countryCode: r.address?.country_code?.toUpperCase(),
        state: r.address?.state,
        city: r.address?.city || r.address?.town || r.address?.village,
        street: r.address?.road,
        postcode: r.address?.postcode,
        lat: r.lat,
        lon: r.lon,
        osmId: r.osm_id,
        displayName: r.display_name,
        mapUrl: `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=16/${r.lat}/${r.lon}`,
      });
    }
  }

  if (!places.length) {
    return { ok: false, error: `Lokasi "${q}" tidak ditemukan di OpenStreetMap.` };
  }

  return {
    ok: true,
    query: q,
    count: places.length,
    places,
    generatedAt: new Date().toISOString(),
  };
}

/** Geolokasi IP (dipakai untuk mencatat jejak audit investigator). */
export async function geolocateIP(ip) {
  const target = ip || 'me';
  try {
    const { status, json } = await requestJSON(
      `http://ip-api.com/json/${encodeURIComponent(target)}?` +
        'fields=status,message,query,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,proxy,hosting',
      { retries: 1, timeout: 10000 }
    );
    if (status !== 200 || json.status !== 'success') {
      return { ok: false, error: json?.message || `HTTP ${status}` };
    }
    return { ok: true, ip: json.query, ...json };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Ambil IP publik dari request HTTP masuk (dipakai untuk log audit).
 * Menghormati header proxy yang umum.
 */
export function clientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

export const nominatimPolicy = {
  contact: `${config.contactName} <${config.contactEmail}>`,
  maxRequestsPerSecond: 1,
};
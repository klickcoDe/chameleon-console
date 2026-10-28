/**
 * Penyimpanan riwayat lokal.
 *
 * Format JSONL (satu JSON per baris) supaya bisa di-append tanpa/database
 * dan tetap mudah diimpor ke Excel, grep, atau skrip analisis lain.
 *
 * Yang disimpan: ringkasan + input. JANGAN simpan password atau key API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = () => path.resolve(config.historyFile);

/** Buang nilai yang tidak boleh masuk log. */
function redact(obj) {
  const clone = JSON.parse(JSON.stringify(obj));
  if (clone.modules?.phone?.checks) delete clone.modules.phone.checks; // berisi URL WA
  return clone;
}

export function appendHistory(report) {
  try {
    const entry = {
      id: report.id,
      at: report.investigator.at,
      investigatorIp: report.investigator.ip,
      input: report.input,
      errors: report.errors,
      summary: {
        phoneOk: report.modules.phone?.ok ?? null,
        phoneOperator: report.modules.phone?.operator ?? null,
        socialFound: report.modules.social?.summary?.found ?? null,
        socialBlocked: report.modules.social?.summary?.blocked ?? null,
        locationOk: report.modules.location?.ok ?? null,
        breachCount: report.modules.breach?.breachCount ?? null,
        entities: report.modules.maltego?.entityCount ?? 0,
      },
    };

    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.appendFileSync(file(), JSON.stringify(entry) + '\n');
    return true;
  } catch (err) {
    console.error('[history] gagal menulis:', err.message);
    return false;
  }
}

export function readHistory(limit = 50) {
  try {
    if (!fs.existsSync(file())) return [];
    const lines = fs.readFileSync(file(), 'utf8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function clearHistory() {
  try {
    if (fs.existsSync(file())) fs.writeFileSync(file(), '');
    return true;
  } catch {
    return false;
  }
}

export { redact };
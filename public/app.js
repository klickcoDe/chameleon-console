/* ============================================================
   CHAMELEON CONSOLE — logika frontend (vanilla JS, tanpa framework)
   ============================================================ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Cegah XSS: semua data dari API masuk lewat esc(), bukan innerHTML mentah. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { ok: false, error: text.slice(0, 300) }; }
  if (!res.ok && data.ok !== false) data.ok = false;
  return data;
}

/* ── Status server ─────────────────────────────────────────── */
(async function health() {
  const badge = $('#healthBadge');
  try {
    const h = await api('/api/health');
    if (!h.ok) throw new Error(h.error);
    const mods = Object.keys(h.modules || {}).length;
    badge.className = 'led led-ok';
    badge.textContent = `ONLINE · ${mods} MODUL`;
  } catch {
    badge.className = 'led led-bad';
    badge.textContent = 'OFFLINE';
  }
})();

/* ── Sidebar: daftar tool dari /api/tools ──────────────────── */
/**
 * Sidebar dibangun dari API, bukan dari HTML statis. Menambah tool baru
 * cukup dilakukan di backend — frontend ikut menyesuaikan sendiri.
 */
(async function loadTools() {
  const box = $('#toolList');
  try {
    const data = await api('/api/tools');
    if (!data.ok || !Array.isArray(data.categories)) throw new Error('format tidak dikenal');

    box.innerHTML = data.categories.map((cat) => `
      <div class="side-group">
        <div class="glabel">${esc(cat.label)}</div>
        ${cat.tools.map((t) => `
          <button class="side-item" data-tool="${esc(t.id)}" data-needs="${esc(t.needs || '')}"
                  type="button" title="${esc(t.endpoint || '')}">
            <span class="dot"></span>${esc(t.label)}
          </button>`).join('')}
      </div>`).join('');

    /* Klik tool -> isi form dengan contoh lalu fokuskan ke kolom yang tepat. */
    $$('.side-item[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.side-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        focusForTool(btn.dataset.tool);
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="side-group">
      <div class="side-item" style="border-left-color:var(--neon-red);color:var(--neon-red);">
        Gagal memuat: ${esc(err.message)}</div></div>`;
  }
})();

/**
 * Kunci tool ke kolom form yang relevan, lalu beri petunjuk lewat placeholder
 * supaya jelas kolom mana yang harus diisi.
 */
const TOOL_FIELDS = {
  investigate: ['name'], phone: ['phone'], social: ['username'],
  breach: ['email'], dns: ['domain'], whois: ['domain'], subdomains: ['domain'],
  headers: ['url'], fingerprint: ['url'], wayback: ['url'],
  'ip-profile': ['ip'], 'ip-owner': ['ip'], 'reverse-ip': ['ip'],
  'scan-history': ['domain'], geocode: ['location'], 'geolocate-ip': ['ip'],
  'phone-info': ['phone'], 'contact-names': ['phone'], mentions: ['phone'],
  'cek-pos': ['phone'], 'port-scan': ['ip'], bgp: ['ip'], 'ip-intel': ['ip'],
  'mac-vendor': ['ip'], 'sanctions-search': ['name'],
  hash: [], identify: [], decode: [], password: [],
};

function focusForTool(tool) {
  const fields = TOOL_FIELDS[tool];
  if (!fields || !fields.length) {
    flash($('#logline'), 'Tool ini memakai kolom khusus di panel kiri.');
    return;
  }
  const el = $(`#osintForm [name="${fields[0]}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    el.placeholder = 'ISI DI SINI untuk tool ini…';
  }
}

/* ── Panel setup / panduan ──────────────────────────────────── */
$('#setupOut').innerHTML = '<div class="callout">Memuat panduan…</div>';

(async function loadSetup() {
  try {
    const m = await api('/api/maltego');
    const guide = m.guide || {};
    const steps = (arr) =>
      `<ol style="font-size:12.5px;line-height:1.9;margin:6px 0;padding-left:20px;">${
        arr.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;

    $('#setupOut').innerHTML = `
      <div class="callout ok">
        <strong>Transform Provider &mdash; satu-satunya jalur resmi ke graph Maltego yang sedang aktif.</strong>
        ${steps(guide.transform || [])}
      </div>

      <h3 class="mono" style="font-size:12px;letter-spacing:1.5px;color:var(--neon-yellow);margin:18px 0 8px;text-transform:uppercase;">
        Impor Dari Berkas &mdash; Hasil Offline
      </h3>
      <div class="items">
        <div class="item found">
          <div class="item-main">
            <div class="item-title">CSV &mdash; dialog 3rd Party Table</div>
            ${steps(guide.csv || [])}
          </div>
        </div>
        <div class="item blocked">
          <div class="item-main">
            <div class="item-title">Clipboard &mdash; tempel entity ke graph</div>
            ${steps(guide.clipboard || [])}
          </div>
        </div>
      </div>

      <div class="callout warn mt">
        <strong>Sengaja tidak tersedia</strong> &mdash; sudah diverifikasi terhadap Maltego CE, bukan asumsi:
        <ul style="margin:7px 0 0;padding-left:20px;">
          ${(m.unavailable || []).map((u) => `<li>${esc(u)}</li>`).join('')}
        </ul>
      </div>

      <div class="callout info mt">
        <strong>Konfigurasi</strong> &mdash; salin <code>.env.example</code> menjadi <code>.env</code>,
        lalu isi seperlunya. Semua variabel opsional; modul yang butuh key akan melaporkan
        status &ldquo;belum dikonfigurasi&rdquo;, bukan error.
      </div>`;
  } catch (err) {
    $('#setupOut').innerHTML =
      `<div class="callout bad">&#10005; Gagal memuat panduan: ${esc(err.message)}</div>`;
  }
})();

/* ── Submit form ───────────────────────────────────────────── */
let lastReport = null;

$('#osintForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const fd = new FormData(e.target);
  const body = {
    name:     fd.get('name') || '',
    username: fd.get('username') || '',
    phone:    fd.get('phone') || '',
    email:    fd.get('email') || '',
    location: fd.get('location') || '',
    domain:   fd.get('domain') || '',
    url:      fd.get('url') || '',
    ip:       fd.get('ip') || '',
    wallet:   fd.get('wallet') || '',
    notes:    fd.get('notes') || '',
    checkPhone:    fd.has('checkPhone'),
    checkPhoneInfo: fd.has('checkPhoneInfo'),
    checkContacts: fd.has('checkContacts'),
    checkSocial:   fd.has('checkSocial'),
    checkLocation: fd.has('checkLocation'),
    checkBreach:   fd.has('checkBreach'),
    checkDomain:   fd.has('checkDomain'),
    checkNetwork:  fd.has('checkNetwork'),
    checkWebsec:   fd.has('checkWebsec'),
  };

  const btn = $('#runBtn');
  const spin = $('#spinner');
  const log = $('#logline');
  btn.disabled = true;
  btn.innerHTML = '&#9673; Menyelidiki&hellip;';
  spin.hidden = false;
  log.hidden = false;
  log.textContent = 'Mengirim target ke modul&hellip;';

  try {
    const report = await api('/api/investigate', { method: 'POST', body });
    lastReport = report;
    render(report);
    if (!report.ok) {
      $('#summary').innerHTML = `<div class="callout bad">&#10005; ${esc(report.error)}</div>`;
      $('#results').hidden = false;
    }
    log.textContent = 'Selesai.';
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    $('#summary').innerHTML =
      `<div class="callout bad">&#10005; Gagal menghubungi server: ${esc(err.message)}</div>`;
    $('#results').hidden = false;
    log.textContent = 'Gagal.';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#9656; Jalankan Investigasi';
    spin.hidden = true;
  }
});

/* ── Render utama ──────────────────────────────────────────── */
function render(r) {
  $('#results').hidden = false;
  renderSummary(r);
  renderPhone(r.modules?.phone, r.input.phone);
  renderReputation(r.modules?.reputation);
  renderPhoneInfo(r.modules?.phoneInfo);
  renderContacts(r.modules?.contacts);
  renderMentions(r.modules?.contacts?.mentions ? r.modules.contacts : r.modules?.mentions);
  renderSocial(r.modules?.social);
  renderDomain(r.modules?.domain);
  renderNetwork(r.modules?.network);
  renderWebsec(r.modules?.websec);
  renderThreat(r.modules?.threat);
  renderLocation(r.modules?.location, r.input.location);
  renderBreach(r.modules?.breach, r.input.email);
  renderDorks(r.modules?.dorks);
  renderGraph(r.graph);
  loadHistory();
}

const stat = (n, l, cls = '') =>
  `<div class="stat ${cls}"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`;

function renderSummary(r) {
  if (!r.ok) {
    $('#summary').innerHTML = `<div class="callout bad">&#10005; ${esc(r.error)}</div>`;
    return;
  }
  const m = r.modules || {};
  const s = m.social?.summary || {};
  const p = m.phone;

  const errors = r.errors?.length
    ? `<div class="callout warn mt"><strong>${r.errors.length} peringatan</strong><ul style="margin:6px 0 0;padding-left:20px;">${
        r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
    : '';

  $('#summary').innerHTML = `
    <div class="cards">
      ${stat(s.found ?? 0, 'Profil sosial', 'ok')}
      ${stat(s.blocked ?? 0, 'Situs memblokir', 'warn')}
      ${stat(m.maltego?.entityCount ?? 0, 'Entity Maltego', 'info')}
      ${stat(m.domain?.subdomains?.count ?? '-', 'Subdomain CT', 'info')}
      ${stat(m.breach?.breached ? (m.breach.breachCount ?? 'Ya') : (m.breach ? '0' : '-'),
             'Data bocor',
             m.breach?.breached ? 'bad' : (m.breach ? 'ok' : ''))}
    </div>
    <dl class="kv mt">
      <dt>ID Laporan</dt><dd>${esc(r.id)}</dd>
      <dt>Waktu</dt><dd>${esc(new Date(r.investigator.at).toLocaleString('id-ID'))}</dd>
      ${p?.ok ? `<dt>Nomor</dt><dd>${esc(p.e164)} ${
        p.operator ? `<span class="badge badge-info">${esc(p.operator)}</span>` : ''}</dd>` : ''}
      ${m.network?.ok ? `<dt>IP</dt><dd>${esc(m.network.ip)} ${
        m.network.network?.asn ? `<span class="badge badge-warn">${esc(m.network.network.asn)}</span>` : ''}</dd>` : ''}
    </dl>
    ${errors}`;
}

/* ── Telepon ───────────────────────────────────────────────── */
function renderPhone(p, inputPhone) {
  const card = $('#phoneCard');
  if (!inputPhone) return card.hidden = true;
  card.hidden = false;

  const out = $('#phoneOut');
  if (!p)     return void (out.innerHTML = '<div class="callout">Modul nomor tidak dijalankan.</div>');
  if (!p.ok)  return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(p.error)}</div>`);

  const wa = p.checks?.whatsapp || {};
  const tg = p.checks?.telegram || {};
  const loc = p.operatorLocation;

  const checkBox = (c) => {
    const map = {
      registered:      ['badge-ok', 'TERDAFTAR'],
      not_registered:  ['badge-muted', 'TIDAK TERDAFTAR'],
      needs_manual:    ['badge-warn', 'MANUAL'],
      unreachable:     ['badge-warn', 'TIDAK BISA DICEK'],
      unknown:         ['badge-muted', 'TIDAK PASTI'],
      error:           ['badge-bad', 'GAGAL'],
    };
    const [cls, label] = map[c.status] || ['badge-muted', String(c.status || '-').toUpperCase()];
    const rowCls =
      c.status === 'registered' ? 'found'
      : c.status === 'error' ? 'error'
      : c.status === 'not_registered' ? 'notfound'
      : 'blocked';
    return `
      <div class="item ${rowCls}">
        <div class="item-main">
          <div class="item-title">${esc(c.platform)}</div>
          ${c.url ? `<div class="item-url"><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.url)}</a></div>` : ''}
          ${c.displayName ? `<div class="item-note">Nama: <b>${esc(c.displayName)}</b>${c.bio ? ' — ' + esc(c.bio) : ''}</div>` : ''}
          ${c.note ? `<div class="item-note">${esc(c.note)}</div>` : ''}
        </div>
        <div class="item-side">
          <span class="badge ${cls}">${label}</span>
          <span class="muted mono" style="font-size:9.5px;">${esc(c.method || '')}</span>
        </div>
      </div>`;
  };

  out.innerHTML = `
    <dl class="kv">
      <dt>E.164</dt><dd>${esc(p.e164)}</dd>
      <dt>Format Lokal</dt><dd>${esc(p.display)}</dd>
      <dt>Negara</dt><dd>${esc(p.countryCode)}</dd>
      <dt>Operator</dt><dd>${p.operator ? esc(p.operator) : '<span class="muted">tidak dikenali dari prefix</span>'}</dd>
      <dt>Tipe</dt><dd>${esc(p.lineType || '-')}</dd>
      ${loc ? `<dt>Lokasi Operator</dt><dd>${esc([loc.city, loc.region, loc.country].filter(Boolean).join(', ') || '-')}
        <br><span class="muted">${esc(loc.note)}</span></dd>` : ''}
    </dl>

    <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
      Verifikasi Lintas Platform</h3>
    <div class="items mt">${checkBox(wa)}${checkBox(tg)}</div>

    <div class="callout warn mt">
      <strong>Kenapa WhatsApp butuh verifikasi manual?</strong><br>
      Meta tidak menyediakan endpoint publik untuk mengecek apakah nomor terdaftar.
      Klik tautan <code>wa.me</code>: bila chat terbuka, nomor aktif; bila muncul
      &ldquo;tidak terdaftar&rdquo;, berarti belum. Satu klik sudah cukup.
    </div>

    <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
      Tautan Terkait</h3>
    <div class="items mt">
      ${p.links.map((l) => `
        <div class="item">
          <div class="item-main">
            <div class="item-title">${esc(l.platform)}</div>
            <div class="item-url"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.url)}</a></div>
            ${l.note ? `<div class="item-note">${esc(l.note)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

/* ── Reputasi & tag nomor ────────────────────────────────────────── */
function renderReputation(rep) {
  const card = $('#reputationCard');
  if (!rep) return card.hidden = true;
  card.hidden = false;

  const out = $('#reputationOut');
  if (!rep.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(rep.error)}</div>`);
  }

  const cls = rep.verdict === 'high_risk' ? 'bad' : rep.verdict === 'some_risk' ? 'warn' : 'ok';
  const sfs = rep.stopForumSpam || {};

  out.innerHTML = `
    <div class="callout ${cls}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">
        <strong>Skor indikasi spam: ${rep.score}/100</strong>
        <span class="badge badge-${cls === 'ok' ? 'ok' : cls === 'warn' ? 'warn' : 'bad'}">${esc(rep.verdict)}</span>
      </div>
      <div class="meter ${cls}"><i style="width:${rep.score}%"></i></div>
      <div>${esc(rep.verdictLabel || '')}</div>
    </div>

    ${rep.tags?.length ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">Tag &amp; Sinyal</h3>
      <div class="items mt">
        ${rep.tags.map((t) => `
          <div class="item">
            <div class="item-main">
              <div class="item-title">${esc(t.tag)}</div>
              <div class="item-note">sumber: ${esc(t.source)}</div>
            </div>
          </div>`).join('')}
      </div>` : '<div class="callout ok mt">Tidak ada pola nomor yang mencurigakan.</div>'}

    ${sfs.checked ? `
      <dl class="kv mt">
        <dt>StopForumSpam</dt><dd>${sfs.appears ? `<span class="badge badge-bad">Dilaporkan spam</span> ${sfs.frequency}x` : '<span class="badge badge-ok">Tidak dilaporkan</span>'}
          ${sfs.confidence != null ? `&middot; confidence ${sfs.confidence}%` : ''}</dd>
      </dl>` : ''}

    <div class="callout info mt">
      <strong>Kenapa tidak ada "nama kontak"?</strong><br>
      ${esc(rep.note)}
    </div>`;
}

/* ── Info nomor & lokasi pendaftaran ───────────────────────────────── */
/**
 * @param {object} pi   hasil /api/phone-info
 * @param {Element} [mount] - elemen tujuan. Kalau diisi, fungsi ini hanya
 *        menulis ke elemen itu tanpa menyentuh kartu hasil investigasi.
 */
function renderPhoneInfo(pi, mount) {
  const out = mount || $('#phoneInfoOut');
  if (!mount) {
    const card = $('#phoneInfoCard');
    if (!pi) return card.hidden = true;
    card.hidden = false;
  }
  if (!pi) return void (out.innerHTML = '<div class="callout">Modul info nomor tidak dijalankan.</div>');

  if (!pi.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(pi.error)}</div>`);
  }

  const v = pi.validity || {};
  const loc = pi.location || {};
  const nv = pi.numverify || {};

  const nvBlock = nv.checked ? `
    <dl class="kv mt">
      <dt>Operator (Numverify)</dt><dd>${esc(nv.carrier || '-')}</dd>
      <dt>Tipe baris</dt><dd>${esc(nv.lineType || '-')}</dd>
      <dt>Negara</dt><dd>${esc(nv.countryName || '-')}</dd>
      <dt>Lokasi</dt><dd>${esc(nv.location || '-')}</dd>
      <dt>Porting</dt><dd>${nv.ported === null || nv.ported === undefined ? '-' : (nv.ported ? 'sudah di-porting' : 'belum di-porting')}</dd>
    </dl>`
    : `<div class="item-note mt">Numverify: ${esc(nv.note || 'tidak dikonfigurasi')}</div>`;

  out.innerHTML = `
    <div class="cards">
      ${stat(pi.country || '-', 'Negara', 'info')}
      ${stat(pi.operator || '-', 'Operator')}
      ${stat(pi.lineType || '-', 'Tipe baris')}
      ${stat(loc.localTime || '-', 'Waktu lokal di area', 'ok')}
    </div>

    <dl class="kv mt">
      <dt>E.164</dt><dd>${esc(pi.number)}</dd>
      <dt>Format lokal</dt><dd>${esc(pi.display)}</dd>
      <dt>Kode negara</dt><dd>${esc(pi.countryCode)} &middot; ${esc(pi.countryIso || '')}</dd>
      <dt>Operator (prefix)</dt><dd>${pi.operator ? esc(pi.operator) : '<span class="muted">tidak dikenali dari prefix</span>'}</dd>
      <dt>Tipe baris</dt><dd>${esc(pi.lineType)}</dd>
      <dt>Panjang NSN</dt><dd>${esc(v.length)} (rentang negara: ${esc((v.expectedLength || []).join('-'))})</dd>
      <dt>Kemungkinan valid</dt><dd>${v.possible ? '<span class="badge badge-ok">POSSIBLE</span>' : '<span class="badge badge-bad">TIDAK</span>'}</dd>
      <dt>Pola awalan</dt><dd>${v.valid ? '<span class="badge badge-ok">VALID</span>' : '<span class="badge badge-muted">TIDAK DIKENALI</span>'}</dd>
      ${pi.city ? `<dt>Area pendaftaran</dt><dd>${esc(pi.city)}${pi.region ? ', ' + esc(pi.region) : ''}
        ${pi.areaCode ? `<span class="badge badge-info">kode area ${esc(pi.areaCode)}</span>` : ''}
        ${pi.coordinates ? `<br><span class="muted mono">${esc(pi.coordinates.lat)}, ${esc(pi.coordinates.lon)} &middot; ${esc(pi.coordinates.accuracy)}</span>` : ''}</dd>` : ''}
      <dt>Zona waktu</dt><dd>${esc(loc.timezone || '-')} ${loc.utcOffset != null ? `<span class="badge badge-muted">UTC${loc.utcOffset >= 0 ? '+' : ''}${esc(loc.utcOffset)}</span>` : ''}
        <br><span class="muted">${esc(loc.localTime || '-')}</span>
        <br><span class="muted">keyakinan: ${esc(loc.confidence || '-')}</span></dd>
    </dl>

    ${nvBlock}

    <div class="callout warn mt">
      <strong>Ini area/zona waktu PENDAFTARAN, bukan lokasi device.</strong><br>
      ${esc(loc.accuracy || '')}
      <br><br>${esc(pi.note || '')}
    </div>`;
}

/* ── Nama & tag kontak ─────────────────────────────────────────── */
const CONF_META = {
  high:   ['badge-ok', 'TINGGI'],
  medium: ['badge-warn', 'SEDANG'],
  low:    ['badge-muted', 'RENDAH'],
};

const KIND_LABEL = {
  role: 'peran', category: 'bidang usaha', risk: 'indikasi negatif', name: 'nama',
};

function evidenceList(e) {
  if (!e?.length) return '';
  return e.map((x) => `
    <div class="item-note">
      &bull; ${x.site ? esc(x.site) + ' &mdash; ' : ''}<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title || x.url)}</a>
      ${x.snippet ? `<br>${esc(x.snippet)}` : ''}
    </div>`).join('');
}

function renderContacts(c, mount) {
  const out = mount || $('#contactsOut');
  if (!mount) {
    const card = $('#contactsCard');
    if (!c) return card.hidden = true;
    card.hidden = false;
  }
  if (!c) return void (out.innerHTML = '<div class="callout">Modul nama &amp; tag kontak tidak dijalankan.</div>');

  if (!c.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(c.error)}</div>`);
  }

  const s = c.summary || {};
  const riskCls = { none: 'ok', low: 'warn', elevated: 'bad' }[s.riskLevel] || 'warn';
  const tg = c.telegram || {};

  const tagBlock = (t) => {
    const [cls, conf] = CONF_META[t.confidence] || CONF_META.low;
    return `
      <div class="item ${t.kind === 'risk' ? 'error' : 'found'}">
        <div class="item-main">
          <div class="item-title">${esc(t.label)}
            <span class="badge badge-muted">${esc(KIND_LABEL[t.kind] || t.kind)}</span></div>
          <div class="item-note">muncul di ${t.siteCount} situs berbeda &middot; ${t.occurrences} kemunculan</div>
          ${evidenceList(t.evidence)}
        </div>
        <div class="item-side"><span class="badge ${cls}">${conf}</span></div>
      </div>`;
  };

  const nameBlock = (n) => {
    const [cls, conf] = CONF_META[n.confidence] || CONF_META.low;
    return `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${esc(n.label)}</div>
          <div class="item-note">ditemukan di ${n.siteCount} situs &middot; ${n.occurrences} kemunculan</div>
          ${evidenceList(n.evidence)}
        </div>
        <div class="item-side"><span class="badge ${cls}">${conf}</span></div>
      </div>`;
  };

  out.innerHTML = `
    <div class="cards">
      ${stat(s.namesFound ?? 0, 'Nama ditemukan', 'info')}
      ${stat(s.tagsFound ?? 0, 'Tag ditemukan', 'info')}
      ${stat(s.sitesMentioning ?? 0, 'Situs menyebut nomor')}
      ${stat(s.mentions ?? 0, 'Total jejak')}
    </div>

    <div class="callout ${riskCls} mt">
      <strong>Level indikasi risiko: ${esc(s.riskLevel || 'tidak diketahui')}</strong><br>
      Dihitung dari tag berkategori negatif (penipuan, spam, blacklist) yang muncul
      di halaman publik. Indikator, bukan vonis.
    </div>

    ${c.warning ? `<div class="callout warn mt">&#9888; ${esc(c.warning)}</div>` : ''}

    ${c.sources?.length ? `
      <div class="callout info mt">
        <strong>Status sumber:</strong>
        ${c.sources.map((x) => `${esc(x.name)} <span class="badge ${x.ok ? 'badge-ok' : 'badge-bad'}">${x.ok ? x.count + ' hasil' : 'gagal'}</span>`).join(' &middot; ')}
      </div>` : ''}

    <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
      Tag Paling Sering Dipakai</h3>
    ${c.topTags?.length ? `<div class="items mt">${c.topTags.map(tagBlock).join('')}</div>`
      : '<div class="callout mt">Tidak ada tag yang bisa diambil dari jejak publik nomor ini.</div>'}

    <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
      Nama yang Dipakai Orang Lain</h3>
    ${c.topNames?.length ? `<div class="items mt">${c.topNames.map(nameBlock).join('')}</div>`
      : '<div class="callout mt">Tidak ada nama pemanggil yang bisa diambil dari jejak publik.</div>'}

    ${c.riskTags?.length ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-red);text-transform:uppercase;">
        Tag Berisiko</h3>
      <div class="items mt">${c.riskTags.map(tagBlock).join('')}</div>` : ''}

    ${tg.available ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-cyan);text-transform:uppercase;">
        Nama Tampilan Telegram</h3>
      <div class="callout ${tg.registered ? 'info' : 'warn'} mt">
        ${tg.registered
          ? `<strong>${esc(tg.displayName)}</strong>${tg.bio ? ' &mdash; ' + esc(tg.bio) : ''}`
          : esc(tg.note || 'Nomor kemungkinan tidak terdaftar di Telegram.')}
        <br><a href="${esc(tg.url)}" target="_blank" rel="noopener noreferrer">${esc(tg.url)}</a>
      </div>` : ''}

    ${c.manualCheck?.length ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
        Verifikasi Manual (tag crowdsourced)</h3>
      <div class="chips mt">
        ${c.manualCheck.map((m) => `<a class="chip" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.name)}</a>`).join('')}
      </div>` : ''}

    <div class="callout info mt">
      <strong>Kenapa tidak ada "nama kontak" sejati?</strong><br>
      ${esc(c.note || '')}
      <br><br><span class="muted">${esc(c.limitation || '')}</span>
    </div>`;
}

/* ── Sebaran publik ───────────────────────────────────────────── */
function renderMentions(m, mount) {
  const out = mount || $('#mentionsOut');
  if (!mount) {
    const card = $('#mentionsCard');
    if (!m) return card.hidden = true;
    card.hidden = false;
  }
  if (!m) return void (out.innerHTML = '<div class="callout">Modul sebaran publik tidak dijalankan.</div>');

  if (!m.ok && !m.mentions?.length) {
    return void (out.innerHTML = `<div class="callout warn">${esc(m.error || 'Tidak ada jejak publik yang ditemukan.')}</div>`);
  }

  out.innerHTML = `
    <div class="cards">
      ${stat(m.count ?? 0, 'Jejak ditemukan', 'info')}
      ${stat(m.sites?.length ?? 0, 'Situs berbeda')}
      ${stat(m.mentions?.length ?? 0, 'Ditampilkan')}
    </div>

    ${m.sources?.length ? `
      <div class="callout info mt">
        <strong>Status sumber:</strong>
        ${m.sources.map((s) => `${esc(s.name)} <span class="badge ${s.ok ? 'badge-ok' : 'badge-bad'}">${s.ok ? s.count + ' hasil' : 'gagal'}</span>`).join(' &middot; ')}
      </div>` : ''}

    ${m.mentions?.length ? `<div class="items mt">
      ${m.mentions.map((x) => `
        <div class="item ${x.kind === 'news' ? 'blocked' : 'found'}">
          <div class="item-main">
            <div class="item-title">${esc(x.title || '(tanpa judul)')}</div>
            ${x.url ? `<div class="item-url"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a></div>` : ''}
            ${x.snippet ? `<div class="item-note">${esc(x.snippet)}</div>` : ''}
            ${x.publishedAt ? `<div class="item-note">${esc(new Date(x.publishedAt).toLocaleDateString('id-ID'))}</div>` : ''}
          </div>
          <div class="item-side">
            <span class="badge badge-info">${esc(x.source || x.kind || '')}</span>
            ${x.site ? `<span class="muted mono" style="font-size:9.5px;">${esc(x.site)}</span>` : ''}
          </div>
        </div>`).join('')}
    </div>` : '<div class="callout mt">Tidak ada posting publik yang menyebut nomor ini.</div>'}

    ${m.manualCheck?.length ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
        Cek Manual</h3>
      <div class="chips mt">
        ${m.manualCheck.map((x) => `<a class="chip" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>`).join('')}
      </div>` : ''}

    <div class="callout info mt">${esc(m.note || '')}</div>`;
}

/* ── Kelemahan website ─────────────────────────────────────────── */
function renderWebsec(w) {
  const card = $('#websecCard');
  if (!w) return card.hidden = true;
  card.hidden = false;

  const out = $('#websecOut');
  if (!w.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(w.error)}</div>`);
  }

  const tls = w.tls || {};
  const secTxt = w.securityTxt || {};
  const paths = w.paths || {};
  const score = w.overallScore ?? 0;
  const cls = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'bad';

  out.innerHTML = `
    <div class="callout ${cls}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">
        <strong>Postur keamanan: ${score}/100</strong>
        <span class="badge badge-${cls === 'ok' ? 'ok' : cls === 'warn' ? 'warn' : 'bad'}">${esc(w.host || '')}</span>
      </div>
      <div class="meter ${cls}"><i style="width:${score}%"></i></div>
    </div>

    ${tls.ok ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-cyan);text-transform:uppercase;">Sertifikat TLS</h3>
      <dl class="kv mt">
        <dt>Terdaftar</dt><dd>${tls.authorized ? '<span class="badge badge-ok">YA</span>' : `<span class="badge badge-bad">TIDAK</span> ${esc(tls.authorizationError || '')}`}</dd>
        <dt>Protokol</dt><dd>${esc(tls.protocol || '-')}</dd>
        <dt>Issuer</dt><dd>${esc(tls.issuer?.O || tls.issuer?.CN || '-')}</dd>
        <dt>Berlaku</dt><dd>${esc(tls.validFrom || '-')} s/d ${esc(tls.validTo || '-')}</dd>
        <dt>Sisa</dt><dd>${tls.daysRemaining != null ? `${tls.daysRemaining} hari` : '-'}</dd>
        <dt>SAN</dt><dd>${esc((tls.subjectAltNames || []).slice(0, 5).join(', ') || '-')}</dd>
      </dl>
      ${tls.findings?.length ? `<div class="items mt">${tls.findings.map((f) => `
        <div class="item ${f.severity === 'critical' || f.severity === 'high' ? 'error' : 'blocked'}">
          <div class="item-main">
            <div class="item-title">${esc(f.title)}</div>
            <div class="item-note">${esc(f.detail)}</div>
          </div>
          <div class="item-side"><span class="badge badge-${f.severity === 'critical' || f.severity === 'high' ? 'bad' : 'warn'}">${esc(f.severity)}</span></div>
        </div>`).join('')}</div>` : '<div class="callout ok mt">Tidak ada temuan pada sertifikat.</div>'}` : ''}

    ${secTxt.found !== undefined ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">security.txt (RFC 9116)</h3>
      <div class="callout ${secTxt.found ? 'ok' : 'warn'} mt">
        ${secTxt.found
          ? `Ditemukan &mdash; kontak: ${esc(secTxt.contact || '-')}${secTxt.expires ? ` &middot; berlaku s/d ${esc(secTxt.expires)}` : ''}`
          : esc(secTxt.note || 'Tidak ditemukan.')}
      </div>` : ''}

    ${paths.checked ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">Path Sensitif</h3>
      <div class="cards mt">
        ${stat(paths.summary.exposed, 'Terbuka', paths.summary.exposed ? 'bad' : 'ok')}
        ${stat(paths.summary.protected, 'Dilindungi', 'ok')}
        ${stat(paths.summary.notFound, 'Tidak ada')}
        ${stat(paths.summary.soft404, 'Soft-404', 'warn')}
      </div>
      ${paths.exposed?.length ? `<div class="items mt">${paths.exposed.map((e) => `
        <div class="item error">
          <div class="item-main">
            <div class="item-title">${esc(e.path)} <span class="badge badge-bad">${esc(e.severity)}</span></div>
            <div class="item-note">${esc(e.why)} &mdash; ${esc(e.detail || '')}</div>
          </div>
          <div class="item-side"><span class="muted mono" style="font-size:9.5px;">HTTP ${esc(e.status)}</span></div>
        </div>`).join('')}</div>` : ''}
      ${paths.caveat ? `<div class="callout warn mt">${esc(paths.caveat)}</div>` : ''}` : ''}`;
}

/* ── Intelijen ancaman ─────────────────────────────────────────── */
function renderThreat(t) {
  const card = $('#threatCard');
  if (!t) return card.hidden = true;
  card.hidden = false;

  const out = $('#threatOut');
  if (!t.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(t.error)}</div>`);
  }

  if (t.chain) {
    const isBtc = t.chain === 'BTC';
    return void (out.innerHTML = `
      <div class="callout info">
        <strong>${esc(t.chain)}</strong> &middot; ${esc(t.address || '')}
      </div>
      <dl class="kv mt">
        ${isBtc ? `
          <dt>Saldo</dt><dd>${esc(t.balanceBTC || 0)} BTC</dd>
          <dt>Transaksi</dt><dd>${(t.txCount || 0).toLocaleString('id-ID')}</dd>
          <dt>UTXO aktif</dt><dd>${t.utxoCount || 0}</dd>
          ${t.firstSeen ? `<dt>Pertama</dt><dd>${esc(String(t.firstSeen).slice(0, 10))}</dd>` : ''}
          ${t.lastSeen ? `<dt>Terakhir</dt><dd>${esc(String(t.lastSeen).slice(0, 10))}</dd>` : ''}
        ` : `
          <dt>Saldo</dt><dd>${esc(t.balanceETH || 0)} ETH</dd>
          ${t.name ? `<dt>Label</dt><dd>${esc(t.name)}</dd>` : ''}
          <dt>Kontrak</dt><dd>${t.isContract ? 'YA' : 'tidak'}${t.isVerified ? ' <span class="badge badge-ok">verified</span>' : ''}</dd>
        `}
        <dt>Sumber</dt><dd>${esc(t.source || '-')}</dd>
      </dl>
      ${t.note ? `<div class="callout warn mt">${esc(t.note)}</div>` : ''}`);
  }

  if (t.cves) {
    return void (out.innerHTML = `
      <div class="callout info">${t.count} CVE untuk &ldquo;${esc(t.keyword || '')}&rdquo;${t.totalResults ? ` dari ${t.totalResults.toLocaleString('id-ID')} total` : ''}</div>
      <div class="items mt">
        ${t.cves.map((c) => `
          <div class="item ${['CRITICAL','HIGH'].includes(c.severity) ? 'error' : 'blocked'}">
            <div class="item-main">
              <div class="item-title">${esc(c.id)}
                <span class="badge badge-${['CRITICAL','HIGH'].includes(c.severity) ? 'bad' : c.severity === 'MEDIUM' ? 'warn' : 'muted'}">${esc(c.severity)}</span>
                ${c.cvssScore != null ? `<span class="muted mono">CVSS ${c.cvssScore}</span>` : ''}</div>
              <div class="item-note">${esc(c.summary)}</div>
            </div>
          </div>`).join('')}
      </div>
      ${t.note ? `<div class="callout warn mt">${esc(t.note)}</div>` : ''}`);
  }

  out.innerHTML = '<div class="callout">Data tidak dalam format yang dikenal.</div>';
}

/* ── Media sosial ──────────────────────────────────────────── */
let socialFilter = 'found';

function renderSocial(s) {
  const card = $('#socialCard');
  if (!s) return card.hidden = true;
  card.hidden = false;

  const out = $('#socialOut');
  const meta = $('#socialMeta');

  if (!s.ok) {
    meta.textContent = '';
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(s.error)}</div>`);
  }

  meta.textContent = `@${s.username} — diperiksa di ${s.totalChecked} platform.`;

  const counts = { found: s.found.length, blocked: s.blocked.length, all: s.results.length };
  const items = s.results.filter((x) =>
    socialFilter === 'found' ? x.status === 'found'
    : socialFilter === 'blocked' ? x.status === 'blocked'
    : true
  );

  out.innerHTML = `
    <div class="tabs">
      <button class="tab ${socialFilter === 'found' ? 'active' : ''}" data-f="found">Ditemukan (${counts.found})</button>
      <button class="tab ${socialFilter === 'blocked' ? 'active' : ''}" data-f="blocked"> Diblokir (${counts.blocked})</button>
      <button class="tab ${socialFilter === 'all' ? 'active' : ''}" data-f="all">Semua (${counts.all})</button>
    </div>
    <div class="items">
      ${items.length ? items.map(itemRow).join('') : '<div class="callout">Tidak ada entri pada kategori ini.</div>'}
    </div>`;

  $$('#socialOut .tab').forEach((t) =>
    t.addEventListener('click', () => { socialFilter = t.dataset.f; renderSocial(s); })
  );
}

const STATUS_META = {
  found:     ['badge-ok', 'ADA'],
  blocked:   ['badge-warn', 'DIBLOKIR'],
  not_found: ['badge-muted', 'TIDAK ADA'],
  error:     ['badge-bad', 'ERROR'],
};

function itemRow(x) {
  const [cls, label] = STATUS_META[x.status] || ['badge-muted', String(x.status)];
  const extra = x.extra || {};
  const extraText = Object.entries(extra)
    .filter(([k]) => k !== 'pageTitle')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
  const title = extra.pageTitle
    ? ` <span class="muted" style="font-weight:400;">— ${esc(extra.pageTitle)}</span>` : '';
  return `
    <div class="item ${x.status}">
      <div class="item-main">
        <div class="item-title">${esc(x.platform)}${title}</div>
        <div class="item-url"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a></div>
        ${extraText ? `<div class="item-note">${esc(extraText)}</div>` : ''}
        ${x.note ? `<div class="item-note">${esc(x.note)}</div>` : ''}
      </div>
      <div class="item-side">
        <span class="badge ${cls}">${label}</span>
        <span class="muted mono" style="font-size:9.5px;">${x.ms}ms</span>
      </div>
    </div>`;
}

/* ── Domain ────────────────────────────────────────────────── */
function renderDomain(d) {
  const card = $('#domainCard');
  if (!d) return card.hidden = true;
  card.hidden = false;

  $('#domainMeta').textContent = `Target: ${d.domain}`;
  const out = $('#domainOut');

  const dnsRows = (d.dns?.records || [])
    .filter((r) => r.answers?.length)
    .map((r) => `
      <div class="item">
        <div class="item-main">
          <div class="item-title">
            <span class="badge badge-info">${esc(r.type)}</span>${esc(r.label)}
          </div>
          <div class="item-note mono">${r.answers.slice(0, 6).map((a) => esc(a.data)).join('<br>')}</div>
        </div>
        <div class="item-side"><span class="muted mono" style="font-size:9.5px;">${r.ms}ms</span></div>
      </div>`).join('');

  const w = d.whois;
  const whoisBlock = w?.ok ? `
    <dl class="kv">
      ${w.registrar ? `<dt>Registrar</dt><dd>${esc(w.registrar.name)}</dd>` : ''}
      ${w.registrar?.email ? `<dt>Email</dt><dd><a href="mailto:${esc(w.registrar.email)}">${esc(w.registrar.email)}</a></dd>` : ''}
      <dt>Didaftarkan</dt><dd>${esc(w.events?.created?.slice(0, 10) || '-')}</dd>
      <dt>Diperbarui</dt><dd>${esc(w.events?.updated?.slice(0, 10) || '-')}</dd>
      <dt>Kedaluwarsa</dt><dd>${esc(w.events?.expires?.slice(0, 10) || '-')}</dd>
      <dt>Nameserver</dt><dd>${esc((w.nameservers || []).join(', ') || '-')}</dd>
      <dt>Sumber</dt><dd>${esc(w.source || 'RDAP')}</dd>
    </dl>`
    : `<div class="callout bad">&#10005; WHOIS: ${esc(w?.error || 'tidak tersedia')}</div>`;

  const sub = d.subdomains;
  const subBlock = sub ? `
    <div class="callout ${sub.count ? 'ok' : 'warn'}">
      <strong>${sub.count} subdomain</strong> dari Certificate Transparency log.
      <span class="mono" style="font-size:10.5px;">(${sub.sources.map((s) => `${esc(s.name)}: ${s.ok ? 'OK' : 'gagal'}`).join(', ')})</span>
    </div>
    ${sub.subdomains?.length ? `
      <div class="chips mt">
        ${sub.subdomains.map((s) => `<a class="chip" href="https://${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(s)}</a>`).join('')}
      </div>` : ''}
    ${sub.note ? `<div class="item-note mt">${esc(sub.note)}</div>` : ''}`
    : '';

  const http = d.http;
  const sec = http?.security;
  const secCls = sec ? (sec.score >= 70 ? 'ok' : sec.score >= 40 ? 'warn' : 'bad') : 'warn';
  const httpBlock = http ? `
    <div class="callout ${secCls}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">
        <strong>Skor header keamanan: ${sec.score}/100</strong>
        <span class="badge ${secCls === 'ok' ? 'badge-ok' : secCls === 'warn' ? 'badge-warn' : 'badge-bad'}">Grade ${esc(sec.grade)}</span>
      </div>
      <div class="meter ${secCls}"><i style="width:${sec.score}%"></i></div>
      <div class="mono" style="font-size:10.5px;">
        ${sec.present.length ? `Ada: ${sec.present.map((x) => esc(x.label)).join(', ')}` : ''}
        ${sec.missing.length ? `<br>Tidak ada: ${sec.missing.map((x) => esc(x.label)).join(', ')}` : ''}
      </div>
    </div>
    <dl class="kv mt">
      <dt>Status HTTP</dt><dd>${esc(http.status)}</dd>
      <dt>Server</dt><dd>${esc(http.server || '-')}</dd>
      <dt>Powered By</dt><dd>${esc(http.poweredBy || '-')}</dd>
      <dt>Waktu</dt><dd>${esc(http.elapsedMs)} ms</dd>
      <dt>Cookie</dt><dd>${sec.cookieCount} total, ${sec.cookiesMissingSecurity} tanpa Secure/HttpOnly</dd>
    </dl>
    <div class="item-note mt">${esc(http.note)}</div>`
    : '';

  out.innerHTML = `
    <h3 class="mono" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-green);text-transform:uppercase;">DNS Records</h3>
    <div class="items mt">${dnsRows || '<div class="callout">Tidak ada record DNS.</div>'}</div>

    <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-green);text-transform:uppercase;">WHOIS / RDAP</h3>
    <div class="mt">${whoisBlock}</div>

    <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">Subdomain &mdash; Certificate Transparency</h3>
    <div class="mt">${subBlock}</div>

    ${http ? `
    <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-cyan);text-transform:uppercase;">HTTP Headers</h3>
    <div class="mt">${httpBlock}</div>` : ''}`;
}

/* ── Jaringan / IP ─────────────────────────────────────────── */
function renderNetwork(n) {
  const card = $('#networkCard');
  if (!n) return card.hidden = true;
  card.hidden = false;

  const out = $('#networkOut');
  if (!n.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(n.error)}</div>`);
  }

  const g = n.geolocation || {};
  const net = n.network || {};
  const fl = n.flags || {};

  out.innerHTML = `
    <div class="cards">
      ${stat(net.asn || '-', 'ASN', 'info')}
      ${stat(g.city || '-', 'Kota')}
      ${stat(g.countryCode || '-', 'Negara')}
      ${stat(net.reverseDns ? 'ADA' : '-', 'Reverse DNS', net.reverseDns ? 'ok' : '')}
    </div>
    <dl class="kv mt">
      <dt>Alamat IP</dt><dd>${esc(n.ip)} <span class="badge badge-muted">IPv${esc(n.version)}</span></dd>
      <dt>ISP</dt><dd>${esc(net.isp || '-')}</dd>
      <dt>Organisasi</dt><dd>${esc(net.org || '-')}</dd>
      <dt>ASN</dt><dd>${esc(net.asn || '-')} ${net.asName ? `<span class="muted">(${esc(net.asName)})</span>` : ''}</dd>
      <dt>Reverse DNS</dt><dd>${esc(net.reverseDns || '-')}</dd>
      <dt>Lokasi</dt><dd>${esc([g.city, g.region, g.country].filter(Boolean).join(', ') || '-')}</dd>
      <dt>Koordinat</dt><dd>${g.lat != null ? `${esc(g.lat)}, ${esc(g.lon)}` : '-'}</dd>
      <dt>Timezone</dt><dd>${esc(g.timezone || '-')}</dd>
      ${fl.available !== false ? `<dt>Flags</dt><dd>
        mobile: ${fl.mobile ? 'YA' : 'tidak'} &middot; proxy: ${fl.proxy ? 'YA' : 'tidak'} &middot; hosting: ${fl.hosting ? 'YA' : 'tidak'}
        ${fl.note ? `<br><span class="muted">${esc(fl.note)}</span>` : ''}</dd>` : ''}
      <dt>Sumber</dt><dd>${(n.sources || []).map((s) => `${esc(s.name)} <span class="badge ${s.ok ? 'badge-ok' : 'badge-bad'}">${s.ok ? 'OK' : 'X'}</span>`).join(' &middot; ')}</dd>
    </dl>
    <div class="item-note mt">${esc(n.note)}</div>`;
}

/* ── Lokasi ────────────────────────────────────────────────── */
function renderLocation(geo, inputLoc) {
  const card = $('#locationCard');
  if (!inputLoc) return card.hidden = true;
  card.hidden = false;

  const out = $('#locationOut');
  if (!geo)    return void (out.innerHTML = '<div class="callout">Modul lokasi tidak dijalankan.</div>');
  if (!geo.ok) return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(geo.error)}</div>`);

  out.innerHTML = `
    <div class="callout ok">${geo.count} lokasi untuk &ldquo;${esc(geo.query)}&rdquo; dari OpenStreetMap.</div>
    <div class="items mt">
      ${geo.places.map((p) => `
        <div class="item">
          <div class="item-main">
            <div class="item-title">${esc(p.name || '(tanpa nama)')}
              ${p.type ? `<span class="badge badge-info">${esc(p.type)}</span>` : ''}</div>
            <div class="item-note">${esc([p.street, p.city, p.state, p.country].filter(Boolean).join(' · '))}</div>
            <div class="item-url">${esc(p.lat)}, ${esc(p.lon)} · ${esc(p.source)}</div>
          </div>
          <div class="item-side">
            ${p.mapUrl ? `<a class="btn btn-sm" href="${esc(p.mapUrl)}" target="_blank" rel="noopener noreferrer">Peta</a>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

/* ── Kebocoran ─────────────────────────────────────────────── */
function renderBreach(b, inputEmail) {
  const card = $('#breachCard');
  if (!inputEmail) return card.hidden = true;
  card.hidden = false;

  const out = $('#breachOut');
  if (!b) return void (out.innerHTML = '<div class="callout">Modul kebocoran tidak dijalankan.</div>');

  if (b.unconfigured) {
    return void (out.innerHTML = `
      <div class="callout warn">
        <strong>Modul kebocoran belum dikonfigurasi.</strong><br>${esc(b.error)}
      </div>
      <div class="items mt">
        ${(b.alternatives || []).map((a) => `
          <div class="item">
            <div class="item-main">
              <div class="item-title">${esc(a.name)}</div>
              <div class="item-url"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.url)}</a></div>
              <div class="item-note">${esc(a.note)}</div>
            </div>
          </div>`).join('')}
      </div>`);
  }

  if (!b.ok) return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(b.error)}</div>`);

  if (!b.breached) {
    return void (out.innerHTML =
      `<div class="callout ok">&#10003; ${esc(b.email)} tidak ada di breach yang tercatat.</div>`);
  }

  out.innerHTML = `
    <div class="callout bad">
      <strong>${esc(b.email)}</strong> muncul di <strong>${b.breachCount}</strong> kebocoran &mdash;
      data sudah terekspos publik.
    </div>
    <div class="items mt">
      ${b.breaches.map((x) => `
        <div class="item danger">
          <div class="item-main">
            <div class="item-title">${esc(x.name)}
              <span class="badge badge-bad">${esc((x.pwnCount || 0).toLocaleString('id-ID'))} akun</span></div>
            <div class="item-note">Bocor: ${esc(x.date)} · Data: ${esc((x.dataClasses || []).join(', ') || '-')}</div>
            ${x.description ? `<div class="item-note">${esc(x.description)}</div>` : ''}
          </div>
          <div class="item-side">
            <a class="btn btn-sm" href="${esc(x.source)}" target="_blank" rel="noopener noreferrer">Detail</a>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ── Dork ──────────────────────────────────────────────────── */
function renderDorks(d) {
  const card = $('#dorksCard');
  if (!d || !d.dorks?.length) return card.hidden = true;
  card.hidden = false;

  $('#dorksOut').innerHTML = d.dorks.map((x) => `
    <div class="dork">
      <div class="dork-head">
        <span class="dork-label">${esc(x.label)}</span>
        <span class="dork-why">${esc(x.why)}</span>
      </div>
      <div class="dork-query">${esc(x.query)}</div>
      <div class="dork-links">
        <a href="${esc(x.googleUrl)}" target="_blank" rel="noopener noreferrer">Google</a>
        <a href="${esc(x.bingUrl)}" target="_blank" rel="noopener noreferrer">Bing</a>
        <a href="${esc(x.duckduckgoUrl)}" target="_blank" rel="noopener noreferrer">DuckDuckGo</a>
      </div>
    </div>`).join('');
}

/* ── Graph ─────────────────────────────────────────────────── */
function renderGraph(g) {
  const card = $('#graphCard');
  if (!g || !g.entities?.length) return card.hidden = true;
  card.hidden = false;

  const meta = $('#graphMeta');
  const out = $('#graphOut');
  meta.textContent = `${g.entities.length} entity · ${g.links.length} link — siap diimpor ke Maltego.`;

  out.innerHTML = `
    <div class="items">
      ${g.entities.map((e) => `
        <div class="item found">
          <div class="item-main">
            <div class="item-title"><span class="badge badge-info">${esc(e.type)}</span>${esc(e.value)}</div>
            ${e.properties?.length ? `<div class="item-note">${
              e.properties.map((p) => `${esc(p.name)}=${esc(p.value)}`).join(' · ')}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>
    ${g.links?.length ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
        Link Graph</h3>
      <pre>${esc(g.links.map((l) => `${l.from}  --[${l.label}]-->  ${l.to}`).join('\n'))}</pre>` : ''}
    <details class="opts"><summary>JSON Entity Lengkap</summary>
      <pre class="mt">${esc(JSON.stringify(g, null, 2))}</pre>
    </details>`;
}

/* ── Riwayat ───────────────────────────────────────────────── */
async function loadHistory() {
  const out = $('#historyOut');
  const h = await api('/api/history?limit=25');
  if (!Array.isArray(h) || !h.length) {
    return void (out.innerHTML = '<div class="callout">Belum ada riwayat.</div>');
  }
  out.innerHTML = h.map((r) => {
    const who = [r.input.name, r.input.username && '@' + r.input.username,
                 r.input.phone, r.input.domain, r.input.location].filter(Boolean).join(' · ');
    return `<div class="hist-row">
      <span>${esc(who || '(tanpa input)')}</span>
      <span class="t">${esc(new Date(r.at).toLocaleString('id-ID'))}</span>
    </div>`;
  }).join('');
}

/* ── Panel Cek Pos & Recon (alat mandiri, di luar laporan investigasi) ── */

const reconVal = (id) => ($(id)?.value || '').trim();

/** Render port scan. */
function renderPortScan(d, out) {
  if (!d?.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(d?.error || 'Target tidak valid.')}</div>`);
  }
  const s = d.summary || {};
  out.innerHTML = `
    <div class="cards">
      ${stat(d.openCount ?? 0, 'Port terbuka', d.openCount ? 'warn' : 'ok')}
      ${stat(s.closed ?? 0, 'Ditolak (closed)')}
      ${stat(s.filteredOrTimeout ?? 0, 'Timeout / filtered', 'warn')}
      ${stat(d.portsScanned ?? 0, 'Port diperiksa')}
    </div>
    ${d.open?.length ? `<div class="items mt">
      ${d.open.map((p) => `
        <div class="item found">
          <div class="item-main">
            <div class="item-title">Port ${esc(p.port)} ${p.service ? `<span class="badge badge-info">${esc(p.service)}</span>` : ''}</div>
            <div class="item-note">${esc(d.scannedAddress)} &middot; koneksi TCP connect berhasil</div>
          </div>
          <div class="item-side"><span class="badge badge-ok">TERBUKA</span></div>
        </div>`).join('')}
    </div>` : '<div class="callout ok mt">Tidak ada port terbuka di daftar yang diperiksa.</div>'}
    <div class="item-note mt">${esc(d.note || '')}</div>
    <div class="callout warn mt">${esc(d.ethics || '')}</div>`;
}

/** Render routing BGP. */
function renderBgp(d, out) {
  if (!d?.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(d?.error || 'IP tidak valid.')}</div>`);
  }
  out.innerHTML = `
    <dl class="kv">
      <dt>IP</dt><dd>${esc(d.ip)}</dd>
      <dt>Prefix</dt><dd>${esc(d.prefix || '-')}</dd>
      <dt>Blok</dt><dd>${esc(d.block?.name || d.block?.desc || '-')}</dd>
      <dt>Diumumkan</dt><dd>${d.announced === null ? '-' : (d.announced ? 'YA' : 'TIDAK')}</dd>
      <dt>AS pengumuman</dt><dd>${(d.asns || []).map((a) => `AS${esc(a.asn)}${a.holder ? ' (' + esc(a.holder) + ')' : ''}`).join(', ') || '-'}</dd>
      <dt>RPKI</dt><dd>${(d.rpki || []).map((r) => `AS${esc(r.asn)} ${esc(r.status || '-')}`).join(', ') || '-'}</dd>
      <dt>Sumber</dt><dd>${(d.sources || []).map((s) => `${esc(s.name)} <span class="badge ${s.ok ? 'badge-ok' : 'badge-bad'}">${s.ok ? 'OK' : 'X'}</span>`).join(' &middot; ')}</dd>
    </dl>
    <div class="item-note mt">${esc(d.note || '')}</div>`;
}

/** Render IP intel gabungan. */
function renderIpIntel(d, out) {
  if (!d?.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(d?.error || 'IP tidak valid.')}</div>`);
  }
  const p = d.profile || {};
  const g = p.geolocation || {};
  const n = p.network || {};
  out.innerHTML = `
    <dl class="kv">
      <dt>IP</dt><dd>${esc(d.ip)}</dd>
      <dt>Negara / Kota</dt><dd>${esc([g.country, g.city].filter(Boolean).join(' · ') || '-')}</dd>
      <dt>ISP</dt><dd>${esc(n.isp || '-')}</dd>
      <dt>ASN</dt><dd>${esc(n.asn || '-')} ${n.asName ? `<span class="muted">(${esc(n.asName)})</span>` : ''}</dd>
      <dt>Prefix BGP</dt><dd>${esc(d.bgp?.prefix || '-')}</dd>
      <dt>AS pengumuman</dt><dd>${(d.bgp?.asns || []).map((a) => `AS${esc(a.asn)}`).join(', ') || '-'}</dd>
    </dl>
    <div class="callout warn mt">${esc(d.note || '')}</div>`;
}

/** Render vendor MAC. */
function renderMacVendor(d, out) {
  if (!d?.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(d?.error || 'MAC tidak valid.')}</div>`);
  }
  out.innerHTML = `
    <dl class="kv">
      <dt>MAC</dt><dd>${esc(d.mac)}</dd>
      <dt>Vendor</dt><dd>${d.vendor ? esc(d.vendor) : '<span class="muted">tidak terdaftar</span>'}</dd>
    </dl>
    <div class="item-note mt">${esc(d.note || '')}</div>`;
}

/** Render hasil cek sanksi OFAC. */
function renderSanctions(d, out) {
  if (!d?.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(d?.error || 'Pencarian gagal.')}</div>`);
  }
  out.innerHTML = `
    <div class="callout ${d.count ? 'bad' : 'ok'}">
      <strong>${d.count} kecocokan</strong> untuk &ldquo;${esc(d.query)}&rdquo;
      <span class="muted"> &middot; dataset: ${esc(d.dataset)} (${(d.datasetEntries || 0).toLocaleString('id-ID')} entri)</span>
    </div>
    ${d.matches?.length ? `<div class="items mt">
      ${d.matches.map((m) => `
        <div class="item ${m.score >= 80 ? 'error' : 'blocked'}">
          <div class="item-main">
            <div class="item-title">${esc(m.name)}
              ${m.viaAlias ? '<span class="badge badge-info">cocok via alias</span>' : ''}</div>
            <div class="item-note">${esc(m.type || '-')} &middot; program: ${esc(m.program || '-')} &middot; skor ${m.score}</div>
            ${m.matchedName && m.matchedName !== m.name ? `<div class="item-note">nama yang cocok: ${esc(m.matchedName)}</div>` : ''}
            ${m.aliases?.length ? `<div class="item-note">alias: ${esc(m.aliases.join(', '))}</div>` : ''}
          </div>
          <div class="item-side"><span class="badge badge-muted">ID ${esc(m.id)}</span></div>
        </div>`).join('')}
    </div>` : '<div class="callout ok mt">Tidak ada kecocokan nama.</div>'}
    <div class="callout warn mt">${esc(d.note || '')}</div>`;
}

/**
 * Jalankan renderer ke elemen sementara lalu ambil HTML-nya.
 * Dipakai supaya renderer yang sama bisa dipakai untuk kartu laporan
 * maupun panel recon tanpa menyalin template.
 */
const htmlOf = (fn, data) => {
  const div = document.createElement('div');
  fn(data, div);
  return div.innerHTML;
};

/** Render bundel "cek pos". */
function renderCekPos(d, out) {
  if (!d?.ok) {
    return void (out.innerHTML = `<div class="callout bad">&#10005; ${esc(d?.error || 'Target tidak diisi.')}</div>`);
  }
  const s = d.summary || {};
  const p = d.parts || {};

  const part = (title, body) => `
    <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
      ${esc(title)}</h3>
    <div class="mt">${body}</div>`;

  const skipped = Object.entries(p)
    .filter(([, x]) => x?.skipped)
    .map(([k, x]) => `<li><b>${esc(k)}</b> &mdash; ${esc(x.reason)}</li>`)
    .join('');

  out.innerHTML = `
    <div class="cards">
      ${stat(s.mentions ?? 0, 'Jejak publik', 'info')}
      ${stat(s.sites ?? 0, 'Situs menyebut')}
      ${stat(s.tags ?? 0, 'Tag kontak', 'info')}
      ${stat(s.names ?? 0, 'Nama ditemukan', 'info')}
      ${stat(s.openPorts ?? 0, 'Port terbuka', s.openPorts ? 'warn' : 'ok')}
      ${stat(s.asn || '-', 'AS pengumuman', 'info')}
    </div>

    ${p.ports && !p.ports.skipped ? part('Port Scan', htmlOf(renderPortScan, p.ports)) : ''}
    ${p.bgp && !p.bgp.skipped ? part('Routing BGP', htmlOf(renderBgp, p.bgp)) : ''}
    ${p.ipIntel && !p.ipIntel.skipped ? part('IP Intel', htmlOf(renderIpIntel, p.ipIntel)) : ''}
    ${p.mac && !p.mac.skipped ? part('Vendor MAC', htmlOf(renderMacVendor, p.mac)) : ''}
    ${p.sanctions && !p.sanctions.skipped ? part('Sanksi OFAC', htmlOf(renderSanctions, p.sanctions)) : ''}
    ${p.mentions && !p.mentions.skipped ? part('Sebaran Publik', htmlOf(renderMentions, p.mentions)) : ''}
    ${p.contacts && !p.contacts.skipped ? part('Nama & Tag Kontak', htmlOf(renderContacts, p.contacts)) : ''}

    ${skipped ? `
      <h3 class="mono mt" style="font-size:11.5px;letter-spacing:1.4px;color:var(--neon-yellow);text-transform:uppercase;">
        Bagian yang Dilewati</h3>
      <div class="callout info mt"><ul style="margin:0;padding-left:20px;">${skipped}</ul></div>` : ''}

    <div class="callout warn mt">${esc(d.ethics || '')}</div>`;
}

/** Definisi tiap tombol panel recon. */
const RECON_TOOLS = {
  'cek-pos': {
    endpoint: '/api/cek-pos',
    build: () => ({
      phone: reconVal('#reconPhone'),
      target: reconVal('#reconTarget'),
      ports: reconVal('#reconPorts'),
      mac: reconVal('#reconMac'),
      name: reconVal('#reconName'),
    }),
    render: renderCekPos,
  },
  'mentions': {
    endpoint: '/api/mentions',
    build: () => ({ number: reconVal('#reconPhone') }),
    render: (d, out) => renderMentions(d, out),
  },
  'contacts': {
    endpoint: '/api/contact-names',
    build: () => ({ number: reconVal('#reconPhone') }),
    render: (d, out) => renderContacts(d, out),
  },
  'port-scan': {
    endpoint: '/api/port-scan',
    build: () => ({ target: reconVal('#reconTarget'), ports: reconVal('#reconPorts') }),
    render: renderPortScan,
  },
  'bgp': {
    endpoint: '/api/bgp',
    build: () => ({ ip: reconVal('#reconTarget') }),
    render: renderBgp,
  },
  'ip-intel': {
    endpoint: '/api/ip-intel',
    build: () => ({ ip: reconVal('#reconTarget') }),
    render: renderIpIntel,
  },
  'mac-vendor': {
    endpoint: '/api/mac-vendor',
    build: () => ({ mac: reconVal('#reconMac') }),
    render: renderMacVendor,
  },
  'sanctions-search': {
    endpoint: '/api/sanctions-search',
    build: () => ({ query: reconVal('#reconName') }),
    render: renderSanctions,
  },
};

$$('[data-recon]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const tool = RECON_TOOLS[btn.dataset.recon];
    if (!tool) return;

    const out = $('#reconOut');
    const spin = $('#reconSpinner');
    spin.hidden = false;
    out.innerHTML = '<div class="callout">Menjalankan…</div>';

    try {
      const data = await api(tool.endpoint, { method: 'POST', body: tool.build() });
      tool.render(data, out);
    } catch (err) {
      out.innerHTML = `<div class="callout bad">&#10005; ${esc(err.message)}</div>`;
    } finally {
      spin.hidden = true;
    }
  });
});

/* ── Ekspor ────────────────────────────────────────────────── */
const EXPORT_FILE = { csv: 'csv', json: 'json' };

$$('[data-export]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!lastReport) return;
    const format = btn.dataset.export;

    const res = await fetch(`/api/export/${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastReport.input),
    });
    const text = await res.text();

    if (EXPORT_FILE[format]) {
      download(text, `chameleon-console-${Date.now()}.${EXPORT_FILE[format]}`);
    } else {
      await navigator.clipboard.writeText(text);
      flash(btn, '&#10003; Tersalin');
    }
  });
});

function flash(btn, html) {
  const old = btn.innerHTML;
  btn.innerHTML = html;
  btn.disabled = true;
  setTimeout(() => { btn.innerHTML = old; btn.disabled = false; }, 1600);
}

$('#copyBtn').addEventListener('click', async () => {
  if (!lastReport) return;
  await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2));
  flash($('#copyBtn'), '&#10003; Tersalin');
});

function download(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ══════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════
let subject = {};
let importedSales = [];
let csvHeaders = [];
let csvRawRows = [];
let globalMonthlyRate = 0;
let subjectMarker = null;
let rankingMap = null;

const REQUIRED_FIELDS = ['sale_price','sale_date','gla'];
const FIELD_ALIASES = {
  sale_price: ['close price','sale price','sold price','sp','close','closed price','saleprice','soldprice','closeprice'],
  sale_date:  ['close date','sale date','sold date','closing date','saledate','closedate','solddate','closed date'],
  gla:        ['gla','above grade','sqft','sf','sq ft','sq. ft.','living area','heated sf','heated sqft','above grade sqft','above grade sf'],
  address:    ['address','street address','property address','full address','street','addr'],
  city:       ['city','municipality'],
  state:      ['state'],
  zip:        ['zip','zipcode','zip code','postal code'],
  site_sf:    ['lot size','site size','lot sf','lot sqft','lot area','site area','acres','lot acres'],
  year_built: ['year built','yearbuilt','yr built','year constructed','built','age','yob'],
  beds:       ['beds','bedrooms','bed','br','bdrms'],
  baths:      ['baths','bathrooms','full baths','full bath','bath'],
  half_baths: ['half baths','half bath','0.5 baths','partial baths'],
  quality:    ['quality','q rating','qual','quality rating','qrating','q'],
  condition:  ['condition','c rating','cond','condition rating','crating','c'],
  garage:     ['garage','garage spaces','garage count','garage type','park','parking'],
  basement:   ['basement','bsmt','basement type','finished basement','basement finish'],
  pool:       ['pool','private pool','pool y/n','swimming pool'],
  dom:        ['dom','days on market','cumulative dom','cdom'],
  list_price: ['list price','listing price','lp'],
  seller_concessions: ['seller concessions','seller concession','concessions','seller paid costs','seller paid closing costs','closing cost credit','seller credit','concession amount','seller assist','paid by seller'],
  concession_type: ['concession type','concession notes','financing concessions','closing costs paid','remarks concessions']
};

// ══════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════
function showPanel(id, el, event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const previousScroll = window.scrollY || document.documentElement.scrollTop || 0;
  const panel = document.getElementById(id);
  if (!panel) {
    console.warn('Missing panel:', id);
    if (typeof showCoach === 'function') showCoach('That section is not available yet.');
    return false;
  }
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ntab').forEach(t => t.classList.remove('active'));
  panel.classList.add('active');
  if (el) el.classList.add('active');
  updateWorkflowGuide(id);
  // Keep the left navigation from kicking the visitor back to the top of the page.
  requestAnimationFrame(() => window.scrollTo({ top: previousScroll, left: 0, behavior: 'auto' }));
  return false;
}

function updateWorkflowGuide(id) {
  const copy = {
    subject: ['Start with the subject property','Enter the subject details first. The rest of the suite uses this profile to analyze market conditions, rank comparables, support adjustments, and build professional valuation exhibits.'],
    import: ['Import the MLS data','Upload the MLS export, confirm the column mapping, and check that sale price, sale date, GLA, age/status, Q, and C fields are coming through correctly.'],
    qc: ['Calibrate Q/C before adjustments','Rate a small spectrum-based anchor sample, then let the suite suggest Q/C across the comp pool while flagging uncertain or conflicting evidence.'],
    'market-time': ['Support market conditions','Use raw monthly data, rolling 3-month smoothing, or quarterly grouping to reduce noise in thin markets while keeping the analysis explainable.'],
    gla: ['Extract GLA support','Use regression and/or paired sales to support a market-derived GLA rate, then document reliability and outliers.'],
    'site-value': ['Support site and land value','Analyze vacant land sales for agents and extract site value support for appraisers using comparable land sales, allocation, and abstraction methods.'],
    ranking: ['Rank comparable sales','Rank comps after property condition and market context are established so the professional can choose the most persuasive sales, not just the closest ones.'],
    concessions: ['Study seller concessions','Analyze whether seller credits, closing cost assistance, or financing concessions are influencing sale prices, net proceeds, and comparable sale interpretation.'],
    narrative: ['Build the report narrative','Narrative fields auto-fill from completed analyses but remain editable so appraisers, agents, or brokers can tailor final client/report language.'],
    adjustments: ['Complete the adjustment grid','Review comp-by-comp adjustments, net/gross indicators, and reconciled value support for the work file.'],
    quality: ['Review data quality','Check missing fields, thin periods, unusual outliers, suspicious Q/C patterns, and items requiring professional review.'],
    storage: ['Save the assignment work','Save locally, export the data package, or print the workfile PDF for assignment documentation.'],
    refs: ['Review methodology references','Use this page for methodology reminders and source language, but still verify final report citations against current guidance.']
  };
  const entry = copy[id] || copy.subject;
  const title = document.getElementById('workflow-title');
  const help = document.getElementById('workflow-help');
  if (title) title.textContent = entry[0];
  if (help) help.textContent = entry[1];
}

function showSub(btn, id, event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const card = btn.closest('.card');
  const panel = document.getElementById(id);
  if (!card || !panel) return false;
  card.querySelectorAll('.spanel').forEach(p => p.classList.remove('active'));
  card.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  panel.classList.add('active');
  btn.classList.add('active');
  return false;
}

// ══════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════
function fmt(n, dec = 0) {
  if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtD(n) {
  if (isNaN(n) || !isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '-';
  return s + '$' + fmt(Math.abs(n));
}
function fmtPct(n, d = 2) { return fmt(n, d) + '%'; }
function toNum(v) { if (v === null || v === undefined || v === '') return NaN; const n = parseFloat(String(v).replace(/[$,]/g, '')); return n; }
function dateToMonths(ds) {
  const d = new Date(ds);
  if (isNaN(d)) return NaN;
  return d.getFullYear() * 12 + d.getMonth();
}
function monthsBetween(d1, d2) { return Math.abs(dateToMonths(d1) - dateToMonths(d2)); }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ══════════════════════════════════════════════════
// SUBJECT
// ══════════════════════════════════════════════════
function saveSubject() {
  subject = {
    address: document.getElementById('s-addr').value.trim(),
    city: document.getElementById('s-city').value.trim(),
    county: document.getElementById('s-county').value.trim(),
    effdate: document.getElementById('s-effdate').value,
    gla: toNum(document.getElementById('s-gla').value),
    site: toNum(document.getElementById('s-site').value),
    year: toNum(document.getElementById('s-year').value),
    beds: toNum(document.getElementById('s-beds').value),
    baths: toNum(document.getElementById('s-baths').value),
    half: toNum(document.getElementById('s-half').value),
    garage: document.getElementById('s-garage').value,
    basement: document.getElementById('s-basement').value,
    pool: document.getElementById('s-pool').value,
    fp: toNum(document.getElementById('s-fp').value),
    qual: document.getElementById('s-qual').value,
    cond: document.getElementById('s-cond').value,
    value: toNum(document.getElementById('s-value').value),
    appraiser: document.getElementById('s-appraiser').value
  };
  document.getElementById('subject-saved').style.display = 'block';
  if (subject.address && subject.city) {
    geocodeSubject();
  } else {
    showSubjectSaved();
  }
}

function showSubjectSaved() {
  document.getElementById('subject-saved').style.display = 'block';
}

function clearSubject() {
  subject = {};
  ['s-addr','s-city','s-county','s-gla','s-site','s-year','s-beds','s-baths','s-half','s-fp','s-value','s-appraiser'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['s-qual','s-cond','s-garage','s-basement','s-pool'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.selectedIndex = 0;
  });
  document.getElementById('subject-saved').style.display = 'none';
  if (window._subjectMarker && window._subMap) { window._subMap.removeLayer(window._subjectMarker); window._subjectMarker = null; }
  const mapEl = document.getElementById('map'); if (mapEl) mapEl.style.display = 'none';
}


async function geocodeSubject() {
  const q = encodeURIComponent([subject.address, subject.city, subject.county].filter(Boolean).join(', '));
  const bar = document.getElementById('geo-loading');
  if (bar) { bar.textContent = 'Geocoding current subject address via OpenStreetMap Nominatim…'; bar.classList.add('show'); }
  // Always clear old coordinates before a new subject geocode so distance ranking cannot reuse an old property.
  delete subject.lat; delete subject.lon;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${q}&limit=1&_=${Date.now()}`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await r.json();
    if (data && data[0]) {
      subject.lat = parseFloat(data[0].lat);
      subject.lon = parseFloat(data[0].lon);
      initSubjectMap();
      if (typeof syncSubjectToModules === 'function') syncSubjectToModules();
    } else {
      const mapEl = document.getElementById('map');
      if (mapEl) mapEl.style.display = 'none';
      alert('No geocode result found for this subject. Try adding ZIP code or county to the City/State/ZIP field.');
    }
  } catch (e) {
    console.log('Geocode error:', e);
    alert('Geocoding failed. You can continue without distance ranking, or try again after checking the address.');
  }
  if (bar) bar.classList.remove('show');
}

function initSubjectMap() {
  if (!subject.lat || !subject.lon) return;
  const mapEl = document.getElementById('map');
  mapEl.style.display = 'block';
  const ll = [subject.lat, subject.lon];
  if (window._subMap) {
    window._subMap.setView(ll, 15);
    if (window._subjectMarker) window._subMap.removeLayer(window._subjectMarker);
  } else {
    window._subMap = L.map('map').setView(ll, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(window._subMap);
  }
  window._subjectMarker = L.marker(ll).addTo(window._subMap)
    .bindPopup(`<strong>Subject</strong><br>${subject.address || ''}<br>${subject.city || ''}`)
    .openPopup();
  setTimeout(() => window._subMap.invalidateSize(), 100);
}

// ══════════════════════════════════════════════════
// CSV IMPORT
// ══════════════════════════════════════════════════
const DROP = document.getElementById('drop-zone');
DROP.addEventListener('dragover', e => { e.preventDefault(); DROP.classList.add('drag'); });
DROP.addEventListener('dragleave', () => DROP.classList.remove('drag'));
DROP.addEventListener('drop', e => {
  e.preventDefault(); DROP.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) parseCSVFile(f);
});

function handleCSV(inp) { if (inp.files[0]) parseCSVFile(inp.files[0]); }

function parseCSVFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return;
    csvHeaders = parseCSVLine(lines[0]);
    csvRawRows = lines.slice(1).map(l => parseCSVLine(l)).filter(r => r.some(c => c.trim()));
    buildColumnMapper();
  };
  reader.readAsText(file);
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

function autoDetectMapping() {
  const mapping = {};
  csvHeaders.forEach((h, i) => {
    const hl = h.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (!mapping[field] && aliases.some(a => hl.includes(a) || a.includes(hl))) {
        mapping[field] = i;
      }
    }
  });
  return mapping;
}

function buildColumnMapper() {
  const mapping = autoDetectMapping();
  const fields = Object.keys(FIELD_ALIASES);
  let html = '';
  fields.forEach(f => {
    const lbl = f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const req = REQUIRED_FIELDS.includes(f) ? ' <span style="color:var(--red);font-size:11px;">required</span>' : '';
    let opts = '<option value="">— Not in CSV —</option>';
    csvHeaders.forEach((h, i) => {
      const sel = mapping[f] === i ? 'selected' : '';
      opts += `<option value="${i}" ${sel}>${h}</option>`;
    });
    html += `<div class="col-map-grid">
      <div class="col-map-label">${lbl}${req}</div>
      <div class="col-map-arrow">→</div>
      <div class="col-map-select"><select id="map-${f}">${opts}</select></div>
    </div>`;
  });
  document.getElementById('col-map-rows').innerHTML = html;
  document.getElementById('col-mapper').style.display = 'block';
}

function applyMapping() {
  const getCol = f => {
    const el = document.getElementById(`map-${f}`);
    return el && el.value !== '' ? parseInt(el.value) : null;
  };
  importedSales = csvRawRows.map((row, idx) => {
    const s = { _id: idx };
    Object.keys(FIELD_ALIASES).forEach(f => {
      const ci = getCol(f);
      s[f] = ci !== null ? row[ci] : '';
    });
    s.sale_price_n = toNum(s.sale_price);
    s.gla_n = toNum(s.gla);
    s.site_sf_n = toNum(s.site_sf);
    s.year_built_n = toNum(s.year_built);
    s.beds_n = toNum(s.beds);
    s.baths_n = toNum(s.baths);
    s.lat = null; s.lon = null;
    return s;
  }).filter(s => !isNaN(s.sale_price_n) && s.sale_price_n > 0);

  document.getElementById('col-mapper').style.display = 'none';
  renderImportSummary();
  updateBadge('badge-import', importedSales.length);
  updateBadge('badge-rank', importedSales.length);
}

function cancelImport() {
  document.getElementById('col-mapper').style.display = 'none';
  csvHeaders = []; csvRawRows = [];
}

function clearImport() {
  importedSales = [];
  document.getElementById('import-summary').style.display = 'none';
  document.getElementById('col-mapper').style.display = 'none';
  document.getElementById('csv-file').value = '';
  updateBadge('badge-import', 0);
  updateBadge('badge-rank', 0);
}

let importPage = 1;
const PAGE_SIZE = 15;

function renderImportSummary() {
  if (!importedSales.length) return;
  const prices = importedSales.map(s => s.sale_price_n).filter(p => !isNaN(p));
  const glas = importedSales.map(s => s.gla_n).filter(g => !isNaN(g));
  const med_price = median(prices);
  const med_gla = glas.length ? median(glas) : null;

  document.getElementById('import-stats').innerHTML = `
    <div class="schip"><div class="slbl">Total Sales</div><div class="sval">${importedSales.length}</div></div>
    <div class="schip"><div class="slbl">Median Price</div><div class="sval">$${fmt(med_price)}</div></div>
    <div class="schip"><div class="slbl">Price Range</div><div class="sval" style="font-size:14px;">$${fmt(Math.min(...prices))}–$${fmt(Math.max(...prices))}</div></div>
    ${med_gla ? `<div class="schip"><div class="slbl">Median GLA</div><div class="sval">${fmt(med_gla)} SF</div></div>` : ''}
  `;

  renderImportTable();
  document.getElementById('import-summary').style.display = 'block';
}

function renderImportTable() {
  const start = (importPage - 1) * PAGE_SIZE;
  const page = importedSales.slice(start, start + PAGE_SIZE);
  const cols = ['address','sale_price','sale_date','gla','site_sf','year_built','garage','basement','pool','quality','condition','seller_concessions'];
  const labels = ['Address','Sale Price','Sale Date','GLA (SF)','Site (SF)','Yr Built','Garage','Basement','Pool','Q','C','Concessions'];

  document.getElementById('import-thead').innerHTML = '<tr>' + labels.map(l => `<th>${l}</th>`).join('') + '</tr>';
  document.getElementById('import-tbody').innerHTML = page.map(s =>
    '<tr>' + cols.map(c => `<td>${s[c] || '—'}</td>`).join('') + '</tr>'
  ).join('');

  const totalPages = Math.ceil(importedSales.length / PAGE_SIZE);
  let pages = '';
  for (let i = 1; i <= totalPages; i++) {
    pages += `<button class="page-btn ${i===importPage?'active':''}" onclick="importPage=${i};renderImportTable()">${i}</button>`;
  }
  document.getElementById('import-pagination').innerHTML = pages;
}

function updateBadge(id, n) {
  const el = document.getElementById(id);
  el.textContent = n;
  n > 0 ? el.classList.add('show') : el.classList.remove('show');
}

async function geocodeAll() {
  if (!importedSales.length) {
    if (typeof showCoach === 'function') showCoach('Import MLS data or load the demo data before geocoding.');
    else alert('No data imported.');
    return false;
  }
  const bar = document.getElementById('geo-all-loading');
  if (bar) {
    bar.classList.add('show');
    bar.textContent = 'Starting address geocoding...';
  }
  let attempted = 0;
  let updated = 0;
  for (let i = 0; i < importedSales.length; i++) {
    const s = importedSales[i];
    if (s.lat && s.lon) { updated++; continue; }
    const addr = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ');
    if (!addr.trim()) continue;
    attempted++;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`;
      const r = await fetch(url);
      const d = await r.json();
      if (d && d[0]) {
        s.lat = parseFloat(d[0].lat);
        s.lon = parseFloat(d[0].lon);
        updated++;
      }
    } catch (e) {
      console.log('Geocode error:', e);
    }
    if (bar) bar.textContent = `Geocoding addresses... ${i + 1} / ${importedSales.length}`;
    await new Promise(res => setTimeout(res, 900));
  }
  if (bar) {
    bar.textContent = `Geocoding complete. ${updated} address(es) have coordinates.`;
    setTimeout(() => bar.classList.remove('show'), 2500);
  }
  if (typeof showCoach === 'function') {
    showCoach(updated ? `Geocoding complete: ${updated} address(es) mapped. Run Comp Ranking to refresh the map.` : 'No addresses were mapped. Check that each row has a full address, city, state, and ZIP.');
  } else {
    alert(updated ? 'Geocoding complete. Run Comp Ranking to see the map.' : 'No addresses were mapped. Check address fields.');
  }
  return false;
}

// ══════════════════════════════════════════════════
// COMP RANKING
// ══════════════════════════════════════════════════
const ratingNum = r => {
  if (!r) return null;
  const m = String(r).match(/(\d)/);
  return m ? parseInt(m[1]) : null;
};

function distanceMiles(lat1, lon1, lat2, lon2) {
  const vals = [lat1, lon1, lat2, lon2].map(Number);
  if (vals.some(v => isNaN(v) || !isFinite(v))) return null;
  const [aLat, aLon, bLat, bLon] = vals;
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceScore(miles) {
  if (miles === null) return null;
  if (miles <= 0.25) return 100;
  if (miles <= 0.5) return 95;
  if (miles <= 1) return 88;
  if (miles <= 2) return 75;
  if (miles <= 3) return 62;
  if (miles <= 5) return 45;
  if (miles <= 10) return 25;
  return 10;
}

function normalizeFeature(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
}
function garageCount(v) {
  const txt = normalizeFeature(v);
  if (!txt || txt === 'none' || txt === 'no') return 0;
  const m = txt.match(/(\d+(?:\.\d+)?)/);
  if (m) return parseFloat(m[1]);
  if (txt.includes('one')) return 1;
  if (txt.includes('two')) return 2;
  if (txt.includes('three')) return 3;
  if (txt.includes('carport')) return 1;
  return null;
}
function garageScore(subVal, compVal) {
  const s = garageCount(subVal), c = garageCount(compVal);
  if (s === null || c === null) return null;
  return Math.max(0, 100 - Math.abs(s - c) * 35);
}
function basementScore(subVal, compVal) {
  const s = normalizeFeature(subVal), c = normalizeFeature(compVal);
  if (!s || !c) return null;
  if (s === c) return 100;
  const sNone = s.includes('none') || s === 'no';
  const cNone = c.includes('none') || c === 'no';
  if (sNone || cNone) return sNone === cNone ? 100 : 35;
  const sFin = s.includes('finished'), cFin = c.includes('finished');
  const sFull = s.includes('full'), cFull = c.includes('full');
  let score = 65;
  if (sFin === cFin) score += 20;
  if (sFull === cFull) score += 10;
  return Math.min(95, score);
}
function poolScore(subVal, compVal) {
  const truthy = v => ['yes','y','true','1','pool','in ground','inground'].some(t => normalizeFeature(v).includes(t));
  const falsy = v => ['no','n','false','0','none'].some(t => normalizeFeature(v).includes(t));
  if (!subVal && !compVal) return null;
  const sKnown = truthy(subVal) || falsy(subVal), cKnown = truthy(compVal) || falsy(compVal);
  if (!sKnown || !cKnown) return null;
  return truthy(subVal) === truthy(compVal) ? 100 : 20;
}

function updateWeightTotal() {
  const ids = ['w-gla','w-distance','w-date','w-site','w-year','w-garage','w-basement','w-pool','w-qual','w-cond'];
  const total = ids.reduce((a, id) => a + (parseFloat(document.getElementById(id).value) || 0), 0);
  document.getElementById('weight-total').textContent = fmt(total, 1);
  document.getElementById('weight-total').style.color = Math.abs(total - 100) < 0.01 ? 'var(--green)' : 'var(--red)';
}

function resetWeights() {
  const def = { 'w-gla':24,'w-distance':18,'w-date':18,'w-site':10,'w-year':8,'w-garage':7,'w-basement':5,'w-pool':4,'w-qual':3,'w-cond':3 };
  Object.entries(def).forEach(([id, v]) => document.getElementById(id).value = v);
  updateWeightTotal();
markNarrativeManualEdits();
buildQCScaleDefs();
}

function scoreComp(comp, weights) {
  let score = 0, total_w = 0;

  function addScore(raw, w) { score += raw * w; total_w += w; }

  // GLA
  if (subject.gla && comp.gla_n) {
    const diff = Math.abs(comp.gla_n - subject.gla);
    const pct = diff / subject.gla;
    addScore(Math.max(0, 100 - pct * 400), weights.gla);
  }
  // Distance from Subject
  if (subject.lat && subject.lon && comp.lat && comp.lon) {
    const miles = distanceMiles(subject.lat, subject.lon, comp.lat, comp.lon);
    const ds = distanceScore(miles);
    if (ds !== null) addScore(ds, weights.distance);
  }
  // Sale Date
  if (subject.effdate && comp.sale_date) {
    const m = monthsBetween(subject.effdate, comp.sale_date);
    addScore(Math.max(0, 100 - m * 5), weights.date);
  }
  // Site
  if (subject.site && comp.site_sf_n) {
    const diff = Math.abs(comp.site_sf_n - subject.site);
    const pct = diff / subject.site;
    addScore(Math.max(0, 100 - pct * 300), weights.site);
  }
  // Year
  if (subject.year && comp.year_built_n) {
    const diff = Math.abs(comp.year_built_n - subject.year);
    addScore(Math.max(0, 100 - diff * 3), weights.year);
  }
  // Garage
  const gs = garageScore(subject.garage, comp.garage);
  if (gs !== null) addScore(gs, weights.garage);
  // Basement
  const bs = basementScore(subject.basement, comp.basement);
  if (bs !== null) addScore(bs, weights.basement);
  // Pool
  const ps = poolScore(subject.pool, comp.pool);
  if (ps !== null) addScore(ps, weights.pool);
  // Quality
  const sq = ratingNum(subject.qual), cq = ratingNum(comp.quality);
  if (sq && cq) addScore(Math.max(0, 100 - Math.abs(sq - cq) * 30), weights.qual);
  // Condition
  const sc = ratingNum(subject.cond), cc = ratingNum(comp.condition);
  if (sc && cc) addScore(Math.max(0, 100 - Math.abs(sc - cc) * 25), weights.cond);

  return total_w > 0 ? score / total_w : 0;
}

function runRanking() {
  if (!importedSales.length) { alert('Import MLS data first.'); return; }
  if (!subject.gla) { alert('Save Subject Property first.'); return; }

  const w = {
    gla: parseFloat(document.getElementById('w-gla').value) || 0,
    distance: parseFloat(document.getElementById('w-distance').value) || 0,
    date: parseFloat(document.getElementById('w-date').value) || 0,
    site: parseFloat(document.getElementById('w-site').value) || 0,
    year: parseFloat(document.getElementById('w-year').value) || 0,
    garage: parseFloat(document.getElementById('w-garage').value) || 0,
    basement: parseFloat(document.getElementById('w-basement').value) || 0,
    pool: parseFloat(document.getElementById('w-pool').value) || 0,
    qual: parseFloat(document.getElementById('w-qual').value) || 0,
    cond: parseFloat(document.getElementById('w-cond').value) || 0
  };

  const scored = importedSales.map(s => ({ ...s, _score: scoreComp(s, w) }))
    .sort((a, b) => b._score - a._score);

  // Subject summary bar
  document.getElementById('subject-summary-bar').innerHTML = `
    <div class="sub-item"><div class="si-lbl">GLA</div><div class="si-val">${fmt(subject.gla)} SF</div></div>
    <div class="sub-item"><div class="si-lbl">Site</div><div class="si-val">${fmt(subject.site)} SF</div></div>
    <div class="sub-item"><div class="si-lbl">Yr Built</div><div class="si-val">${subject.year || '—'}</div></div>
    <div class="sub-item"><div class="si-lbl">Garage</div><div class="si-val">${subject.garage || '—'}</div></div>
    <div class="sub-item"><div class="si-lbl">Basement</div><div class="si-val">${subject.basement || '—'}</div></div>
    <div class="sub-item"><div class="si-lbl">Pool</div><div class="si-val">${subject.pool || '—'}</div></div>
    <div class="sub-item"><div class="si-lbl">Quality</div><div class="si-val">${subject.qual || '—'}</div></div>
    <div class="sub-item"><div class="si-lbl">Condition</div><div class="si-val">${subject.cond || '—'}</div></div>
    <div class="sub-item"><div class="si-lbl">Opinion of Value</div><div class="si-val">${subject.value ? '$'+fmt(subject.value) : '—'}</div></div>
  `;

  const colors = ['#c5a028','#adb5bd','#cd7f32'];
  let cards = '';
  scored.slice(0, 20).forEach((s, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : 'rank-n';
    const sc = Math.round(s._score);
    const barColor = sc >= 70 ? '#2d6a4f' : sc >= 45 ? '#c5a028' : '#8b2020';
    const glaDiff = subject.gla && s.gla_n ? (s.gla_n - subject.gla) : null;
    const glaDiffStr = glaDiff !== null ? (glaDiff >= 0 ? '+' : '') + fmt(glaDiff) + ' SF' : '—';
    const priceFmt = s.sale_price_n ? '$' + fmt(s.sale_price_n) : '—';
    const qdiff = ratingNum(subject.qual) && ratingNum(s.quality) ? ratingNum(s.quality) - ratingNum(subject.qual) : null;
    const cdiff = ratingNum(subject.cond) && ratingNum(s.condition) ? ratingNum(s.condition) - ratingNum(subject.cond) : null;
    const distMi = (subject.lat && subject.lon && s.lat && s.lon) ? distanceMiles(subject.lat, subject.lon, s.lat, s.lon) : null;

    cards += `<div style="background:white;border:1px solid var(--border);border-radius:var(--rl);padding:16px 20px;margin-bottom:12px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0;">
        <div class="rank-badge ${rankClass}">${rank}</div>
        <div style="font-size:20px;font-weight:700;color:var(--navy);font-family:'Libre Baskerville',serif;">${sc}</div>
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">score</div>
        <div class="score-bar-wrap" style="width:48px;"><div class="score-bar" style="width:${sc}%;background:${barColor};"></div></div>
      </div>
      <div style="flex:1;min-width:200px;">
        <div style="font-weight:600;font-size:14px;color:var(--navy);margin-bottom:6px;">${s.address || 'Address not mapped'} ${s.city ? '· '+s.city : ''}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;font-size:12px;">
          <div><span style="color:var(--text-muted);">Sale Price:</span> <strong>${priceFmt}</strong></div>
          <div><span style="color:var(--text-muted);">Sale Date:</span> <strong>${s.sale_date || '—'}</strong></div>
          <div><span style="color:var(--text-muted);">Distance:</span> <strong>${distMi !== null ? fmt(distMi, 2) + ' mi' : '—'}</strong></div>
          <div><span style="color:var(--text-muted);">GLA:</span> <strong>${s.gla_n ? fmt(s.gla_n)+' SF' : '—'}</strong> <span style="color:${glaDiff!==null?(glaDiff>=0?'var(--green)':'var(--red)'):'inherit'};font-size:11px;">${glaDiffStr}</span></div>
          <div><span style="color:var(--text-muted);">Site:</span> <strong>${s.site_sf_n ? fmt(s.site_sf_n)+' SF' : '—'}</strong></div>
          <div><span style="color:var(--text-muted);">Yr Built:</span> <strong>${s.year_built || '—'}</strong></div>
          <div><span style="color:var(--text-muted);">Garage:</span> <strong>${s.garage||'—'}</strong></div>
          <div><span style="color:var(--text-muted);">Basement:</span> <strong>${s.basement||'—'}</strong></div>
          <div><span style="color:var(--text-muted);">Pool:</span> <strong>${s.pool||'—'}</strong></div>
          <div><span style="color:var(--text-muted);">Quality:</span> <strong>${s.quality||'—'}</strong>${qdiff!==null?` <span style="font-size:11px;color:${Math.abs(qdiff)===0?'var(--green)':'var(--warn)'};">(${qdiff>0?'+':''}${qdiff} vs sub)</span>`:''}</div>
          <div><span style="color:var(--text-muted);">Condition:</span> <strong>${s.condition||'—'}</strong>${cdiff!==null?` <span style="font-size:11px;color:${Math.abs(cdiff)===0?'var(--green)':'var(--warn)'};">(${cdiff>0?'+':''}${cdiff} vs sub)</span>`:''}</div>
        </div>
      </div>
    </div>`;
  });

  document.getElementById('ranking-cards').innerHTML = cards;
  document.getElementById('ranking-output').style.display = 'block';
  updateNarrativeFromRanking();

  // Build ranking map
  setTimeout(() => {
    buildRankingMap(scored.slice(0, 10));
  }, 200);
}

function buildRankingMap(comps) {
  if (rankingMap) { rankingMap.remove(); rankingMap = null; }
  const center = subject.lat ? [subject.lat, subject.lon] : [34.8526, -82.3940];
  rankingMap = L.map('ranking-map').setView(center, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(rankingMap);

  if (subject.lat) {
    L.marker([subject.lat, subject.lon], {
      icon: L.divIcon({ html: '<div style="background:#c5a028;color:#1a2744;font-weight:700;font-size:11px;padding:3px 7px;border-radius:4px;white-space:nowrap;border:2px solid #1a2744;">SUBJECT</div>', className: '' })
    }).addTo(rankingMap).bindPopup(`<strong>Subject</strong><br>${subject.address || ''}`);
  }

  comps.forEach((s, i) => {
    if (!s.lat) return;
    const label = `#${i + 1}`;
    L.marker([s.lat, s.lon], {
      icon: L.divIcon({ html: `<div style="background:#1a2744;color:#e8c04a;font-weight:700;font-size:11px;padding:3px 7px;border-radius:4px;border:1px solid #c5a028;">${label}</div>`, className: '' })
    }).addTo(rankingMap)
      .bindPopup(`<strong>Rank ${i + 1}</strong><br>${s.address || ''}<br>Score: ${Math.round(s._score)}/100<br>Price: $${fmt(s.sale_price_n)}`);
  });
}

// ══════════════════════════════════════════════════
// MARKET TIME
// ══════════════════════════════════════════════════
function updateMTSmoothingHelp() {
  const mode = document.getElementById('mt-smoothing')?.value || 'none';
  const help = document.getElementById('mt-smoothing-help');
  if (!help) return;
  const copy = {
    none: '<strong>Limited Data Modifier</strong>Off means the trend rate is extracted from the raw period medians only. This is most transparent when each month or quarter has enough sales to be reliable.',
    rolling3: '<strong>Limited Data Modifier</strong>Rolling 3-month median uses each month plus the prior and following month to reduce sharp swings caused by low sale counts. It does not create new market evidence; it only smooths the visual trend and rate extraction.',
    quarterly_avg: '<strong>Limited Data Modifier</strong>Quarterly modifier groups sales into calendar quarters. This is useful when monthly sale volume is too thin but there are enough sales across a three-month period to show market direction.',
    weighted_regression: '<strong>Limited Data Modifier</strong>Weighted trend line keeps monthly periods but gives more influence to periods with more sales. Thin months are still shown, but they have less impact on the extracted monthly rate.'
  };
  help.innerHTML = copy[mode] || copy.none;
}

function periodMonthIndex(key) {
  if (/Q[1-4]$/.test(key)) {
    const [yr, qtxt] = key.split(' Q');
    return parseInt(yr) * 12 + (parseInt(qtxt) - 1) * 3;
  }
  const [yr, mo] = key.split('-').map(Number);
  return yr * 12 + (mo - 1);
}

function weightedSlope(points) {
  const sw = points.reduce((a,p)=>a+p.w,0);
  const sx = points.reduce((a,p)=>a+p.x*p.w,0);
  const sy = points.reduce((a,p)=>a+p.y*p.w,0);
  const sxy = points.reduce((a,p)=>a+p.x*p.y*p.w,0);
  const sx2 = points.reduce((a,p)=>a+p.x*p.x*p.w,0);
  const denom = sw * sx2 - sx * sx;
  const b = denom ? (sw * sxy - sx * sy) / denom : 0;
  const a = sw ? (sy - b * sx) / sw : 0;
  return {a,b};
}

function calcMTFromData() {
  if (!importedSales.length) { alert('Import MLS data first.'); return; }
  const baseGroupBy = document.getElementById('mt-groupby').value;
  const smoothing = document.getElementById('mt-smoothing')?.value || 'none';
  const minSales = parseInt(document.getElementById('mt-min-sales').value) || 3;
  const groups = {};

  // For quarterly modifier, force quarterly grouping even if monthly is selected.
  const groupBy = smoothing === 'quarterly_avg' ? 'quarter' : baseGroupBy;

  importedSales.forEach(s => {
    const d = new Date(s.sale_date);
    if (isNaN(d) || isNaN(s.sale_price_n)) return;
    let key;
    if (groupBy === 'quarter') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      key = `${d.getFullYear()} Q${q}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(s.sale_price_n);
  });

  const periods = Object.keys(groups).sort((a,b)=>periodMonthIndex(a)-periodMonthIndex(b));
  const rawSeries = periods.map(p => ({ key:p, x:periodMonthIndex(p), y:median(groups[p]), n:groups[p].length }));
  let filtered = rawSeries.filter(p => p.n >= minSales);
  if (filtered.length < 2) { alert(`Not enough periods with ${minSales}+ sales. Lower the minimum, switch to quarterly grouping, or use the limited-data modifier.`); return; }

  let trendSeries = filtered.map(p => ({...p, yMod:p.y, method:'Raw'}));
  let modifierLabel = 'Off — raw period medians';

  if (smoothing === 'rolling3' && groupBy === 'month') {
    trendSeries = filtered.map((p, i) => {
      const neighbors = filtered.filter(q => Math.abs(q.x - p.x) <= 1);
      const pool = neighbors.flatMap(q => Array(q.n).fill(q.y));
      return {...p, yMod: median(pool.length ? pool : [p.y]), method:'Rolling 3-month median'};
    });
    modifierLabel = 'Rolling 3-month median';
  } else if (smoothing === 'rolling3' && groupBy === 'quarter') {
    modifierLabel = 'Quarterly grouping; rolling modifier not needed';
  } else if (smoothing === 'quarterly_avg') {
    modifierLabel = 'Quarterly grouping modifier';
  } else if (smoothing === 'weighted_regression') {
    const x0 = filtered[0].x;
    const pts = filtered.map(p => ({x:p.x-x0, y:p.y, w:Math.max(1,p.n)}));
    const line = weightedSlope(pts);
    trendSeries = filtered.map(p => ({...p, yMod: line.a + line.b * (p.x-x0), method:'Weighted trend line'}));
    modifierLabel = 'Weighted trend line by sale count';
  }

  const base = trendSeries[0].yMod, last = trendSeries[trendSeries.length - 1].yMod;
  const totalMonths = Math.max(1, trendSeries[trendSeries.length - 1].x - trendSeries[0].x);
  const monthly = totalMonths > 0 ? ((last - base) / base * 100) / totalMonths : 0;
  const annual = monthly * 12;
  const cagr = totalMonths > 0 ? (Math.pow(last / base, 12 / totalMonths) - 1) * 100 : 0;
  globalMonthlyRate = monthly;

  let html = '';
  trendSeries.forEach((p) => {
    const rawText = `$${fmt(p.y)}`;
    const modText = Math.abs(p.yMod - p.y) > 1 ? ` → modified $${fmt(p.yMod)}` : '';
    html += `<div class="rrow"><span class="rlbl">${p.key} (n=${p.n})</span><span class="rval neu">${rawText}${modText}</span></div>`;
  });

  document.getElementById('mt-period-rows').innerHTML = html;
  document.getElementById('mt-n-periods').textContent = trendSeries.length;
  const modEl = document.getElementById('mt-modifier-used');
  if (modEl) modEl.textContent = modifierLabel;
  document.getElementById('mt-monthly').textContent = fmtPct(monthly, 3) + '/month';
  document.getElementById('mt-annual').textContent = fmtPct(annual, 2) + '/year';
  document.getElementById('mt-cagr').textContent = fmtPct(cagr, 2) + '/year (compound)';
  document.getElementById('mt-dir').textContent = monthly > 0.05 ? '↑ Appreciating' : monthly < -0.05 ? '↓ Declining' : '↔ Stable';
  updateNarrativeFromMarket(monthly, monthly > 0.05 ? 'increasing' : monthly < -0.05 ? 'declining' : 'stable', modifierLabel);
  document.getElementById('mt-from-data').querySelector('.rbox').classList.add('on');

  const chartWrap = document.getElementById('mt-chart-wrap');
  if (chartWrap) chartWrap.classList.add('on');
  const note = document.getElementById('mt-chart-note');
  if (note) note.textContent = `${modifierLabel}. Raw period medians remain visible so the professional can compare the modified trend against actual MLS evidence.`;
  drawMarketTrendChart(filtered, trendSeries);
}

function drawMarketTrendChart(rawSeries, trendSeries) {
  const canvas = document.getElementById('mt-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const mode = document.getElementById('mt-chart-mode')?.value || 'both';
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
  const padL=70, padR=24, padT=24, padB=62;
  const allY = [];
  if (mode !== 'smooth') rawSeries.forEach(p=>allY.push(p.y));
  if (mode !== 'raw') trendSeries.forEach(p=>allY.push(p.yMod));
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const yPad = Math.max(1000, (maxY-minY)*0.12);
  const y0 = minY - yPad, y1 = maxY + yPad;
  const minX = Math.min(...trendSeries.map(p=>p.x)), maxX = Math.max(...trendSeries.map(p=>p.x));
  const xScale = x => padL + (maxX===minX ? 0 : (x-minX)/(maxX-minX))*(w-padL-padR);
  const yScale = y => h-padB - ((y-y0)/(y1-y0))*(h-padT-padB);

  ctx.strokeStyle = '#ede8dc'; ctx.lineWidth = 1;
  ctx.fillStyle = '#666'; ctx.font = '12px Source Sans 3, sans-serif'; ctx.textAlign='right';
  for (let i=0;i<=4;i++) {
    const y = y0 + (y1-y0)*i/4;
    const py = yScale(y);
    ctx.beginPath(); ctx.moveTo(padL,py); ctx.lineTo(w-padR,py); ctx.stroke();
    ctx.fillText('$'+fmt(y), padL-8, py+4);
  }
  ctx.strokeStyle = '#ddd5c0'; ctx.beginPath(); ctx.moveTo(padL,padT); ctx.lineTo(padL,h-padB); ctx.lineTo(w-padR,h-padB); ctx.stroke();

  function drawLine(series, field, stroke, pointFill, dashed=false) {
    ctx.save(); ctx.strokeStyle=stroke; ctx.lineWidth=2.5; if (dashed) ctx.setLineDash([6,5]);
    ctx.beginPath();
    series.forEach((p,i)=>{ const x=xScale(p.x), y=yScale(p[field]); if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); });
    ctx.stroke(); ctx.setLineDash([]);
    series.forEach(p=>{ const x=xScale(p.x), y=yScale(p[field]); ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fillStyle=pointFill; ctx.fill(); });
    ctx.restore();
  }
  if (mode !== 'smooth') drawLine(rawSeries, 'y', '#1a2744', '#1a2744', false);
  if (mode !== 'raw') drawLine(trendSeries, 'yMod', '#c5a028', '#c5a028', mode==='both');

  ctx.fillStyle = '#666'; ctx.font = '11px Source Sans 3, sans-serif'; ctx.textAlign='center';
  const every = Math.max(1, Math.ceil(trendSeries.length / 8));
  trendSeries.forEach((p,i)=>{
    if (i % every !== 0 && i !== trendSeries.length-1) return;
    const x=xScale(p.x);
    ctx.save(); ctx.translate(x,h-padB+18); ctx.rotate(-Math.PI/6); ctx.fillText(p.key,0,0); ctx.restore();
  });
  ctx.fillStyle = '#1a2744'; ctx.font = '13px Source Sans 3, sans-serif'; ctx.textAlign='left';
  ctx.fillText('Median sale price by period', padL, 16);
}

function addMTRow() {
  const d = document.createElement('div');
  d.className = 'grid3 mt-row'; d.style = 'align-items:end;';
  d.innerHTML = `
    <div class="fg"><label>&nbsp;</label><input type="text" class="mtp-label" placeholder="Period"></div>
    <div class="fg"><label>&nbsp;</label><input type="number" class="mtp-price" placeholder="Median Price"></div>
    <div class="fg"><label>&nbsp;</label><input type="number" class="mtp-months" placeholder="Months from base"></div>`;
  document.getElementById('mt-manual-rows').appendChild(d);
}

function calcMTManual() {
  const prices = [...document.querySelectorAll('.mtp-price')].map(i => parseFloat(i.value));
  const months = [...document.querySelectorAll('.mtp-months')].map(i => parseFloat(i.value));
  const valid = prices.filter(p => !isNaN(p) && p > 0);
  if (valid.length < 2) { alert('Enter at least 2 periods.'); return; }
  const base = valid[0], last = valid[valid.length - 1];
  const totalM = months[valid.length - 1] - (months[0] || 0) || 1;
  const monthly = ((last - base) / base * 100) / totalM;
  const annual = monthly * 12;
  const cagr = (Math.pow(last / base, 12 / totalM) - 1) * 100;
  globalMonthlyRate = monthly;
  document.getElementById('mm-monthly').textContent = fmtPct(monthly, 3) + '/month';
  document.getElementById('mm-annual').textContent = fmtPct(annual, 2) + '/year';
  document.getElementById('mm-cagr').textContent = fmtPct(cagr, 2) + '/year';
  document.getElementById('mm-dir').textContent = monthly > 0.05 ? '↑ Appreciating' : monthly < -0.05 ? '↓ Declining' : '↔ Stable';
  updateNarrativeFromMarket(monthly, monthly > 0.05 ? 'increasing' : monthly < -0.05 ? 'declining' : 'stable', 'Manual period entry');
  document.getElementById('mt-manual-result').classList.add('on');
}

function applyMT() {
  const rate = parseFloat(document.getElementById('mta-rate').value);
  const months = parseFloat(document.getElementById('mta-months').value);
  const price = parseFloat(document.getElementById('mta-price').value);
  if ([rate, months, price].some(isNaN)) { alert('Fill all fields.'); return; }
  const pct = rate * months;
  const dollar = price * pct / 100;
  const adj = price + dollar;
  document.getElementById('mta-pct').textContent = fmtPct(pct, 2);
  const el = document.getElementById('mta-dollar');
  el.textContent = fmtD(dollar);
  el.className = 'rval ' + (dollar >= 0 ? 'pos' : 'neg');
  document.getElementById('mta-adj').textContent = '$' + fmt(adj);
  document.getElementById('mta-result').classList.add('on');
}

// ══════════════════════════════════════════════════
// GLA
// ══════════════════════════════════════════════════
function runGLARegression() {
  if (!importedSales.length) { alert('Import MLS data first.'); return; }
  const rate = parseFloat(document.getElementById('gla-mt-rate').value) || 0;
  const effDate = document.getElementById('gla-eff-date').value || subject.effdate;
  const pairs = importedSales
    .filter(s => !isNaN(s.gla_n) && !isNaN(s.sale_price_n) && s.gla_n > 0 && s.sale_price_n > 0)
    .map(s => {
      let adjPrice = s.sale_price_n;
      if (rate !== 0 && effDate && s.sale_date) {
        const m = monthsBetween(effDate, s.sale_date);
        adjPrice *= (1 + rate / 100 * m);
      }
      return { x: s.gla_n, y: adjPrice };
    });

  if (pairs.length < 3) { alert('Need at least 3 sales with GLA and price data.'); return; }
  const { a, b, r2, n } = linReg(pairs);
  const rel = r2 >= 0.8 ? 'Strong (R²≥0.80)' : r2 >= 0.6 ? 'Moderate (R²≥0.60)' : r2 >= 0.4 ? 'Weak (R²≥0.40) — corroborate with paired sales' : 'Poor — use paired sales method';

  document.getElementById('gla-stat-chips').innerHTML = `
    <div class="schip" style="background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15);">
      <div class="slbl" style="color:rgba(255,255,255,.5);">Slope ($/SF)</div>
      <div class="sval" style="color:var(--gold-light);">$${fmt(b, 2)}</div></div>
    <div class="schip" style="background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15);">
      <div class="slbl" style="color:rgba(255,255,255,.5);">R²</div>
      <div class="sval" style="color:var(--gold-light);">${fmt(r2, 3)}</div></div>
    <div class="schip" style="background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15);">
      <div class="slbl" style="color:rgba(255,255,255,.5);">Sales Used</div>
      <div class="sval" style="color:var(--gold-light);">${n}</div></div>
  `;
  document.getElementById('gr-slope').textContent = '$' + fmt(b, 2) + '/SF';
  document.getElementById('gr-r2').textContent = fmt(r2, 3);
  document.getElementById('gr-n').textContent = n;
  document.getElementById('gr-rel').textContent = rel;
  document.getElementById('gla-reg-result').classList.add('on');
  updateNarrativeFromGLA(b, 'simple linear regression');
}

function linReg(pairs) {
  const n = pairs.length;
  const sx = pairs.reduce((a, p) => a + p.x, 0);
  const sy = pairs.reduce((a, p) => a + p.y, 0);
  const sxy = pairs.reduce((a, p) => a + p.x * p.y, 0);
  const sx2 = pairs.reduce((a, p) => a + p.x * p.x, 0);
  const sy2 = pairs.reduce((a, p) => a + p.y * p.y, 0);
  const denom = n * sx2 - sx * sx;
  const b = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const a = (sy - b * sx) / n;
  const r2num = Math.pow(n * sxy - sx * sy, 2);
  const r2den = (n * sx2 - sx * sx) * (n * sy2 - sy * sy);
  const r2 = r2den > 0 ? r2num / r2den : 0;
  return { a, b, r2, n };
}

function addGLAPair() {
  const d = document.createElement('div');
  d.className = 'grid2 gla-pr';
  d.style = 'align-items:end;background:var(--cream);padding:12px;border-radius:var(--r);border:1px solid var(--border-light);margin-bottom:10px;';
  d.innerHTML = `
    <div class="fg"><label>Sale A Price ($)</label><input type="number" class="gpa-p" placeholder="310000"></div>
    <div class="fg"><label>Sale A GLA (SF)</label><input type="number" class="gpa-g" placeholder="1800"></div>
    <div class="fg"><label>Sale B Price ($)</label><input type="number" class="gpb-p" placeholder="290000"></div>
    <div class="fg"><label>Sale B GLA (SF)</label><input type="number" class="gpb-g" placeholder="1600"></div>`;
  document.getElementById('gla-pairs').appendChild(d);
}

function calcGLAPaired() {
  const rows = document.querySelectorAll('.gla-pr');
  const rates = [];
  let html = '';
  rows.forEach((r, i) => {
    const pa = toNum(r.querySelector('.gpa-p').value);
    const ga = toNum(r.querySelector('.gpa-g').value);
    const pb = toNum(r.querySelector('.gpb-p').value);
    const gb = toNum(r.querySelector('.gpb-g').value);
    if ([pa, ga, pb, gb].every(v => !isNaN(v)) && ga !== gb) {
      const rate = (pa - pb) / (ga - gb);
      rates.push(rate);
      html += `<div class="rrow"><span class="rlbl">Pair ${i + 1}</span><span class="rval pos">$${fmt(rate, 2)}/SF</span></div>`;
    }
  });
  if (!rates.length) { alert('Enter at least one complete pair.'); return; }
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const med = median(rates);
  document.getElementById('gla-pr-rows').innerHTML = html;
  document.getElementById('gp-avg').textContent = '$' + fmt(avg, 2) + '/SF';
  document.getElementById('gp-med').textContent = '$' + fmt(med, 2) + '/SF';
  document.getElementById('gp-range').textContent = '$' + fmt(Math.min(...rates), 2) + ' – $' + fmt(Math.max(...rates), 2);
  document.getElementById('gla-paired-result').classList.add('on');
  updateNarrativeFromGLA(med, 'paired sales analysis');
}

function applyGLA() {
  const sg = toNum(document.getElementById('gla-sub').value);
  const cg = toNum(document.getElementById('gla-comp').value);
  const rate = toNum(document.getElementById('gla-rate-apply').value);
  const cp = toNum(document.getElementById('gla-comp-price').value);
  if ([sg, cg, rate, cp].some(isNaN)) { alert('Fill all fields.'); return; }
  const diff = sg - cg, dollar = diff * rate, adj = cp + dollar;
  document.getElementById('ga-diff').textContent = fmt(diff) + ' SF';
  const el = document.getElementById('ga-dollar');
  el.textContent = fmtD(dollar);
  el.className = 'rval ' + (dollar >= 0 ? 'pos' : 'neg');
  document.getElementById('ga-adj').textContent = '$' + fmt(adj);
  document.getElementById('ga-pct').textContent = fmt(Math.abs(dollar / cp * 100), 1) + '%';
  document.getElementById('gla-apply-result').classList.add('on');
}

// ══════════════════════════════════════════════════
// Q & C ANALYSIS
// ══════════════════════════════════════════════════
function buildQCDistribution() {
  if (!importedSales.length) { alert('Import MLS data first.'); return; }
  const cCounts = {}, qCounts = {};
  ['C1','C2','C3','C4','C5','C6'].forEach(r => cCounts[r] = 0);
  ['Q1','Q2','Q3','Q4','Q5','Q6'].forEach(r => qCounts[r] = 0);
  let cTotal = 0, qTotal = 0;

  importedSales.forEach(s => {
    const c = String(s.condition || '').trim().toUpperCase();
    const q = String(s.quality || '').trim().toUpperCase();
    if (cCounts[c] !== undefined) { cCounts[c]++; cTotal++; }
    if (qCounts[q] !== undefined) { qCounts[q]++; qTotal++; }
  });

  drawBarChart('c-chart', cCounts, '#2e4080');
  drawBarChart('q-chart', qCounts, '#c5a028');

  document.getElementById('c-dist-table').innerHTML = buildDistTable(cCounts, cTotal, subject.cond);
  document.getElementById('q-dist-table').innerHTML = buildDistTable(qCounts, qTotal, subject.qual);

  let compHtml = '';
  if (subject.cond || subject.qual) {
    compHtml = `<div class="info-block"><strong>Subject vs. Comp Pool</strong>`;
    if (subject.cond && cTotal > 0) {
      const cn = ratingNum(subject.cond);
      const above = Object.entries(cCounts).filter(([r]) => ratingNum(r) < cn).reduce((a,[,n])=>a+n,0);
      const below = Object.entries(cCounts).filter(([r]) => ratingNum(r) > cn).reduce((a,[,n])=>a+n,0);
      const same = cCounts[subject.cond] || 0;
      compHtml += `<div style="margin-top:8px;"><strong>Condition ${subject.cond}:</strong> ${same} comp(s) at same rating, ${above} better, ${below} worse. ${above > below ? 'Subject condition is below average for the comp pool — consider positive adjustments to comps in better condition.' : below > above ? 'Subject condition is above average — consider negative adjustments to comps in worse condition.' : 'Subject condition is typical for the comp pool.'}</div>`;
    }
    if (subject.qual && qTotal > 0) {
      const qn = ratingNum(subject.qual);
      const above = Object.entries(qCounts).filter(([r]) => ratingNum(r) < qn).reduce((a,[,n])=>a+n,0);
      const below = Object.entries(qCounts).filter(([r]) => ratingNum(r) > qn).reduce((a,[,n])=>a+n,0);
      const same = qCounts[subject.qual] || 0;
      compHtml += `<div style="margin-top:8px;"><strong>Quality ${subject.qual}:</strong> ${same} comp(s) at same rating, ${above} higher quality, ${below} lower quality. ${above > below ? 'Subject quality is below average — positive adjustments may be needed for comps with superior quality.' : below > above ? 'Subject quality is above average — negative adjustments to lower-quality comps.' : 'Subject quality is typical for the pool.'}</div>`;
    }
    compHtml += '</div>';
  }
  document.getElementById('qc-subject-comparison').innerHTML = compHtml;
  document.getElementById('qc-dist-output').style.display = 'block';
}

function buildDistTable(counts, total, subjectRating) {
  let html = '<table class="tbl" style="font-size:12px;"><thead><tr><th>Rating</th><th>Count</th><th>%</th><th>Subject</th></tr></thead><tbody>';
  Object.entries(counts).forEach(([r, n]) => {
    const pct = total > 0 ? (n / total * 100).toFixed(1) : 0;
    const isSubj = r === (subjectRating || '').toUpperCase();
    html += `<tr style="${isSubj?'background:var(--gold-pale);font-weight:700;':''}">
      <td>${r}</td><td class="num">${n}</td><td class="num">${pct}%</td>
      <td>${isSubj ? '⬅ Subject' : ''}</td></tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function drawBarChart(canvasId, counts, color) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const labels = Object.keys(counts);
  const values = Object.values(counts);
  const max = Math.max(...values, 1);
  const w = canvas.width, h = canvas.height;
  const pad = 30, barW = (w - pad * 2) / labels.length - 6;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#faf8f4';
  ctx.fillRect(0, 0, w, h);
  labels.forEach((lbl, i) => {
    const x = pad + i * ((w - pad * 2) / labels.length) + 3;
    const barH = (values[i] / max) * (h - 55);
    ctx.fillStyle = color;
    ctx.fillRect(x, h - barH - 25, barW, barH);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '11px Source Sans 3, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lbl, x + barW / 2, h - 8);
    ctx.fillText(values[i], x + barW / 2, h - barH - 30);
  });
}

function buildQCHeatmap() {
  if (!importedSales.length) { alert('Import MLS data first.'); return; }
  const grid = {};
  const qRatings = ['Q1','Q2','Q3','Q4','Q5','Q6'];
  const cRatings = ['C1','C2','C3','C4','C5','C6'];
  qRatings.forEach(q => { grid[q] = {}; cRatings.forEach(c => grid[q][c] = 0); });

  importedSales.forEach(s => {
    const q = String(s.quality || '').trim().toUpperCase();
    const c = String(s.condition || '').trim().toUpperCase();
    if (grid[q] && grid[q][c] !== undefined) grid[q][c]++;
  });

  const maxVal = Math.max(...qRatings.flatMap(q => cRatings.map(c => grid[q][c])), 1);
  const sq = (subject.qual || '').toUpperCase();
  const sc = (subject.cond || '').toUpperCase();

  let html = '<table class="qc-grid"><thead><tr><th>Q \\ C</th>';
  cRatings.forEach(c => { html += `<th>${c}${c===sc?'<br><span style="color:var(--gold-light);">◀ Subj</span>':''}</th>`; });
  html += '</tr></thead><tbody>';
  qRatings.forEach(q => {
    html += `<tr><td style="font-weight:700;background:var(--navy);color:rgba(255,255,255,.8);padding:8px 14px;">${q}${q===sq?' ▼':''}</td>`;
    cRatings.forEach(c => {
      const val = grid[q][c];
      const intensity = Math.ceil((val / maxVal) * 4);
      const isSubj = q === sq && c === sc;
      html += `<td class="qc-cell-${val>0?intensity:0}" style="${isSubj?'outline:2px solid var(--gold);outline-offset:-2px;':''}">
        ${val > 0 ? val : ''}${isSubj ? '<br><span style="font-size:10px;color:var(--gold);font-weight:700;">SUBJECT</span>' : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">Cell color intensity reflects number of sales. Gold outline = subject Q×C combination.</div>';
  document.getElementById('qc-heatmap-out').innerHTML = html;
}

function addQCPair() {
  const d = document.createElement('div');
  d.className = 'grid2 qcp-row';
  d.style = 'align-items:end;background:var(--cream);padding:14px;border-radius:var(--r);border:1px solid var(--border-light);margin-bottom:10px;';
  d.innerHTML = `
    <div class="fg"><label>Sale A Price ($)</label><input type="number" class="qcpa" placeholder="310000"></div>
    <div class="fg"><label>Sale A Rating</label><input type="text" class="qcra" placeholder="C3" maxlength="2"></div>
    <div class="fg"><label>Sale B Price ($)</label><input type="number" class="qcpb" placeholder="285000"></div>
    <div class="fg"><label>Sale B Rating</label><input type="text" class="qcrb" placeholder="C4" maxlength="2"></div>
    <div class="fg"><label>Type</label><select class="qctype"><option value="C">Condition</option><option value="Q">Quality</option></select></div>
    <div class="fg"><label>Notes</label><input type="text" class="qcnotes" placeholder="Similar GLA, site, location"></div>`;
  document.getElementById('qc-pairs').appendChild(d);
}

function calcQCPaired() {
  const rows = document.querySelectorAll('.qcp-row');
  const cRates = [], qRates = [];
  let html = '';
  rows.forEach((r, i) => {
    const pa = toNum(r.querySelector('.qcpa').value);
    const ra = r.querySelector('.qcra').value.toUpperCase();
    const pb = toNum(r.querySelector('.qcpb').value);
    const rb = r.querySelector('.qcrb').value.toUpperCase();
    const type = r.querySelector('.qctype').value;
    const na = ratingNum(ra), nb = ratingNum(rb);
    if ([pa, pb].every(v => !isNaN(v)) && na && nb && na !== nb) {
      const rate = Math.abs(pa - pb) / Math.abs(na - nb);
      type === 'C' ? cRates.push(rate) : qRates.push(rate);
      html += `<div class="rrow"><span class="rlbl">Pair ${i+1} (${type}: ${ra}↔${rb})</span><span class="rval pos">$${fmt(rate)}/level</span></div>`;
    }
  });
  if (!cRates.length && !qRates.length) { alert('Enter at least one complete pair.'); return; }
  document.getElementById('qcp-rows').innerHTML = html;
  document.getElementById('qcp-c-avg').textContent = cRates.length ? '$' + fmt(cRates.reduce((a,b)=>a+b,0)/cRates.length) + '/level' : 'No C pairs';
  document.getElementById('qcp-q-avg').textContent = qRates.length ? '$' + fmt(qRates.reduce((a,b)=>a+b,0)/qRates.length) + '/level' : 'No Q pairs';
  document.getElementById('qc-paired-result').classList.add('on');
}

function genQCNarrative() {
  const sc = document.getElementById('qcn-s-cond').value || '—';
  const cc = document.getElementById('qcn-c-cond').value || '—';
  const ca = toNum(document.getElementById('qcn-c-adj').value);
  const cb = document.getElementById('qcn-c-basis').value;
  const sq = document.getElementById('qcn-s-qual').value || '—';
  const cq = document.getElementById('qcn-c-qual').value || '—';
  const qa = toNum(document.getElementById('qcn-q-adj').value);
  const qb = document.getElementById('qcn-q-basis').value;
  const comment = document.getElementById('qcn-comment').value;

  const text = `<p><strong>Condition and Quality Adjustment — Appraiser Documentation</strong></p>
<p><strong>Condition Adjustment (${sc} subject vs. ${cc} comparable):</strong> The subject property has been rated ${sc} under the FNMA UAD rating system following physical inspection. The comparable sale has been assigned a condition rating of ${cc}. The appraiser recognizes that UAD condition ratings cannot be derived from a mathematical formula; they require professional judgment, physical inspection, and comparison to market norms as defined in FNMA UAD Appendix D and the Appraisal Institute's "The Appraisal of Real Estate," 15th Edition, Chapter 14.</p>
${!isNaN(ca) ? `<p>A condition adjustment of ${fmtD(ca)} has been applied, supported by ${cb}. This adjustment reflects the market's recognized price difference between properties in ${sc} condition versus ${cc} condition within the subject's competitive market area. The appraiser's work file contains the supporting data underlying this conclusion.</p>` : ''}
<p><strong>Quality Adjustment (${sq} subject vs. ${cq} comparable):</strong> Quality ratings under the UAD system reflect the construction quality, materials, and craftsmanship of the improvements — independent of current condition. The subject has been rated ${sq} and the comparable ${cq} based on observed physical characteristics and comparison to market standards.</p>
${!isNaN(qa) ? `<p>A quality adjustment of ${fmtD(qa)} has been applied, supported by ${qb}. This reflects market participants' recognition of quality differences between the subject and the comparable in the subject neighborhood and competitive market area.</p>` : ''}
${comment ? `<p><strong>Additional Commentary:</strong> ${comment}</p>` : ''}
<p>The appraiser certifies that all condition and quality adjustments presented herein are based on professional judgment, physical inspection findings, and market-derived evidence consistent with USPAP Standards Rule 1-4(a) and FNMA guidelines.</p>`;

  document.getElementById('qcn-text').innerHTML = text;
  document.getElementById('qcn-out').classList.add('on');
}

// ══════════════════════════════════════════════════
// NARRATIVE
// ══════════════════════════════════════════════════
const autoFilledNarrativeFields = new Set();
function setNarrativeField(id, value){
  const el=document.getElementById(id); if(!el || value===undefined || value===null || value==='') return;
  const cur=String(el.value||'').trim();
  if(!cur || autoFilledNarrativeFields.has(id)){
    el.value=value;
    autoFilledNarrativeFields.add(id);
  }
}
function markNarrativeManualEdits(){
  ['nar-market','nar-period','nar-n','nar-source','nar-rate','nar-dir','nar-gla','nar-gla-method','nar-sel'].forEach(id=>{
    const el=document.getElementById(id); if(!el || el.dataset.manualListener) return;
    el.dataset.manualListener='1';
    el.addEventListener('input',()=>{ if(document.activeElement===el) autoFilledNarrativeFields.delete(id); });
    el.addEventListener('change',()=>{ if(document.activeElement===el) autoFilledNarrativeFields.delete(id); });
  });
}
function inferAnalysisPeriodFromSales(){
  const ds=importedSales.map(s=>new Date(s.sale_date)).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
  if(ds.length<2) return '';
  const fmtMon=d=>d.toLocaleString('en-US',{month:'short',year:'numeric'});
  return fmtMon(ds[0])+' – '+fmtMon(ds[ds.length-1]);
}
function updateNarrativeFromMarket(monthly, direction, modifierLabel){
  setNarrativeField('nar-n', importedSales.length ? String(importedSales.length) : '');
  setNarrativeField('nar-period', inferAnalysisPeriodFromSales());
  setNarrativeField('nar-source', 'MLS export / appraiser workfile');
  setNarrativeField('nar-rate', fmt(monthly,3));
  setNarrativeField('nar-dir', direction || (monthly > 0.05 ? 'increasing' : monthly < -0.05 ? 'declining' : 'stable'));
  const selParts=[];
  if(subject.gla) selParts.push('similar GLA to the subject');
  if(subject.effdate) selParts.push('sales proximate to the effective date');
  selParts.push('competitive market area and relevant buyer pool');
  setNarrativeField('nar-sel', selParts.join(', '));
}
function updateNarrativeFromGLA(rate, method){
  if(rate && isFinite(rate)) setNarrativeField('nar-gla', fmt(rate,2));
  if(method) setNarrativeField('nar-gla-method', method);
}
function updateNarrativeFromRanking(){
  const topn=document.getElementById('adj-topn')?.value || 'top ranked';
  setNarrativeField('nar-sel', `the ${topn} most comparable sales based on similarity to the subject, with emphasis on competitive location, GLA, age, condition, quality, and sale date`);
}
function genMainNarrative() {
  const market = document.getElementById('nar-market').value || '[Market Area]';
  const period = document.getElementById('nar-period').value || '[period]';
  const n = document.getElementById('nar-n').value || '[n]';
  const source = document.getElementById('nar-source').value || 'MLS data';
  const rate = parseFloat(document.getElementById('nar-rate').value) || 0;
  const dir = document.getElementById('nar-dir').value;
  const gla = parseFloat(document.getElementById('nar-gla').value) || 0;
  const glaMethod = document.getElementById('nar-gla-method').value;
  const sel = document.getElementById('nar-sel').value || 'within the subject neighborhood, similar GLA, and within 12 months of the effective date';
  const annRate = fmt(rate * 12, 2);
  const appraiser = subject.appraiser || '[Appraiser Name/License]';

  const text = `<p><strong>Market Conditions and Comparable Selection Addendum</strong></p>
<p>The subject property is located within ${market}. To determine the appropriate market conditions adjustment, the appraiser analyzed ${n} arm's-length sales during the period of ${period}, utilizing data from ${source}. This analysis is consistent with USPAP Standards Rule 1-4(a) and Fannie Mae Selling Guide Section B4-1.3-09.</p>
<p>Median sale price analysis over the study period indicates a ${dir} market at an indicated rate of approximately ${fmtPct(rate, 3)} per month (${annRate}% annualized). The trend was established through time-series analysis of median sale prices plotted against time of sale. Monthly Rate Formula: (Current Median − Base Median) / Base Median / Months Elapsed. A compound annual growth rate (CAGR) was also computed and found consistent with the simple rate. Market conditions adjustments have been applied to all comparables at the indicated monthly rate, calculated on each comparable's sale price.</p>
${gla > 0 ? `<p>Gross Living Area adjustments were extracted through ${glaMethod} of sales within the subject's competitive market area. This methodology is consistent with Appraisal Institute guidance (The Appraisal of Real Estate, 15th Ed., Ch. 11–12) and FNMA Lender Letter 2014-07, which requires GLA adjustments to be market-supported rather than assumed. The indicated rate of $${fmt(gla, 2)}/SF reflects actual buyer behavior as evidenced by the analyzed sales data.</p>` : ''}
<p>Comparable sales were selected based on the following criteria: ${sel}. Selection criteria are consistent with USPAP Advisory Opinion 11 (selection of comparable sales) and FNMA Selling Guide B4-1.3-08. Where ideal comparables were unavailable, the best available sales were utilized with appropriate adjustments and commentary.</p>
<p>All adjustments presented in this report are market-derived and supported by the data described above and contained in the appraiser's work file. The appraiser's professional judgment was applied throughout this analysis in accordance with USPAP.</p>
<p style="color:var(--text-muted);font-style:italic;font-size:13px;">Prepared by: ${appraiser}</p>`;

  document.getElementById('main-nar-text').innerHTML = text;
  document.getElementById('main-nar-out').classList.add('on');
}

function copyText(id) {
  const el = document.getElementById(id);
  const text = el.innerText || el.textContent;
  navigator.clipboard.writeText(text)
    .then(() => alert('Copied to clipboard.'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('Copied to clipboard.');
    });
}



// ══════════════════════════════════════════════════
// V3 ENHANCEMENTS — SECURITY, QUALITY, ADJ GRID, STORAGE, QC CALIBRATION
// ══════════════════════════════════════════════════
function esc(v){return String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function ratingDecimal(r){
  if (r === null || r === undefined) return null;
  const m = String(r).trim().toUpperCase().match(/[QC]?\s*([1-6](?:\.5)?)/);
  return m ? parseFloat(m[1]) : null;
}
function ratingLabel(prefix, n){ return n ? prefix + fmt(n, n % 1 ? 1 : 0) : '—'; }
function currentWeights(){return {
  gla: parseFloat(document.getElementById('w-gla').value) || 0,
  distance: parseFloat(document.getElementById('w-distance').value) || 0,
  date: parseFloat(document.getElementById('w-date').value) || 0,
  price: parseFloat(document.getElementById('w-price').value) || 0,
  site: parseFloat(document.getElementById('w-site').value) || 0,
  year: parseFloat(document.getElementById('w-year').value) || 0,
  beds: parseFloat(document.getElementById('w-beds').value) || 0,
  qual: parseFloat(document.getElementById('w-qual').value) || 0,
  cond: parseFloat(document.getElementById('w-cond').value) || 0
};}
function rankedSales(){ return importedSales.map(s => ({...s, _score: scoreComp(s, currentWeights())})).sort((a,b)=>b._score-a._score); }
function statusItem(kind, label, detail){ return `<div class="check-item ${kind}"><strong>${label}</strong><span>${detail}</span></div>`; }

function runDataQuality(){
  if(!importedSales.length){ alert('Import MLS data first.'); return; }
  const n = importedSales.length;
  const missing = f => importedSales.filter(s => !s[f] || String(s[f]).trim()==='').length;
  const nums = (field) => importedSales.map(s=>s[field]).filter(v=>!isNaN(v)&&isFinite(v));
  const prices = nums('sale_price_n'), glas = nums('gla_n');
  const priceMed = median(prices), glaMed = glas.length ? median(glas) : 0;
  const possibleDupes = new Set();
  importedSales.forEach((s,i)=>{
    const key = [String(s.address||'').toLowerCase().trim(), s.sale_date, Math.round(s.sale_price_n||0)].join('|');
    if(key.length>5){ importedSales.forEach((t,j)=>{ if(j>i){ const key2=[String(t.address||'').toLowerCase().trim(),t.sale_date,Math.round(t.sale_price_n||0)].join('|'); if(key===key2) possibleDupes.add(key); }}); }
  });
  const priceOut = importedSales.filter(s => s.sale_price_n && priceMed && (s.sale_price_n > priceMed*1.8 || s.sale_price_n < priceMed*0.55));
  const glaOut = importedSales.filter(s => s.gla_n && glaMed && (s.gla_n > glaMed*1.7 || s.gla_n < glaMed*0.6));
  const monthBuckets = {};
  importedSales.forEach(s=>{ const d=new Date(s.sale_date); if(!isNaN(d)){ const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); monthBuckets[k]=(monthBuckets[k]||0)+1; }});
  const thin = Object.entries(monthBuckets).filter(([,c])=>c<3).length;
  let html = '<div class="stats-row">' +
    `<div class="schip"><div class="slbl">Sales</div><div class="sval">${n}</div></div>`+
    `<div class="schip"><div class="slbl">Median Price</div><div class="sval">$${fmt(priceMed)}</div></div>`+
    `<div class="schip"><div class="slbl">Median GLA</div><div class="sval">${fmt(glaMed)} SF</div></div>`+
    `<div class="schip"><div class="slbl">Months</div><div class="sval">${Object.keys(monthBuckets).length}</div></div></div>`;
  html += '<div class="checklist">';
  html += statusItem(missing('sale_price')===0?'good':'bad','Sale price completeness',`${n-missing('sale_price')} of ${n} records include sale price.`);
  html += statusItem(missing('sale_date')===0?'good':'warn','Sale date completeness',`${n-missing('sale_date')} of ${n} records include sale date.`);
  html += statusItem(missing('gla')===0?'good':'warn','GLA completeness',`${n-missing('gla')} of ${n} records include GLA.`);
  html += statusItem(missing('condition')/n < .3?'good':'warn','Condition ratings',`${n-missing('condition')} of ${n} records include C rating.`);
  html += statusItem(missing('quality')/n < .3?'good':'warn','Quality ratings',`${n-missing('quality')} of ${n} records include Q rating.`);
  html += statusItem(thin===0?'good':'warn','Thin monthly periods',`${thin} month(s) have fewer than 3 sales; consider quarterly grouping or a broader dataset.`);
  html += statusItem(possibleDupes.size===0?'good':'warn','Duplicate-looking records',`${possibleDupes.size} duplicate key(s) found by address/date/price.`);
  html += statusItem(priceOut.length===0?'good':'warn','Price outliers',`${priceOut.length} record(s) are far from median price and should be reviewed.`);
  html += statusItem(glaOut.length===0?'good':'warn','GLA outliers',`${glaOut.length} record(s) are far from median GLA and should be reviewed.`);
  html += '</div>';
  if(priceOut.length || glaOut.length){
    const rows = [...new Set([...priceOut, ...glaOut])].slice(0,20).map(s=>`<tr><td>${esc(s.address)||'—'}</td><td>$${fmt(s.sale_price_n)}</td><td>${fmt(s.gla_n)} SF</td><td>${esc(s.sale_date)||'—'}</td><td>${esc(s.quality)||'—'}/${esc(s.condition)||'—'}</td></tr>`).join('');
    html += `<div class="sec">Records to Review</div><table class="tbl"><thead><tr><th>Address</th><th>Price</th><th>GLA</th><th>Date</th><th>Q/C</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  document.getElementById('dq-output').innerHTML = html;
  document.getElementById('dq-output').style.display = 'block';
}

function drawGLAScatter(){
  if(!importedSales.length){ alert('Import MLS data first.'); return; }
  const pairs = importedSales.filter(s=>!isNaN(s.gla_n)&&!isNaN(s.sale_price_n)&&s.gla_n>0&&s.sale_price_n>0).map(s=>({x:s.gla_n,y:s.sale_price_n}));
  if(pairs.length<3){ alert('Need at least 3 sales with GLA and price.'); return; }
  const reg = linReg(pairs);
  const canvas=document.getElementById('gla-scatter'), ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height,pad=48;
  const xs=pairs.map(p=>p.x), ys=pairs.map(p=>p.y), xmin=Math.min(...xs), xmax=Math.max(...xs), ymin=Math.min(...ys), ymax=Math.max(...ys);
  const xmap=x=>pad+(x-xmin)/(xmax-xmin||1)*(w-pad*2); const ymap=y=>h-pad-(y-ymin)/(ymax-ymin||1)*(h-pad*2);
  ctx.clearRect(0,0,w,h); ctx.fillStyle='#faf8f4'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='#ddd5c0'; ctx.strokeRect(pad,pad,w-pad*2,h-pad*2);
  ctx.fillStyle='#1a2744'; pairs.forEach(p=>{ctx.beginPath();ctx.arc(xmap(p.x),ymap(p.y),4,0,Math.PI*2);ctx.fill();});
  ctx.strokeStyle='#c5a028'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(xmap(xmin), ymap(reg.a+reg.b*xmin)); ctx.lineTo(xmap(xmax), ymap(reg.a+reg.b*xmax)); ctx.stroke();
  ctx.fillStyle='#1a1a1a'; ctx.font='12px Source Sans 3, sans-serif'; ctx.fillText(`Slope: $${fmt(reg.b,2)}/SF · R² ${fmt(reg.r2,3)} · n=${reg.n}`, pad, 24);
  ctx.fillText('GLA →', w/2-20, h-10); ctx.save(); ctx.translate(14,h/2+40); ctx.rotate(-Math.PI/2); ctx.fillText('Sale Price →',0,0); ctx.restore();
  document.getElementById('scatter-wrap').style.display='block';
}

let lastAdjustmentRows = [];
function buildAdjustmentGrid(){
  if(!importedSales.length || !subject.gla){ alert('Import MLS data and save the subject first.'); return; }
  const topN = parseInt(document.getElementById('adj-topn').value)||6;
  const mtRate = toNum(document.getElementById('adj-mt-rate').value)||0;
  const glaRate = toNum(document.getElementById('adj-gla-rate').value)||0;
  const siteRate = toNum(document.getElementById('adj-site-rate').value)||0;
  const ageRate = toNum(document.getElementById('adj-age-rate').value)||0;
  const condRate = toNum(document.getElementById('adj-cond-rate').value)||0;
  const qualRate = toNum(document.getElementById('adj-qual-rate').value)||0;
  const decimalMode = document.getElementById('adj-half-mode').value === 'on';
  const sales = rankedSales().slice(0, topN);
  lastAdjustmentRows = sales.map((s,i)=>{
    const months = subject.effdate && s.sale_date ? monthsBetween(subject.effdate, s.sale_date) : 0;
    const timeAdj = s.sale_price_n * (mtRate/100) * months;
    const glaAdj = subject.gla && s.gla_n ? (subject.gla - s.gla_n) * glaRate : 0;
    const siteAdj = subject.site && s.site_sf_n ? (subject.site - s.site_sf_n) * siteRate : 0;
    const ageAdj = subject.year && s.year_built_n ? (s.year_built_n - subject.year) * ageRate : 0;
    const cq = ratingDecimal(s.condition), sq = ratingDecimal(subject.cond); const qq = ratingDecimal(s.quality), qs = ratingDecimal(subject.qual);
    const cDiff = (sq&&cq) ? (decimalMode ? cq-sq : Math.round(cq)-Math.round(sq)) : 0;
    const qDiff = (qs&&qq) ? (decimalMode ? qq-qs : Math.round(qq)-Math.round(qs)) : 0;
    const condAdj = cDiff * condRate;
    const qualAdj = qDiff * qualRate;
    const otherAdj = 0;
    const totalAdj = timeAdj+glaAdj+siteAdj+ageAdj+condAdj+qualAdj+otherAdj;
    return {rank:i+1,address:s.address||'',price:s.sale_price_n||0,date:s.sale_date||'',score:s._score||0,timeAdj,glaAdj,siteAdj,ageAdj,condAdj,qualAdj,otherAdj,totalAdj,adjusted:(s.sale_price_n||0)+totalAdj,note:''};
  });
  renderAdjustmentGrid();
}
function renderAdjustmentGrid(){
  const rows = lastAdjustmentRows.map((r,i)=>`<tr>
    <td>${r.rank}</td><td>${esc(r.address)||'—'}</td><td class="num">$${fmt(r.price)}</td><td>${esc(r.date)||'—'}</td><td class="num">${fmt(r.score,0)}</td>
    ${['timeAdj','glaAdj','siteAdj','ageAdj','condAdj','qualAdj','otherAdj'].map(k=>`<td><input class="adj-input" value="${fmt(r[k],0).replace(/,/g,'')}" onchange="editAdj(${i},'${k}',this.value)"></td>`).join('')}
    <td class="num adj-total">${fmtD(r.totalAdj)}</td><td class="num adj-total">$${fmt(r.adjusted)}</td><td><input class="adj-note" value="${esc(r.note)}" onchange="lastAdjustmentRows[${i}].note=this.value"></td>
  </tr>`).join('');
  document.getElementById('adj-grid-out').innerHTML = `<table class="tbl"><thead><tr><th>Rank</th><th>Comp</th><th>Sale Price</th><th>Date</th><th>Score</th><th>Time</th><th>GLA</th><th>Site</th><th>Age</th><th>Cond</th><th>Qual</th><th>Other</th><th>Net Adj</th><th>Adjusted</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
  document.getElementById('adj-grid-out').style.display='block';
  renderReconciliation();
}
function editAdj(i,k,v){ lastAdjustmentRows[i][k]=toNum(v)||0; const r=lastAdjustmentRows[i]; r.totalAdj=r.timeAdj+r.glaAdj+r.siteAdj+r.ageAdj+r.condAdj+r.qualAdj+r.otherAdj; r.adjusted=r.price+r.totalAdj; renderAdjustmentGrid(); }
function renderReconciliation(){
  const vals=lastAdjustmentRows.map(r=>r.adjusted).filter(v=>v>0); if(!vals.length)return;
  const weights=lastAdjustmentRows.map(r=>Math.max(1,r.score)); const wAvg=lastAdjustmentRows.reduce((a,r)=>a+r.adjusted*Math.max(1,r.score),0)/weights.reduce((a,b)=>a+b,0);
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length, med=median(vals), low=Math.min(...vals), high=Math.max(...vals);
  const html=`<div class="card" style="margin-bottom:0;"><div class="card-title">Reconciliation Summary</div><div class="stats-row">
    <div class="schip"><div class="slbl">Low</div><div class="sval">$${fmt(low)}</div></div><div class="schip"><div class="slbl">Median</div><div class="sval">$${fmt(med)}</div></div><div class="schip"><div class="slbl">Mean</div><div class="sval">$${fmt(avg)}</div></div><div class="schip"><div class="slbl">Score-Weighted</div><div class="sval">$${fmt(wAvg)}</div></div><div class="schip"><div class="slbl">Range</div><div class="sval">$${fmt(high-low)}</div></div></div>
    <div class="warn-block"><strong>Suggested reconciliation language</strong>The adjusted comparables indicate a range from $${fmt(low)} to $${fmt(high)}, with a median of $${fmt(med)} and a similarity-score-weighted indication of $${fmt(wAvg)}. Greatest weight should be placed on the sales requiring the fewest and most supportable adjustments, with final reconciliation completed by the appraiser.</div></div>`;
  document.getElementById('recon-out').innerHTML=html; document.getElementById('recon-out').style.display='block';
}
function exportAdjustmentCSV(){
  if(!lastAdjustmentRows.length){ alert('Build the adjustment grid first.'); return; }
  const headers=['rank','address','sale_price','sale_date','score','time_adj','gla_adj','site_adj','age_adj','condition_adj','quality_adj','other_adj','net_adj','adjusted_price','note'];
  const csv=[headers.join(',')].concat(lastAdjustmentRows.map(r=>headers.map(h=>`"${String(({rank:r.rank,address:r.address,sale_price:r.price,sale_date:r.date,score:Math.round(r.score),time_adj:r.timeAdj,gla_adj:r.glaAdj,site_adj:r.siteAdj,age_adj:r.ageAdj,condition_adj:r.condAdj,quality_adj:r.qualAdj,other_adj:r.otherAdj,net_adj:r.totalAdj,adjusted_price:r.adjusted,note:r.note}[h])??'').replace(/"/g,'""')}"`).join(','))).join('\n');
  downloadText(csv,'adjustment_grid.csv','text/csv');
}
function downloadText(text, filename, type){ const blob=new Blob([text],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }

function buildQCScaleDefs(){
  const defs = [
    ['1','Exceptional benchmark. Q1: architect/custom/highest-grade materials. C1: new, never occupied, no physical depreciation.'],
    ['1.5','Clearly between 1 and 2. Better than typical superior stock, but not enough support for a full 1 rating.'],
    ['2','Superior. Q2: high-quality materials/workmanship. C2: nearly new or comprehensively renovated, no deferred maintenance.'],
    ['2.5','Between superior and good. Above local good/updated norms, but not consistently superior throughout.'],
    ['3','Good. Q3: good materials, some upgrades. C3: well maintained with limited depreciation or updates.'],
    ['3.5','Between good and standard. Better than average builder/market standard, but not enough to call full Q3/C3.'],
    ['4','Standard / average. Q4: standard builder grade. C4: adequately maintained with minor wear or age typical for market.'],
    ['4.5','Between average and fair. Noticeably weaker than C4/Q4, but not clearly economy/fair enough for C5/Q5.'],
    ['5','Fair / economy. Q5: economy construction or limited appeal. C5: obvious deferred maintenance or needed repairs.'],
    ['5.5','Between fair and poor. Approaching substantial deficiencies, but not enough evidence for a full 6.'],
    ['6','Lowest / poor. Q6: minimal standards. C6: substantial damage, major repairs, or severe deferred maintenance.']
  ];
  const el=document.getElementById('qc-scale-defs');
  if(el) el.innerHTML=defs.map(([n,d])=>`<div class="qc-scale-card"><strong>${n}</strong><div>${d}</div></div>`).join('');
}

let qcAnchorSample = [];
let qcCalibrationRatings = [];
let qcSuggestionRows = [];

function qcSampleCount(){
  const pct = Math.max(5, Math.min(50, parseFloat(document.getElementById('qc-cal-pct')?.value)||10));
  return Math.max(3, Math.min(10, Math.ceil(importedSales.length * pct / 100))); // cap at 10 so calibration stays faster than doing every comp manually
}

function qcAllText(s){
  // Look across mapped/imported text fields for renovation/update clues. This lets a renovated older house escape a simple age bucket.
  return Object.entries(s||{}).filter(([k,v])=>typeof v==='string' && !k.startsWith('_')).map(([,v])=>v).join(' ').toLowerCase();
}
function renovationSignal(s){
  const t=qcAllText(s);
  if(!t) return null;
  if(/(completely|fully|totally|gut|major|extensive)\s+(renovat|remodel|updated)|renovat(ed|ion)|remodel(ed|ed throughout)|like new|new roof|new hvac|new kitchen|new bath/.test(t)){
    return {prior:2, label:'renovation/update evidence'};
  }
  if(/partial(ly)?\s+(renovat|remodel|updated)|some updates|updated kitchen|updated bath|recent updates/.test(t)){
    return {prior:3, label:'partial update evidence'};
  }
  if(/needs\s+(work|repair|tlc)|deferred|as[-\s]?is|fixer|poor condition|damage|repair needed/.test(t)){
    return {prior:5, label:'deferred maintenance evidence'};
  }
  return null;
}
function ageBucketLabelForSale(s){
  const ts=conditionTextSignal(s);
  if(ts) return ts.band;
  const age=saleAge(s);
  if(age===null) return 'unknown';
  if(age<=0) return 'new / under construction';
  if(age<=5) return '1-5 years';
  if(age<=10) return '6-10 years';
  if(age<=15) return '11-15 years';
  if(age<=25) return '16-25 years';
  if(age<=40) return '26-40 years';
  return '40+ years';
}
function learnedConditionByBucket(s){
  const bucket=ageBucketLabelForSale(s);
  const matches=qcCalibrationRatings.filter(a=>a.cn && a.bucket===bucket);
  if(!matches.length) return null;
  return matches.reduce((sum,a)=>sum+a.cn,0)/matches.length;
}
function directAnchorRating(s, field){
  const a=qcCalibrationRatings.find(x=>x.id===s._id);
  if(!a) return null;
  const val = field==='q' ? a.qn : a.cn;
  return val ? {v:val, raw:val, basis:'appraiser anchor rating - exact sale', conf:'high'} : null;
}

function conditionTextSignal(s){
  const raw = String(s.year_built || s.age || s.property_age || '').trim();
  const t = raw.toLowerCase();
  if(!t) return null;
  // Many MLS exports put age buckets in the Year Built column: Under Construction, New/Never Lived In, 1-5, 6-10, etc.
  if(/under\s*construction|new\s*construction|new\s*\/\s*never|never\s*lived|new\s*never|to\s*be\s*built/.test(t)){
    return {age:0, prior:1, band:'new / under construction', strength:'strong'};
  }
  const range = t.match(/(\d{1,3})\s*[-–to]+\s*(\d{1,3})/);
  if(range){
    const a=parseFloat(range[1]), b=parseFloat(range[2]);
    const mid=(a+b)/2;
    let prior=5, band=raw;
    if(mid<=5){ prior=2; band='1-5 years'; }
    else if(mid<=10){ prior=3; band='6-10 years'; }
    else if(mid<=15){ prior=3.5; band='11-15 years'; }
    else if(mid<=25){ prior=4; band='16-25 years'; }
    else if(mid<=40){ prior=4.5; band='26-40 years'; }
    else { prior=5; band='40+ years'; }
    return {age:mid, prior, band, strength:'strong'};
  }
  if(/^new$|^0$/.test(t)) return {age:0, prior:1, band:'new', strength:'strong'};
  return null;
}
function saleAge(s){
  const textSignal = conditionTextSignal(s);
  if(textSignal && textSignal.age!==null) return textSignal.age;
  const y = toNum(s.year_built);
  if(isNaN(y) || y<1700) return null;
  const eff = subject.effdate ? new Date(subject.effdate) : new Date();
  const yr = isNaN(eff) ? new Date().getFullYear() : eff.getFullYear();
  return Math.max(0, yr - y);
}
function percentile(arr, p){
  const vals=arr.filter(v=>!isNaN(v) && isFinite(v)).sort((a,b)=>a-b);
  if(!vals.length) return NaN;
  const idx=(vals.length-1)*p, lo=Math.floor(idx), hi=Math.ceil(idx);
  return lo===hi ? vals[lo] : vals[lo] + (vals[hi]-vals[lo])*(idx-lo);
}
function robustZ(v, arr){
  if(isNaN(v) || !isFinite(v)) return 0;
  const med=percentile(arr,.5), q1=percentile(arr,.25), q3=percentile(arr,.75);
  const iqr=Math.max(1, q3-q1);
  return Math.abs(v-med)/iqr;
}
function conditionAgePrior(s){
  const textSignal = conditionTextSignal(s);
  if(textSignal && textSignal.prior) return textSignal.prior;
  const age=saleAge(s);
  if(age===null) return null;
  // C1 is reserved for effectively new / never occupied. Age buckets then step into normal resale condition bands.
  if(age <= 0) return 1;
  if(age <= 5) return 2;      // 1-5 years: typically C2 absent contrary evidence
  if(age <= 10) return 3;     // 6-10 years: often where C3 starts in this workflow
  if(age <= 15) return 3.5;
  if(age <= 25) return 4;
  if(age <= 40) return 4.5;
  if(age <= 60) return 5;
  return 5.5;
}
function qcRiskFactors(s, stats){
  const factors=[];
  const age=saleAge(s), price=s.sale_price_n||NaN, gla=s.gla_n||NaN, year=toNum(s.year_built);
  const pz=robustZ(price, stats.prices), gz=robustZ(gla, stats.glas), yz=robustZ(year, stats.years);
  if(pz>=1.5) factors.push('price outlier');
  if(gz>=1.5) factors.push('GLA outlier');
  if(yz>=1.2) factors.push('year-built / age outlier');
  if(!s.quality) factors.push('missing quality');
  if(!s.condition) factors.push('missing condition');
  const c=ratingDecimal(s.condition);
  if(c===1 && age!==null && age>0) factors.push('C1 conflicts with age');
  if(c && age!==null){
    const prior=conditionAgePrior(s);
    if(prior && Math.abs(c-prior)>=1.5) factors.push('condition differs from age signal');
  }
  if(subject.gla && s.gla_n && Math.abs(s.gla_n-subject.gla)/subject.gla>.2) factors.push('far from subject GLA');
  if(subject.year && year && Math.abs(year-subject.year)>10) factors.push('different age than subject');
  return factors;
}
function qcRiskScore(s, stats){
  const age=saleAge(s), price=s.sale_price_n||NaN, gla=s.gla_n||NaN, year=toNum(s.year_built);
  let score=0;
  score += Math.min(4, robustZ(price, stats.prices))*14;
  score += Math.min(4, robustZ(gla, stats.glas))*14;
  score += Math.min(4, robustZ(year, stats.years))*12;
  if(!s.quality) score += 18;
  if(!s.condition) score += 18;
  const c=ratingDecimal(s.condition);
  if(c===1 && age!==null && age>0) score += 45;
  if(c && age!==null){ const prior=conditionAgePrior(s); if(prior) score += Math.min(30, Math.abs(c-prior)*10); }
  if(subject.gla && s.gla_n) score += Math.min(25, Math.abs(s.gla_n-subject.gla)/subject.gla*60);
  if(subject.year && year) score += Math.min(25, Math.abs(year-subject.year)*1.5);
  return score;
}
function riskBasedSample(sales, n){
  const stats={prices:sales.map(s=>s.sale_price_n), glas:sales.map(s=>s.gla_n), years:sales.map(s=>toNum(s.year_built))};
  const scored=sales.map(s=>({...s, _qcRisk:qcRiskScore(s,stats), _qcFactors:qcRiskFactors(s,stats)})).sort((a,b)=>b._qcRisk-a._qcRisk);
  const out=[]; const ageBuckets=new Set();
  // First pass: pick the highest-risk sales while trying not to take only new construction.
  for(const s of scored){
    if(out.length>=n) break;
    const age=saleAge(s); const bucket=age===null?'unknown':age<=0?'new':age<=5?'1-5':age<=15?'6-15':age<=30?'16-30':'30+';
    if(out.length < Math.ceil(n*.65) || !ageBuckets.has(bucket)) { out.push(s); ageBuckets.add(bucket); }
  }
  for(const s of scored){ if(out.length>=n) break; if(!out.some(x=>x._id===s._id)) out.push(s); }
  return out.slice(0,n);
}

function spectrumBand(value, arr, labels){
  if(isNaN(value) || !isFinite(value) || !arr.filter(v=>!isNaN(v)&&isFinite(v)).length) return 'unknown';
  const q1=percentile(arr,.25), q2=percentile(arr,.50), q3=percentile(arr,.75);
  if(value<=q1) return labels[0];
  if(value<=q2) return labels[1];
  if(value<=q3) return labels[2];
  return labels[3];
}
function ageSpectrumBand(s){
  const signal=conditionTextSignal(s);
  if(signal && signal.band) return signal.band + ' / C' + signal.prior + ' age signal';
  const age=saleAge(s);
  if(age===null) return 'age unknown';
  if(age<=0) return 'new / C1 candidate';
  if(age<=5) return '1-5 years / C2 candidate';
  if(age<=10) return '6-10 years / C3 candidate';
  if(age<=15) return '11-15 years / C3.5 candidate';
  if(age<=25) return '16-25 years / C4 candidate';
  if(age<=50) return 'older / C4.5-C5 candidate';
  return 'oldest / C5+ candidate';
}
function mlsOrProxyCBand(s){
  const prior=conditionAgePrior(s);
  const signal=conditionTextSignal(s);
  // For sampling, the age/text signal is more useful than a uniform MLS C field, because it forces anchors across the spectrum.
  if(signal && prior) return 'Age/Text C'+prior+' group';
  if(prior) return 'Age C'+prior+' group';
  const c=ratingDecimal(s.condition);
  if(c) return 'MLS C'+Math.round(c)+' group';
  return 'C unknown';
}
function mlsOrProxyQBand(s, stats){
  const q=ratingDecimal(s.quality);
  if(q) return 'Q'+Math.round(q);
  const ppsf=(s.sale_price_n&&s.gla_n)?s.sale_price_n/s.gla_n:NaN;
  return 'Q proxy '+spectrumBand(ppsf, stats.ppsf, ['lower','low-mid','high-mid','higher']);
}
function spectrumKey(s, stats){
  return [mlsOrProxyQBand(s,stats), mlsOrProxyCBand(s), ageSpectrumBand(s)].join(' | ');
}
function spectrumBasedSample(sales, n){
  const stats={
    prices:sales.map(s=>s.sale_price_n),
    glas:sales.map(s=>s.gla_n),
    years:sales.map(s=>toNum(s.year_built)),
    ppsf:sales.map(s=>(s.sale_price_n&&s.gla_n)?s.sale_price_n/s.gla_n:NaN)
  };
  const enriched=sales.map(s=>{
    const ageBand=ageSpectrumBand(s);
    const qBand=mlsOrProxyQBand(s,stats);
    const cBand=mlsOrProxyCBand(s);
    const priceBand=spectrumBand(s.sale_price_n,stats.prices,['low price','mid-low price','mid-high price','high price']);
    const glaBand=spectrumBand(s.gla_n,stats.glas,['small GLA','mid-small GLA','mid-large GLA','large GLA']);
    const risk=qcRiskScore(s,stats);
    const factors=[`spectrum: ${qBand}`, `${cBand}`, ageBand, priceBand, glaBand];
    const riskFactors=qcRiskFactors(s,stats);
    if(riskFactors.length) factors.push('review: '+riskFactors.join(', '));
    return {...s,_qcSpectrumKey:spectrumKey(s,stats),_qcRisk:risk,_qcFactors:factors};
  });
  const out=[];
  const addOne=(list)=>{
    const pick=list.filter(s=>!out.some(x=>x._id===s._id)).sort((a,b)=>b._qcRisk-a._qcRisk)[0];
    if(pick && out.length<n) out.push(pick);
  };
  // 1) Force coverage across condition/age first, so new/C1 and nearly-new/C2 do not get blended together.
  const cGroups=[...new Set(enriched.map(s=>mlsOrProxyCBand(s)))].sort();
  cGroups.forEach(g=>addOne(enriched.filter(s=>mlsOrProxyCBand(s)===g)));
  const ageGroups=[...new Set(enriched.map(s=>ageSpectrumBand(s)))];
  ageGroups.forEach(g=>addOne(enriched.filter(s=>ageSpectrumBand(s)===g)));
  // 2) Add coverage across quality/proxy-quality groups.
  const qGroups=[...new Set(enriched.map(s=>mlsOrProxyQBand(s,stats)))].sort();
  qGroups.forEach(g=>addOne(enriched.filter(s=>mlsOrProxyQBand(s,stats)===g)));
  // 3) Add price and GLA extremes so the professional sees the range of the pool.
  ['low price','high price'].forEach(g=>addOne(enriched.filter(s=>spectrumBand(s.sale_price_n,stats.prices,['low price','mid-low price','mid-high price','high price'])===g)));
  ['small GLA','large GLA'].forEach(g=>addOne(enriched.filter(s=>spectrumBand(s.gla_n,stats.glas,['small GLA','mid-small GLA','mid-large GLA','large GLA'])===g)));
  // 4) Fill remaining slots with highest-risk items not already selected.
  enriched.sort((a,b)=>b._qcRisk-a._qcRisk).forEach(s=>{ if(out.length<n && !out.some(x=>x._id===s._id)) out.push(s); });
  return out.slice(0,n);
}
function stratifiedSample(sales, n){
  const valid=[...sales];
  if(valid.length<=n) return valid;
  const score=s=>{
    const age=saleAge(s); const p=s.sale_price_n||0; const g=s.gla_n||0;
    return (age===null?50:age)*100000000 + p*100 + g;
  };
  valid.sort((a,b)=>score(a)-score(b));
  const out=[];
  for(let i=0;i<n;i++) out.push(valid[Math.round(i*(valid.length-1)/(n-1))]);
  return [...new Map(out.map(x=>[x._id,x])).values()];
}
function pickQCSample(){
  if(!importedSales.length){ alert('Import MLS data first.'); return []; }
  const n=qcSampleCount();
  const method=document.getElementById('qc-cal-method')?.value || 'risk';
  let sales=[...importedSales];
  if(method==='spectrum'){ sales=spectrumBasedSample(sales,n); }
  else if(method==='risk'){ sales=riskBasedSample(sales,n); }
  else if(method==='ranked' && subject.gla){ sales=rankedSales().slice(0,n); }
  else if(method==='stratified'){ sales=stratifiedSample(sales,n); }
  else { sales=sales.sort(()=>Math.random()-.5).slice(0,n); }
  return sales.slice(0,n);
}
function openQCCalibrationModal(){
  qcAnchorSample=pickQCSample();
  if(!qcAnchorSample.length) return;
  const savedById = new Map(qcCalibrationRatings.map(r=>[r.id,r]));
  const html = qcAnchorSample.map((s,i)=>{
    const saved=savedById.get(s._id)||{};
    const age=saleAge(s);
    return `<div class="qc-anchor-card" data-sale-id="${s._id}">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><strong>${i+1}. ${esc(s.address)||'Address not mapped'}</strong><span class="qc-pill">Anchor ${i+1} of ${qcAnchorSample.length}</span></div>
      <div class="qc-anchor-meta">
        <div>Sale price: <strong>${s.sale_price_n?'$'+fmt(s.sale_price_n):'—'}</strong></div>
        <div>Sale date: <strong>${esc(s.sale_date)||'—'}</strong></div>
        <div>GLA: <strong>${s.gla_n?fmt(s.gla_n)+' SF':'—'}</strong></div>
        <div>Year / age: <strong>${esc(s.year_built)||'—'}${age!==null?' / '+age+' yrs':''}</strong></div>
        <div>MLS Q/C: <strong>${esc(s.quality)||'—'} / ${esc(s.condition)||'—'}</strong></div>
        <div>Why selected: <strong>${esc((s._qcFactors&&s._qcFactors.length?s._qcFactors.join(', '):'Q/C spectrum coverage'))}</strong></div>
      </div>
      <div class="grid3">
        <div class="fg"><label>Professional Quality Rating</label><select class="anchor-q">${qcOptions('Q', saved.q || s.quality)}</select></div>
        <div class="fg"><label>Professional Condition Rating</label><select class="anchor-c">${qcOptions('C', saved.c || s.condition)}</select></div>
        <div class="fg"><label>Evidence / Notes</label><input class="anchor-note" value="${esc(saved.note||'')}" placeholder="photos, updates, wear, materials, repairs"></div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('qc-modal-sales').innerHTML=html;
  document.getElementById('qc-rating-modal').classList.add('on');
}
function closeQCCalibrationModal(){ document.getElementById('qc-rating-modal').classList.remove('on'); }
function qcOptions(prefix, selected){
  const vals=[1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6]; const seln=ratingDecimal(selected);
  return '<option value="">Select</option>'+vals.map(v=>`<option value="${prefix}${v}" ${seln===v?'selected':''}>${prefix}${v} — ${qcShortDef(v)}</option>`).join('');
}
function qcShortDef(v){ if(v%1) return `between ${Math.floor(v)} and ${Math.ceil(v)}`; return ['','exceptional/new','superior','good/updated','standard/average','fair/economy','poor/substantial'][v]; }
function saveQCCalibrationRatings(){
  const rows=[...document.querySelectorAll('#qc-modal-sales .qc-anchor-card')];
  const ratings=[];
  rows.forEach(card=>{
    const id=parseInt(card.dataset.saleId);
    const s=importedSales.find(x=>x._id===id);
    const q=card.querySelector('.anchor-q').value;
    const c=card.querySelector('.anchor-c').value;
    const note=card.querySelector('.anchor-note').value.trim();
    if(s && (q || c)) ratings.push({id, q, c, qn:ratingDecimal(q), cn:ratingDecimal(c), note, age:saleAge(s), bucket:ageBucketLabelForSale(s), price:s.sale_price_n, gla:s.gla_n, year:s.year_built_n});
  });
  if(!ratings.length){ alert('Rate at least one anchor sale.'); return; }
  qcCalibrationRatings=ratings;
  closeQCCalibrationModal();
  runQCCalibrationModel();
}
function clampQC(v){ return Math.max(1, Math.min(6, Math.round(v*2)/2)); }
function nearestAnchorEstimate(s, field){
  const anchors=qcCalibrationRatings.filter(a=>field==='q'?a.qn:a.cn);
  if(!anchors.length) return null;
  const age=saleAge(s); const price=s.sale_price_n||0; const gla=s.gla_n||0;
  let num=0, den=0;
  anchors.forEach(a=>{
    const ad=(age!==null && a.age!==null) ? Math.abs(age-a.age)/40 : 0.6;
    const pd=(price&&a.price) ? Math.abs(price-a.price)/Math.max(price,a.price,1) : 0.35;
    const gd=(gla&&a.gla) ? Math.abs(gla-a.gla)/Math.max(gla,a.gla,1) : 0.35;
    const dist=0.45*ad + 0.30*pd + 0.25*gd;
    const w=1/(0.08+dist);
    num += (field==='q'?a.qn:a.cn)*w; den += w;
  });
  return den ? num/den : null;
}
function ageConditionEstimate(s){
  const anchors=qcCalibrationRatings.filter(a=>a.cn && a.age!==null);
  const age=saleAge(s);
  if(age===null || anchors.length<2) return null;
  const xs=anchors.map(a=>a.age), ys=anchors.map(a=>a.cn), n=xs.length;
  const sx=xs.reduce((a,b)=>a+b,0), sy=ys.reduce((a,b)=>a+b,0), sxy=xs.reduce((a,x,i)=>a+x*ys[i],0), sx2=xs.reduce((a,x)=>a+x*x,0);
  const denom=n*sx2-sx*sx;
  if(Math.abs(denom)<0.0001) return null;
  const b=(n*sxy-sx*sy)/denom, a=(sy-b*sx)/n;
  return a+b*age;
}
function mlsRatingEstimate(s, field){
  const val = field==='q' ? s.quality : s.condition;
  const n=ratingDecimal(val);
  return n || null;
}
function inferQCForSale(s){
  // The appraiser's rated anchors are the truth. Never let age/status rules overwrite them.
  const qAnchor=directAnchorRating(s,'q');
  const cAnchor=directAnchorRating(s,'c');

  const qNear=nearestAnchorEstimate(s,'q');
  const cNear=nearestAnchorEstimate(s,'c');
  const cAge=ageConditionEstimate(s);
  const cPrior=conditionAgePrior(s);
  const cBucket=learnedConditionByBucket(s);
  const reno=renovationSignal(s);
  const textSignal=conditionTextSignal(s);
  const qMls=mlsRatingEstimate(s,'q');
  const cMls=mlsRatingEstimate(s,'c');
  let qParts=[], cParts=[];

  if(qAnchor) qParts.push([qAnchor.v,1.50,'appraiser exact anchor']);
  else {
    if(qNear) qParts.push([qNear,.95,'appraiser anchor similarity']);
    if(qMls) qParts.push([qMls,.18,'MLS field']);
  }

  if(cAnchor) cParts.push([cAnchor.v,1.80,'appraiser exact anchor']);
  else {
    // For C, appraiser anchors and learned same-bucket behavior should beat generic age rules.
    if(cNear) cParts.push([cNear,1.05,'appraiser anchor similarity']);
    if(cBucket) cParts.push([cBucket,.85,'learned from appraiser-rated same age/status bucket']);
    if(reno) cParts.push([reno.prior,.75,reno.label]);
    if(cAge) cParts.push([cAge,.20,'anchor age model']);
    if(cPrior) cParts.push([cPrior, textSignal ? .38 : .25, textSignal ? 'MLS age/status baseline' : 'age baseline']);
    if(cMls) cParts.push([cMls,.08,'MLS field']);
  }

  const calc=parts=>{
    if(!parts.length) return {v:null, basis:'no data', conf:'low'};
    const sw=parts.reduce((a,p)=>a+p[1],0); const val=parts.reduce((a,p)=>a+p[0]*p[1],0)/sw;
    const spread=parts.length>1 ? Math.max(...parts.map(p=>p[0]))-Math.min(...parts.map(p=>p[0])) : .5;
    const hasAnchor=parts.some(p=>String(p[2]).includes('appraiser'));
    const conf = qcCalibrationRatings.length>=5 && hasAnchor && spread<=1 ? 'high' : qcCalibrationRatings.length>=3 && spread<=1.5 ? 'medium' : 'low';
    return {v:clampQC(val), raw:val, basis:parts.map(p=>p[2]).join(' + '), conf};
  };
  const qCalc=calc(qParts);
  const cCalc=calc(cParts);

  // Only use hard guardrails when there is no exact appraiser anchor and no renovation/condition evidence to the contrary.
  if(!cAnchor){
    if(textSignal && textSignal.prior===1 && !reno){ cCalc.v=1; cCalc.conf='high'; cCalc.basis += ' + C1 status guardrail for new/never-lived-in/under-construction'; }
    else if(textSignal && textSignal.prior===2 && cCalc.v<2){ cCalc.v=2; cCalc.basis += ' + C1 blocked for 1-5 year resale bucket'; }
    const age=saleAge(s);
    if(cCalc.v && age!==null && age<=0 && cCalc.v>1.5 && !reno){ cCalc.v=1; cCalc.basis += ' + new-construction C1 reasonableness check'; }
    if(cCalc.v && age!==null && age>0 && cCalc.v<2){ cCalc.v=2; cCalc.basis += ' + C1 age guardrail'; }
  }

  // When evidence conflicts, do not pretend certainty.
  if(!cAnchor && cPrior && cCalc.v && Math.abs(cCalc.v-cPrior)>=1.0){
    cCalc.conf = cCalc.conf==='high' ? 'medium' : cCalc.conf;
    cCalc.basis += ' + evidence conflicts with age baseline; appraiser review recommended';
  }
  return {q:qCalc, c:cCalc};
}
function runQCCalibrationModel(){
  if(!importedSales.length){ alert('Import MLS data first.'); return; }
  if(!qcCalibrationRatings.length){ openQCCalibrationModal(); return; }
  qcSuggestionRows = importedSales.map(s=>{
    const inf=inferQCForSale(s);
    s.suggested_quality = inf.q.v ? 'Q'+inf.q.v : '';
    s.suggested_condition = inf.c.v ? 'C'+inf.c.v : '';
    s.qc_confidence = (inf.q.conf==='high' && inf.c.conf==='high') ? 'high' : (inf.q.conf==='low' || inf.c.conf==='low') ? 'low' : 'medium';
    return {sale:s, inf};
  });
  renderQCSuggestions();
}
function renderQCSuggestions(){
  const anchors=qcCalibrationRatings.length;
  const n=importedSales.length;
  const rows=qcSuggestionRows.slice(0,100).map(({sale:s,inf})=>{
    const conf=s.qc_confidence||'low'; const cls=conf==='high'?'qc-conf-high':conf==='medium'?'qc-conf-med':'qc-conf-low';
    const age=saleAge(s);
    return `<tr><td>${esc(s.address)||'—'}</td><td class="num">${s.sale_price_n?'$'+fmt(s.sale_price_n):'—'}</td><td class="num">${s.gla_n?fmt(s.gla_n):'—'}</td><td class="num">${esc(s.year_built)||'—'}${age!==null?' / '+age:''}</td><td>${esc(s.quality)||'—'} / ${esc(s.condition)||'—'}</td><td><strong>${inf.q.v?'Q'+inf.q.v:'—'}</strong><br><span style="font-size:11px;color:var(--text-muted);">${esc(inf.q.basis)}</span></td><td><strong>${inf.c.v?'C'+inf.c.v:'—'}</strong><br><span style="font-size:11px;color:var(--text-muted);">${esc(inf.c.basis)}</span></td><td class="${cls}">${conf}</td></tr>`;
  }).join('');
  const noteText = qcCalibrationRatings.map(r=>r.note).filter(Boolean).join('; ');
  document.getElementById('qc-cal-summary').innerHTML=`<div class="nar-lbl">Q/C Calibration Summary</div><p>Rated <strong>${anchors}</strong> anchor sale(s), approximately <strong>${fmt(anchors/n*100,1)}%</strong> of the imported comp pool. The model now treats appraiser-rated anchors as controlling evidence, learns from the age/status bucket of those anchors, and uses age/status only as a baseline. Renovation/update and deferred-maintenance keywords can move the suggestion away from the age baseline. Conflicts are flagged for appraiser review instead of forcing a rating.</p><p>Half-step ratings are internal analytical support. Final UAD reporting may still need whole Q/C labels, with half-steps documented as reconciliation support.</p>${noteText?'<p><strong>Anchor evidence notes:</strong> '+esc(noteText)+'</p>':''}`;
  document.getElementById('qc-cal-summary').classList.add('on');
  document.getElementById('qc-suggest-out').innerHTML=`<table class="tbl"><thead><tr><th>Comp</th><th>Price</th><th>GLA</th><th>Year / Age</th><th>MLS Q/C</th><th>Suggested Q</th><th>Suggested C</th><th>Confidence</th></tr></thead><tbody>${rows}</tbody></table>`;
  const qcComment=document.getElementById('qcn-comment');
  if(qcComment && !qcComment.value.trim()) qcComment.value='Q/C calibration rated '+anchors+' spectrum-based anchor sale(s). Condition suggestions use appraiser anchors plus age/status buckets. Under Construction and New/Never Lived In are treated as C1 candidates; 1-5 years generally starts at C2; 6-10 years generally starts at C3 unless the appraiser\'s evidence supports otherwise.';
}
function applySuggestedQCToImportedSales(){
  if(!qcSuggestionRows.length){ runQCCalibrationModel(); if(!qcSuggestionRows.length) return; }
  let changed=0;
  qcSuggestionRows.forEach(({sale:s,inf})=>{
    if(!s.quality && inf.q.v){ s.quality='Q'+inf.q.v; changed++; }
    if(!s.condition && inf.c.v){ s.condition='C'+inf.c.v; changed++; }
  });
  renderImportSummary();
  flashSave('Applied suggested Q/C to '+changed+' missing field(s).');
}

function collectWorkfile(){ return {version:'v7-spectrum-qc-auto-narrative', savedAt:new Date().toISOString(), subject, importedSales, globalMonthlyRate, lastAdjustmentRows, qcCalibrationRatings, qcSuggestionRows}; }
function saveWorkfileLocal(){ localStorage.setItem('appraiserSuiteWorkfile', JSON.stringify(collectWorkfile())); flashSave('Saved to this browser.'); }
function restoreWorkfileLocal(){ const raw=localStorage.getItem('appraiserSuiteWorkfile'); if(!raw){ alert('No browser save found.'); return; } loadWorkfile(JSON.parse(raw)); flashSave('Restored browser save.'); }
function downloadWorkfileJSON(){ downloadText(JSON.stringify(collectWorkfile(),null,2),'appraisal_workfile.json','application/json'); }
function importWorkfileJSON(inp){ const f=inp.files[0]; if(!f)return; const r=new FileReader(); r.onload=e=>{ loadWorkfile(JSON.parse(e.target.result)); flashSave('Imported JSON workfile.'); }; r.readAsText(f); }
function loadWorkfile(w){ subject=w.subject||{}; importedSales=w.importedSales||[]; globalMonthlyRate=w.globalMonthlyRate||0; lastAdjustmentRows=w.lastAdjustmentRows||[]; qcCalibrationRatings=w.qcCalibrationRatings||[]; qcSuggestionRows=w.qcSuggestionRows||[]; updateBadge('badge-import', importedSales.length); updateBadge('badge-rank', importedSales.length); if(importedSales.length) renderImportSummary(); if(lastAdjustmentRows.length) renderAdjustmentGrid(); if(qcSuggestionRows.length) renderQCSuggestions(); document.getElementById('storage-status').innerHTML='<div class="nar-lbl">Loaded</div><p>Workfile restored with '+importedSales.length+' imported sales.</p>'; document.getElementById('storage-status').style.display='block'; }
function flashSave(msg){ let b=document.getElementById('save-banner'); if(!b){ b=document.createElement('div'); b.id='save-banner'; b.className='save-banner'; document.body.appendChild(b); } b.textContent=msg; b.classList.add('on'); setTimeout(()=>b.classList.remove('on'),2400); const st=document.getElementById('storage-status'); if(st){st.innerHTML='<div class="nar-lbl">Status</div><p>'+esc(msg)+'</p>'; st.style.display='block';}}



// ══════════════════════════════════════════════════
// WORK FILE PRINT / PDF EXPORT
// ══════════════════════════════════════════════════
function openWorkfilePrintDialog(){ document.getElementById('print-modal').classList.add('on'); }
function closeWorkfilePrintDialog(){ document.getElementById('print-modal').classList.remove('on'); }
function pfChecked(id){ const el=document.getElementById(id); return !el || el.checked; }
function wfMoney(v){ return (v || v===0) && isFinite(v) ? '$'+fmt(v) : '—'; }
function wfVal(v){ return (v || v===0) ? esc(v) : '—'; }
function wfDate(){ return new Date().toLocaleString(); }
function wfTable(headers, rows){
  return '<table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
function workfileSubjectSection(){
  const rows=[
    ['Address', wfVal([subject.address, subject.city].filter(Boolean).join(', '))],
    ['County', wfVal(subject.county)], ['Effective Date', wfVal(subject.effdate)],
    ['GLA', subject.gla?fmt(subject.gla)+' SF':'—'], ['Site', subject.site?fmt(subject.site)+' SF':'—'],
    ['Year Built', wfVal(subject.year)], ['Beds / Baths', wfVal((subject.beds||'—')+' / '+(subject.baths||'—'))],
    ['Quality / Condition', wfVal((subject.qual||'—')+' / '+(subject.cond||'—'))],
    ['Opinion of Value', wfMoney(subject.value)], ['Appraiser', wfVal(subject.appraiser)]
  ];
  return '<section><h2>Subject Property Summary</h2>'+wfTable(['Item','Value'], rows)+'</section>';
}
function workfileMarketSection(){
  const rate=document.getElementById('nar-rate')?.value || (globalMonthlyRate?fmt(globalMonthlyRate,3):'');
  const dir=document.getElementById('nar-dir')?.value || '—';
  const period=document.getElementById('nar-period')?.value || '—';
  const n=document.getElementById('nar-n')?.value || importedSales.length || '—';
  const source=document.getElementById('nar-source')?.value || 'MLS data';
  const rows=[['Sales Analyzed', esc(n)], ['Period', esc(period)], ['Data Source', esc(source)], ['Monthly Rate', rate?esc(rate)+'%':'—'], ['Annualized Rate', rate?esc(fmt((parseFloat(rate)||0)*12,2))+'%':'—'], ['Direction', esc(dir)]];
  let note='Market conditions analysis should be retained with supporting MLS export, period grouping, and any smoothing/modifier selected by the appraiser.';
  return '<section><h2>Market Conditions Support</h2>'+wfTable(['Item','Value'], rows)+'<p class="small">'+note+'</p></section>';
}
function workfileGLASection(){
  const gla=document.getElementById('nar-gla')?.value || '';
  const method=document.getElementById('nar-gla-method')?.value || '—';
  const rows=[['GLA Rate Indication', gla?'$'+esc(gla)+'/SF':'—'], ['Extraction Method', esc(method)], ['Regression Result', document.getElementById('gr-slope')?.textContent || '—'], ['Regression R²', document.getElementById('gr-r2')?.textContent || '—'], ['Sales Used', document.getElementById('gr-n')?.textContent || '—'], ['Reliability', document.getElementById('gr-rel')?.textContent || '—']];
  return '<section><h2>GLA Adjustment Support</h2>'+wfTable(['Item','Value'], rows)+'</section>';
}
function workfileQCSection(){
  let rows=[];
  if(qcCalibrationRatings && qcCalibrationRatings.length){
    rows=qcCalibrationRatings.map(a=>[esc(a.address||'Comp'), wfMoney(a.price), esc(a.gla||'—'), esc(a.ageText||a.status||a.age||'—'), esc(a.q||'—'), esc(a.c||'—'), esc(a.note||'')]);
  }
  let sugg=[];
  if(qcSuggestionRows && qcSuggestionRows.length){
    sugg=qcSuggestionRows.slice(0,30).map(({sale:s,inf})=>[esc(s.address||'Comp'), esc(s.quality||'—')+' / '+esc(s.condition||'—'), esc(inf.q||'—'), esc(inf.c||'—'), esc(inf.conf||'—'), esc((inf.reasons||[]).join('; '))]);
  }
  return '<section><h2>Q/C Calibration Support</h2><p class="small">Appraiser-provided anchor ratings are treated as the primary evidence. Automated suggestions are analytical support only and should be reconciled with inspection, MLS photos, renovation evidence, and market norms.</p>'+
    (rows.length?wfTable(['Anchor Sale','Price','GLA','Age/Status','Appraiser Q','Appraiser C','Notes'], rows):'<p>No Q/C anchor ratings saved.</p>')+
    (sugg.length?'<h3>Suggested Q/C Review Table</h3>'+wfTable(['Comp','MLS Q/C','Suggested Q','Suggested C','Confidence','Reason'], sugg):'')+'</section>';
}
function workfileAdjustmentsSection(){
  if(!lastAdjustmentRows || !lastAdjustmentRows.length) return '<section><h2>Adjustment Grid / Reconciliation</h2><p>No adjustment grid has been built yet.</p></section>';
  const rows=lastAdjustmentRows.map(r=>[esc(r.rank), esc(r.address), wfMoney(r.price), esc(r.date||'—'), esc(Math.round(r.score)), fmtD(r.timeAdj), fmtD(r.glaAdj), fmtD(r.siteAdj), fmtD(r.ageAdj), fmtD(r.condAdj), fmtD(r.qualAdj), fmtD(r.otherAdj), fmtD(r.totalAdj), wfMoney(r.adjusted), esc(r.note||'')]);
  const vals=lastAdjustmentRows.map(r=>r.adjusted).filter(v=>v>0);
  const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  const med=vals.length?median(vals):null;
  let rec='<p class="small"><strong>Reconciliation indicators:</strong> Average '+wfMoney(avg)+'; Median '+wfMoney(med)+'. Final opinion remains the appraiser\'s reconciled conclusion.</p>';
  return '<section><h2>Adjustment Grid / Reconciliation</h2>'+wfTable(['Rank','Address','Sale Price','Sale Date','Score','Time','GLA','Site','Age','Cond','Qual','Other','Net Adj','Adjusted','Note'], rows)+rec+'</section>';
}
function workfileDataSection(){
  const prices=importedSales.map(s=>s.sale_price_n).filter(v=>isFinite(v));
  const glas=importedSales.map(s=>s.gla_n).filter(v=>isFinite(v));
  const rows=[['Imported Sales', esc(importedSales.length)], ['Median Sale Price', prices.length?wfMoney(median(prices)):'—'], ['Price Range', prices.length?wfMoney(Math.min(...prices))+' – '+wfMoney(Math.max(...prices)):'—'], ['Median GLA', glas.length?fmt(median(glas))+' SF':'—'], ['Missing Q/C Count', esc(importedSales.filter(s=>!s.quality || !s.condition).length)], ['Geocoded Count', esc(importedSales.filter(s=>s.lat && s.lon).length)]];
  return '<section><h2>Data Quality / Imported Sales Summary</h2>'+wfTable(['Item','Value'], rows)+'</section>';
}
function workfileNarrativeSection(){
  if(!document.getElementById('main-nar-text')?.innerText?.trim()) genMainNarrative();
  const nar=document.getElementById('main-nar-text')?.innerHTML || '<p>No narrative generated.</p>';
  return '<section><h2>Report Narrative Draft</h2>'+nar+'</section>';
}
function printWorkfileReport(){
  const parts=[];
  if(pfChecked('pf-subject')) parts.push(workfileSubjectSection());
  if(pfChecked('pf-market')) parts.push(workfileMarketSection());
  if(pfChecked('pf-gla')) parts.push(workfileGLASection());
  if(pfChecked('pf-qc')) parts.push(workfileQCSection());
  if(pfChecked('pf-adjustments')) parts.push(workfileAdjustmentsSection());
  if(pfChecked('pf-data')) parts.push(workfileDataSection());
  if(pfChecked('pf-narrative')) parts.push(workfileNarrativeSection());
  const title='Appraisal Work File Support';
  const html='<!doctype html><html><head><meta charset="utf-8"><title>'+title+'</title></head><body><h1>'+title+'</h1><div class="meta">Prepared '+esc(wfDate())+' · '+esc(subject.address||'Subject property')+'</div><div class="disclaimer"><strong>Work File Note:</strong> This report summarizes calculations, imported data, appraiser-entered ratings, and analytical outputs from the Real Estate Market Analysis Suite. It is intended for professional work-file support and should be retained with source MLS exports, photos, inspection notes, and the analyst\'s reconciliation.</div>'+parts.join('')+'<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>';
  const w=window.open('', '_blank');
  if(!w){ alert('Popup blocked. Allow popups for this file, then try again.'); return; }
  w.document.open(); w.document.write(html); w.document.close(); closeWorkfilePrintDialog();
}



// ══════════════════════════════════════════════════
// SELLER CONCESSIONS STUDY
// ══════════════════════════════════════════════════
function concessionAmount(s) {
  const raw = s.seller_concessions || s.concessions || '';
  if (raw === null || raw === undefined || raw === '') return 0;
  const str = String(raw).toLowerCase();
  const pctMatch = str.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (pctMatch && s.sale_price_n) return s.sale_price_n * parseFloat(pctMatch[1]) / 100;
  return toNum(raw) || 0;
}

function runSellerConcessionStudy() {
  if (!importedSales.length) { alert('Import MLS data first.'); return; }
  const view = document.getElementById('sc-view').value;
  let rows = importedSales.map((s, i) => {
    const price = s.sale_price_n || 0;
    const conc = concessionAmount(s);
    const pct = price ? conc / price * 100 : 0;
    return {...s, _idx:i+1, _conc:conc, _concPct:pct, _netPrice:price-conc};
  });
  const withConc = rows.filter(r => r._conc > 0);
  const displayed = view === 'with' ? withConc : rows;
  const pcts = withConc.map(r => r._concPct).sort((a,b)=>a-b);
  const amts = withConc.map(r => r._conc).sort((a,b)=>a-b);
  const nets = rows.map(r => r._netPrice).filter(v => isFinite(v)).sort((a,b)=>a-b);
  const freq = rows.length ? withConc.length / rows.length * 100 : 0;
  const medPct = pcts.length ? median(pcts) : 0;
  const medAmt = amts.length ? median(amts) : 0;
  const maxPct = pcts.length ? Math.max(...pcts) : 0;
  const maxAmt = amts.length ? Math.max(...amts) : 0;
  const minAmt = amts.length ? Math.min(...amts) : 0;
  const avgAmt = amts.length ? amts.reduce((a,b)=>a+b,0)/amts.length : 0;
  const avgPct = pcts.length ? pcts.reduce((a,b)=>a+b,0)/pcts.length : 0;
  window.latestSellerConcessionFacts = {
    salesAnalyzed: rows.length,
    withConcessions: withConc.length,
    frequency: freq,
    medianAmount: medAmt,
    medianPct: medPct,
    averageAmount: avgAmt,
    averagePct: avgPct,
    minAmount: minAmt,
    maxAmount: maxAmt,
    maxPct: maxPct,
    netMedian: nets.length ? median(nets) : 0,
    dataAvailable: withConc.length > 0
  };

  let html = `<div class="stats-row">
    <div class="schip"><div class="slbl">Sales Analyzed</div><div class="sval">${rows.length}</div></div>
    <div class="schip"><div class="slbl">With Concessions</div><div class="sval">${withConc.length}</div><div class="ssub">${fmt(freq,1)}%</div></div>
    <div class="schip"><div class="slbl">Median Concession</div><div class="sval">$${fmt(medAmt)}</div><div class="ssub">${fmt(medPct,2)}%</div></div>
    <div class="schip"><div class="slbl">Observed Range</div><div class="sval" style="font-size:14px;">$${fmt(minAmt)}–$${fmt(maxAmt)}</div><div class="ssub">max ${fmt(maxPct,2)}%</div></div>
  </div>`;
  html += `<div class="info-block"><strong>Factual Summary</strong>${withConc.length ? `Seller concessions were mapped in ${withConc.length} of ${rows.length} imported sales (${fmt(freq,1)}%). The median concession was $${fmt(medAmt)} (${fmt(medPct,2)}% of sale price). The observed concession dollar range was $${fmt(minAmt)} to $${fmt(maxAmt)}, with the highest observed concession equal to ${fmt(maxPct,2)}% of sale price. Net price indicators were calculated as sale price less seller concessions.` : 'No mapped seller concessions were detected. If your MLS export contains seller credits under a different header, re-import and map that column to Seller Concessions.'}</div>`;
  html += '<div style="overflow-x:auto;"><table class="tbl"><thead><tr><th>#</th><th>Address</th><th>Sale Price</th><th>Concession</th><th>Concession %</th><th>Net Price</th><th>Fact Note</th></tr></thead><tbody>';
  displayed.slice(0,80).forEach(r => {
    const cls = r._conc > 0 ? 'pos' : 'neu';
    const factText = r._conc > 0 ? 'Concession mapped' : 'No concession mapped';
    html += `<tr><td>${r._idx}</td><td>${r.address || '—'}</td><td class="num">$${fmt(r.sale_price_n)}</td><td class="num">$${fmt(r._conc)}</td><td class="num ${cls}">${fmt(r._concPct,2)}%</td><td class="num">$${fmt(r._netPrice)}</td><td>${factText}</td></tr>`;
  });
  html += '</tbody></table></div>';
  document.getElementById('sc-data-output').innerHTML = html;
  document.getElementById('sc-data-output').style.display = 'block';
  populateSellerConcessionNarrativeFields();
}

function populateSellerConcessionNarrativeFields() {
  const facts = window.latestSellerConcessionFacts;
  if (!facts) { return; }
  const marketEl = document.getElementById('scn-market');
  const freqEl = document.getElementById('scn-frequency');
  const rangeEl = document.getElementById('scn-range');
  const conclusionEl = document.getElementById('scn-conclusion');
  if (marketEl && !marketEl.value) marketEl.value = subject.city || subject.county || 'the analyzed market segment';
  if (freqEl) freqEl.value = `${facts.withConcessions} of ${facts.salesAnalyzed} sales (${fmt(facts.frequency,1)}%) included mapped seller concessions`;
  if (rangeEl) rangeEl.value = facts.dataAvailable
    ? `$${fmt(facts.minAmount)} to $${fmt(facts.maxAmount)}; median $${fmt(facts.medianAmount)} (${fmt(facts.medianPct,2)}%); average $${fmt(facts.averageAmount)} (${fmt(facts.averagePct,2)}%)`
    : 'No mapped seller concessions detected in the imported MLS data';
  if (conclusionEl) {
    conclusionEl.innerHTML = '<option>concession activity was documented from the imported MLS data</option><option>no mapped seller concessions were detected in the imported MLS data</option><option>seller concessions were present in a minority of the imported sales</option><option>seller concessions were present in a majority of the imported sales</option><option>additional verification is recommended for sales with mapped concessions</option>';
    if (!facts.dataAvailable) conclusionEl.value = 'no mapped seller concessions were detected in the imported MLS data';
    else if (facts.frequency >= 50) conclusionEl.value = 'seller concessions were present in a majority of the imported sales';
    else conclusionEl.value = 'seller concessions were present in a minority of the imported sales';
  }
}

function calcSellerConcessionManual() {
  const price = parseFloat(document.getElementById('scm-price').value);
  const concession = parseFloat(document.getElementById('scm-concession').value) || 0;
  if (!price || isNaN(price)) { alert('Enter a sale price.'); return; }
  const pct = concession / price * 100;
  const net = price - concession;
  document.getElementById('scm-pct').textContent = fmtPct(pct,2);
  document.getElementById('scm-net').textContent = '$' + fmt(net);
  document.getElementById('scm-result').classList.add('on');
}

function genSellerConcessionNarrative() {
  const market = document.getElementById('scn-market').value || 'the analyzed market segment';
  const freq = document.getElementById('scn-frequency').value || 'the imported comparable sales';
  const range = document.getElementById('scn-range').value || 'the observed concession range';
  const conclusion = document.getElementById('scn-conclusion').value;
  const text = `Seller concessions were reviewed for ${market}. The MLS data review considered the number of sales with mapped concessions, concession dollars, concession percentage of sale price, and net price indicators calculated as sale price less seller concessions. Within the data reviewed, ${freq}. The observed concession range was ${range}. Based on the imported MLS data, ${conclusion}. These talking points summarize the factual MLS data review and should be edited as needed to reflect sale verification, financing terms, market segment, and the user's professional judgment.`;
  document.getElementById('scn-text').textContent = text;
  document.getElementById('scn-out').classList.add('on');
}





// ══════════════════════════════════════════════════
// LAUNCH / BUYER MODE UPGRADES
// ══════════════════════════════════════════════════
let buyerMode = 'appraiser';
function setBuyerMode(mode){
  buyerMode = mode === 'agent' ? 'agent' : 'appraiser';
  const app = document.getElementById('mode-appraiser');
  const ag = document.getElementById('mode-agent');
  if(app && ag){ app.classList.toggle('active', buyerMode==='appraiser'); ag.classList.toggle('active', buyerMode==='agent'); }
  const pill = document.getElementById('sc-mode-pill');
  if(pill){ pill.textContent = buyerMode === 'agent' ? 'Agent / Broker Mode' : 'Appraiser Mode'; pill.classList.toggle('agent', buyerMode==='agent'); }
  const nar = document.getElementById('main-nar-out');
  if(nar && nar.classList.contains('on')) genMainNarrative();
}

function loadDemoData(){
  subject = {
    address:'124 Oak Meadow Drive', city:'Greenville, SC 29607', county:'Greenville County', effdate:new Date().toISOString().slice(0,10),
    gla:1850, site:9200, year:2001, beds:3, baths:2, half:1, garage:'2-Car Attached', basement:'None', pool:'No', fp:1, qual:'Q3', cond:'C3', value:415000, appraiser:'Demo User'
  };
  const set=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
  set('s-addr',subject.address); set('s-city',subject.city); set('s-county',subject.county); set('s-effdate',subject.effdate); set('s-gla',subject.gla); set('s-site',subject.site); set('s-year',subject.year); set('s-beds',subject.beds); set('s-baths',subject.baths); set('s-half',subject.half); set('s-garage',subject.garage); set('s-basement',subject.basement); set('s-pool',subject.pool); set('s-fp',subject.fp); set('s-qual',subject.qual); set('s-cond',subject.cond); set('s-value',subject.value); set('s-appraiser',subject.appraiser);
  importedSales = [
    {address:'118 Oak Meadow Dr',city:'Greenville',state:'SC',zip:'29607',sale_price:'410000',sale_date:'2026-03-10',gla:'1815',site_sf:'9000',year_built:'2000',beds:'3',baths:'2.5',quality:'Q3',condition:'C3',seller_concessions:'4500'},
    {address:'212 Maple Ridge Ln',city:'Greenville',state:'SC',zip:'29607',sale_price:'428000',sale_date:'2026-02-21',gla:'1910',site_sf:'9600',year_built:'2003',beds:'3',baths:'2.5',quality:'Q3',condition:'C2',seller_concessions:'0'},
    {address:'77 Brookside Ct',city:'Greenville',state:'SC',zip:'29607',sale_price:'397500',sale_date:'2026-01-18',gla:'1760',site_sf:'8800',year_built:'1999',beds:'3',baths:'2',quality:'Q3',condition:'C3',seller_concessions:'6500'},
    {address:'305 Pine Hollow Rd',city:'Greenville',state:'SC',zip:'29607',sale_price:'435000',sale_date:'2025-12-12',gla:'1985',site_sf:'10200',year_built:'2004',beds:'4',baths:'2.5',quality:'Q3',condition:'C3',seller_concessions:'3000'},
    {address:'91 Cedar Way',city:'Greenville',state:'SC',zip:'29607',sale_price:'389000',sale_date:'2025-11-05',gla:'1695',site_sf:'8400',year_built:'1997',beds:'3',baths:'2',quality:'Q4',condition:'C3',seller_concessions:'0'},
    {address:'144 Laurel Bend',city:'Greenville',state:'SC',zip:'29607',sale_price:'421500',sale_date:'2025-10-22',gla:'1875',site_sf:'9300',year_built:'2001',beds:'3',baths:'2.5',quality:'Q3',condition:'C3',seller_concessions:'8500'},
    {address:'39 Willow Park Dr',city:'Greenville',state:'SC',zip:'29607',sale_price:'405000',sale_date:'2025-09-14',gla:'1800',site_sf:'9100',year_built:'1998',beds:'3',baths:'2',quality:'Q3',condition:'C4',seller_concessions:'5000'},
    {address:'260 Holly Trace',city:'Greenville',state:'SC',zip:'29607',sale_price:'449000',sale_date:'2025-08-30',gla:'2050',site_sf:'11000',year_built:'2005',beds:'4',baths:'3',quality:'Q3',condition:'C2',seller_concessions:'0'}
  ].map((s,i)=>Object.assign(s,{_id:i,sale_price_n:toNum(s.sale_price),gla_n:toNum(s.gla),site_sf_n:toNum(s.site_sf),year_built_n:toNum(s.year_built),beds_n:toNum(s.beds),baths_n:toNum(s.baths),lat:null,lon:null}));
  document.getElementById('subject-saved').style.display='block';
  renderImportSummary(); updateBadge('badge-import', importedSales.length); updateBadge('badge-rank', importedSales.length);
  runSellerConcessionStudy();
  showPanel('concessions', document.querySelector(`[onclick*='concessions']`));
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
updateWeightTotal();
markNarrativeManualEdits();
buildQCScaleDefs();




document.addEventListener('DOMContentLoaded', function(){
  window.safeShowPanel = function(id, el){
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
    const target = document.getElementById(id);
    if(target){ target.classList.add('active'); }
    if(el){ el.classList.add('active'); }

    if(typeof updateWorkflowGuide === 'function'){
      updateWorkflowGuide(id);
    }

    window.scrollTo({top:0, behavior:'smooth'});
  };

  document.querySelectorAll('.workflow-nav .ntab').forEach(btn=>{
    const onclick = btn.getAttribute('onclick');
    if(onclick && onclick.includes('showPanel(')){
      btn.setAttribute('onclick', onclick.replace('showPanel(', 'safeShowPanel('));
    }
  });
});
// ══════════════════════════════════════════════════
// ENHANCEMENTS: SITE VALUE, GLOBAL SYNC, RESTART, MANUAL COMP SELECTION
// ══════════════════════════════════════════════════
let siteValueResults = { landSales: [], allocation: null, reconciled: null };
let selectedAdjustmentCompIds = new Set();

function setVal(id, value, overwrite=true){
  const el=document.getElementById(id);
  if(!el) return;
  if(overwrite || !el.value) el.value = value ?? '';
}
function parseMoneyText(txt){
  const n = parseFloat(String(txt||'').replace(/[^0-9.-]/g,''));
  return isNaN(n) ? 0 : n;
}
function syncSubjectAcrossModules(){
  if(!subject) return;
  if(subject.site){
    setVal('land-sub-sf', subject.site, false);
    setVal('alloc-site-sf', subject.site, false);
    if(!document.getElementById('land-sub-acres')?.value) setVal('land-sub-acres', (subject.site/43560).toFixed(3), true);
  }
  if(subject.effdate){
    setVal('gla-eff-date', subject.effdate, false);
  }
  if(globalMonthlyRate){
    syncMarketRate(globalMonthlyRate);
  }
}
function syncMarketRate(rate){
  if(!rate || !isFinite(rate)) return;
  ['adj-mt-rate','gla-mt-rate','nar-rate','mta-rate'].forEach(id=>setVal(id, Number(rate).toFixed(3), false));
}
function syncGLARate(rate){
  if(!rate || !isFinite(rate)) return;
  ['adj-gla-rate','gla-rate-apply','nar-gla'].forEach(id=>setVal(id, Number(rate).toFixed(2), false));
}
function syncSiteRate(psf){
  if(!psf || !isFinite(psf)) return;
  setVal('adj-site-rate', Number(psf).toFixed(2), false);
}
function syncSiteNarrative(count, indicator, method, reliability, notes){
  setVal('site-nar-count', count, true);
  setVal('site-nar-indicator', indicator, true);
  const m=document.getElementById('site-nar-method'); if(m && method) m.value = method;
  const r=document.getElementById('site-nar-reliability'); if(r && reliability) r.value = reliability;
  setVal('site-nar-notes', notes || '', false);
}

// Wrap existing saveSubject so subject site/effective date carry forward automatically.
if(typeof saveSubject === 'function'){
  const _origSaveSubject = saveSubject;
  saveSubject = function(){
    _origSaveSubject.apply(this, arguments);
    setTimeout(syncSubjectAcrossModules, 50);
  };
}
if(typeof calcMTFromData === 'function'){
  const _origCalcMTFromData = calcMTFromData;
  calcMTFromData = function(){
    _origCalcMTFromData.apply(this, arguments);
    setTimeout(()=>syncMarketRate(globalMonthlyRate || parseMoneyText(document.getElementById('mt-monthly')?.textContent)), 50);
  };
}
if(typeof calcMTManual === 'function'){
  const _origCalcMTManual = calcMTManual;
  calcMTManual = function(){
    _origCalcMTManual.apply(this, arguments);
    setTimeout(()=>syncMarketRate(globalMonthlyRate || parseMoneyText(document.getElementById('mm-monthly')?.textContent)), 50);
  };
}
if(typeof applyMT === 'function'){
  const _origApplyMT = applyMT;
  applyMT = function(){
    _origApplyMT.apply(this, arguments);
    const rate=toNum(document.getElementById('mta-rate')?.value);
    if(rate) syncMarketRate(rate);
  };
}
if(typeof runGLARegression === 'function'){
  const _origRunGLARegression = runGLARegression;
  runGLARegression = function(){
    _origRunGLARegression.apply(this, arguments);
    setTimeout(()=>{
      const slope=parseMoneyText(document.getElementById('gr-slope')?.textContent);
      if(slope) syncGLARate(slope);
    }, 50);
  };
}
if(typeof calcGLAPaired === 'function'){
  const _origCalcGLAPaired = calcGLAPaired;
  calcGLAPaired = function(){
    _origCalcGLAPaired.apply(this, arguments);
    setTimeout(()=>{
      const med=parseMoneyText(document.getElementById('gp-med')?.textContent) || parseMoneyText(document.getElementById('gp-avg')?.textContent);
      if(med) syncGLARate(med);
    }, 50);
  };
}
if(typeof applyGLA === 'function'){
  const _origApplyGLA = applyGLA;
  applyGLA = function(){
    _origApplyGLA.apply(this, arguments);
    const rate=toNum(document.getElementById('gla-rate-apply')?.value);
    if(rate) syncGLARate(rate);
  };
}

function addLandSaleRow(){
  const wrap=document.getElementById('land-sale-rows'); if(!wrap) return;
  const n=wrap.querySelectorAll('.land-row').length+1;
  const div=document.createElement('div'); div.className='cal-sale-card land-row';
  div.innerHTML=`<div class="cal-title">Land Sale ${n}</div><div class="cal-grid">
    <div class="fg"><label>Address / ID</label><input class="land-addr" placeholder="Land sale ${n}"></div>
    <div class="fg"><label>Sale Price ($)</label><input type="number" class="land-price"></div>
    <div class="fg"><label>Site SF</label><input type="number" class="land-sf"></div>
    <div class="fg"><label>Acres</label><input type="number" class="land-acres" step="0.001"></div>
    <div class="fg"><label>Sale Date</label><input type="date" class="land-date"></div>
    <div class="fg"><label>Adjust %</label><input type="number" class="land-adj-pct" placeholder="0" step="0.1"></div>
    <div class="fg"><label>Notes / Adjustments</label><input class="land-notes" placeholder="Zoning, utilities, topography, location, frontage"></div>
    <div class="fg"><label>&nbsp;</label><button class="btn btn-outline btn-sm" onclick="this.closest('.land-row').remove(); calcLandSales();">Remove</button></div>
  </div>`;
  wrap.appendChild(div);
}

function readLandSales(){
  const rows=[...document.querySelectorAll('.land-row')];
  return rows.map((row,i)=>{
    const price=toNum(row.querySelector('.land-price')?.value);
    let sf=toNum(row.querySelector('.land-sf')?.value);
    let acres=toNum(row.querySelector('.land-acres')?.value);
    if(!sf && acres) sf=acres*43560;
    if(!acres && sf) acres=sf/43560;
    const adjPct=toNum(row.querySelector('.land-adj-pct')?.value)||0;
    const adjPrice=price*(1+adjPct/100);
    return {
      id:i, address:row.querySelector('.land-addr')?.value || `Land Sale ${i+1}`,
      price, sf, acres, date:row.querySelector('.land-date')?.value || '',
      adjPct, adjPrice, psf: sf ? adjPrice/sf : 0, pacre: acres ? adjPrice/acres : 0,
      notes:row.querySelector('.land-notes')?.value || ''
    };
  }).filter(x=>x.price>0 && x.sf>0);
}

function calcLandSales(){
  const sales=readLandSales();
  let subSf=toNum(document.getElementById('land-sub-sf')?.value) || subject.site || 0;
  let subAcres=toNum(document.getElementById('land-sub-acres')?.value) || (subSf ? subSf/43560 : 0);
  if(!subSf && subAcres) subSf=subAcres*43560;
  if(!subAcres && subSf) subAcres=subSf/43560;
  if(!sales.length){ alert('Enter at least one land sale with sale price and site size.'); return; }
  if(!subSf){ alert('Enter the subject site area or save the subject with site area first.'); return; }
  const psfs=sales.map(s=>s.psf).filter(Boolean);
  const pacres=sales.map(s=>s.pacre).filter(Boolean);
  const medPsf=median(psfs), avgPsf=psfs.reduce((a,b)=>a+b,0)/psfs.length;
  const medAcre=median(pacres), avgAcre=pacres.reduce((a,b)=>a+b,0)/pacres.length;
  const medInd=medPsf*subSf, avgInd=avgPsf*subSf;
  const low=Math.min(...psfs)*subSf, high=Math.max(...psfs)*subSf;
  const reconciled=(medInd*0.65 + avgInd*0.35);
  siteValueResults.landSales=sales;
  siteValueResults.reconciled={method:'land sales comparison', subSf, subAcres, medPsf, avgPsf, medAcre, avgAcre, medInd, avgInd, low, high, reconciled};
  syncSiteRate(medPsf);
  syncSiteNarrative(`${sales.length} land sale${sales.length===1?'':'s'}`, `$${fmt(low)} to $${fmt(high)}; reconciled near $${fmt(reconciled)}`, 'land sales comparison', sales.length>=3?'moderate':'limited', 'Land sales should be reviewed for zoning, utilities, topography, frontage, access, entitlements, location, and highest and best use comparability.');
  const rows=sales.map((s,i)=>`<tr><td>${i+1}</td><td>${esc(s.address)}</td><td class="num">$${fmt(s.price)}</td><td class="num">${fmt(s.sf)} SF</td><td class="num">${fmt(s.acres,3)}</td><td class="num">${fmt(s.adjPct,1)}%</td><td class="num">$${fmt(s.psf,2)}</td><td class="num">$${fmt(s.pacre)}</td><td>${esc(s.date)||'—'}</td><td>${esc(s.notes)||'—'}</td></tr>`).join('');
  document.getElementById('land-sales-out').innerHTML=`<div class="rbox on"><h3>Generated Site Value — Land Sales Comparison</h3>
    <div class="rrow"><span class="rlbl">Subject Site Area</span><span class="rval neu">${fmt(subSf)} SF / ${fmt(subAcres,3)} acres</span></div>
    <div class="rrow"><span class="rlbl">Median $/SF</span><span class="rval pos">$${fmt(medPsf,2)}</span></div>
    <div class="rrow"><span class="rlbl">Average $/SF</span><span class="rval neu">$${fmt(avgPsf,2)}</span></div>
    <div class="rrow"><span class="rlbl">Median $/Acre</span><span class="rval neu">$${fmt(medAcre)}</span></div>
    <div class="rrow"><span class="rlbl">Indicated Site Value Range</span><span class="rval neu">$${fmt(low)} – $${fmt(high)}</span></div>
    <div class="rrow"><span class="rlbl">Reconciled Site Value Indication</span><span class="rval pos">$${fmt(reconciled)}</span></div>
  </div><div style="overflow-x:auto;margin-top:12px;"><table class="tbl"><thead><tr><th>#</th><th>Sale</th><th>Price</th><th>SF</th><th>Acres</th><th>Adj %</th><th>$/SF</th><th>$/Acre</th><th>Date</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.getElementById('land-sales-out').style.display='block';
  return siteValueResults.reconciled;
}

function calcSiteAllocation(){
  const sale=toNum(document.getElementById('alloc-sale')?.value);
  const impr=toNum(document.getElementById('alloc-impr')?.value);
  const ratio=toNum(document.getElementById('alloc-ratio')?.value);
  const siteSf=toNum(document.getElementById('alloc-site-sf')?.value) || subject.site || toNum(document.getElementById('land-sub-sf')?.value);
  const abstraction=(sale && impr) ? sale-impr : 0;
  const allocation=(sale && ratio) ? sale*(ratio/100) : 0;
  const indicators=[abstraction, allocation].filter(v=>v>0);
  const reconciled=indicators.length ? indicators.reduce((a,b)=>a+b,0)/indicators.length : 0;
  const psf=siteSf && reconciled ? reconciled/siteSf : 0;
  if(!indicators.length){ alert('Enter either improved sale price with RCNLD for abstraction or improved sale price with land ratio for allocation.'); return; }
  document.getElementById('alloc-out')?.classList.add('on');
  setTimeout(()=>{
    document.getElementById('alloc-abstraction').textContent = abstraction ? '$'+fmt(abstraction) : '—';
    document.getElementById('alloc-allocation').textContent = allocation ? '$'+fmt(allocation) : '—';
    document.getElementById('alloc-psf').textContent = psf ? '$'+fmt(psf,2)+'/SF' : '—';
  },0);
  siteValueResults.allocation={sale,impr,ratio,siteSf,abstraction,allocation,reconciled,psf};
  if(psf) syncSiteRate(psf);
  syncSiteNarrative(document.getElementById('site-nar-count')?.value || 'available land/allocation evidence', `$${fmt(reconciled)}${psf?' / $'+fmt(psf,2)+' per SF':''}`, 'allocation and abstraction due to limited vacant land sales', 'limited', 'Allocation and abstraction should be reconciled with vacant land sales where possible and verified against local market behavior.');
  return siteValueResults.allocation;
}

function genSiteNarrative(){
  const count=document.getElementById('site-nar-count')?.value || 'the available site value evidence';
  const indicator=document.getElementById('site-nar-indicator')?.value || 'a reconciled site value indication was developed';
  const method=document.getElementById('site-nar-method')?.value || 'land sales comparison';
  const rel=document.getElementById('site-nar-reliability')?.value || 'moderate';
  const notes=document.getElementById('site-nar-notes')?.value || '';
  const use=document.getElementById('land-use')?.value || 'site value support';
  const text=`<p>Site value support was developed for ${esc(use).toLowerCase()} using ${esc(method)}. The analysis considered ${esc(count)}, resulting in an indicated site value support range or conclusion of ${esc(indicator)}.</p>
  <p>The indicated reliability is ${esc(rel)} based on the quantity, comparability, and completeness of the available site evidence. Relevant site factors include zoning, access, utilities, topography, frontage, location, site utility, buildability, entitlements, and highest-and-best-use consistency.</p>
  ${notes?`<p>${esc(notes)}</p>`:''}
  <p>For agent use, this supports vacant-land pricing, lot-premium conversations, and seller/buyer explanations. For appraiser use, this can support cost-approach site value reconciliation when verified and reconciled with professional judgment.</p>`;
  document.getElementById('site-nar-text').innerHTML=text;
  document.getElementById('site-nar-out').classList.add('on');
}

function populateAdjustmentCompSelector(){
  const box=document.getElementById('adj-comp-selector'); if(!box) return;
  if(!importedSales.length){ alert('Import MLS data first.'); return; }
  const sales=rankedSales().slice(0,30);
  box.innerHTML=sales.map((s,i)=>{
    const id = String(s._id ?? i);
    const checked = selectedAdjustmentCompIds.has(id) ? 'checked' : '';
    return `<label class="check-item" style="cursor:pointer;"><input type="checkbox" class="adj-comp-check" value="${esc(id)}" ${checked} onchange="updateAdjustmentCompSelection()"> <span><strong>#${i+1} · ${esc(s.address)||'Address not mapped'}</strong><br><span class="mini-muted">$${fmt(s.sale_price_n)} · ${esc(s.sale_date)||'No date'} · ${s.gla_n?fmt(s.gla_n)+' SF':'No GLA'} · Score ${fmt(s._score,0)}</span></span></label>`;
  }).join('');
  box.style.display='grid';
}
function updateAdjustmentCompSelection(){
  selectedAdjustmentCompIds = new Set([...document.querySelectorAll('.adj-comp-check:checked')].map(x=>String(x.value)));
}
function selectTopAdjustmentComps(n=6){
  populateAdjustmentCompSelector();
  const checks=[...document.querySelectorAll('.adj-comp-check')];
  checks.forEach((c,i)=>c.checked=i<n);
  updateAdjustmentCompSelection();
}
function clearAdjustmentCompSelection(){
  document.querySelectorAll('.adj-comp-check').forEach(c=>c.checked=false);
  selectedAdjustmentCompIds.clear();
}

// Override grid builder to use manually selected comps when provided.
buildAdjustmentGrid = function(){
  if(!importedSales.length || !subject.gla){ alert('Import MLS data and save the subject first.'); return; }
  updateAdjustmentCompSelection();
  const topN = parseInt(document.getElementById('adj-topn').value)||6;
  const mtRate = toNum(document.getElementById('adj-mt-rate').value)||globalMonthlyRate||0;
  const glaRate = toNum(document.getElementById('adj-gla-rate').value)||0;
  const siteRate = toNum(document.getElementById('adj-site-rate').value)||0;
  const ageRate = toNum(document.getElementById('adj-age-rate').value)||0;
  const condRate = toNum(document.getElementById('adj-cond-rate').value)||0;
  const qualRate = toNum(document.getElementById('adj-qual-rate').value)||0;
  const decimalMode = document.getElementById('adj-half-mode').value === 'on';
  let sales = rankedSales();
  if(selectedAdjustmentCompIds.size){
    sales = sales.filter(s=>selectedAdjustmentCompIds.has(String(s._id)));
  } else {
    sales = sales.slice(0, topN);
  }
  if(!sales.length){ alert('Select at least one comparable or clear selections to use fallback top-ranked sales.'); return; }
  lastAdjustmentRows = sales.map((s,i)=>{
    const months = subject.effdate && s.sale_date ? monthsBetween(subject.effdate, s.sale_date) : 0;
    const timeAdj = s.sale_price_n * (mtRate/100) * months;
    const glaAdj = subject.gla && s.gla_n ? (subject.gla - s.gla_n) * glaRate : 0;
    const siteAdj = subject.site && s.site_sf_n ? (subject.site - s.site_sf_n) * siteRate : 0;
    const ageAdj = subject.year && s.year_built_n ? (s.year_built_n - subject.year) * ageRate : 0;
    const cq = ratingDecimal(s.condition), sq = ratingDecimal(subject.cond); const qq = ratingDecimal(s.quality), qs = ratingDecimal(subject.qual);
    const cDiff = (sq&&cq) ? (decimalMode ? cq-sq : Math.round(cq)-Math.round(sq)) : 0;
    const qDiff = (qs&&qq) ? (decimalMode ? qq-qs : Math.round(qq)-Math.round(qs)) : 0;
    const condAdj = cDiff * condRate;
    const qualAdj = qDiff * qualRate;
    const otherAdj = 0;
    const totalAdj = timeAdj+glaAdj+siteAdj+ageAdj+condAdj+qualAdj+otherAdj;
    return {rank:i+1,address:s.address||'',price:s.sale_price_n||0,date:s.sale_date||'',score:s._score||0,timeAdj,glaAdj,siteAdj,ageAdj,condAdj,qualAdj,otherAdj,totalAdj,adjusted:(s.sale_price_n||0)+totalAdj,note:''};
  });
  renderAdjustmentGrid();
};

function restartWorkspace(){
  const ok=confirm('Restart and clear all subject data, imported sales, analyses, saved local workfile, selections, and outputs?');
  if(!ok) return;
  try{ localStorage.removeItem('appraiserSuiteWorkfile'); localStorage.removeItem('realEstateSuiteWorkfile'); }catch(e){}
  subject={}; importedSales=[]; csvHeaders=[]; csvRawRows=[]; globalMonthlyRate=0; lastAdjustmentRows=[]; siteValueResults={landSales:[],allocation:null,reconciled:null}; selectedAdjustmentCompIds.clear();
  document.querySelectorAll('input, textarea').forEach(el=>{
    if(el.type==='file') el.value='';
    else if(el.type==='checkbox' || el.type==='radio') el.checked = el.defaultChecked;
    else el.value = el.defaultValue || '';
  });
  document.querySelectorAll('select').forEach(el=>{ el.selectedIndex = 0; });
  document.querySelectorAll('.rbox,.nar-out').forEach(el=>el.classList.remove('on'));
  ['subject-saved','col-mapper','import-summary','ranking-output','land-sales-out','adj-comp-selector','adj-grid-out','recon-out','dq-output','scatter-wrap','storage-status'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
  ['badge-import','badge-rank'].forEach(id=>updateBadge(id,0));
  const first=document.querySelector(".workflow-nav .ntab[onclick*=\"subject\"]"); showPanel('subject', first);
}



// ══════════════════════════════════════════════════
// GLOBAL EVENT BRIDGE FOR INLINE HTML BUTTONS
// Vite loads app.js as a module, so functions must be attached to window
// for onclick handlers in index.html to work reliably.
// ══════════════════════════════════════════════════
function exposeInlineHandlers(){
  try { if (typeof addGLAPair === 'function') window.addGLAPair = addGLAPair; } catch (e) {}
  try { if (typeof addLandSaleRow === 'function') window.addLandSaleRow = addLandSaleRow; } catch (e) {}
  try { if (typeof addMTRow === 'function') window.addMTRow = addMTRow; } catch (e) {}
  try { if (typeof addQCPair === 'function') window.addQCPair = addQCPair; } catch (e) {}
  try { if (typeof applyGLA === 'function') window.applyGLA = applyGLA; } catch (e) {}
  try { if (typeof applyMT === 'function') window.applyMT = applyMT; } catch (e) {}
  try { if (typeof applyMapping === 'function') window.applyMapping = applyMapping; } catch (e) {}
  try { if (typeof applySuggestedQCToImportedSales === 'function') window.applySuggestedQCToImportedSales = applySuggestedQCToImportedSales; } catch (e) {}
  try { if (typeof buildAdjustmentGrid === 'function') window.buildAdjustmentGrid = buildAdjustmentGrid; } catch (e) {}
  try { if (typeof buildQCDistribution === 'function') window.buildQCDistribution = buildQCDistribution; } catch (e) {}
  try { if (typeof buildQCHeatmap === 'function') window.buildQCHeatmap = buildQCHeatmap; } catch (e) {}
  try { if (typeof calcGLAPaired === 'function') window.calcGLAPaired = calcGLAPaired; } catch (e) {}
  try { if (typeof calcLandSales === 'function') window.calcLandSales = calcLandSales; } catch (e) {}
  try { if (typeof calcMTFromData === 'function') window.calcMTFromData = calcMTFromData; } catch (e) {}
  try { if (typeof calcMTManual === 'function') window.calcMTManual = calcMTManual; } catch (e) {}
  try { if (typeof calcQCPaired === 'function') window.calcQCPaired = calcQCPaired; } catch (e) {}
  try { if (typeof calcSellerConcessionManual === 'function') window.calcSellerConcessionManual = calcSellerConcessionManual; } catch (e) {}
  try { if (typeof calcSiteAllocation === 'function') window.calcSiteAllocation = calcSiteAllocation; } catch (e) {}
  try { if (typeof cancelImport === 'function') window.cancelImport = cancelImport; } catch (e) {}
  try { if (typeof clearAdjustmentCompSelection === 'function') window.clearAdjustmentCompSelection = clearAdjustmentCompSelection; } catch (e) {}
  try { if (typeof clearImport === 'function') window.clearImport = clearImport; } catch (e) {}
  try { if (typeof clearSubject === 'function') window.clearSubject = clearSubject; } catch (e) {}
  try { if (typeof closeQCCalibrationModal === 'function') window.closeQCCalibrationModal = closeQCCalibrationModal; } catch (e) {}
  try { if (typeof closeWorkfilePrintDialog === 'function') window.closeWorkfilePrintDialog = closeWorkfilePrintDialog; } catch (e) {}
  try { if (typeof copyText === 'function') window.copyText = copyText; } catch (e) {}
  try { if (typeof downloadWorkfileJSON === 'function') window.downloadWorkfileJSON = downloadWorkfileJSON; } catch (e) {}
  try { if (typeof drawGLAScatter === 'function') window.drawGLAScatter = drawGLAScatter; } catch (e) {}
  try { if (typeof exportAdjustmentCSV === 'function') window.exportAdjustmentCSV = exportAdjustmentCSV; } catch (e) {}
  try { if (typeof genMainNarrative === 'function') window.genMainNarrative = genMainNarrative; } catch (e) {}
  try { if (typeof genQCNarrative === 'function') window.genQCNarrative = genQCNarrative; } catch (e) {}
  try { if (typeof genSellerConcessionNarrative === 'function') window.genSellerConcessionNarrative = genSellerConcessionNarrative; } catch (e) {}
  try { if (typeof genSiteNarrative === 'function') window.genSiteNarrative = genSiteNarrative; } catch (e) {}
  try { if (typeof geocodeAll === 'function') window.geocodeAll = geocodeAll; } catch (e) {}
  try { if (typeof loadDemoData === 'function') window.loadDemoData = loadDemoData; } catch (e) {}
  try { if (typeof openQCCalibrationModal === 'function') window.openQCCalibrationModal = openQCCalibrationModal; } catch (e) {}
  try { if (typeof openWorkfilePrintDialog === 'function') window.openWorkfilePrintDialog = openWorkfilePrintDialog; } catch (e) {}
  try { if (typeof populateAdjustmentCompSelector === 'function') window.populateAdjustmentCompSelector = populateAdjustmentCompSelector; } catch (e) {}
  try { if (typeof populateSellerConcessionNarrativeFields === 'function') window.populateSellerConcessionNarrativeFields = populateSellerConcessionNarrativeFields; } catch (e) {}
  try { if (typeof printWorkfileReport === 'function') window.printWorkfileReport = printWorkfileReport; } catch (e) {}
  try { if (typeof resetWeights === 'function') window.resetWeights = resetWeights; } catch (e) {}
  try { if (typeof restartWorkspace === 'function') window.restartWorkspace = restartWorkspace; } catch (e) {}
  try { if (typeof restoreWorkfileLocal === 'function') window.restoreWorkfileLocal = restoreWorkfileLocal; } catch (e) {}
  try { if (typeof runDataQuality === 'function') window.runDataQuality = runDataQuality; } catch (e) {}
  try { if (typeof runGLARegression === 'function') window.runGLARegression = runGLARegression; } catch (e) {}
  try { if (typeof runQCCalibrationModel === 'function') window.runQCCalibrationModel = runQCCalibrationModel; } catch (e) {}
  try { if (typeof runRanking === 'function') window.runRanking = runRanking; } catch (e) {}
  try { if (typeof runSellerConcessionStudy === 'function') window.runSellerConcessionStudy = runSellerConcessionStudy; } catch (e) {}
  try { if (typeof saveQCCalibrationRatings === 'function') window.saveQCCalibrationRatings = saveQCCalibrationRatings; } catch (e) {}
  try { if (typeof saveSubject === 'function') window.saveSubject = saveSubject; } catch (e) {}
  try { if (typeof saveWorkfileLocal === 'function') window.saveWorkfileLocal = saveWorkfileLocal; } catch (e) {}
  try { if (typeof selectTopAdjustmentComps === 'function') window.selectTopAdjustmentComps = selectTopAdjustmentComps; } catch (e) {}
  try { if (typeof setBuyerMode === 'function') window.setBuyerMode = setBuyerMode; } catch (e) {}
  try { if (typeof showPanel === 'function') window.showPanel = showPanel; } catch (e) {}
  try { if (typeof showSub === 'function') window.showSub = showSub; } catch (e) {}
}
exposeInlineHandlers();
document.addEventListener('DOMContentLoaded', exposeInlineHandlers);
document.addEventListener('click', function(e){
  const btn = e.target.closest('button');
  if (!btn) return;
  if (!btn.getAttribute('type')) btn.setAttribute('type','button');
});

// Extend workfile save/load to include site-value and comp-selection state.
if(typeof collectWorkfile === 'function'){
  const _origCollectWorkfile = collectWorkfile;
  collectWorkfile = function(){
    const wf=_origCollectWorkfile.apply(this, arguments) || {};
    wf.siteValueResults=siteValueResults;
    wf.selectedAdjustmentCompIds=[...selectedAdjustmentCompIds];
    wf.landInputs={
      subSf:document.getElementById('land-sub-sf')?.value||'', subAcres:document.getElementById('land-sub-acres')?.value||'', use:document.getElementById('land-use')?.value||'',
      allocation:{sale:document.getElementById('alloc-sale')?.value||'', impr:document.getElementById('alloc-impr')?.value||'', ratio:document.getElementById('alloc-ratio')?.value||'', siteSf:document.getElementById('alloc-site-sf')?.value||''}
    };
    return wf;
  };
}
if(typeof loadWorkfile === 'function'){
  const _origLoadWorkfile = loadWorkfile;
  loadWorkfile = function(w){
    _origLoadWorkfile.apply(this, arguments);
    siteValueResults=w.siteValueResults||{landSales:[],allocation:null,reconciled:null};
    selectedAdjustmentCompIds=new Set((w.selectedAdjustmentCompIds||[]).map(String));
    if(w.landInputs){
      setVal('land-sub-sf', w.landInputs.subSf, true); setVal('land-sub-acres', w.landInputs.subAcres, true); if(w.landInputs.use) setVal('land-use', w.landInputs.use, true);
      const a=w.landInputs.allocation||{}; setVal('alloc-sale', a.sale, true); setVal('alloc-impr', a.impr, true); setVal('alloc-ratio', a.ratio, true); setVal('alloc-site-sf', a.siteSf, true);
    }
    syncSubjectAcrossModules();
  };
}

document.addEventListener('DOMContentLoaded', ()=>{ syncSubjectAcrossModules(); });



/* ===== VALORAIQ LAUNCH UPGRADE V5 ===== */
(function(){
  const $ = (id)=>document.getElementById(id);
  const money = (n)=> isFinite(n) ? '$' + Math.round(n).toLocaleString('en-US') : '—';
  const pct = (n,d=1)=> isFinite(n) ? Number(n).toFixed(d)+'%' : '—';
  function safeNum(v){ const n=parseFloat(String(v??'').replace(/[$,% ,]/g,'')); return isFinite(n)?n:0; }
  function getImported(){ return Array.isArray(window.importedSales) ? window.importedSales : (typeof importedSales !== 'undefined' ? importedSales : []); }
  function getSubject(){ return (typeof subject !== 'undefined' && subject) ? subject : {}; }
  function medianLocal(arr){ const s=arr.filter(n=>isFinite(n)&&n>0).sort((a,b)=>a-b); if(!s.length) return 0; const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
  function avg(arr){ const s=arr.filter(n=>isFinite(n)); return s.length?s.reduce((a,b)=>a+b,0)/s.length:0; }
  function confidenceClass(n){ return n>=78?'confidence-high':n>=55?'confidence-mid':'confidence-low'; }
  function setVal(id,val){ const el=$(id); if(el){ el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); } }
  function setText(id, html){ const el=$(id); if(el) el.innerHTML=html; }
  window.ValoraIQ = { money, pct, safeNum, getImported, getSubject };

  // Extend imported MLS mapping without touching original parser internals.
  try{
    if(typeof FIELD_ALIASES !== 'undefined'){
      FIELD_ALIASES.status = ['status','mls status','listing status','sale status','property status'];
      FIELD_ALIASES.list_date = ['list date','listing date','on market date'];
      FIELD_ALIASES.expiration_date = ['expiration date','expired date'];
      FIELD_ALIASES.original_list_price = ['original list price','olp','original price'];
      FIELD_ALIASES.current_list_price = ['current list price','list price','listing price','lp','asking price'];
    }
  }catch(e){}

  function injectBrand(){
    const hero = document.querySelector('.site-hero > div');
    if(hero && !document.querySelector('.brand-lockup')){
      hero.insertAdjacentHTML('afterbegin', `<div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">ValoraIQ<small>Appraisal-grade CMA intelligence</small></span></div>`);
    }
  }

  function insertNavButton(afterSelector, id, step, label){
    const nav=document.querySelector('.workflow-nav'); if(!nav || nav.querySelector(`[onclick*="${id}"]`)) return;
    const after=document.querySelector(afterSelector) || nav.querySelector('.nav-divider');
    const btn=document.createElement('button'); btn.className='ntab agent-only-ui'; btn.dataset.step=step; btn.setAttribute('onclick',`showPanel('${id}',this)`); btn.innerHTML=`<span>${step}</span> ${label}`;
    after.insertAdjacentElement('afterend', btn);
  }

  function insertPanels(){
    const main=document.querySelector('.app-main'); if(!main || $('agent-dashboard')) return;
    const panels = `
<div id="agent-dashboard" class="panel agent-only-ui">
  <div class="card">
    <div class="card-title">Agent Command Dashboard <span class="tag">Listing Intelligence</span></div>
    <p class="card-desc">A seller-friendly dashboard that converts the deeper appraisal-grade workflow into clear pricing strategy, confidence, marketability, concession pressure, and next steps.</p>
    <div class="btn-row"><button class="btn btn-gold" onclick="buildAgentDashboard()">Refresh Dashboard</button><button class="btn btn-outline" onclick="loadDemoData()">Load Sample Listing</button><button class="btn btn-outline" onclick="exportSellerPresentation()">Export Seller CMA Presentation</button></div>
    <div id="agent-dashboard-out" style="margin-top:18px;"></div>
  </div>
</div>
<div id="competitive-market" class="panel agent-only-ui">
  <div class="card">
    <div class="card-title">Active / Pending / Expired Market Intelligence <span class="tag">Agent Strategy</span></div>
    <p class="card-desc">Sold comps support value. Active, pending, expired, and withdrawn listings support strategy. Use this to explain competition, buyer resistance, and pricing risk.</p>
    <div class="info-block"><strong>MLS setup</strong>If your CSV includes status, list price, original list price, DOM, and concession fields, this panel will summarize current competition and failed-pricing signals.</div>
    <div class="btn-row"><button class="btn btn-gold" onclick="renderCompetitiveListingAnalysis()">Analyze Competition</button><button class="btn btn-outline" onclick="loadDemoData()">Load Sample Data</button></div>
    <div id="competitive-out" style="margin-top:18px;"></div>
  </div>
</div>
<div id="seller-presentation" class="panel agent-only-ui">
  <div class="card">
    <div class="card-title">Seller Presentation Builder <span class="tag">Client Ready</span></div>
    <p class="card-desc">Build a seller-facing CMA presentation from the analysis. Everything remains editable so agents can tailor the story before presenting.</p>
    <div class="grid2">
      <div class="fg"><label>Agent / Team</label><input id="pres-agent" placeholder="Your Name · Brokerage"></div>
      <div class="fg"><label>Presentation Title</label><input id="pres-title" value="Pricing Strategy & Market Intelligence"></div>
      <div class="fg"><label>Recommended List Range</label><input id="pres-range" placeholder="$415,000 – $430,000"></div>
      <div class="fg"><label>Pricing Strategy</label><select id="pres-strategy"><option>Market-aligned strategy</option><option>Aspirational strategy</option><option>Fast-sale strategy</option><option>Premium launch strategy</option></select></div>
    </div>
    <div class="fg"><label>Seller Talking Points</label><textarea id="pres-points" rows="6" placeholder="Auto-fill from dashboard, then edit..."></textarea></div>
    <div class="btn-row" style="margin-top:12px;"><button class="btn btn-gold" onclick="fillSellerPresentation()">Auto-Fill from Analysis</button><button class="btn btn-outline" onclick="exportSellerPresentation()">Open Print / Save PDF</button></div>
  </div>
</div>
<div id="net-roi" class="panel agent-only-ui">
  <div class="card">
    <div class="card-title">Seller Net Sheet & Renovation ROI <span class="tag">Agent Tool</span></div>
    <p class="card-desc">Compare seller proceeds and simple improvement scenarios. This is not a contractor estimate or guaranteed value increase; it is a pricing-conversation tool.</p>
    <div class="grid3">
      <div class="fg"><label>Projected Sale Price</label><input id="net-price" type="number" placeholder="425000"></div>
      <div class="fg"><label>Mortgage Payoff</label><input id="net-payoff" type="number" placeholder="285000"></div>
      <div class="fg"><label>Commission %</label><input id="net-comm" type="number" value="6" step="0.1"></div>
      <div class="fg"><label>Seller Concessions</label><input id="net-conc" type="number" placeholder="8000"></div>
      <div class="fg"><label>Closing / Transfer Costs</label><input id="net-costs" type="number" placeholder="3500"></div>
      <div class="fg"><label>Repair / Prep Budget</label><input id="net-repairs" type="number" placeholder="5000"></div>
    </div>
    <div class="btn-row"><button class="btn btn-gold" onclick="calculateNetSheet()">Calculate Seller Net</button><button class="btn btn-outline" onclick="fillNetFromSubject()">Use Subject Value</button></div>
    <div id="net-out" style="margin-top:16px;"></div>
    <div class="sec">Renovation / Prep Scenario</div>
    <div class="grid3">
      <div class="fg"><label>Improvement Type</label><select id="roi-type"><option>Paint / cosmetic refresh</option><option>Flooring</option><option>Kitchen update</option><option>Bath update</option><option>Landscaping / curb appeal</option><option>Staging</option><option>Roof / mechanical repair</option></select></div>
      <div class="fg"><label>Estimated Cost</label><input id="roi-cost" type="number" placeholder="5000"></div>
      <div class="fg"><label>Estimated Market Reaction / Value Lift</label><input id="roi-lift" type="number" placeholder="8000"></div>
    </div>
    <div class="btn-row"><button class="btn" onclick="calculateROI()">Calculate ROI Scenario</button></div>
    <div id="roi-out" style="margin-top:12px;"></div>
  </div>
</div>
<div id="launch-review" class="panel">
  <div class="card">
    <div class="card-title">Review Before Presenting <span class="tag">Quality Gate</span></div>
    <p class="card-desc">A final checklist before sending a seller presentation, appraisal workfile support, or internal pricing summary.</p>
    <div class="btn-row"><button class="btn btn-gold" onclick="runPresentationReview()">Run Review</button><button class="btn btn-outline" onclick="exportInternalSummary()">Export Internal Analysis Summary</button><button class="btn btn-outline" onclick="exportAppraiserWorkfile()">Export Appraiser Workfile Support</button></div>
    <div id="review-out" class="review-list" style="margin-top:16px;"></div>
  </div>
</div>`;
    const firstPanel=document.querySelector('#subject');
    firstPanel.insertAdjacentHTML('beforebegin', panels);
    insertNavButton('.workflow-nav button[onclick*=\'import\']','agent-dashboard','2A','Agent Dashboard');
    insertNavButton('.workflow-nav button[onclick*=\'ranking\']','competitive-market','6A','Active / Pending / Expired');
    insertNavButton('.workflow-nav button[onclick*=\'narrative\']','seller-presentation','9A','Seller Presentation');
    insertNavButton('.workflow-nav button[onclick*=\'seller-presentation\']','net-roi','9B','Net Sheet / ROI');
    const nav=document.querySelector('.workflow-nav'); const divider=nav?.querySelector('.nav-divider');
    if(nav && divider && !nav.querySelector(`[onclick*="launch-review"]`)){
      const btn=document.createElement('button'); btn.className='ntab ntab-utility'; btn.setAttribute('onclick',"showPanel('launch-review',this)"); btn.innerHTML='<span>✓</span> Review Before Presenting'; divider.insertAdjacentElement('afterend', btn);
    }
  }

  function enhanceStorage(){
    const card=$('storage')?.querySelector('.card'); if(!card || $('project-name')) return;
    card.querySelector('.card-desc')?.insertAdjacentHTML('afterend', `<div class="grid2"><div class="fg"><label>Project / Assignment Name</label><input id="project-name" placeholder="123 Main Street CMA"></div><div class="fg"><label>Client / Seller</label><input id="project-client" placeholder="Smith Family"></div></div><div class="btn-row" style="margin-bottom:12px;"><button class="btn btn-gold" onclick="saveNamedProject()">Save Named Project</button><button class="btn btn-outline" onclick="duplicateNamedProject()">Duplicate Project</button><button class="btn btn-outline" onclick="exportSellerPresentation()">Seller CMA Presentation</button><button class="btn btn-outline" onclick="exportAppraiserWorkfile()">Appraiser Workfile Support</button><button class="btn btn-outline" onclick="exportInternalSummary()">Internal Analysis Summary</button></div>`);
  }

  function injectDisclaimer(){
    if($('valora-disclaimer')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="disclaimer-modal" id="valora-disclaimer"><div class="disclaimer-card"><div class="brand-lockup" style="margin-bottom:10px"><span class="brand-mark"></span><span class="brand-name" style="color:var(--navy)">ValoraIQ<small style="color:var(--text-muted)">Professional use safeguard</small></span></div><h2>Pricing intelligence, not an appraisal replacement.</h2><p>ValoraIQ organizes market evidence, CMA support, adjustment analysis, seller strategy, and workfile documentation. Agents and brokers should present outputs as pricing and market-analysis support. Appraisal conclusions remain the responsibility of a licensed appraiser using appropriate scope of work, verification, inspection, and professional judgment.</p><div class="btn-row" style="margin-top:16px"><button class="btn btn-gold" onclick="localStorage.setItem('valoraDisclaimerAccepted','1');document.getElementById('valora-disclaimer').classList.remove('on')">I Understand</button><button class="btn btn-outline" onclick="document.getElementById('valora-disclaimer').classList.remove('on')">Continue for Demo</button></div></div></div>`);
    if(!localStorage.getItem('valoraDisclaimerAccepted')) setTimeout(()=>$('valora-disclaimer')?.classList.add('on'),700);
  }

  function injectHelper(){
    if($('valora-helper') || localStorage.getItem('valoraHelperDisabled')==='1') return;
    document.body.insertAdjacentHTML('beforeend', `<div class="helper" id="valora-helper"><div class="helper-bubble"><div id="helper-msg">Need help? I’ll flag missing inputs and suggest what to do next.</div><div class="helper-actions"><button onclick="document.getElementById('valora-helper').classList.remove('on')">Hide</button><button onclick="localStorage.setItem('valoraHelperDisabled','1');document.getElementById('valora-helper').classList.add('hidden')">Disable</button></div></div><div class="helper-face" onclick="document.getElementById('valora-helper').classList.toggle('on')" title="ValoraIQ Assistant"></div></div>`);
    setTimeout(()=>window.showCoach('Tip: load the sample listing first if you want a quick demo story.'),1800);
  }

  window.showCoach = function(msg){
    const h=$('valora-helper'), m=$('helper-msg'); if(!h || !m || localStorage.getItem('valoraHelperDisabled')==='1') return;
    m.textContent=msg; h.classList.add('on'); clearTimeout(window._coachTimer); window._coachTimer=setTimeout(()=>h.classList.remove('on'),6500);
  };

  window.loadDemoData = function(){
    const demoSubject = {address:'1842 Willow Glen Drive', city:'Greenville, SC 29607', county:'Greenville County', effdate:new Date().toISOString().slice(0,10), gla:2140, site:10890, year:2004, beds:4, baths:2.5, half:1, garage:'2-Car Attached', basement:'None', pool:'No', fp:1, qual:'Q3', cond:'C3', value:425000, appraiser:'ValoraIQ Demo Team', lat:34.8219, lon:-82.3006};
    Object.assign(subject, demoSubject);
    const mapIds = {'s-addr':'address','s-city':'city','s-county':'county','s-effdate':'effdate','s-gla':'gla','s-site':'site','s-year':'year','s-beds':'beds','s-baths':'baths','s-half':'half','s-garage':'garage','s-basement':'basement','s-pool':'pool','s-fp':'fp','s-qual':'qual','s-cond':'cond','s-value':'value','s-appraiser':'appraiser'};
    Object.entries(mapIds).forEach(([id,key])=>{ const el=$(id); if(el) el.value=demoSubject[key]??''; });
    const rows = [
      ['Sold','210 Brookfield Ct','Greenville','SC','29607',418000,'2026-03-14',2075,10454,2003,4,2.5,'Q3','C3','2-Car Attached','None','No',34.8231,-82.3020,22,425000,425000,5000],
      ['Sold','92 Ridgeview Ln','Greenville','SC','29607',431500,'2026-02-06',2210,11200,2006,4,2.5,'Q3','C3','2-Car Attached','None','No',34.8188,-82.2991,18,439000,439000,7500],
      ['Sold','34 Oak Terrace','Greenville','SC','29607',405000,'2025-12-20',1985,9800,2001,3,2,'Q3','C4','2-Car Attached','None','No',34.8260,-82.3056,35,415000,415000,10000],
      ['Sold','77 Hampton Bend','Greenville','SC','29607',449000,'2026-01-18',2325,12100,2005,4,3,'Q2','C3','2-Car Attached','None','No',34.8165,-82.2944,12,449000,449000,0],
      ['Active','118 Maple Run','Greenville','SC','29607',0,'',2260,11050,2007,4,2.5,'Q3','C3','2-Car Attached','None','No',34.8205,-82.3071,28,459000,459000,0],
      ['Active','55 Creekstone Dr','Greenville','SC','29607',0,'',2050,10100,2002,3,2,'Q3','C4','2-Car Attached','None','No',34.8290,-82.2968,41,429900,449900,8000],
      ['Pending','12 Ashbury Way','Greenville','SC','29607',0,'',2165,10900,2004,4,2.5,'Q3','C3','2-Car Attached','None','No',34.8241,-82.2927,9,429000,429000,3000],
      ['Expired','301 Laurel Ridge','Greenville','SC','29607',0,'',2188,10750,2003,4,2.5,'Q3','C3','2-Car Attached','None','No',34.8129,-82.3034,96,469000,489000,0]
    ];
    importedSales.length = 0;
    rows.forEach((r,i)=> importedSales.push({_id:i,status:r[0],address:r[1],city:r[2],state:r[3],zip:r[4],sale_price:String(r[5]||''),sale_price_n:r[5]||safeNum(r[20]),sale_date:r[6],gla:String(r[7]),gla_n:r[7],site_sf:String(r[8]),site_sf_n:r[8],year_built:String(r[9]),year_built_n:r[9],beds:String(r[10]),beds_n:r[10],baths:String(r[11]),baths_n:r[11],quality:r[12],condition:r[13],garage:r[14],basement:r[15],pool:r[16],lat:r[17],lon:r[18],dom:String(r[19]),list_price:String(r[20]),current_list_price:String(r[20]),original_list_price:String(r[21]),seller_concessions:String(r[22]),seller_concessions_n:r[22]}));
    try{ $('subject-saved').style.display='block'; initSubjectMap(); }catch(e){}
    try{ renderImportSummary(); updateBadge('badge-import', importedSales.length); updateBadge('badge-rank', importedSales.length); }catch(e){}
    fillNetFromSubject(); buildAgentDashboard(); renderCompetitiveListingAnalysis(); runPresentationReview();
    showCoach('Sample listing loaded. Start with Agent Dashboard, then review comps and seller presentation.');
  };

  function calcPricing(){
    const sales=getImported(); const subj=getSubject();
    const sold=sales.filter(s=>(String(s.status||'sold').toLowerCase().includes('sold') || s.sale_price_n>0) && s.sale_price_n>0);
    const med=medianLocal(sold.map(s=>s.sale_price_n));
    const subjectVal=safeNum(subj.value)||med||0;
    const low=subjectVal*0.97, high=subjectVal*1.03, asp=subjectVal*1.055, fast=subjectVal*0.965;
    const completeness=['gla','site','year','qual','cond'].reduce((a,k)=>a+(subj[k]?1:0),0)/5;
    const nscore=Math.min(1,sold.length/6); const volatility=sold.length?Math.min(.25,(Math.max(...sold.map(s=>s.sale_price_n))-Math.min(...sold.map(s=>s.sale_price_n)))/(med||1)):.25;
    const conf=Math.max(35, Math.min(96, Math.round(50 + completeness*22 + nscore*24 - volatility*40)));
    const mktScore=Math.max(40, Math.min(96, Math.round(conf - (volatility*20) + (sales.some(s=>String(s.status||'').toLowerCase().includes('pending'))?5:0))));
    return {subjectVal, low, high, asp, fast, conf, mktScore, med, soldCount:sold.length};
  }

  window.buildAgentDashboard = function(){
    const c=calcPricing(); const sales=getImported();
    const active=sales.filter(s=>/active/i.test(s.status||'')); const pend=sales.filter(s=>/pending/i.test(s.status||'')); const exp=sales.filter(s=>/expired|withdrawn/i.test(s.status||''));
    const concessionVals=sales.map(s=>safeNum(s.seller_concessions||s.seller_concessions_n)).filter(n=>n>0); const medConc=medianLocal(concessionVals);
    const pressure = active.length>2 || exp.length ? 'Moderate' : 'Low';
    setText('agent-dashboard-out', `<div class="report-cover"><h2>Pricing Strategy Snapshot</h2><p>Agent-ready summary powered by appraisal-grade comparable analysis, concessions review, market support, and editable professional judgment.</p></div><div class="agent-hero-grid"><div class="agent-metric"><div class="k">Recommended Market Range</div><div class="v">${money(c.low)} – ${money(c.high)}</div><p>Use as the central seller-pricing conversation.</p></div><div class="agent-metric"><div class="k">Confidence Score</div><div class="v ${confidenceClass(c.conf)}">${c.conf}/100</div><p>${c.soldCount} sold comps and current subject/data completeness.</p></div><div class="agent-metric"><div class="k">Marketability Score</div><div class="v ${confidenceClass(c.mktScore)}">${c.mktScore}/100</div><p>Pricing alignment, competition, and data quality signal.</p></div><div class="agent-metric"><div class="k">Concession Pressure</div><div class="v">${pressure}</div><p>${medConc?`Median observed concession: ${money(medConc)}.`:'No strong concession pattern detected.'}</p></div></div><div class="lux-card"><h3 style="font-family:Libre Baskerville,serif;color:var(--navy);margin-bottom:8px;">Recommended Strategy</h3><p><strong>Market-aligned launch:</strong> ${money(c.low)} to ${money(c.high)}. A fast-sale posture would be closer to ${money(c.fast)}; an aspirational launch should be tested carefully near ${money(c.asp)} with a clear price-review date.</p><div class="panel-pills"><span class="panel-pill">Active: ${active.length}</span><span class="panel-pill">Pending: ${pend.length}</span><span class="panel-pill">Expired/Withdrawn: ${exp.length}</span><span class="panel-pill">Sold support: ${c.soldCount}</span></div></div>`);
    fillSellerPresentation();
  };

  window.renderCompetitiveListingAnalysis = function(){
    const sales=getImported(); const groups={Active:[],Pending:[],Expired:[],Sold:[]};
    sales.forEach(s=>{ const st=String(s.status||'Sold').toLowerCase(); if(st.includes('active')) groups.Active.push(s); else if(st.includes('pending')) groups.Pending.push(s); else if(st.includes('expired')||st.includes('withdrawn')) groups.Expired.push(s); else groups.Sold.push(s); });
    const card=(name,arr,cls)=>`<div class="agent-metric"><div class="k">${name}</div><div class="v">${arr.length}</div><p>${arr.length?`Median price/list: ${money(medianLocal(arr.map(s=>safeNum(s.sale_price_n)||safeNum(s.current_list_price)||safeNum(s.list_price))))}`:'No records in this group.'}</p></div>`;
    const rows=sales.map(s=>{const st=s.status||'Sold'; const cls=/active/i.test(st)?'status-active':/pending/i.test(st)?'status-pending':/expired|withdrawn/i.test(st)?'status-expired':'status-sold'; const lp=safeNum(s.current_list_price)||safeNum(s.list_price)||safeNum(s.sale_price_n); const olp=safeNum(s.original_list_price); const cut=olp&&lp&&olp>lp?money(olp-lp):'—'; return `<tr><td><span class="status-chip ${cls}">${st}</span></td><td>${s.address||'—'}</td><td class="num">${money(lp)}</td><td class="num">${s.dom||'—'}</td><td class="num">${cut}</td><td>${s.condition||'—'} / ${s.quality||'—'}</td></tr>`}).join('');
    setText('competitive-out', `<div class="agent-hero-grid">${card('Active Competition',groups.Active)}${card('Pending Demand',groups.Pending)}${card('Expired / Withdrawn Risk',groups.Expired)}${card('Closed Support',groups.Sold)}</div><div class="lux-card"><h3 style="font-family:Libre Baskerville,serif;color:var(--navy)">Pricing Signals</h3><p>${groups.Expired.length?'Expired listings suggest buyers rejected at least some higher-price positioning. Review original list prices and DOM before recommending an aspirational strategy.':'No expired/withdrawn records were loaded, so failed-pricing risk should be checked manually in MLS.'} ${groups.Pending.length?'Pending listings provide current demand signals and should be compared closely to the recommended launch range.':''}</p><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Status</th><th>Address</th><th>Price/List</th><th>DOM</th><th>Price Cut</th><th>C / Q</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
  };

  window.fillSellerPresentation = function(){
    const c=calcPricing(); const subj=getSubject();
    setVal('pres-range', `${money(c.low)} – ${money(c.high)}`);
    setVal('pres-points', `Recommended market-aligned range: ${money(c.low)} to ${money(c.high)}.\n\nConfidence: ${c.conf}/100 based on available comparable data, subject completeness, and market consistency.\n\nThe pricing strategy should lead with buyer confidence, comparable support, and a clear review plan. If activity is weak after launch, review showing feedback, active competition, and concession signals before reducing price.\n\nThis analysis is pricing support, not an appraisal. The strength of ValoraIQ is that it uses appraisal-grade comp logic underneath a seller-friendly CMA presentation.`);
    if(!safeNum($('net-price')?.value)) setVal('net-price', Math.round(c.subjectVal));
  };

  window.exportSellerPresentation = function(){ fillSellerPresentation(); const c=calcPricing(); const subj=getSubject(); const points=($('pres-points')?.value||'').replace(/\n/g,'<br>'); const title=$('pres-title')?.value||'Pricing Strategy & Market Intelligence'; const agent=$('pres-agent')?.value||subj.appraiser||'Prepared with ValoraIQ';
    openReport(`${title}`, `<div class="cover"><h1>ValoraIQ</h1><h2>${title}</h2><p>${subj.address||'Subject Property'} · ${subj.city||''}</p><p>${agent}</p></div><h2>Recommended Pricing Range</h2><div class="big">${money(c.low)} – ${money(c.high)}</div><p>${points}</p><h2>Confidence & Marketability</h2><p>Confidence Score: <strong>${c.conf}/100</strong><br>Marketability Score: <strong>${c.mktScore}/100</strong></p><h2>Professional Use Note</h2><p>This is CMA and pricing support for professional judgment. It is not an appraisal unless completed by a licensed appraiser within an appropriate appraisal assignment scope.</p>`); };
  window.exportAppraiserWorkfile = function(){ const c=calcPricing(); const subj=getSubject(); openReport('Appraiser Workfile Support', `<div class="cover"><h1>ValoraIQ</h1><h2>Appraiser Workfile Support</h2><p>${subj.address||'Subject Property'} · ${subj.city||''}</p></div><h2>Market-Supported Value Range</h2><p>${money(c.low)} – ${money(c.high)} with confidence score ${c.conf}/100.</p><h2>Support Included</h2><ul><li>Comparable ranking and selection support</li><li>Market time support</li><li>GLA and site adjustment support</li><li>Seller concession facts</li><li>Q/C documentation framework</li><li>Editable narrative language</li></ul><p>All conclusions remain subject to the appraiser's verification, inspection, scope of work, and professional judgment.</p>`); };
  window.exportInternalSummary = function(){ const c=calcPricing(); openReport('Internal Analysis Summary', `<div class="cover"><h1>ValoraIQ</h1><h2>Internal Analysis Summary</h2></div><p>Recommended market range: <strong>${money(c.low)} – ${money(c.high)}</strong></p><p>Confidence: <strong>${c.conf}/100</strong>. Marketability: <strong>${c.mktScore}/100</strong>.</p><p>Use this summary to review data completeness, comp selection, concession pressure, and pricing strategy before presenting to a client.</p>`); };
  function openReport(title, body){ const w=window.open('','_blank'); if(!w){ showCoach('Popup blocked. Allow popups to open the printable report.'); return; } w.document.write(`<!doctype html><html><head><title>${title}</title></head><body>${body}<script>setTimeout(()=>print(),500)<\/script></body></html>`); w.document.close(); }

  window.fillNetFromSubject = function(){ const s=getSubject(); const v=safeNum(s.value)||calcPricing().subjectVal; if(v) setVal('net-price',Math.round(v)); };
  window.calculateNetSheet = function(){ const price=safeNum($('net-price')?.value), payoff=safeNum($('net-payoff')?.value), comm=safeNum($('net-comm')?.value)/100, conc=safeNum($('net-conc')?.value), costs=safeNum($('net-costs')?.value), repairs=safeNum($('net-repairs')?.value); const commission=price*comm; const net=price-payoff-commission-conc-costs-repairs; setText('net-out', `<div class="agent-hero-grid"><div class="agent-metric"><div class="k">Estimated Net</div><div class="v">${money(net)}</div><p>After payoff, commission, concessions, costs, and prep.</p></div><div class="agent-metric"><div class="k">Commission</div><div class="v">${money(commission)}</div><p>${pct(comm*100)} of sale price.</p></div><div class="agent-metric"><div class="k">Seller Costs</div><div class="v">${money(conc+costs+repairs)}</div><p>Concessions, closing costs, and prep.</p></div></div>`); };
  window.calculateROI = function(){ const cost=safeNum($('roi-cost')?.value), lift=safeNum($('roi-lift')?.value); const net=lift-cost; const r=cost?net/cost*100:0; setText('roi-out', `<div class="info-block"><strong>ROI Scenario</strong>${$('roi-type')?.value||'Improvement'}: estimated lift ${money(lift)} less cost ${money(cost)} = net impact ${money(net)} (${pct(r)} ROI). Validate with local buyer behavior and contractor estimates.</div>`); };

  window.runPresentationReview = function(){ const s=getSubject(); const sales=getImported(); const c=calcPricing(); const checks=[
      ['Subject saved', !!(s.address&&s.gla&&s.value), 'Subject address, GLA, and value are present.'],
      ['MLS data loaded', sales.length>=3, `${sales.length} records loaded.`],
      ['Sold comp support', c.soldCount>=3, `${c.soldCount} sold comps available.`],
      ['Pricing confidence', c.conf>=60, `Current confidence score is ${c.conf}/100.`],
      ['Competition reviewed', sales.some(x=>/active|pending|expired|withdrawn/i.test(x.status||'')), 'Active/pending/expired data helps agent strategy.'],
      ['Narratives editable', true, 'Generated output should be reviewed and customized before use.']
    ];
    setText('review-out', checks.map(([name,ok,msg])=>`<div class="review-item ${ok?'good':'warn'}"><span>${ok?'✓':'!'}</span><div><b>${name}</b><br><span>${msg}</span></div></div>`).join(''));
  };

  window.saveNamedProject = function(){ const data={name:$('project-name')?.value||'Untitled Project',client:$('project-client')?.value||'',savedAt:new Date().toISOString(),subject:getSubject(),importedSales:getImported()}; localStorage.setItem('valoraNamedProject:'+data.name, JSON.stringify(data)); const ss=$('storage-status'); if(ss){ss.style.display='block'; ss.innerHTML=`<div class="nar-lbl">Saved</div>${data.name} saved ${new Date().toLocaleString()}.`; } showCoach('Project saved locally in this browser.'); };
  window.duplicateNamedProject = function(){ const base=$('project-name')?.value||'Project'; setVal('project-name', base+' Copy'); saveNamedProject(); };

  // Coach validation on common missing inputs.
  const oldRunRanking=window.runRanking; if(typeof oldRunRanking==='function'){ window.runRanking=function(){ if(!getImported().length) showCoach('Import MLS data or load sample data before ranking comps.'); else if(!getSubject().gla) showCoach('Save the subject profile first so comp ranking has a comparison point.'); return oldRunRanking.apply(this,arguments); }; }

  document.addEventListener('DOMContentLoaded', function(){
    injectBrand(); insertPanels(); enhanceStorage(); injectDisclaimer(); injectHelper();
    const heroCta=document.querySelector('.hero-cta'); if(heroCta && !heroCta.querySelector('[onclick="exportSellerPresentation()"]')) heroCta.insertAdjacentHTML('beforeend','<button class="btn btn-outline" onclick="showPanel(\'agent-dashboard\', document.querySelector(`[onclick*=agent-dashboard]`)); buildAgentDashboard()">Agent Dashboard</button>');
  });
})();


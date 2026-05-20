import './styles.css';

const state = {
  user: JSON.parse(localStorage.getItem('valora_user') || 'null'),
  mode: localStorage.getItem('valora_mode') || 'appraiser',
  subject: JSON.parse(localStorage.getItem('valora_subject') || '{}'),
  sales: JSON.parse(localStorage.getItem('valora_sales') || '[]'),
  activeStep: 'overview',
  mapping: {},
  rawCsv: null
};

const fieldAliases = {
  sale_price: ['sale price','close price','sold price','price','sp','saleprice','closeprice'],
  sale_date: ['sale date','close date','sold date','closing date','date','saledate','closedate'],
  gla: ['gla','living area','sqft','sf','sq ft','heated sqft','above grade','gross living area'],
  address: ['address','street address','property address','street'],
  city: ['city','municipality'],
  state: ['state'],
  zip: ['zip','zipcode','zip code','postal code'],
  site_sf: ['site sf','lot sf','lot sqft','lot size','site size','lot area','acres'],
  year_built: ['year built','yr built','built','yearbuilt','age'],
  beds: ['beds','bedrooms','br'],
  baths: ['baths','bathrooms','full baths'],
  quality: ['quality','q rating','q'],
  condition: ['condition','c rating','c'],
  garage: ['garage','parking'],
  basement: ['basement','bsmt'],
  pool: ['pool'],
  list_price: ['list price','listing price','lp'],
  seller_concessions: ['seller concessions','concessions','seller credit','closing cost credit']
};

const requiredFields = ['sale_price','sale_date','gla'];

const appraiserSteps = [
  ['overview','Overview'], ['subject','Subject'], ['import','MLS Import'], ['market','Market Conditions'],
  ['ranking','Comp Ranking'], ['adjustments','Adjustments'], ['narrative','Narrative'], ['export','Export Workfile']
];
const agentSteps = [
  ['overview','Overview'], ['subject','Property'], ['import','MLS Import'], ['snapshot','Market Snapshot'],
  ['pricing','Pricing Range'], ['seller','Seller Net'], ['presentation','Client Presentation'], ['export','Export CMA']
];

function save() {
  localStorage.setItem('valora_user', JSON.stringify(state.user));
  localStorage.setItem('valora_mode', state.mode);
  localStorage.setItem('valora_subject', JSON.stringify(state.subject));
  localStorage.setItem('valora_sales', JSON.stringify(state.sales));
}

function money(n) { return Number.isFinite(n) ? '$' + Math.round(n).toLocaleString() : '—'; }
function num(n) { return Number.isFinite(n) ? Math.round(n).toLocaleString() : '—'; }
function toNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const str = String(v).replace(/[$,% ,]/g, '');
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : NaN;
}
function median(values) {
  const arr = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!arr.length) return NaN;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}
function avg(values) {
  const arr = values.filter(Number.isFinite);
  return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : NaN;
}
function monthsBetween(a,b) {
  const da = new Date(a), db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return NaN;
  return Math.abs((da.getFullYear() - db.getFullYear()) * 12 + da.getMonth() - db.getMonth());
}

function navigate(route) {
  window.location.hash = route;
}

window.addEventListener('hashchange', render);
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); navigate(nav.dataset.nav); }
  const step = e.target.closest('[data-step]');
  if (step) { e.preventDefault(); state.activeStep = step.dataset.step; renderApp(); }
  const action = e.target.closest('[data-action]');
  if (action) handleAction(action.dataset.action, action);
});

document.addEventListener('change', e => {
  if (e.target.id === 'csv-file') handleCsvFile(e.target.files?.[0]);
  if (e.target.matches('[data-map-field]')) state.mapping[e.target.dataset.mapField] = e.target.value;
});

document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'auth-form') submitAuth(e.target);
  if (e.target.id === 'subject-form') submitSubject(e.target);
  if (e.target.id === 'seller-form') renderApp();
});

function header() {
  const loggedIn = !!state.user;
  return `
    <header class="topbar">
      <a class="brand" href="#/" data-nav="/">
        <span>VQ</span><strong>ValoraIQ</strong>
      </a>
      <nav class="toplinks">
        <a href="#/features" data-nav="/features">Features</a>
        <a href="#/pricing" data-nav="/pricing">Pricing</a>
        <a href="#/demo" data-nav="/demo">Demo</a>
        ${loggedIn ? '<a class="btn small" href="#/app" data-nav="/app">Dashboard</a><button class="ghost small" data-action="logout">Log out</button>' : '<a href="#/login" data-nav="/login">Log in</a><a class="btn small" href="#/signup" data-nav="/signup">Sign up</a>'}
      </nav>
    </header>`;
}

function landing() {
  return `${header()}
    <main>
      <section class="hero">
        <div>
          <p class="eyebrow">Real estate intelligence for professional valuation and CMA workflows</p>
          <h1>Turn MLS exports into clear decisions, defensible support, and client-ready reports.</h1>
          <p class="lede">ValoraIQ gives appraisers a valuation workfile workflow and gives agents a cleaner CMA and seller presentation workflow. Same analysis engine, different professional experiences.</p>
          <div class="hero-actions">
            <button class="btn" data-nav="/signup">Start free</button>
            <button class="ghost" data-nav="/demo">View demo</button>
          </div>
        </div>
        <div class="hero-card">
          <h3>Choose your workspace</h3>
          <div class="mode-grid">
            <button data-action="choose-appraiser" class="mode-card"><b>Appraiser</b><span>Market conditions, comp ranking, adjustments, narrative, workfile export.</span></button>
            <button data-action="choose-agent" class="mode-card"><b>Agent / Broker</b><span>Market snapshot, pricing range, seller net, listing presentation export.</span></button>
          </div>
        </div>
      </section>
      ${featureBlocks()}
    </main>`;
}

function featureBlocks() {
  return `<section class="section" id="features">
    <div class="section-head"><p class="eyebrow">Two dashboards, one engine</p><h2>Cleaner separation for each buyer.</h2></div>
    <div class="cards three">
      <article class="card"><h3>Appraiser workspace</h3><p>Designed for workfile support, market-derived adjustments, comp ranking, reconciliation, and report language.</p></article>
      <article class="card"><h3>Agent / broker workspace</h3><p>Designed for CMA pricing, seller conversations, net proceeds, market snapshots, and client-friendly presentation outputs.</p></article>
      <article class="card"><h3>Shared MLS import</h3><p>Upload CSVs once, map the fields, and reuse the same market evidence across either professional workflow.</p></article>
    </div>
  </section>`;
}

function authPage(kind) {
  const isSignup = kind === 'signup';
  return `${header()}<main class="auth-shell">
    <form id="auth-form" class="auth-card">
      <p class="eyebrow">${isSignup ? 'Create workspace' : 'Welcome back'}</p>
      <h1>${isSignup ? 'Sign up for ValoraIQ' : 'Log in to ValoraIQ'}</h1>
      <label>Name<input name="name" value="${state.user?.name || ''}" placeholder="Your name"></label>
      <label>Email<input name="email" type="email" value="${state.user?.email || ''}" placeholder="you@example.com" required></label>
      <label>Password<input name="password" type="password" placeholder="Password" required></label>
      <div class="mode-picker">
        <label><input type="radio" name="mode" value="appraiser" ${state.mode==='appraiser'?'checked':''}> Appraiser workspace</label>
        <label><input type="radio" name="mode" value="agent" ${state.mode==='agent'?'checked':''}> Agent / broker workspace</label>
      </div>
      <button class="btn" type="submit">${isSignup ? 'Create account' : 'Log in'}</button>
      <p class="note">Prototype auth only. Connect Supabase, Clerk, Auth0, or Firebase when you are ready for production accounts.</p>
    </form>
  </main>`;
}

function simplePage(title, copy) {
  return `${header()}<main class="section"><p class="eyebrow">ValoraIQ</p><h1>${title}</h1><p class="lede narrow">${copy}</p>${featureBlocks()}</main>`;
}

function appShell() {
  const steps = state.mode === 'agent' ? agentSteps : appraiserSteps;
  return `${header()}<main class="workspace">
    <aside class="side">
      <div class="side-head">
        <p class="eyebrow">${state.mode === 'agent' ? 'Agent / Broker' : 'Appraiser'} Dashboard</p>
        <h2>${state.mode === 'agent' ? 'CMA and seller workflow' : 'Valuation support workflow'}</h2>
      </div>
      <div class="switcher">
        <button class="${state.mode==='appraiser'?'active':''}" data-action="switch-appraiser">Appraiser</button>
        <button class="${state.mode==='agent'?'active':''}" data-action="switch-agent">Agent / Broker</button>
      </div>
      <nav class="steps">${steps.map(([id,label],i)=>`<button class="${state.activeStep===id?'active':''}" data-step="${id}"><span>${i+1}</span>${label}</button>`).join('')}</nav>
    </aside>
    <section class="workpane">${renderStep()}</section>
  </main>`;
}

function renderStep() {
  const mode = state.mode;
  if (state.activeStep === 'overview') return overviewStep();
  if (state.activeStep === 'subject') return subjectStep(mode);
  if (state.activeStep === 'import') return importStep();
  if (state.activeStep === 'market' || state.activeStep === 'snapshot') return marketStep(mode);
  if (state.activeStep === 'ranking' || state.activeStep === 'pricing') return rankingStep(mode);
  if (state.activeStep === 'adjustments') return adjustmentsStep();
  if (state.activeStep === 'seller') return sellerStep();
  if (state.activeStep === 'narrative' || state.activeStep === 'presentation') return narrativeStep(mode);
  if (state.activeStep === 'export') return exportStep(mode);
  return overviewStep();
}

function overviewStep() {
  const mode = state.mode;
  return `<div class="panel"><p class="eyebrow">Workspace overview</p><h1>${mode==='agent'?'Agent / Broker CMA Workspace':'Appraiser Valuation Workspace'}</h1>
  <p class="lede narrow">${mode==='agent'?'Use this flow for listing conversations, pricing ranges, seller net facts, and client-friendly CMA output.':'Use this flow for organized subject data, MLS evidence, market conditions, comp ranking, adjustment support, and workfile output.'}</p>
  <div class="metric-grid">
    <div class="metric"><span>Subject</span><b>${state.subject.address ? 'Saved' : 'Not started'}</b></div>
    <div class="metric"><span>Imported sales</span><b>${state.sales.length}</b></div>
    <div class="metric"><span>Median sale price</span><b>${money(median(state.sales.map(s=>s.sale_price_n)))}</b></div>
  </div>
  <div class="callout"><b>Clean flow:</b> public website → login/signup → choose workspace → import MLS → analyze → export.</div>
  </div>`;
}

function subjectStep(mode) {
  const s = state.subject;
  return `<form id="subject-form" class="panel form-grid"><p class="eyebrow">${mode==='agent'?'Property setup':'Subject property'}</p><h1>${mode==='agent'?'Property overview':'Subject property profile'}</h1>
    <label>Street address<input name="address" value="${s.address||''}" placeholder="123 Main Street"></label>
    <label>City, State ZIP<input name="city" value="${s.city||''}" placeholder="Greenville, SC 29601"></label>
    <label>Effective / analysis date<input name="effdate" type="date" value="${s.effdate||''}"></label>
    <label>Gross living area<input name="gla" type="number" value="${s.gla||''}" placeholder="1850"></label>
    <label>Site area SF<input name="site" type="number" value="${s.site||''}" placeholder="9500"></label>
    <label>Year built<input name="year" type="number" value="${s.year||''}" placeholder="1998"></label>
    <label>Beds<input name="beds" type="number" value="${s.beds||''}"></label>
    <label>Baths<input name="baths" type="number" value="${s.baths||''}"></label>
    <label>Condition<select name="condition"><option value="">Select</option>${['C1','C2','C3','C4','C5','C6'].map(v=>`<option ${s.condition===v?'selected':''}>${v}</option>`).join('')}</select></label>
    <label>Quality<select name="quality"><option value="">Select</option>${['Q1','Q2','Q3','Q4','Q5','Q6'].map(v=>`<option ${s.quality===v?'selected':''}>${v}</option>`).join('')}</select></label>
    <div class="full"><button class="btn" type="submit">Save property</button></div>
  </form>`;
}

function importStep() {
  return `<div class="panel"><p class="eyebrow">MLS Import</p><h1>Upload and map your CSV</h1>
    <div class="upload" onclick="document.getElementById('csv-file').click()"><b>Click to upload CSV</b><span>or drag a file into this area</span><input id="csv-file" type="file" accept=".csv,text/csv"></div>
    <div id="mapper">${state.rawCsv ? mapperHtml() : ''}</div>
    <div class="metric-grid"><div class="metric"><span>Imported sales</span><b>${state.sales.length}</b></div><div class="metric"><span>Median price</span><b>${money(median(state.sales.map(s=>s.sale_price_n)))}</b></div><div class="metric"><span>Median GLA</span><b>${num(median(state.sales.map(s=>s.gla_n)))} SF</b></div></div>
    ${state.sales.length ? salesTable(state.sales.slice(0,15)) : '<p class="note">No MLS rows imported yet.</p>'}
    <div class="btn-row"><button class="ghost" data-action="load-demo">Load demo data</button><button class="ghost danger" data-action="clear-sales">Clear sales</button></div>
  </div>`;
}

function mapperHtml() {
  const { headers } = state.rawCsv;
  const fields = Object.keys(fieldAliases);
  return `<div class="card mapper"><h3>Confirm column mapping</h3>${fields.map(f=>`<label>${labelize(f)} ${requiredFields.includes(f)?'<em>required</em>':''}<select data-map-field="${f}"><option value="">Not in CSV</option>${headers.map((h,i)=>`<option value="${i}" ${String(state.mapping[f])===String(i)?'selected':''}>${h}</option>`).join('')}</select></label>`).join('')}<button class="btn" data-action="apply-mapping">Import mapped rows</button></div>`;
}

function salesTable(rows) {
  return `<div class="table-wrap"><table><thead><tr><th>Address</th><th>Sale date</th><th>Price</th><th>GLA</th><th>Yr built</th><th>Q/C</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${s.address||'—'}</td><td>${s.sale_date||'—'}</td><td>${money(s.sale_price_n)}</td><td>${num(s.gla_n)}</td><td>${s.year_built||'—'}</td><td>${s.quality||'—'} / ${s.condition||'—'}</td></tr>`).join('')}</tbody></table></div>`;
}

function marketStep(mode) {
  const groups = monthlyGroups();
  const trend = trendRate(groups);
  return `<div class="panel"><p class="eyebrow">${mode==='agent'?'Market snapshot':'Market conditions'}</p><h1>${mode==='agent'?'Explain the market clearly':'Support market conditions'}</h1>
    <div class="metric-grid"><div class="metric"><span>Periods</span><b>${groups.length}</b></div><div class="metric"><span>Monthly trend</span><b>${Number.isFinite(trend.monthly) ? trend.monthly.toFixed(2)+'%' : '—'}</b></div><div class="metric"><span>Annualized</span><b>${Number.isFinite(trend.monthly) ? (trend.monthly*12).toFixed(1)+'%' : '—'}</b></div></div>
    ${groups.length ? `<div class="chart">${groups.map(g=>`<div><span style="height:${Math.max(8, Math.min(100, g.median / trend.max * 100))}%"></span><em>${g.label}</em></div>`).join('')}</div>` : '<p class="note">Import MLS data to calculate market trends.</p>'}
    <div class="callout">${mode==='agent'?'Use this as client-friendly pricing context, not as an appraisal conclusion.':'Use this as support for market conditions and reconcile with professional judgment.'}</div>
  </div>`;
}

function rankingStep(mode) {
  const ranked = rankedSales();
  const med = median(ranked.slice(0,6).map(s=>s.sale_price_n));
  const low = med * 0.97, high = med * 1.03;
  return `<div class="panel"><p class="eyebrow">${mode==='agent'?'Pricing Range':'Comp Ranking'}</p><h1>${mode==='agent'?'Suggested pricing support':'Rank comparable sales'}</h1>
    <div class="metric-grid"><div class="metric"><span>Top-comp median</span><b>${money(med)}</b></div>${mode==='agent'?`<div class="metric"><span>Suggested range</span><b>${money(low)} – ${money(high)}</b></div>`:''}<div class="metric"><span>Rows ranked</span><b>${ranked.length}</b></div></div>
    ${ranked.length ? ranked.slice(0,10).map((s,i)=>`<div class="rank-row"><b>#${i+1}</b><div><strong>${s.address||'Address unavailable'}</strong><span>${money(s.sale_price_n)} · ${num(s.gla_n)} SF · score ${Math.round(s.score)}/100</span></div></div>`).join('') : '<p class="note">Save a property and import sales to rank comps.</p>'}
  </div>`;
}

function adjustmentsStep() {
  const ranked = rankedSales().slice(0,5);
  return `<div class="panel"><p class="eyebrow">Appraiser workflow</p><h1>Adjustment support</h1>
    ${ranked.length ? `<div class="table-wrap"><table><thead><tr><th>Comp</th><th>Sale price</th><th>GLA adj.</th><th>Market adj.</th><th>Indicated</th></tr></thead><tbody>${ranked.map(s=>{ const glaAdj = (Number(state.subject.gla||0)-s.gla_n)*50; const marketAdj = marketAdjustment(s); return `<tr><td>${s.address||'Comp'}</td><td>${money(s.sale_price_n)}</td><td>${money(glaAdj)}</td><td>${money(marketAdj)}</td><td>${money(s.sale_price_n+glaAdj+marketAdj)}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="note">Rank comps first to create adjustment support.</p>'}
  </div>`;
}

function sellerStep() {
  const ranked = rankedSales();
  const price = median(ranked.slice(0,6).map(s=>s.sale_price_n)) || 0;
  return `<div class="panel"><p class="eyebrow">Agent / broker workflow</p><h1>Seller net sheet</h1>
    <form id="seller-form" class="form-grid compact">
      <label>Target price<input id="net-price" type="number" value="${Math.round(price)||''}"></label>
      <label>Mortgage payoff<input id="net-payoff" type="number" value="0"></label>
      <label>Commission %<input id="net-commission" type="number" step="0.1" value="6"></label>
      <label>Seller credits<input id="net-credits" type="number" value="0"></label>
      <div class="full"><button class="btn">Calculate</button></div>
    </form>
    <div class="callout"><b>Estimated net:</b> ${money(calcNet())}</div>
  </div>`;
}

function narrativeStep(mode) {
  const ranked = rankedSales();
  const med = median(ranked.slice(0,6).map(s=>s.sale_price_n));
  return `<div class="panel"><p class="eyebrow">${mode==='agent'?'Client presentation':'Narrative'}</p><h1>${mode==='agent'?'Client-ready talking points':'Report narrative draft'}</h1>
    <textarea class="narrative">${mode==='agent' ? `The property was reviewed against recent comparable sales from the imported MLS dataset. Based on the strongest comparable indicators, the supported pricing conversation centers around ${money(med)} before final seller strategy, property condition, and local competition are considered.` : `The subject was analyzed using imported market data, comparable sale ranking, market conditions support, and physical similarity. The strongest comparable indicators support a reconciled value discussion around ${money(med)}, subject to appraiser judgment and final scope of work.`}</textarea>
  </div>`;
}

function exportStep(mode) {
  return `<div class="panel"><p class="eyebrow">Export</p><h1>${mode==='agent'?'Export CMA package':'Export workfile package'}</h1>
    <p class="lede narrow">Download a JSON package of the current workspace. PDF/report export can be layered in after this architecture is stable.</p>
    <button class="btn" data-action="download-json">Download workspace JSON</button>
  </div>`;
}

function handleAction(action) {
  if (action === 'choose-appraiser' || action === 'switch-appraiser') { state.mode = 'appraiser'; state.activeStep = 'overview'; save(); navigate('/app'); }
  if (action === 'choose-agent' || action === 'switch-agent') { state.mode = 'agent'; state.activeStep = 'overview'; save(); navigate('/app'); }
  if (action === 'logout') { state.user = null; save(); navigate('/'); }
  if (action === 'load-demo') { loadDemo(); renderApp(); }
  if (action === 'clear-sales') { state.sales = []; save(); renderApp(); }
  if (action === 'apply-mapping') { applyMapping(); renderApp(); }
  if (action === 'download-json') downloadJson();
}

function submitAuth(form) {
  const fd = new FormData(form);
  state.user = { name: fd.get('name') || 'ValoraIQ User', email: fd.get('email') };
  state.mode = fd.get('mode') || 'appraiser';
  save(); navigate('/app');
}
function submitSubject(form) {
  const fd = new FormData(form);
  state.subject = Object.fromEntries(fd.entries());
  ['gla','site','year','beds','baths'].forEach(k => state.subject[k] = toNum(state.subject[k]));
  save(); renderApp();
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i=0; i<text.length; i++) {
    const c = text[i], next = text[i+1];
    if (c === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function handleCsvFile(file) {
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) return;
  const headers = rows[0];
  const data = rows.slice(1);
  state.rawCsv = { headers, data };
  state.mapping = autoMapping(headers);
  renderApp();
}

function autoMapping(headers) {
  const map = {};
  headers.forEach((h,i)=>{
    const clean = h.toLowerCase().trim();
    Object.entries(fieldAliases).forEach(([field, aliases])=>{
      if (map[field] === undefined && aliases.some(a => clean === a || clean.includes(a) || a.includes(clean))) map[field] = String(i);
    });
  });
  return map;
}

function applyMapping() {
  if (!state.rawCsv) return;
  const get = (row, field) => state.mapping[field] !== undefined && state.mapping[field] !== '' ? row[Number(state.mapping[field])] || '' : '';
  state.sales = state.rawCsv.data.map((row, idx)=>{
    const s = { id: idx };
    Object.keys(fieldAliases).forEach(f => s[f] = get(row, f));
    s.sale_price_n = toNum(s.sale_price);
    s.gla_n = toNum(s.gla);
    s.site_sf_n = toNum(s.site_sf);
    s.year_built_n = toNum(s.year_built);
    return s;
  }).filter(s => Number.isFinite(s.sale_price_n) && Number.isFinite(s.gla_n));
  state.rawCsv = null;
  save();
}

function loadDemo() {
  state.subject = { address:'123 Main Street', city:'Greenville, SC 29601', effdate:new Date().toISOString().slice(0,10), gla:1850, site:9500, year:1998, beds:3, baths:2, condition:'C3', quality:'Q4' };
  state.sales = [
    ['14 Oak Ridge Dr','2026-03-14',310000,1800,9200,1999,'Q4','C3'], ['22 Pine Hollow','2026-02-02',322500,1910,10100,2001,'Q4','C3'],
    ['7 Cedar Lane','2025-12-19',295000,1710,8700,1994,'Q4','C4'], ['40 Maple Ct','2025-11-28',337000,2050,11200,2004,'Q3','C3'],
    ['88 Brookside','2025-10-06',285000,1660,8100,1992,'Q4','C4'], ['19 Lakeview','2025-09-18',350000,2140,12000,2005,'Q3','C2']
  ].map((r,i)=>({id:i,address:r[0],sale_date:r[1],sale_price:String(r[2]),sale_price_n:r[2],gla:String(r[3]),gla_n:r[3],site_sf:String(r[4]),site_sf_n:r[4],year_built:String(r[5]),year_built_n:r[5],quality:r[6],condition:r[7]}));
  save();
}

function rankedSales() {
  const sub = state.subject;
  if (!state.sales.length) return [];
  return state.sales.map(s=>{
    let score = 100;
    if (sub.gla && s.gla_n) score -= Math.min(45, Math.abs(s.gla_n - sub.gla) / sub.gla * 220);
    if (sub.year && s.year_built_n) score -= Math.min(20, Math.abs(s.year_built_n - sub.year) * 1.5);
    if (sub.effdate && s.sale_date) score -= Math.min(25, monthsBetween(sub.effdate, s.sale_date) * 3);
    return {...s, score: Math.max(0, score)};
  }).sort((a,b)=>b.score-a.score);
}

function monthlyGroups() {
  const groups = new Map();
  state.sales.forEach(s=>{
    const d = new Date(s.sale_date);
    if (Number.isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s.sale_price_n);
  });
  return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([label, vals])=>({label, median:median(vals), n:vals.length}));
}
function trendRate(groups) {
  const max = Math.max(...groups.map(g=>g.median), 1);
  if (groups.length < 2) return { monthly: NaN, max };
  const first = groups[0], last = groups[groups.length-1];
  const months = Math.max(1, groups.length - 1);
  return { monthly: ((last.median - first.median) / first.median * 100) / months, max };
}
function marketAdjustment(s) {
  const t = trendRate(monthlyGroups()).monthly;
  if (!Number.isFinite(t) || !state.subject.effdate || !s.sale_date) return 0;
  return s.sale_price_n * (t / 100) * monthsBetween(state.subject.effdate, s.sale_date);
}
function calcNet() {
  const price = toNum(document.getElementById('net-price')?.value) || median(rankedSales().slice(0,6).map(s=>s.sale_price_n)) || 0;
  const payoff = toNum(document.getElementById('net-payoff')?.value) || 0;
  const commission = toNum(document.getElementById('net-commission')?.value) || 6;
  const credits = toNum(document.getElementById('net-credits')?.value) || 0;
  return price - payoff - price * commission / 100 - credits;
}
function downloadJson() {
  const blob = new Blob([JSON.stringify({ mode: state.mode, subject: state.subject, sales: state.sales }, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `valora-iq-${state.mode}-workspace.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function labelize(s) { return s.replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase()); }

function renderApp() { document.getElementById('app').innerHTML = appShell(); window.scrollTo({ top:0, behavior:'auto' }); }
function render() {
  const route = (window.location.hash || '#/').slice(1);
  if (route === '/' || route === '') document.getElementById('app').innerHTML = landing();
  else if (route === '/login') document.getElementById('app').innerHTML = authPage('login');
  else if (route === '/signup') document.getElementById('app').innerHTML = authPage('signup');
  else if (route === '/features') document.getElementById('app').innerHTML = simplePage('Features', 'A public marketing page that explains the platform before users enter a dashboard.');
  else if (route === '/pricing') document.getElementById('app').innerHTML = simplePage('Pricing', 'Add your real subscription tiers here when billing is ready.');
  else if (route === '/demo') { if (!state.sales.length) loadDemo(); state.user = state.user || {name:'Demo User', email:'demo@valoraiq.local'}; save(); navigate('/app'); }
  else if (route === '/app') renderApp();
  else document.getElementById('app').innerHTML = landing();
}

render();

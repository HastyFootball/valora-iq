import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/globals.css';
import { supabase } from '../lib/supabaseClient';

// ── Router ──────────────────────────────────────────────────────────────────
const routes = ['/', '/login', '/signup', '/appraiser', '/agent'];
function navigate(path) { window.history.pushState({}, '', path); window.dispatchEvent(new Event('popstate')); if (!path.includes('/appraiser/') && !path.includes('/agent/')) window.scrollTo({ top: 0, behavior: 'smooth' }); }
function usePath() { const [path, setPath] = useState(location.pathname); useEffect(() => { const fn = () => setPath(location.pathname); addEventListener('popstate', fn); return () => removeEventListener('popstate', fn) }, []); return routes.some(r => path === r || path.startsWith('/appraiser/') || path.startsWith('/agent/')) ? path : '/'; }
function Link({ to, children, className }) { return <a href={to} className={className} onClick={e => { e.preventDefault(); navigate(to) }}>{children}</a> }
function Logo({ compact = false }) { return <div className="logo-lockup"><div className="logo-mark"><span>V</span></div>{!compact && <div><strong>Valora<span>IQ</span></strong><small>Real Estate Intelligence</small></div>}</div> }

// ── Utilities ────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) { if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return '—'; return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
function money(n) { if (!n && n !== 0) return '—'; return '$' + fmt(n); }
function fmtD(n) { if (!n && n !== 0) return '—'; return (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n)); }
function fmtPct(n, d = 2) { return fmt(n, d) + '%'; }
function toNum(v) { if (v === null || v === undefined || v === '') return NaN; const n = parseFloat(String(v).replace(/[$,]/g, '')); return n; }
function dateToMonths(ds) { const d = new Date(ds); if (isNaN(d)) return null; return d.getFullYear() * 12 + d.getMonth(); }
function monthsBetween(d1, d2) { return Math.abs(dateToMonths(d1) - dateToMonths(d2)); }
function median(arr) { const vals = arr.filter(v => !isNaN(v) && isFinite(v)).sort((a, b) => a - b); if (!vals.length) return NaN; const m = Math.floor(vals.length / 2); return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2; }
function ratingNum(r) { if (!r) return null; const m = String(r).match(/([1-6])(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
function distanceMiles(lat1, lon1, lat2, lon2) { if (!lat1 || !lon1 || !lat2 || !lon2) return null; const R = 3958.8, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function linReg(pairs) { const n = pairs.length; const sx = pairs.reduce((a, p) => a + p.x, 0); const sy = pairs.reduce((a, p) => a + p.y, 0); const sxy = pairs.reduce((a, p) => a + p.x * p.y, 0); const sx2 = pairs.reduce((a, p) => a + p.x * p.x, 0); const sy2 = pairs.reduce((a, p) => a + p.y * p.y, 0); const denom = n * sx2 - sx * sx; const b = denom !== 0 ? (n * sxy - sx * sy) / denom : 0; const a2 = (sy - b * sx) / n; const r2num = Math.pow(n * sxy - sx * sy, 2); const r2den = (n * sx2 - sx * sx) * (n * sy2 - sy * sy); const r2 = r2den > 0 ? r2num / r2den : 0; return { a: a2, b, r2, n }; }
function scoreComp(s, subj, w) { let score = 0, tw = 0; function add(raw, wt) { score += raw * wt; tw += wt; } const glaD = subj.gla && s.gla_n ? Math.abs(s.gla_n - subj.gla) / subj.gla : 1; add(Math.max(0, 1 - glaD * 2), w.gla || 0); const dist = distanceMiles(subj.lat, subj.lon, s.lat, s.lon); add(dist !== null ? Math.max(0, 1 - dist / 5) : 0.3, w.distance || 0); const dMonths = s.sale_date ? monthsBetween(subj.effdate || new Date().toISOString().slice(0, 10), s.sale_date) : 12; add(Math.max(0, 1 - dMonths / 24), w.date || 0); const siteD = subj.site && s.site_sf_n ? Math.abs(s.site_sf_n - subj.site) / subj.site : 1; add(Math.max(0, 1 - siteD * 2), w.site || 0); const ageD = subj.year && s.year_built_n ? Math.abs(s.year_built_n - subj.year) / 20 : 1; add(Math.max(0, 1 - ageD), w.year || 0); add(s.garage === subj.garage ? 1 : 0.3, w.garage || 0); add(s.basement === subj.basement ? 1 : 0.3, w.basement || 0); add(s.pool === subj.pool ? 1 : 0.3, w.pool || 0); const qn = ratingNum(s.quality), qs = ratingNum(subj.qual); add(qn && qs ? Math.max(0, 1 - Math.abs(qn - qs) / 3) : 0.3, w.qual || 0); const cn = ratingNum(s.condition), cs = ratingNum(subj.cond); add(cn && cs ? Math.max(0, 1 - Math.abs(cn - cs) / 3) : 0.3, w.cond || 0); return tw > 0 ? (score / tw) * 100 : 0; }
function buildAddress(record) { return [record.address, record.city, record.state, record.zip].filter(Boolean).join(', '); }
async function geocodeAddress(parts) {
  const q = Array.isArray(parts) ? parts.filter(Boolean).join(', ') : String(parts || '');
  if (!q.trim()) return null;
  const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
  const d = await r.json();
  return d?.[0] ? { lat: Number(d[0].lat), lon: Number(d[0].lon), geocode_status: 'geocoded' } : { geocode_status: 'not_found' };
}
async function geocodeMissingSales(records, onProgress) {
  const updated = [];
  let attempted = 0, geocoded = 0, skipped = 0;
  for (let i = 0; i < records.length; i++) {
    const s = records[i];
    if (s.lat && s.lon) { updated.push({ ...s, geocode_status: s.geocode_status || 'provided' }); skipped++; continue; }
    const addr = buildAddress(s);
    if (!addr) { updated.push({ ...s, geocode_status: 'missing_address' }); skipped++; continue; }
    attempted++;
    onProgress?.(`Geocoding ${i + 1} of ${records.length}: ${addr}`);
    try {
      const res = await geocodeAddress(addr);
      if (res?.lat && res?.lon) { updated.push({ ...s, ...res }); geocoded++; }
      else updated.push({ ...s, geocode_status: 'not_found' });
    } catch {
      updated.push({ ...s, geocode_status: 'failed' });
    }
    await new Promise(r => setTimeout(r, 650));
  }
  return { records: updated, attempted, geocoded, skipped };
}

// ── Market series ────────────────────────────────────────────────────────────
function periodKey(date, quarter = false) { const d = new Date(date); if (isNaN(d)) return null; if (quarter) return `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function periodIndex(key) { if (key.includes('Q')) { const [y, q] = key.split(' Q').map(Number); return y * 12 + (q - 1) * 3; } const [y, m] = key.split('-').map(Number); return y * 12 + m - 1; }
function marketSeries(sales, minSales, mode) { const quarter = mode === 'quarterly'; const groups = {}; sales.forEach(s => { const k = periodKey(s.sale_date, quarter); if (!k || !s.sale_price_n) return; (groups[k] ?? (groups[k] = [])).push(s.sale_price_n); }); let pts = Object.keys(groups).sort((a, b) => periodIndex(a) - periodIndex(b)).map(k => ({ key: k, x: periodIndex(k), y: median(groups[k]), n: groups[k].length })).filter(p => p.n >= minSales); if (pts.length < 2) pts = Object.keys(groups).sort((a, b) => periodIndex(a) - periodIndex(b)).map(k => ({ key: k, x: periodIndex(k), y: median(groups[k]), n: groups[k].length })); if (mode === 'rolling3' && !quarter) { pts = pts.map(p => { const neighbors = pts.filter(q => Math.abs(q.x - p.x) <= 1); const pool = neighbors.flatMap(q => Array(q.n).fill(q.y)); return { ...p, yMod: median(pool.length ? pool : [p.y]) }; }); } else if (mode === 'weighted' && pts.length > 1) { const x0 = pts[0].x, sw = pts.reduce((a, p) => a + p.n, 0), sx = pts.reduce((a, p) => a + (p.x - x0) * p.n, 0), sy = pts.reduce((a, p) => a + p.y * p.n, 0), sxy = pts.reduce((a, p) => a + (p.x - x0) * p.y * p.n, 0), sx2 = pts.reduce((a, p) => a + (p.x - x0) ** 2 * p.n, 0); const dn = sw * sx2 - sx * sx; const b = dn ? (sw * sxy - sx * sy) / dn : 0; const a = sw ? (sy - b * sx) / sw : 0; pts = pts.map(p => ({ ...p, yMod: a + b * (p.x - x0) })); } else pts = pts.map(p => ({ ...p, yMod: p.y })); const first = pts[0], last = pts[pts.length - 1]; const months = first && last ? Math.max(1, last.x - first.x) : 1; const monthly = first && last && first.yMod ? ((last.yMod - first.yMod) / first.yMod * 100) / months : 0; return { points: pts, monthly, max: Math.max(1, ...pts.map(p => p.yMod)) }; }

// ── CSV import ───────────────────────────────────────────────────────────────
const FIELD_ALIASES = { address: ['address', 'property address', 'street address', 'full address', 'street'], city: ['city', 'municipality', 'city state zip'], state: ['state'], zip: ['zip', 'zipcode', 'zip code', 'postal code'], status: ['status', 'mls status'], sale_price: ['sale price', 'close price', 'sold price', 'list price', 'price', 'sp', 'lp'], sale_date: ['sale date', 'close date', 'sold date', 'closing date'], gla: ['gla', 'living area', 'sqft', 'sf', 'sq ft', 'above grade'], site_sf: ['site size', 'lot size', 'lot sf', 'lot sqft', 'site area', 'acres'], year_built: ['year built', 'yr built', 'built', 'year constructed'], quality: ['quality', 'q rating', 'q'], condition: ['condition', 'c rating', 'c'], garage: ['garage', 'parking', 'garage spaces'], basement: ['basement', 'bsmt'], pool: ['pool'], dom: ['dom', 'days on market'], lat: ['lat', 'latitude'], lon: ['lon', 'lng', 'longitude'], concessions: ['seller concessions', 'seller concession', 'concessions', 'seller paid costs', 'seller credit', 'concession amount'] };
const FIELD_LABELS = { address: 'Address', city: 'City', state: 'State', zip: 'ZIP', status: 'Status', sale_price: 'Sale Price', sale_date: 'Sale Date', gla: 'GLA', site_sf: 'Site / Lot SF', year_built: 'Year Built', quality: 'Quality', condition: 'Condition', garage: 'Garage', basement: 'Basement', pool: 'Pool', dom: 'DOM', lat: 'Latitude', lon: 'Longitude', concessions: 'Concessions $' };
function parseCSVMatrix(text) { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < text.length; i++) { const c = text[i], n2 = text[i + 1]; if (c === '"' && q && n2 === '"') { cur += '"'; i++; } else if (c === '"') { q = !q; } else if (c === ',' && !q) { row.push(cur.trim()); cur = ''; } else if ((c === '\n' || c === '\r') && !q) { if (c === '\r' && n2 === '\n') i++; row.push(cur.trim()); if (row.some(Boolean)) rows.push(row); row = []; cur = ''; } else cur += c; } row.push(cur.trim()); if (row.some(Boolean)) rows.push(row); return { headers: rows[0] || [], rows: rows.slice(1) }; }
function autoMapHeaders(headers) { const map = {}; headers.forEach((h, i) => { const hl = h.toLowerCase().trim(); Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => { if (map[field] === undefined && aliases.some(a => hl === a || hl.includes(a) || a.includes(hl))) map[field] = String(i); }); }); return map; }
function rowsFromMapping(headers, rows, map) { return rows.map((cells, i) => { const get = f => map[f] !== undefined && map[f] !== '' ? cells[Number(map[f])] || '' : ''; return { _id: i, address: get('address'), city: get('city'), state: get('state'), zip: get('zip'), status: get('status') || 'Sold', sale_price_n: toNum(get('sale_price')), gla_n: toNum(get('gla')), site_sf_n: toNum(get('site_sf')), year_built_n: toNum(get('year_built')), sale_date: get('sale_date'), quality: get('quality'), condition: get('condition'), garage: get('garage'), basement: get('basement'), pool: get('pool'), dom: toNum(get('dom')), concessions_n: toNum(get('concessions')), lat: toNum(get('lat')) || null, lon: toNum(get('lon')) || null }; }).filter(r => r.address || r.sale_price_n || r.gla_n); }

// ── Navigation helpers ────────────────────────────────────────────────────────
const appraiserTabs = ['Dashboard', 'Projects', 'Subject Property', 'MLS Import', 'Q/C Analyzer', 'Market Conditions', 'GLA Study', 'Comp Ranking', 'Site / Land Value', 'Adjustment Grid', 'Concessions', 'Reconciliation', 'Narrative', 'Export Workfile', 'Photos / Exhibits', 'AI Assistant'];
const agentTabs = ['Dashboard', 'Projects', 'Property Overview', 'MLS Import', 'Market Snapshot', 'Pricing Strategy', 'Comp Ranking', 'Seller Net Sheet', 'Listing Presentation', 'Photos', 'AI Assistant', 'CMA Export'];
function slug(s) { return s.toLowerCase().replace(/\//g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, ''); }
function iconFor(t) { if (t.includes('Import')) return '⬆'; if (t.includes('Market') || t.includes('Snapshot')) return '↗'; if (t.includes('Export') || t.includes('Workfile')) return '⇩'; if (t.includes('Project')) return '▣'; if (t.includes('AI')) return '✦'; if (t.includes('Photo')) return '◉'; if (t.includes('Net')) return '$'; if (t.includes('Comp')) return '★'; if (t.includes('Q/C')) return '◆'; if (t.includes('Site')) return '◌'; if (t.includes('GLA')) return '⌖'; if (t.includes('Concession')) return '©'; if (t.includes('Reconcil')) return '⊞'; if (t.includes('Narrative')) return '✎'; if (t.includes('Pricing')) return '$'; return '⌂'; }

// ── Public pages ──────────────────────────────────────────────────────────────
function PublicNav() { return <header className="public-nav"><Link to="/" className="plain"><Logo /></Link><nav><a href="/#workflows">Workflows</a><a href="/#features">Features</a><a href="/#pricing">Pricing</a><Link to="/login">Log in</Link><Link className="btn small gold" to="/signup">Start free</Link></nav></header> }

function Landing() {
  return (
    <>
      <PublicNav />
      <main>
        <section className="hero">
          <div className="hero-grid">
            <div>
              <p className="eyebrow">Professional Real Estate Intelligence Workspace</p>
              <h1>One platform. Two workflows. Cleaner real estate decisions.</h1>
              <p className="hero-copy">ValoraIQ helps appraisers build defensible valuation support and helps agents create persuasive CMA and listing presentations from the same market intelligence engine.</p>
              <div className="hero-actions">
                <Link className="btn gold" to="/signup">Start building →</Link>
                <Link className="btn glass" to="/login">Log in</Link>
              </div>
            </div>
            <div className="hero-preview">
              <div className="preview-header"><span /><span /><span /></div>
              <div className="preview-title">Market Snapshot</div>
              <div className="preview-card"><b>Import your MLS data to see live market metrics</b><span>Upload a CSV to populate median sale price, DOM, list-to-sale ratio, and trend charts for your market area.</span></div>
            </div>
          </div>
        </section>
        <section className="section" id="workflows">
          <p className="eyebrow center">Persona-specific dashboards</p>
          <h2>Appraisers and agents should not see the same product.</h2>
          <div className="workflow-cards">
            <article><h3>Appraiser Workspace</h3><p>Subject, MLS import, Q/C analyzer, market conditions, GLA study, comp ranking, site value, adjustments, concessions, reconciliation, narrative, and workfile export.</p><Link to="/signup">Start appraiser workspace</Link></article>
            <article><h3>Agent/Broker Workspace</h3><p>Property overview, market snapshot, pricing strategy, active/pending/sold intelligence, seller net sheet, listing presentation, and CMA export.</p><Link to="/signup">Start agent workspace</Link></article>
          </div>
        </section>
        <section className="section" id="features">
          <p className="eyebrow center">Core platform</p>
          <h2>From raw MLS data to clear, client-ready outputs.</h2>
          <div className="feature-grid">
            {['MLS Import', 'Comp Ranking + Geocoding', 'Q/C Analyzer', 'Market Conditions Modifier', 'GLA Regression + Paired Sales', 'Workfile Save / Export'].map(t => (
              <div className="feature-card" key={t}><div className="glyph">✦</div><h3>{t}</h3><p>Premium workflow support designed for real estate professionals.</p></div>
            ))}
          </div>
        </section>
        <section className="section pricing" id="pricing">
          <p className="eyebrow center">Pricing</p>
          <h2>Start free. Save your work to the cloud.</h2>
          <p className="muted max center-block">Create an account to save projects, access AI-assisted narrative tools, and export workfiles. Sign up to get started at no cost.</p>
          <div style={{ textAlign: 'center', marginTop: '2rem' }}>
            <Link className="btn gold" to="/signup">Create free account →</Link>
          </div>
        </section>
      </main>
    </>
  );
}

function Auth({ type }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const cleanEmail = email.trim();
      if (!cleanEmail || !password) throw new Error('Enter an email and password.');
      if (type === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { name } }
        });
        if (error) throw error;
        setMessage('Account created. Check your email to confirm it, then log in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        navigate('/appraiser');
      }
    } catch (err) {
      setMessage(err.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PublicNav />
      <main className="auth-page">
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">{type === 'login' ? 'Welcome back' : 'Start free'}</p>
          <h1>{type === 'login' ? 'Log in to ValoraIQ' : 'Create your workspace'}</h1>
          {type === 'signup' && <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />}
          <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="btn gold full" disabled={busy}>{busy ? 'Working…' : type === 'login' ? 'Log in' : 'Create account'}</button>
          <p className="muted">{type === 'login' ? 'Need an account?' : 'Already have an account?'} <Link to={type === 'login' ? '/signup' : '/login'}>{type === 'login' ? 'Sign up' : 'Log in'}</Link></p>
          {message && <div className="status-banner">{message}</div>}
        </form>
      </main>
    </>
  );
}

// ── Dashboard shell ───────────────────────────────────────────────────────────
function emptySubject() { return { address: '', city: '', effdate: new Date().toISOString().slice(0, 10), gla: '', site: '', year: '', beds: '', baths: '', garage: '', basement: '', pool: '', qual: '', cond: '', value: '', appraiser: '' }; }
function emptyWorkspace() {
  return {
    subject: emptySubject(),
    sales: [],
    selectedComps: [],
    adjRows: [],
    glaNarData: { rate: 0, method: '' },
    mtNarData: { monthly: 0, dir: 'stable' },
    marketStudyState: { mode: 'rolling3', minSales: 1, ran: false },
    glaStudyState: {
      mtRate: 0,
      regResult: null,
      pairedRows: [{ pa: '', ga: '', pb: '', gb: '' }],
      pairedResult: null,
      applyInputs: { sg: '', cg: '', rate: '', cp: '' },
      applyResult: null
    },
    siteValueState: {
      land: [],
      imp: '',
      total: '',
      pct: 20,
      ran: false,
      selectedRate: 0
    },
    adjustmentDefaults: {
      mtRate: 0,
      glaRate: 0,
      siteRate: 0,
      ageRate: 0,
      condRate: 0,
      qualRate: 0,
      topN: 6,
      built: false
    }
  };
}
function projectNameFromData(data, fallback = 'Untitled Project') { return data?.subject?.address || data?.subject?.city || fallback; }

function DashboardShell({ persona, session }) {
  const initial = emptyWorkspace();
  const [tab, setTab] = useState('Dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [subject, setSubject] = useState(initial.subject);
  const [sales, setSales] = useState(initial.sales);
  const [selectedComps, setSelectedComps] = useState(initial.selectedComps);
  const [adjRows, setAdjRows] = useState(initial.adjRows);
  const [glaNarData, setGlaNarData] = useState(initial.glaNarData);
  const [mtNarData, setMtNarData] = useState(initial.mtNarData);
  const [marketStudyState, setMarketStudyState] = useState(initial.marketStudyState);
  const [glaStudyState, setGlaStudyState] = useState(initial.glaStudyState);
  const [siteValueState, setSiteValueState] = useState(initial.siteValueState);
  const [adjustmentDefaults, setAdjustmentDefaults] = useState(initial.adjustmentDefaults);

  const [cloudStatus, setCloudStatus] = useState('');
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [currentProjectName, setCurrentProjectName] = useState('');
  const [projectsLoading, setProjectsLoading] = useState(false);
  const user = session?.user;
  const isAppraiser = persona === 'appraiser';
  const tabs = isAppraiser ? appraiserTabs : agentTabs;

  useEffect(() => {
    const parts = location.pathname.split('/');
    const routePart = parts[2];
    if (routePart) {
      const match = tabs.find(t => slug(t) === routePart);
      if (match) setTab(match);
    }
  }, [persona]);

  useEffect(() => {
    if (user) fetchProjects();
  }, [user?.id, persona]);

  function setRoute(t) {
    setTab(t);
    const base = `/${persona}`;
    window.history.pushState({}, '', `${base}${t === 'Dashboard' ? '' : '/' + slug(t)}`);
  }

  function workspacePayload() {
    return {
      subject,
      sales,
      selectedComps,
      adjRows,
      glaNarData,
      mtNarData,
      marketStudyState,
      glaStudyState,
      siteValueState,
      adjustmentDefaults,
      savedAt: new Date().toISOString()
    };
  }

  function applyWorkspace(data) {
    const w = data || emptyWorkspace();
    setSubject(w.subject || emptySubject());
    setSales(Array.isArray(w.sales) ? w.sales : []);
    setSelectedComps(Array.isArray(w.selectedComps) ? w.selectedComps : []);
    setAdjRows(Array.isArray(w.adjRows) ? w.adjRows : []);
    setGlaNarData(w.glaNarData || { rate: 0, method: '' });
    setMtNarData(w.mtNarData || { monthly: 0, dir: 'stable' });
    setMarketStudyState(w.marketStudyState || { mode: 'rolling3', minSales: 1, ran: false });
    setGlaStudyState(w.glaStudyState || {
      mtRate: w.mtNarData?.monthly || 0,
      regResult: null,
      pairedRows: [{ pa: '', ga: '', pb: '', gb: '' }],
      pairedResult: null,
      applyInputs: { sg: w.subject?.gla || '', cg: '', rate: w.glaNarData?.rate || '', cp: '' },
      applyResult: null
    });
    setSiteValueState(w.siteValueState || {
      land: [],
      imp: '',
      total: '',
      pct: 20,
      ran: false,
      selectedRate: 0
    });
    setAdjustmentDefaults(w.adjustmentDefaults || {
      mtRate: w.mtNarData?.monthly || 0,
      glaRate: w.glaNarData?.rate || 0,
      siteRate: 0,
      ageRate: 0,
      condRate: 0,
      qualRate: 0,
      topN: 6,
      built: false
    });
  }

  async function fetchProjects() {
    if (!user) return;
    setProjectsLoading(true);
    const { data, error } = await supabase
      .from('valora_projects')
      .select('id,name,persona,data,created_at,updated_at')
      .eq('user_id', user.id)
      .eq('persona', persona)
      .order('updated_at', { ascending: false });
    setProjectsLoading(false);
    if (error) { setCloudStatus(error.message); return; }
    setProjects(data || []);
  }

  function newProject() {
    const name = window.prompt('Project name?', subject.address || currentProjectName || 'New Project');
    if (name === null) return;
    applyWorkspace(emptyWorkspace());
    setCurrentProjectId(null);
    setCurrentProjectName(name.trim() || 'New Project');
    setCloudStatus('New project started. Add a subject, import sales, then click Save Project.');
    setRoute(persona === 'appraiser' ? 'Subject Property' : 'Property Overview');
  }

  async function saveProject() {
    if (!user) { setCloudStatus('Log in before saving.'); return; }
    const payload = workspacePayload();
    const name = (currentProjectName || projectNameFromData(payload, '') || window.prompt('Project name?', 'New Project') || '').trim();
    if (!name) { setCloudStatus('Project was not saved — it needs a name.'); return; }
    setCloudStatus('Saving project…');

    if (currentProjectId) {
      const { error } = await supabase
        .from('valora_projects')
        .update({ name, data: payload, updated_at: new Date().toISOString() })
        .eq('id', currentProjectId)
        .eq('user_id', user.id);
      if (error) { setCloudStatus(error.message); return; }
      setCurrentProjectName(name);
      setCloudStatus('Project saved.');
    } else {
      const { data, error } = await supabase
        .from('valora_projects')
        .insert({ user_id: user.id, persona, name, data: payload })
        .select('id,name')
        .single();
      if (error) { setCloudStatus(error.message); return; }
      setCurrentProjectId(data.id);
      setCurrentProjectName(data.name);
      setCloudStatus('Project created and saved.');
    }
    fetchProjects();
  }

  function openProject(project) {
    applyWorkspace(project.data || emptyWorkspace());
    setCurrentProjectId(project.id);
    setCurrentProjectName(project.name);
    setCloudStatus(`Opened ${project.name}.`);
    setRoute(persona === 'appraiser' ? 'Subject Property' : 'Property Overview');
  }

  async function deleteProject(project) {
    if (!window.confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('valora_projects').delete().eq('id', project.id).eq('user_id', user.id);
    if (error) { setCloudStatus(error.message); return; }
    if (currentProjectId === project.id) {
      applyWorkspace(emptyWorkspace());
      setCurrentProjectId(null);
      setCurrentProjectName('');
    }
    setCloudStatus(`Deleted ${project.name}.`);
    fetchProjects();
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/');
  }

  const activeProjectLabel = currentProjectName || 'No project open';

  return (
    <div className={`dashboard-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className="sidebar">
        <Logo compact={collapsed} />
        <div className="mode-toggle">
          <button className={isAppraiser ? 'active' : ''} onClick={() => navigate('/appraiser')}>Appraiser</button>
          <button className={!isAppraiser ? 'active' : ''} onClick={() => navigate('/agent')}>Agent/Broker</button>
        </div>
        <div className="nav-section-label">{isAppraiser ? 'Appraiser Workflow' : 'Agent Workflow'}</div>
        <nav className="side-nav">
          {tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setRoute(t)}><span className="nav-icon">{iconFor(t)}</span><span>{t}</span></button>)}
        </nav>
        <button className="collapse-btn" onClick={() => setCollapsed(v => !v)}>{collapsed ? 'Expand' : 'Collapse'} sidebar</button>
      </aside>
      <main className="dashboard-main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setCollapsed(v => !v)}>☰</button>
          <div><strong>{isAppraiser ? 'Appraiser Workspace' : 'Agent/Broker Workspace'}</strong><span>{activeProjectLabel}</span></div>
          <div className="topbar-actions">
            <button className="btn ghost" onClick={newProject}>New Project</button>
            <button className="btn gold" onClick={saveProject}>Save Project</button>
            <button className="btn ghost" onClick={() => setRoute('Projects')}>Open</button>
            <button className="btn ghost" onClick={signOut}>Sign out</button>
            <button className="avatar" onClick={signOut} title="Sign out and return home">{(user?.email || 'VQ').slice(0, 2).toUpperCase()}</button>
          </div>
        </header>
        {cloudStatus && (
          <div className={`status-banner ${cloudStatus.toLowerCase().includes('saved') || cloudStatus.toLowerCase().includes('opened') || cloudStatus.toLowerCase().includes('created') ? 'success' : ''}`} style={{ margin: '12px 24px 0' }}>
            {cloudStatus}
          </div>
        )}
        <Workspace
          persona={persona} tab={tab} setRoute={setRoute}
          subject={subject} setSubject={setSubject}
          sales={sales} setSales={setSales}
          selectedComps={selectedComps} setSelectedComps={setSelectedComps}
          adjRows={adjRows} setAdjRows={setAdjRows}
          glaNarData={glaNarData} setGlaNarData={setGlaNarData}
          mtNarData={mtNarData} setMtNarData={setMtNarData}
          marketStudyState={marketStudyState} setMarketStudyState={setMarketStudyState}
          glaStudyState={glaStudyState} setGlaStudyState={setGlaStudyState}
          siteValueState={siteValueState} setSiteValueState={setSiteValueState}
          adjustmentDefaults={adjustmentDefaults} setAdjustmentDefaults={setAdjustmentDefaults}
          projects={projects} projectsLoading={projectsLoading}
          currentProjectId={currentProjectId} currentProjectName={currentProjectName}
          newProject={newProject} openProject={openProject} deleteProject={deleteProject}
          saveProject={saveProject} fetchProjects={fetchProjects}
        />
      </main>
    </div>
  );
}

function Workspace({ persona, tab, setRoute, subject, setSubject, sales, setSales, selectedComps, setSelectedComps, adjRows, setAdjRows, glaNarData, setGlaNarData, mtNarData, setMtNarData, marketStudyState, setMarketStudyState, glaStudyState, setGlaStudyState, siteValueState, setSiteValueState, adjustmentDefaults, setAdjustmentDefaults, projects, projectsLoading, currentProjectId, currentProjectName, newProject, openProject, deleteProject, saveProject, fetchProjects }) {
  if (tab === 'Dashboard') return persona === 'appraiser'
    ? <AppraiserHome sales={sales} projects={projects} selectedComps={selectedComps} adjRows={adjRows} currentProjectName={currentProjectName} setRoute={setRoute} newProject={newProject} openProject={openProject} deleteProject={deleteProject} />
    : <AgentHome sales={sales} projects={projects} selectedComps={selectedComps} currentProjectName={currentProjectName} setRoute={setRoute} newProject={newProject} openProject={openProject} deleteProject={deleteProject} />;
  if (tab === 'Projects') return <Projects persona={persona} projects={projects} projectsLoading={projectsLoading} currentProjectId={currentProjectId} newProject={newProject} openProject={openProject} deleteProject={deleteProject} fetchProjects={fetchProjects} />;
  if (tab === 'Subject Property' || tab === 'Property Overview') return <SubjectForm persona={persona} subject={subject} setSubject={setSubject} />;
  if (tab.includes('Import')) return <ImportData persona={persona} sales={sales} setSales={setSales} />;
  if (tab === 'Q/C Analyzer') return <QCAnalyzer sales={sales} setSales={setSales} subject={subject} />;
  if (tab === 'Market Conditions' || tab === 'Market Snapshot') return <MarketConditions persona={persona} sales={sales} setMtNarData={setMtNarData} marketStudyState={marketStudyState} setMarketStudyState={setMarketStudyState} setAdjustmentDefaults={setAdjustmentDefaults} />;
  if (tab === 'GLA Study') return <GLAStudy sales={sales} subject={subject} setGlaNarData={setGlaNarData} glaStudyState={glaStudyState} setGlaStudyState={setGlaStudyState} setAdjustmentDefaults={setAdjustmentDefaults} adjustmentDefaults={adjustmentDefaults} />;
  if (tab === 'Comp Ranking') return <CompRanking subject={subject} setSubject={setSubject} sales={sales} setSales={setSales} selectedComps={selectedComps} setSelectedComps={setSelectedComps} />;
  if (tab === 'Site / Land Value') return <SiteValue subject={subject} siteValueState={siteValueState} setSiteValueState={setSiteValueState} setAdjustmentDefaults={setAdjustmentDefaults} />;
  if (tab === 'Adjustment Grid') return <Adjustments selectedComps={selectedComps} sales={sales} subject={subject} adjRows={adjRows} setAdjRows={setAdjRows} adjustmentDefaults={adjustmentDefaults} setAdjustmentDefaults={setAdjustmentDefaults} />;
  if (tab === 'Concessions') return <Concessions sales={sales} />;
  if (tab === 'Reconciliation') return <Reconciliation adjRows={adjRows} />;
  if (tab === 'Narrative') return <NarrativeBuilder subject={subject} sales={sales} glaNarData={glaNarData} mtNarData={mtNarData} />;
  if (tab === 'Export Workfile') return <ExportWorkfile subject={subject} sales={sales} adjRows={adjRows} glaNarData={glaNarData} mtNarData={mtNarData} saveProject={saveProject} />;
  if (tab === 'Pricing Strategy') return <PricingStrategy sales={sales} selectedComps={selectedComps} subject={subject} />;
  if (tab === 'Seller Net Sheet') return <SellerNet />;
  if (tab.includes('Presentation') || tab === 'CMA Export') return <ExportLike title={tab} items={['Pricing snapshot', 'Active/pending/sold summary', 'Selected comps', 'Seller net sheet', 'Talking points']} />;
  if (tab.includes('Photos')) return <Photos persona={persona} />;
  if (tab === 'AI Assistant') return <Assistant persona={persona} subject={subject} sales={sales} adjRows={adjRows} glaNarData={glaNarData} mtNarData={mtNarData} />;
  return <Panel title={tab} eyebrow={persona === 'appraiser' ? 'Appraiser Workflow' : 'Agent Workflow'} copy="This section is part of the ValoraIQ platform." />;
}

// ── KPI + home ────────────────────────────────────────────────────────────────
function KPI({ label, value, helper }) { return <div className="kpi"><div className="kpi-icon">✦</div><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div> }

function AppraiserHome({ sales, projects = [], selectedComps = [], adjRows = [], currentProjectName = '', setRoute, newProject, openProject, deleteProject }) {
  const projectCount = projects.length;
  const currentLabel = currentProjectName || (sales.length ? 'Unsaved Project' : 'No project open');
  return (
    <div className="dash-page">
      <section className="welcome">
        <p className="eyebrow">Appraiser Workspace</p>
        <h1>Appraisal intelligence workspace</h1>
        <p>Build support for Q/C analysis, market conditions, GLA study, comparable selection, site value, adjustments, concessions, reconciliation, and workfile exports.</p>
      </section>
      <div className="kpi-row">
        <KPI label="Saved Projects" value={projectCount} helper="in your account" />
        <KPI label="Imported Sales" value={sales.length} helper="current project" />
        <KPI label="Selected Comps" value={selectedComps.length} helper="ready for adjustment grid" />
        <KPI label="Current Project" value={currentLabel} helper={currentProjectName ? 'open project' : 'start or open one'} />
      </div>
      <div className="two-col">
        <ProjectTable projects={projects} setRoute={setRoute} openProject={openProject} deleteProject={deleteProject} />
        <QuickActions persona="appraiser" setRoute={setRoute} newProject={newProject} />
      </div>
      <section className="panel-card">
        <h2>Professional Use Only</h2>
        <p className="muted">ValoraIQ provides market analysis and valuation support. Appraisers remain responsible for all appraisal conclusions.</p>
      </section>
    </div>
  );
}

function AgentHome({ sales, projects = [], selectedComps = [], currentProjectName = '', setRoute, newProject, openProject, deleteProject }) {
  const currentLabel = currentProjectName || (sales.length ? 'Unsaved Project' : 'No project open');
  return (
    <div className="dash-page">
      <section className="welcome">
        <p className="eyebrow">Agent/Broker Workspace</p>
        <h1>CMA and listing pricing workspace</h1>
        <p>Create a CMA project, import market data, rank comparables, and build a seller presentation.</p>
      </section>
      <div className="kpi-row">
        <KPI label="Saved Projects" value={projects.length} helper="in your account" />
        <KPI label="Imported Records" value={sales.length} helper="current project" />
        <KPI label="Selected Comps" value={selectedComps.length} helper="current project" />
        <KPI label="Current Project" value={currentLabel} helper={currentProjectName ? 'open project' : 'start or open one'} />
      </div>
      <div className="two-col">
        <ProjectTable projects={projects} setRoute={setRoute} openProject={openProject} deleteProject={deleteProject} />
        <QuickActions persona="agent" setRoute={setRoute} newProject={newProject} />
      </div>
    </div>
  );
}

function ProjectTable({ projects = [], setRoute, openProject, deleteProject }) {
  const rows = projects.slice(0, 5);
  return (
    <div className="table-card">
      <div className="card-head"><h2>Recent Projects</h2><button onClick={() => setRoute('Projects')}>View all →</button></div>
      {rows.length
        ? <table><thead><tr><th>Project</th><th>Type</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{rows.map(p => <tr key={p.id}><td><b>{p.name}</b><span>{p.data?.subject?.address || ''}</span></td><td>{p.persona === 'agent' ? 'CMA' : 'Appraisal'}</td><td>{p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}</td><td><div className="btn-row"><button className="btn ghost small" onClick={() => openProject(p)}>Open</button><button className="btn ghost small" onClick={() => deleteProject(p)}>Delete</button></div></td></tr>)}</tbody></table>
        : <div className="status-banner">No saved projects yet. Click New Project to start one.</div>}
    </div>
  );
}

function QuickActions({ persona, setRoute, newProject }) {
  const actions = persona === 'appraiser'
    ? [['New Appraisal Project', 'Projects'], ['Import MLS Data', 'MLS Import'], ['Run Q/C Analyzer', 'Q/C Analyzer'], ['Run Market Conditions', 'Market Conditions'], ['Run GLA Study', 'GLA Study'], ['Rank Comparables', 'Comp Ranking'], ['Export Workfile PDF', 'Export Workfile']]
    : [['New CMA Project', 'Projects'], ['Import MLS Data', 'MLS Import'], ['Rank Comparables', 'Comp Ranking'], ['Build Seller Presentation', 'Listing Presentation'], ['Create Seller Net Sheet', 'Seller Net Sheet']];
  return (
    <div className="quick-card">
      <h2>Quick Actions</h2>
      {actions.map(([label, target]) => (
        <button key={label} onClick={() => label.startsWith('New') && newProject ? newProject() : setRoute(target)}>{label}<span>›</span></button>
      ))}
    </div>
  );
}

// ── Projects ──────────────────────────────────────────────────────────────────
function Projects({ persona, projects = [], projectsLoading, currentProjectId, newProject, openProject, deleteProject, fetchProjects }) {
  return (
    <div className="dash-page">
      <section className="panel-card row-between">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>{persona === 'appraiser' ? 'Appraisal Projects' : 'CMA & Listing Projects'}</h1>
          <p className="muted max">Create, open, and delete your saved projects. Opening a project loads its subject, imported sales, Q/C edits, selected comps, adjustments, and narrative data.</p>
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={newProject}>+ New Project</button>
          <button className="btn ghost" onClick={fetchProjects}>Refresh</button>
        </div>
      </section>
      {projectsLoading && <section className="panel-card"><p className="muted">Loading projects…</p></section>}
      {!projectsLoading && !projects.length && (
        <section className="panel-card">
          <h2>No projects yet</h2>
          <p className="muted">Click <strong>+ New Project</strong>, enter a project name, then add your subject and import MLS data. When you click Save Project, it will appear here.</p>
        </section>
      )}
      <div className="project-grid">
        {projects.map(proj => (
          <article className={`project-card ${currentProjectId === proj.id ? 'selected' : ''}`} key={proj.id}>
            <span>{persona === 'appraiser' ? 'Appraisal' : 'CMA / Listing'}</span>
            <h3>{proj.name}</h3>
            <p>{proj.updated_at ? `Updated ${new Date(proj.updated_at).toLocaleString()}` : 'Saved project'}</p>
            <div>
              <em>{currentProjectId === proj.id ? 'Open' : 'Saved'}</em>
              <button className="btn ghost small" onClick={() => openProject(proj)}>Open</button>
              <button className="btn ghost small" onClick={() => deleteProject(proj)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

// ── Subject form ──────────────────────────────────────────────────────────────
function SubjectForm({ persona, subject, setSubject }) {
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const fields = [
    ['address', 'Street Address'], ['city', 'City, State, ZIP'],
    ['effdate', 'Effective / Analysis Date', 'date'],
    ['gla', 'GLA', 'number'], ['site', 'Site Area SF', 'number'],
    ['year', 'Year Built', 'number'], ['beds', 'Bedrooms', 'number'],
    ['baths', 'Baths', 'number'], ['garage', 'Garage'], ['basement', 'Basement'],
    ['pool', 'Pool'], ['qual', 'Quality Rating'], ['cond', 'Condition Rating'],
    ['value', 'Opinion / Target Value', 'number'], ['appraiser', 'Appraiser Name / License']
  ];
  function update(key, type, value) { setSaved(false); setSubject({ ...subject, [key]: type === 'number' ? (value === '' ? '' : toNum(value)) : value }); }
  function save() { setSaved(true); setMessage('Subject profile saved. Values carry into comp ranking, market analysis, site value, adjustment grid, narrative, and workfile exports.'); }
  async function geo() {
    const q = [subject.address, subject.city].filter(Boolean).join(', ');
    if (!q) { setMessage('Enter a street address and city first.'); return; }
    setMessage('Geocoding subject address…');
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (d?.[0]) { setSubject({ ...subject, lat: Number(d[0].lat), lon: Number(d[0].lon) }); setSaved(true); setMessage(`Geocoded → ${Number(d[0].lat).toFixed(5)}, ${Number(d[0].lon).toFixed(5)}`); }
      else setMessage('No result. Try a fuller address with ZIP.');
    } catch { setMessage('Geocoding failed. You can continue without distance ranking.'); }
  }
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">{persona === 'appraiser' ? 'Subject Property' : 'Property Overview'}</p>
        <h1>{persona === 'appraiser' ? 'Subject Property Profile' : 'Listing Property Profile'}</h1>
        <p className="muted max">Fill in the property details and save. Values carry into comp ranking, market comparison, adjustment support, site value, narrative, and exports.</p>
        <div className="form-grid">
          {fields.map(([key, label, type = 'text']) => (
            <label key={key}>{label}<input type={type} value={subject[key] ?? ''} onChange={e => update(key, type, e.target.value)} /></label>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={save}>Save Subject</button>
          <button className="btn ghost" onClick={geo}>Save & Geocode Subject</button>
          <button className="btn ghost" onClick={() => navigate(`/${persona}/mls-import`)}>Continue to MLS Import</button>
        </div>
        <div className={`status-banner ${saved ? 'success' : ''}`}>
          {message || `Coordinates: ${subject.lat ? `${Number(subject.lat).toFixed(5)}, ${Number(subject.lon).toFixed(5)}` : 'not geocoded yet'}`}
        </div>
      </section>
    </div>
  );
}

// ── MLS Import ────────────────────────────────────────────────────────────────
function ImportData({ persona, sales, setSales }) {
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(sales);
  const [fileName, setFileName] = useState('');
  const [importStatus, setImportStatus] = useState('Upload a CSV to review and remap fields before the data is used.');
  const [committed, setCommitted] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const required = ['sale_price', 'sale_date', 'gla'];
  const mappedOk = required.every(f => mapping[f] !== undefined && mapping[f] !== '');

  async function handle(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const parsed = parseCSVMatrix(text);
    const m = autoMapHeaders(parsed.headers);
    setHeaders(parsed.headers); setRawRows(parsed.rows); setMapping(m);
    setPreview(rowsFromMapping(parsed.headers, parsed.rows, m));
    setFileName(f.name); setCommitted(false);
    setImportStatus(`Loaded ${f.name}. Review the column mapping below before applying.`);
    e.target.value = '';
  }

  async function apply() {
    if (!mappedOk) { setImportStatus('Map Sale Price, Sale Date, and GLA before applying.'); return; }
    const records = rowsFromMapping(headers, rawRows, mapping);
    setGeocoding(true); setCommitted(false); setPreview(records);
    setImportStatus(`Mapped ${records.length} record(s). Geocoding missing coordinates…`);
    const result = await geocodeMissingSales(records, msg => setImportStatus(msg));
    setPreview(result.records); setSales(result.records); setCommitted(true); setGeocoding(false);
    setImportStatus(`Applied ${result.records.length} record(s). Geocoded ${result.geocoded}, kept ${result.skipped} existing, attempted ${result.attempted} lookups. Records now feed Q/C, Market Conditions, GLA Study, Comp Ranking, Adjustments, Concessions, and exports.`);
  }

  function updateMap(field, value) {
    const next = { ...mapping, [field]: value };
    setMapping(next); setPreview(rowsFromMapping(headers, rawRows, next));
    setCommitted(false); setImportStatus('Mapping changed. Review the preview, then click Apply.');
  }

  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">MLS Import</p>
        <h1>{persona === 'appraiser' ? 'Import appraisal sales data' : 'Import CMA market data'}</h1>
        <p className="muted max">Upload your MLS CSV, verify the field mapping, inspect the preview, then apply it.</p>
        <label className="upload-box">
          <strong>Click to upload MLS CSV</strong>
          <span>After upload, the mapping review panel opens below.</span>
          <input type="file" accept=".csv,text/csv" onChange={handle} />
        </label>
        {fileName && <div className="btn-row"><span className="muted">Current file: {fileName}</span></div>}
        <div className={`status-banner ${committed ? 'success' : ''}`}>{importStatus}</div>
      </section>

      {headers.length > 0 && (
        <section className="panel-card mapping-panel">
          <div className="card-head">
            <div><p className="eyebrow">Step 1</p><h2>Confirm Column Mapping</h2></div>
            <button className="btn gold small" onClick={apply} disabled={geocoding}>{geocoding ? 'Geocoding…' : 'Apply Mapping'}</button>
          </div>
          <div className="mapping-required-row">
            {required.map(f => (
              <span key={f} className={mapping[f] !== undefined && mapping[f] !== '' ? 'map-ok' : 'map-missing'}>
                {FIELD_LABELS[f]} {mapping[f] !== undefined && mapping[f] !== '' ? '✓' : 'missing'}
              </span>
            ))}
          </div>
          <div className="mapper-grid">
            {Object.keys(FIELD_LABELS).map(field => {
              const req = required.includes(field);
              const selected = mapping[field] ?? '';
              const sample = selected !== '' && rawRows[0] ? rawRows[0][Number(selected)] : '';
              return (
                <label key={field} className={req ? 'required-map' : ''}>
                  {FIELD_LABELS[field]} {req && <em>Required</em>}
                  <select value={selected} onChange={e => updateMap(field, e.target.value)}>
                    <option value="">— Not in CSV —</option>
                    {headers.map((h, i) => <option key={h + i} value={i}>{h}</option>)}
                  </select>
                  <small>{sample ? `Sample: ${sample}` : 'No sample mapped'}</small>
                </label>
              );
            })}
          </div>
          <div className="btn-row">
            <button className="btn gold" onClick={apply} disabled={geocoding}>{geocoding ? 'Geocoding Sales…' : 'Apply Mapping & Use These Records'}</button>
            <button className="btn ghost" onClick={() => { setHeaders([]); setRawRows([]); setMapping({}); setPreview(sales); setImportStatus('Import cancelled.'); }}>Cancel Import</button>
          </div>
        </section>
      )}

      {preview.length > 0 && (
        <section className="table-card">
          <div className="card-head">
            <div><p className="eyebrow">Step 2</p><h2>{headers.length && !committed ? 'Preview Before Applying' : 'Active Records'}</h2></div>
            <span>{preview.length} rows</span>
          </div>
          <table>
            <thead><tr><th>Address</th><th>City</th><th>Status</th><th>Price</th><th>Date</th><th>GLA</th><th>Site</th><th>Year</th><th>Q</th><th>C</th><th>Geo</th></tr></thead>
            <tbody>{preview.slice(0, 25).map((r, i) => (
              <tr key={i}><td>{r.address || '—'}</td><td>{r.city || '—'}</td><td>{r.status || '—'}</td><td>{money(r.sale_price_n)}</td><td>{r.sale_date || '—'}</td><td>{r.gla_n || '—'}</td><td>{r.site_sf_n || '—'}</td><td>{r.year_built_n || '—'}</td><td>{r.quality || '—'}</td><td>{r.condition || '—'}</td><td>{r.lat && r.lon ? '✓' : r.geocode_status || '—'}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ── Q/C Analyzer ──────────────────────────────────────────────────────────────
function Distribution({ title, data }) {
  const max = Math.max(1, ...data.map(d => d[1]));
  return (
    <section className="panel-card">
      <h2>{title}</h2>
      <div className="bar-list">
        {data.map(([k, v]) => (
          <div key={k}><span>{k}</span><i><b style={{ width: `${v / max * 100}%` }} /></i><em>{v}</em></div>
        ))}
      </div>
    </section>
  );
}
function QCAnalyzer({
  sales,
  setSales,
  subject
}) {
  const [qcRows, setQcRows] = React.useState([]);

  React.useEffect(() => {
    if (!sales?.length) return;

    const sampleSize = Math.max(
      5,
      Math.round(sales.length * 0.1)
    );

    const shuffled = [...sales]
      .sort(() => 0.5 - Math.random())
      .slice(0, sampleSize);

    const initialized = shuffled.map((sale) => ({
      ...sale,
      qRating: sale.qRating || "",
      cRating: sale.cRating || ""
    }));

    setQcRows(initialized);
  }, [sales]);

  const updateRow = (idx, field, value) => {
    setQcRows((prev) =>
      prev.map((row, i) =>
        i === idx
          ? { ...row, [field]: value }
          : row
      )
    );
  };

  const applyReviewSamples = () => {
    const reviewed = qcRows.filter(
      (r) => r.qRating && r.cRating
    );

    if (!reviewed.length) return;

    const avgQ =
      reviewed.reduce(
        (sum, r) =>
          sum + Number(r.qRating || 0),
        0
      ) / reviewed.length;

    const avgC =
      reviewed.reduce(
        (sum, r) =>
          sum + Number(r.cRating || 0),
        0
      ) / reviewed.length;

    const updatedSales = sales.map((sale) => {
      const reviewedMatch = reviewed.find(
        (r) => r.id === sale.id
      );

      // Preserve manually reviewed rows
      if (reviewedMatch) {
        return {
          ...sale,
          qRating: reviewedMatch.qRating,
          cRating: reviewedMatch.cRating
        };
      }

      let qEstimate = avgQ;
      let cEstimate = avgC;

      // Similarity logic
      if (
        Number(sale.yearBuilt || 0) >
        Number(subject?.yearBuilt || 0)
      ) {
        qEstimate += 0.5;
        cEstimate += 0.5;
      }

      if (
        Number(sale.gla || 0) >
        Number(subject?.gla || 0)
      ) {
        qEstimate += 0.25;
      }

      if (
        Number(sale.salePrice || 0) <
        Number(subject?.salePrice || 0)
      ) {
        cEstimate -= 0.25;
      }

      qEstimate = Math.max(
        1,
        Math.min(6, qEstimate)
      );

      cEstimate = Math.max(
        1,
        Math.min(6, cEstimate)
      );

      return {
        ...sale,
        qRating: Math.round(qEstimate),
        cRating: Math.round(cEstimate)
      };
    });

    setSales(updatedSales);

    alert(
      "Q/C ratings applied to all imported sales."
    );
  };

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>
            10% Suggested Q/C Review Samples
          </h2>
          <span>
            Review sample sales, then apply
            ratings to all imported comps.
          </span>
        </div>

        <button
          className="btn gold small"
          onClick={applyReviewSamples}
        >
          Apply Q/C Rating Adjustments
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Address</th>
            <th>Price</th>
            <th>GLA</th>
            <th>Year</th>
            <th>Q</th>
            <th>C</th>
          </tr>
        </thead>

        <tbody>
          {qcRows.map((row, idx) => (
            <tr key={idx}>
              <td>{row.address}</td>

              <td>
                $
                {Number(
                  row.salePrice || 0
                ).toLocaleString()}
              </td>

              <td>{row.gla}</td>

              <td>{row.yearBuilt}</td>

              <td>
                <select
                  value={row.qRating}
                  onChange={(e) =>
                    updateRow(
                      idx,
                      "qRating",
                      e.target.value
                    )
                  }
                >
                  <option value="">
                    Select
                  </option>

                  {[1, 2, 3, 4, 5, 6].map(
                    (q) => (
                      <option
                        key={q}
                        value={q}
                      >
                        Q{q}
                      </option>
                    )
                  )}
                </select>
              </td>

              <td>
                <select
                  value={row.cRating}
                  onChange={(e) =>
                    updateRow(
                      idx,
                      "cRating",
                      e.target.value
                    )
                  }
                >
                  <option value="">
                    Select
                  </option>

                  {[1, 2, 3, 4, 5, 6].map(
                    (c) => (
                      <option
                        key={c}
                        value={c}
                      >
                        C{c}
                      </option>
                    )
                  )}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}


// ── Market Conditions ─────────────────────────────────────────────────────────
function MarketLineChart({ points, max }) {
  if (!points.length) return <div className="status-banner">No valid market trend points available.</div>;
  const w = 720, h = 220, pad = 34;
  const vals = points.map(p => p.yMod).filter(v => isFinite(v));
  const minY = Math.min(...vals), maxY = Math.max(max || 1, ...vals);
  const span = Math.max(1, maxY - minY);
  const denom = Math.max(1, points.length - 1);
  const coords = points.map((p, i) => {
    const x = pad + (i / denom) * (w - pad * 2);
    const y = h - pad - ((p.yMod - minY) / span) * (h - pad * 2);
    return { ...p, x, y };
  });
  const d = coords.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return (
    <div className="market-line-wrap">
      <svg className="market-line-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Median sale price line graph">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} />
        <path d={d} />
        {coords.map(p => <g key={p.key}><circle cx={p.x} cy={p.y} r="4"><title>{p.key}: {money(p.yMod)} ({p.n} sales)</title></circle><text x={p.x} y={h - 10} textAnchor="middle">{p.key}</text></g>)}
      </svg>
    </div>
  );
}

function MarketConditions({ persona, sales, setMtNarData, marketStudyState, setMarketStudyState, setAdjustmentDefaults }) {
  const state = marketStudyState || { mode: 'rolling3', minSales: 1, ran: false };
  const mode = state.mode ?? 'rolling3';
  const minSales = state.minSales ?? 1;
  const ran = !!state.ran;
  const series = useMemo(() => marketSeries(sales, minSales, mode), [sales, minSales, mode]);

  function updateState(patch) {
    setMarketStudyState(prev => ({ ...(prev || { mode: 'rolling3', minSales: 1, ran: false }), ...patch }));
  }

  function generate() {
    const dir = series.monthly > 0.1 ? 'increasing' : series.monthly < -0.1 ? 'declining' : 'stable';
    updateState({ ran: true, lastSeries: series });
    setMtNarData({ monthly: series.monthly, dir });
    setAdjustmentDefaults(prev => ({ ...(prev || {}), mtRate: Number(series.monthly || 0) }));
  }

  const modeLabels = { raw: 'Raw period medians', rolling3: 'Rolling 3-month median', quarterly: 'Quarterly modifier', weighted: 'Weighted trend line' };
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">{persona === 'appraiser' ? 'Market Conditions Tool' : 'Market Snapshot'}</p>
        <h1>{persona === 'appraiser' ? 'Market Conditions / Rolling Modifier' : 'Active / Pending / Sold Market Snapshot'}</h1>
        <p className="muted max">Rolling 3-month median, quarterly grouping, and weighted trend line options. Import MLS data first to populate this analysis. Generated results now stay visible when you leave this tab and feed the Adjustment Grid.</p>
        <div className="form-grid compact">
          <label>Modifier Method<select value={mode} onChange={e => updateState({ mode: e.target.value, ran: false })}><option value="raw">Off — raw period medians</option><option value="rolling3">Rolling 3-month median</option><option value="quarterly">Quarterly modifier</option><option value="weighted">Weighted trend line by sale count</option></select></label>
          <label>Minimum Sales Per Period<input type="number" value={minSales} min="1" onChange={e => updateState({ minSales: Number(e.target.value) || 1, ran: false })} /></label>
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={generate} disabled={!sales.length}>Generate Market Study</button>
          {!sales.length && <span className="muted">Import MLS data first.</span>}
          {ran && <span className="status-pill">Study generated using {modeLabels[mode]}</span>}
          {ran && <span className="status-pill">Carried to Adjustment Grid</span>}
        </div>
        {ran && (
          <div className="metric-grid four">
            <div><b>{series.monthly.toFixed(3)}%</b><span>Monthly Rate</span></div>
            <div><b>{(series.monthly * 12).toFixed(2)}%</b><span>Annualized</span></div>
            <div><b>{series.points.length}</b><span>Periods Used</span></div>
            <div><b>{series.monthly > 0.1 ? '↑ Increasing' : series.monthly < -0.1 ? '↓ Declining' : '→ Stable'}</b><span>Direction</span></div>
          </div>
        )}
      </section>
      {ran
        ? <section className="chart-card">
            <h2>Median Sale Price Trend</h2>
            <MarketLineChart points={series.points} max={series.max} />
            <div className="table-card embedded">
              <table><thead><tr><th>Period</th><th>Sales</th><th>Raw Median</th><th>Modified Median</th></tr></thead>
                <tbody>{series.points.map(p => <tr key={p.key}><td>{p.key}</td><td>{p.n}</td><td>{money(p.y)}</td><td>{money(p.yMod)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        : <section className="panel-card"><h2>Ready to generate</h2><p className="muted">{sales.length ? 'Choose a modifier, then click Generate Market Study.' : 'Import MLS data first, then return here to run the market study.'}</p></section>
      }
    </div>
  );
}

// ── GLA Study ─────────────────────────────────────────────────────────────────
function GLAStudy({ sales, subject, setGlaNarData, glaStudyState, setGlaStudyState, setAdjustmentDefaults, adjustmentDefaults }) {
  const state = glaStudyState || {};
  const mtRate = state.mtRate ?? adjustmentDefaults?.mtRate ?? 0;
  const regResult = state.regResult ?? null;
  const pairedRows = state.pairedRows ?? [{ pa: '', ga: '', pb: '', gb: '' }];
  const pairedResult = state.pairedResult ?? null;
  const applyInputs = state.applyInputs ?? { sg: subject.gla || '', cg: '', rate: adjustmentDefaults?.glaRate || '', cp: '' };
  const applyResult = state.applyResult ?? null;

  function updateState(patch) {
    setGlaStudyState(prev => ({ ...(prev || {}), ...patch }));
  }

  useEffect(() => {
    updateState({
      applyInputs: {
        ...(applyInputs || {}),
        sg: applyInputs?.sg || subject.gla || '',
        rate: applyInputs?.rate || adjustmentDefaults?.glaRate || ''
      }
    });
  }, [subject.gla, adjustmentDefaults?.glaRate]);

  function runRegression() {
    const pairs = sales.filter(s => !isNaN(s.gla_n) && !isNaN(s.sale_price_n) && s.gla_n > 0 && s.sale_price_n > 0).map(s => {
      let adjPrice = s.sale_price_n;
      if (mtRate !== 0 && subject.effdate && s.sale_date) { const m = monthsBetween(subject.effdate, s.sale_date); adjPrice *= (1 + mtRate / 100 * m); }
      return { x: s.gla_n, y: adjPrice };
    });
    if (pairs.length < 3) { alert('Need at least 3 sales with GLA and price data.'); return; }
    const { b, r2, n } = linReg(pairs);
    const rel = r2 >= 0.8 ? 'Strong (R²≥0.80)' : r2 >= 0.6 ? 'Moderate (R²≥0.60)' : r2 >= 0.4 ? 'Weak (R²≥0.40) — corroborate with paired sales' : 'Poor — use paired sales method';
    const next = { slope: b, r2, n, rel };
    updateState({ regResult: next, applyInputs: { ...applyInputs, rate: b } });
    setGlaNarData({ rate: b, method: 'simple linear regression' });
    setAdjustmentDefaults(prev => ({ ...(prev || {}), glaRate: Number(b || 0) }));
  }

  function calcPaired() {
    const rates = [];
    const results = pairedRows.map((r, i) => {
      const pa = toNum(r.pa), ga = toNum(r.ga), pb = toNum(r.pb), gb = toNum(r.gb);
      if ([pa, ga, pb, gb].every(v => !isNaN(v)) && ga !== gb) { const rate = (pa - pb) / (ga - gb); rates.push(rate); return { i, rate, valid: true }; }
      return { i, valid: false };
    });
    if (!rates.length) { alert('Enter at least one complete pair.'); return; }
    const avg = rates.reduce((a, b2) => a + b2, 0) / rates.length;
    const med = median(rates);
    const next = { results, avg, med, min: Math.min(...rates), max: Math.max(...rates) };
    updateState({ pairedResult: next, applyInputs: { ...applyInputs, rate: med } });
    setGlaNarData({ rate: med, method: 'paired sales analysis' });
    setAdjustmentDefaults(prev => ({ ...(prev || {}), glaRate: Number(med || 0) }));
  }

  function calcApply() {
    const sg = toNum(applyInputs.sg), cg = toNum(applyInputs.cg), rate = toNum(applyInputs.rate), cp = toNum(applyInputs.cp);
    if ([sg, cg, rate, cp].some(isNaN)) { alert('Fill all fields.'); return; }
    const diff = sg - cg, dollar = diff * rate, adj = cp + dollar;
    updateState({ applyResult: { diff, dollar, adj, pct: Math.abs(dollar / cp * 100) } });
    setAdjustmentDefaults(prev => ({ ...(prev || {}), glaRate: Number(rate || 0) }));
  }

  return (
    <div className="dash-page">
      <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>GLA Adjustment Study</h1><p className="muted max">Extract a per-square-foot GLA adjustment using regression analysis, paired sales, or apply an existing rate. Results now stay visible when you leave this tab and feed the Adjustment Grid while remaining editable there.</p></section>
      <section className="panel-card">
        <h2>Method 1 — Simple Linear Regression</h2>
        <p className="muted">Regresses time-adjusted sale prices against GLA for all imported sales with valid data.</p>
        <div className="form-grid compact"><label>Market Conditions Rate (% / month)<input type="number" step="0.001" value={mtRate} onChange={e => updateState({ mtRate: toNum(e.target.value) || 0 })} /></label></div>
        <div className="btn-row"><button className="btn gold" onClick={runRegression} disabled={!sales.length}>Run GLA Regression</button>{!sales.length && <span className="muted">Import MLS data first.</span>}{regResult && <span className="status-pill">GLA rate carried to Adjustment Grid</span>}</div>
        {regResult && <div className="metric-grid four" style={{ marginTop: 16 }}><div><b>${fmt(regResult.slope, 2)}/SF</b><span>Slope ($/SF)</span></div><div><b>{fmt(regResult.r2, 3)}</b><span>R²</span></div><div><b>{regResult.n}</b><span>Sales Used</span></div><div><b style={{ fontSize: '1rem', lineHeight: 1.3 }}>{regResult.rel}</b><span>Reliability</span></div></div>}
      </section>
      <section className="panel-card">
        <h2>Method 2 — Paired Sales Analysis</h2>
        <p className="muted">Isolate GLA differences between matched pairs. Add pairs, then calculate.</p>
        {pairedRows.map((r, i) => (
          <div key={i} className="form-grid" style={{ marginBottom: 8 }}>
            <label>Sale A Price ($)<input type="number" value={r.pa} onChange={e => updateState({ pairedRows: pairedRows.map((x, j) => j === i ? { ...x, pa: e.target.value } : x) })} /></label>
            <label>Sale A GLA (SF)<input type="number" value={r.ga} onChange={e => updateState({ pairedRows: pairedRows.map((x, j) => j === i ? { ...x, ga: e.target.value } : x) })} /></label>
            <label>Sale B Price ($)<input type="number" value={r.pb} onChange={e => updateState({ pairedRows: pairedRows.map((x, j) => j === i ? { ...x, pb: e.target.value } : x) })} /></label>
            <label>Sale B GLA (SF)<input type="number" value={r.gb} onChange={e => updateState({ pairedRows: pairedRows.map((x, j) => j === i ? { ...x, gb: e.target.value } : x) })} /></label>
          </div>
        ))}
        <div className="btn-row">
          <button className="btn ghost" onClick={() => updateState({ pairedRows: [...pairedRows, { pa: '', ga: '', pb: '', gb: '' }] })}>+ Add Pair</button>
          <button className="btn gold" onClick={calcPaired}>Calculate Paired Rates</button>
        </div>
        {pairedResult && <div className="metric-grid four" style={{ marginTop: 16 }}><div><b>${fmt(pairedResult.avg, 2)}/SF</b><span>Average Rate</span></div><div><b>${fmt(pairedResult.med, 2)}/SF</b><span>Median Rate</span></div><div><b>${fmt(pairedResult.min, 2)} – ${fmt(pairedResult.max, 2)}</b><span>Range</span></div><div><b>{pairedResult.results.filter(r => r.valid).length}</b><span>Valid Pairs</span></div></div>}
      </section>
      <section className="panel-card">
        <h2>Apply GLA Rate</h2>
        <p className="muted">Calculate the dollar adjustment and adjusted price for a single comparable.</p>
        <div className="form-grid">
          <label>Subject GLA (SF)<input type="number" value={applyInputs.sg} onChange={e => updateState({ applyInputs: { ...applyInputs, sg: e.target.value } })} /></label>
          <label>Comp GLA (SF)<input type="number" value={applyInputs.cg} onChange={e => updateState({ applyInputs: { ...applyInputs, cg: e.target.value } })} /></label>
          <label>Rate ($/SF)<input type="number" step="0.01" value={applyInputs.rate} onChange={e => updateState({ applyInputs: { ...applyInputs, rate: e.target.value } })} /></label>
          <label>Comp Sale Price ($)<input type="number" value={applyInputs.cp} onChange={e => updateState({ applyInputs: { ...applyInputs, cp: e.target.value } })} /></label>
        </div>
        <div className="btn-row"><button className="btn gold" onClick={calcApply}>Apply GLA Rate</button></div>
        {applyResult && <div className="metric-grid four" style={{ marginTop: 16 }}><div><b>{fmt(applyResult.diff)} SF</b><span>GLA Difference</span></div><div><b>{fmtD(applyResult.dollar)}</b><span>Dollar Adjustment</span></div><div><b>{money(applyResult.adj)}</b><span>Adjusted Price</span></div><div><b>{fmt(applyResult.pct, 1)}%</b><span>Pct of Sale Price</span></div></div>}
      </section>
    </div>
  );
}

// ── Comp Ranking ──────────────────────────────────────────────────────────────
function CompRanking({ subject, setSubject, sales, setSales, selectedComps, setSelectedComps }) {
  const [w, setW] = useState({ gla: 24, distance: 18, date: 18, site: 10, year: 8, garage: 7, basement: 5, pool: 4, qual: 3, cond: 3 });
  const [busy, setBusy] = useState('');
  const ranked = useMemo(() => sales.map((s, idx) => ({ ...s, _key: s._id ?? s.address ?? idx, _distance: distanceMiles(subject.lat, subject.lon, s.lat, s.lon), _score: scoreComp(s, subject, w) })).sort((a, b) => b._score - a._score), [sales, subject, w]);
  const selectedSet = new Set(selectedComps);
  function toggleComp(key) { setSelectedComps(selectedSet.has(key) ? selectedComps.filter(x => x !== key) : [...selectedComps, key]); }
  async function geocodeOne(addr) { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`); const d = await r.json(); return d?.[0] ? { lat: Number(d[0].lat), lon: Number(d[0].lon) } : null; }
  async function geoSubject() { setBusy('Geocoding subject…'); const res = await geocodeOne([subject.address, subject.city].filter(Boolean).join(', ')); if (res) setSubject({ ...subject, ...res }); setBusy(''); }
  async function geoComps() { setBusy('Geocoding comps…'); const updated = []; for (let i = 0; i < sales.length; i++) { const s = sales[i]; if (s.lat && s.lon) { updated.push(s); continue; } const addr = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '); if (!addr) { updated.push(s); continue; } try { const res = await geocodeOne(addr); updated.push(res ? { ...s, ...res } : s); } catch { updated.push(s); } await new Promise(r => setTimeout(r, 650)); } setSales(updated); setBusy(''); }
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Comp Ranking Tool</p>
        <h1>Comparable Sale Ranking + Geocoding</h1>
        <p className="muted max">Ranks comps by GLA, distance, date, site, age, garage, basement, pool, quality, and condition. Select comps to carry into the Adjustment Grid. Import MLS data first.</p>
        <div className="btn-row">
          <button className="btn gold" onClick={geoSubject}>Geocode Subject</button>
          <button className="btn ghost" onClick={geoComps}>Geocode Comparable Sales</button>
          {busy && <span className="muted">{busy}</span>}
          <span className="status-pill">{selectedComps.length} selected</span>
        </div>
        {!sales.length && <div className="status-banner">No sales imported yet. Go to MLS Import to upload your data.</div>}
        <div className="weight-grid">{Object.keys(w).map(k => <label key={k}>{k}<input type="number" value={w[k]} onChange={e => setW({ ...w, [k]: Number(e.target.value) || 0 })} /></label>)}</div>
        <div className="muted" style={{ marginTop: 8 }}>Weight total: {Object.values(w).reduce((a, b) => a + b, 0)}</div>
      </section>
      <section className="rank-grid">
        {ranked.slice(0, 12).map((s, i) => (
          <article className={`rank-card ${selectedSet.has(s._key) ? 'selected' : ''}`} key={s._key}>
            <div className="rank-num">#{i + 1}</div>
            <div>
              <div className="row-between">
                <div><h3>{s.address || 'Address not mapped'}</h3><p>{s.city || ''}</p></div>
                <label className="select-comp"><input type="checkbox" checked={selectedSet.has(s._key)} onChange={() => toggleComp(s._key)} /> Use comp</label>
              </div>
              <div className="rank-meta">
                <span>Score <b>{fmt(s._score, 0)}</b></span>
                <span>Price <b>{money(s.sale_price_n)}</b></span>
                <span>GLA <b>{fmt(s.gla_n)}</b></span>
                <span>Distance <b>{s._distance !== null ? `${fmt(s._distance, 2)} mi` : '—'}</b></span>
                <span>Q/C <b>{s.quality || '—'} / {s.condition || '—'}</b></span>
                <span>Status <b>{s.status || '—'}</b></span>
              </div>
              {s.lat && s.lon && <a className="map-link" href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=16/${s.lat}/${s.lon}`} target="_blank" rel="noreferrer">Open map ↗</a>}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

// ── Site Value ────────────────────────────────────────────────────────────────
function SiteValue({ subject, siteValueState, setSiteValueState, setAdjustmentDefaults }) {
  const state = siteValueState || { land: [], imp: '', total: '', pct: 20, ran: false, selectedRate: 0 };
  const land = state.land || [];
  const imp = state.imp ?? '';
  const total = state.total ?? '';
  const pct = state.pct ?? 20;
  const ran = !!state.ran;
  const selectedRate = state.selectedRate || 0;

  function updateState(patch) {
    setSiteValueState(prev => ({ ...(prev || {}), ...patch }));
  }

  const avg = land.length ? land.reduce((a, r) => a + (Number(r.price) || 0) / (Number(r.site) || 1), 0) / land.length : 0;
  const allocation = toNum(total) && pct ? toNum(total) * pct / 100 : 0;
  const abstraction = toNum(total) && toNum(imp) ? toNum(total) - toNum(imp) : 0;
  const allocationRate = allocation && subject.site ? allocation / Number(subject.site) : 0;
  const abstractionRate = abstraction && subject.site ? abstraction / Number(subject.site) : 0;

  function useSiteRate(rate, label) {
    const cleanRate = Number(rate || 0);
    updateState({ selectedRate: cleanRate, selectedRateLabel: label });
    setAdjustmentDefaults(prev => ({ ...(prev || {}), siteRate: cleanRate }));
  }

  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Appraiser Tool</p>
        <h1>Site / Land Value Support</h1>
        <p className="muted max">Support site value using vacant land sales, allocation, and abstraction methods. Chosen $/SF site rates now carry into the Adjustment Grid while remaining editable there.</p>
        <div className="btn-row">
          <button className="btn gold" onClick={() => updateState({ ran: true })} disabled={!land.length && !toNum(total)}>Calculate Site / Land Value</button>
          {selectedRate ? <span className="status-pill">Site rate carried: ${fmt(selectedRate, 2)}/SF</span> : null}
        </div>
        {ran && (
          <div className="metric-grid three" style={{ marginTop: 16 }}>
            <div><b>{land.length ? `${money(avg)}/SF` : '—'}</b><span>Avg $/SF (Land Sales)</span></div>
            <div><b>{allocation ? money(allocation) : '—'}</b><span>Allocation Indication</span></div>
            <div><b>{abstraction ? money(abstraction) : '—'}</b><span>Abstraction Indication</span></div>
          </div>
        )}
        {ran && (
          <div className="btn-row" style={{ marginTop: 16 }}>
            {land.length > 0 && <button className="btn ghost" onClick={() => useSiteRate(avg, 'Land Sale Average')}>Use Land Avg in Grid</button>}
            {allocationRate > 0 && <button className="btn ghost" onClick={() => useSiteRate(allocationRate, 'Allocation Rate')}>Use Allocation $/SF in Grid</button>}
            {abstractionRate > 0 && <button className="btn ghost" onClick={() => useSiteRate(abstractionRate, 'Abstraction Rate')}>Use Abstraction $/SF in Grid</button>}
          </div>
        )}
      </section>
      <section className="table-card">
        <div className="card-head"><h2>Vacant Land Sales</h2><button onClick={() => updateState({ ran: false, land: [...land, { price: '', site: '' }] })}>+ Add Sale</button></div>
        {land.length === 0 && <div className="status-banner">No land sales entered yet. Click + Add Sale to begin.</div>}
        {land.length > 0 && (
          <table>
            <thead><tr><th>Sale Price</th><th>Site SF</th><th>$/SF</th><th></th></tr></thead>
            <tbody>{land.map((r, i) => (
              <tr key={i}>
                <td><input className="cell-input" type="number" value={r.price} onChange={e => updateState({ ran: false, land: land.map((x, j) => j === i ? { ...x, price: e.target.value } : x) })} /></td>
                <td><input className="cell-input" type="number" value={r.site} onChange={e => updateState({ ran: false, land: land.map((x, j) => j === i ? { ...x, site: e.target.value } : x) })} /></td>
                <td>{r.price && r.site ? `${money((Number(r.price) || 0) / (Number(r.site) || 1))}/SF` : '—'}</td>
                <td><button className="btn ghost small" onClick={() => updateState({ land: land.filter((_, j) => j !== i) })}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
      <section className="panel-card">
        <h2>Allocation / Abstraction Methods</h2>
        <p className="muted" style={{ marginBottom: 12 }}>If subject site area is filled in Subject Property, allocation and abstraction can also be converted to a $/SF site rate for the Adjustment Grid.</p>
        <div className="form-grid">
          <label>Total Property Value<input type="number" value={total} onChange={e => updateState({ ran: false, total: e.target.value })} /></label>
          <label>Allocation % to Site<input type="number" value={pct} onChange={e => updateState({ ran: false, pct: Number(e.target.value) })} /></label>
          <label>Improvement Value Estimate<input type="number" value={imp} onChange={e => updateState({ ran: false, imp: e.target.value })} /></label>
        </div>
      </section>
    </div>
  );
}

// ── Adjustment Grid ───────────────────────────────────────────────────────────
function Adjustments({ selectedComps, sales, subject, adjRows, setAdjRows, adjustmentDefaults, setAdjustmentDefaults }) {
  const defaults = adjustmentDefaults || {};
  const mtRate = defaults.mtRate ?? 0;
  const glaRate = defaults.glaRate ?? 0;
  const siteRate = defaults.siteRate ?? 0;
  const ageRate = defaults.ageRate ?? 0;
  const condRate = defaults.condRate ?? 0;
  const qualRate = defaults.qualRate ?? 0;
  const topN = defaults.topN ?? 6;
  const built = !!defaults.built;

  function updateDefault(key, value) {
    setAdjustmentDefaults(prev => ({ ...(prev || {}), [key]: value }));
  }

  const selectedSet = new Set(selectedComps);
  const selectedRows = sales.filter(s => { const key = s._id ?? s.address; return selectedSet.has(key); }).sort((a, b) => (b._score || 0) - (a._score || 0));

  function build() {
    const useSales = selectedRows.length ? selectedRows.slice(0, topN) : sales.slice(0, topN);
    const rows = useSales.map((s, i) => {
      const months = subject.effdate && s.sale_date ? monthsBetween(subject.effdate, s.sale_date) : 0;
      const timeAdj = s.sale_price_n * (mtRate / 100) * months;
      const glaAdj = subject.gla && s.gla_n ? (subject.gla - s.gla_n) * glaRate : 0;
      const siteAdj = subject.site && s.site_sf_n ? (subject.site - s.site_sf_n) * siteRate : 0;
      const ageAdj = subject.year && s.year_built_n ? (s.year_built_n - subject.year) * ageRate : 0;
      const cq = ratingNum(s.condition), sq = ratingNum(subject.cond); const qq = ratingNum(s.quality), qs = ratingNum(subject.qual);
      const cDiff = sq && cq ? Math.round(cq) - Math.round(sq) : 0;
      const qDiff = qs && qq ? Math.round(qq) - Math.round(qs) : 0;
      const condAdj = cDiff * condRate; const qualAdj = qDiff * qualRate;
      const totalAdj = timeAdj + glaAdj + siteAdj + ageAdj + condAdj + qualAdj;
      return { rank: i + 1, address: s.address || '', price: s.sale_price_n || 0, date: s.sale_date || '', score: s._score || 0, timeAdj, glaAdj, siteAdj, ageAdj, condAdj, qualAdj, otherAdj: 0, totalAdj, adjusted: (s.sale_price_n || 0) + totalAdj, note: '' };
    });
    setAdjRows(rows);
    setAdjustmentDefaults(prev => ({ ...(prev || {}), built: true }));
  }

  function editAdj(i, k, v) {
    const next = adjRows.map((r, j) => {
      if (j !== i) return r;
      const updated = { ...r, [k]: toNum(v) || 0 };
      updated.totalAdj = updated.timeAdj + updated.glaAdj + updated.siteAdj + updated.ageAdj + updated.condAdj + updated.qualAdj + updated.otherAdj;
      updated.adjusted = updated.price + updated.totalAdj;
      return updated;
    });
    setAdjRows(next);
  }

  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Appraiser Tool</p>
        <h1>Adjustment Grid</h1>
        <p className="muted max">Select comps in Comp Ranking then build the grid. Market, GLA, and site rates carry over from prior studies, but appraisers can still edit them here before building the grid.</p>
        <div className="form-grid">
          <label>Market Conditions (% / month)<input type="number" step="0.001" value={mtRate} onChange={e => updateDefault('mtRate', toNum(e.target.value) || 0)} /></label>
          <label>GLA Rate ($/SF)<input type="number" step="0.01" value={glaRate} onChange={e => updateDefault('glaRate', toNum(e.target.value) || 0)} /></label>
          <label>Site Rate ($/SF)<input type="number" step="0.01" value={siteRate} onChange={e => updateDefault('siteRate', toNum(e.target.value) || 0)} /></label>
          <label>Age Rate ($/year)<input type="number" step="1" value={ageRate} onChange={e => updateDefault('ageRate', toNum(e.target.value) || 0)} /></label>
          <label>Condition Rate ($/rating step)<input type="number" step="100" value={condRate} onChange={e => updateDefault('condRate', toNum(e.target.value) || 0)} /></label>
          <label>Quality Rate ($/rating step)<input type="number" step="100" value={qualRate} onChange={e => updateDefault('qualRate', toNum(e.target.value) || 0)} /></label>
          <label>Top N Comps<input type="number" min="1" max="12" value={topN} onChange={e => updateDefault('topN', Number(e.target.value) || 6)} /></label>
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          {mtRate !== 0 && <span className="status-pill">Market rate loaded</span>}
          {glaRate !== 0 && <span className="status-pill">GLA rate loaded</span>}
          {siteRate !== 0 && <span className="status-pill">Site rate loaded</span>}
        </div>
        {selectedRows.length > 0
          ? <div className="selected-comps-row">{selectedRows.slice(0, topN).map(s => <span key={s._id}>{s.address}</span>)}</div>
          : <div className="status-banner">No comps selected. Select comps in Comp Ranking for best results, or the grid will use the top {topN} ranked sales.</div>}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn gold" onClick={build} disabled={!sales.length}>Build / Rebuild Adjustment Grid</button>
          {!sales.length && <span className="muted">Import MLS data first.</span>}
          {built && <span className="status-pill">Grid built — cells are editable</span>}
        </div>
      </section>
      {adjRows.length > 0 && (
        <section className="table-card" style={{ overflowX: 'auto' }}>
          <div className="card-head">
            <h2>Adjustment Grid</h2>
            <button className="btn ghost small" onClick={() => {
              const csv = ['Rank,Address,Sale Price,Date,Score,Time,GLA,Site,Age,Cond,Qual,Other,Net Adj,Adjusted,Notes'].concat(adjRows.map(r => [r.rank, `"${r.address}"`, r.price, r.date, Math.round(r.score), Math.round(r.timeAdj), Math.round(r.glaAdj), Math.round(r.siteAdj), Math.round(r.ageAdj), Math.round(r.condAdj), Math.round(r.qualAdj), Math.round(r.otherAdj), Math.round(r.totalAdj), Math.round(r.adjusted), `"${r.note}"`].join(','))).join('\n');
              const b = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'adjustment_grid.csv'; a.click();
            }}>Export CSV ⇩</button>
          </div>
          <table>
            <thead><tr><th>#</th><th>Comp</th><th>Sale Price</th><th>Date</th><th>Score</th><th>Time</th><th>GLA</th><th>Site</th><th>Age</th><th>Cond</th><th>Qual</th><th>Other</th><th>Net Adj</th><th>Adjusted</th><th>Notes</th></tr></thead>
            <tbody>{adjRows.map((r, i) => (
              <tr key={i}>
                <td>{r.rank}</td><td>{r.address || '—'}</td><td>{money(r.price)}</td><td>{r.date || '—'}</td><td>{fmt(r.score, 0)}</td>
                {['timeAdj', 'glaAdj', 'siteAdj', 'ageAdj', 'condAdj', 'qualAdj', 'otherAdj'].map(k => <td key={k}><input className="cell-input" defaultValue={Math.round(r[k])} onBlur={e => editAdj(i, k, e.target.value)} style={{ width: 80 }} /></td>)}
                <td style={{ color: r.totalAdj >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtD(r.totalAdj)}</td>
                <td><b>{money(r.adjusted)}</b></td>
                <td><input className="cell-input wide" defaultValue={r.note} onBlur={e => { const next = adjRows.map((x, j) => j === i ? { ...x, note: e.target.value } : x); setAdjRows(next); }} style={{ width: 160 }} /></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ── Concessions ───────────────────────────────────────────────────────────────
function Concessions({ sales }) {
  const [view, setView] = useState('all');
  const [ran, setRan] = useState(false);
  const withConc = sales.filter(s => s.concessions_n > 0);
  const display = view === 'with' ? withConc : sales.filter(s => s.sale_price_n > 0);
  const freq = sales.length ? (withConc.length / sales.length * 100) : 0;
  const amounts = withConc.map(s => s.concessions_n);
  const medConc = median(amounts); const avgConc = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
  const concPcts = withConc.map(s => s.concessions_n / s.sale_price_n * 100).filter(v => isFinite(v));
  const medPct = median(concPcts);
  function narrativeText() {
    if (!withConc.length) return 'No seller concession data was mapped in the imported MLS records. If concessions are relevant, import a CSV with a seller concession column and remap the field.';
    return `Of the ${sales.length} imported sales, ${withConc.length} (${fmt(freq, 1)}%) reflect seller-paid concessions. The median concession was ${money(medConc)}, representing approximately ${fmt(medPct, 1)}% of the sale price for those transactions. This factual summary is drawn from the imported MLS data and does not constitute a conclusion regarding market typicality or price influence. Professional judgment is required to determine whether any adjustment is warranted.`;
  }
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Appraiser Tool</p>
        <h1>Seller Concessions Analysis</h1>
        <p className="muted max">Summarize seller-paid closing costs, credits, and financing concessions from the MLS data. Import sales data first.</p>
        <div className="form-grid compact"><label>Analysis View<select value={view} onChange={e => setView(e.target.value)}><option value="all">All imported sales</option><option value="with">Only sales with concessions</option></select></label></div>
        <div className="btn-row">
          <button className="btn gold" onClick={() => setRan(true)} disabled={!sales.length}>Run Concessions Study</button>
          {!sales.length && <span className="muted">Import MLS data first.</span>}
          {ran && <span className="status-pill">Study complete</span>}
        </div>
        {ran && (
          <div className="metric-grid four" style={{ marginTop: 16 }}>
            <div><b>{withConc.length} / {sales.length}</b><span>Sales with Concessions</span></div>
            <div><b>{fmt(freq, 1)}%</b><span>Frequency</span></div>
            <div><b>{amounts.length ? money(medConc) : '—'}</b><span>Median Concession</span></div>
            <div><b>{concPcts.length ? fmt(medPct, 1) + '%' : '—'}</b><span>Median % of Sale Price</span></div>
          </div>
        )}
      </section>
      {ran && (
        <section className="panel-card">
          <h2>Factual Narrative (Editable)</h2>
          <p className="muted" style={{ marginBottom: 8 }}>Edit before copying into a report addendum.</p>
          <textarea className="big-text" defaultValue={narrativeText()} style={{ minHeight: 140 }} />
          <div className="btn-row"><button className="btn ghost" onClick={() => navigator.clipboard?.writeText(narrativeText())}>Copy Text</button></div>
        </section>
      )}
      {ran && display.length > 0 && (
        <section className="table-card">
          <div className="card-head"><h2>Concession Detail</h2><span>{display.length} records</span></div>
          <table>
            <thead><tr><th>Address</th><th>Sale Price</th><th>Concessions</th><th>Conc %</th><th>Net Price</th><th>Status</th></tr></thead>
            <tbody>{display.map((s, i) => (
              <tr key={i}>
                <td>{s.address || '—'}</td><td>{money(s.sale_price_n)}</td>
                <td>{s.concessions_n > 0 ? money(s.concessions_n) : '—'}</td>
                <td>{s.concessions_n > 0 && s.sale_price_n ? fmt(s.concessions_n / s.sale_price_n * 100, 1) + '%' : '—'}</td>
                <td>{s.concessions_n > 0 && s.sale_price_n ? money(s.sale_price_n - s.concessions_n) : '—'}</td>
                <td>{s.status || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ── Reconciliation ────────────────────────────────────────────────────────────
function Reconciliation({ adjRows }) {
  const [opinion, setOpinion] = useState('');
  const [rationale, setRationale] = useState('');
  const vals = adjRows.map(r => r.adjusted).filter(v => v > 0);
  if (!vals.length) return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Appraiser Tool</p>
        <h1>Reconciliation</h1>
        <p className="muted">Build the Adjustment Grid first. Reconciliation indicators will appear here once the grid has comps.</p>
      </section>
    </div>
  );
  const weights = adjRows.map(r => Math.max(1, r.score || 1));
  const wAvg = adjRows.reduce((a, r) => a + r.adjusted * Math.max(1, r.score || 1), 0) / weights.reduce((a, b) => a + b, 0);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const med = median(vals);
  const low = Math.min(...vals);
  const high = Math.max(...vals);
  return (
    <div className="dash-page">
      <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Reconciliation Summary</h1><p className="muted max">Statistical indicators from the adjustment grid. Final opinion of value is the appraiser's reconciled professional conclusion.</p></section>
      <div className="metric-grid four">
        <div><b>{money(low)}</b><span>Low Adjusted</span></div>
        <div><b>{money(med)}</b><span>Median</span></div>
        <div><b>{money(avg)}</b><span>Mean</span></div>
        <div><b>{money(wAvg)}</b><span>Score-Weighted</span></div>
      </div>
      <section className="panel-card">
        <h2>Range Analysis</h2>
        <div className="metric-grid three">
          <div><b>{money(high - low)}</b><span>Range Spread</span></div>
          <div><b>{money(high)}</b><span>High Adjusted</span></div>
          <div><b>{adjRows.length}</b><span>Comps Reconciled</span></div>
        </div>
      </section>
      <section className="panel-card" style={{ borderColor: 'rgba(214,176,74,.4)' }}>
        <h2>Suggested Reconciliation Language</h2>
        <p className="muted" style={{ marginBottom: 12 }}>Auto-drafted from the grid. Edit before use in report addendum.</p>
        <textarea className="big-text" style={{ minHeight: 120 }} defaultValue={`The adjusted comparables indicate a range from ${money(low)} to ${money(high)}, with a median of ${money(med)} and a similarity-score-weighted indication of ${money(Math.round(wAvg))}. Greatest weight has been placed on the sales requiring the fewest and most supportable adjustments, with consideration given to proximity, date of sale, physical similarity, and overall reliability. The final opinion of value reflects the appraiser's professional judgment applied to this market evidence.`} />
      </section>
      <section className="panel-card">
        <h2>Appraiser's Opinion of Value</h2>
        <div className="form-grid"><label>Final Value Opinion ($)<input type="number" value={opinion} onChange={e => setOpinion(e.target.value)} placeholder={Math.round(wAvg)} /></label></div>
        <label style={{ display: 'block', marginTop: 12, color: 'var(--muted)' }}>Reconciliation Rationale<textarea className="big-text" style={{ minHeight: 100 }} value={rationale} onChange={e => setRationale(e.target.value)} placeholder="Explain the weight given to each comparable and how the final value was concluded…" /></label>
        {opinion && <div className="net-result">Opinion of Value <strong>{money(toNum(opinion))}</strong></div>}
      </section>
      <section className="table-card">
        <div className="card-head"><h2>Comp Summary</h2></div>
        <table>
          <thead><tr><th>Rank</th><th>Comp</th><th>Sale Price</th><th>Net Adj</th><th>Adjusted</th><th>Score</th></tr></thead>
          <tbody>{adjRows.map(r => (
            <tr key={r.rank}><td>{r.rank}</td><td>{r.address || '—'}</td><td>{money(r.price)}</td><td style={{ color: r.totalAdj >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtD(r.totalAdj)}</td><td><b>{money(r.adjusted)}</b></td><td>{fmt(r.score, 0)}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}

// ── Narrative Builder ─────────────────────────────────────────────────────────
function NarrativeBuilder({ subject, sales, glaNarData, mtNarData }) {
  const [fields, setFields] = useState({ market: subject.city || '', period: '12 months ending ' + (subject.effdate || new Date().toISOString().slice(0, 10)), n: String(sales.length), source: 'MLS data', rate: String(mtNarData.monthly?.toFixed(3) || '0'), dir: mtNarData.dir || 'stable', gla: String(glaNarData.rate?.toFixed(2) || '0'), glaMethod: glaNarData.method || 'paired sales analysis', sel: 'within the subject neighborhood, similar GLA, and within 12 months of the effective date' });
  const [generated, setGenerated] = useState('');
  useEffect(() => { setFields(f => ({ ...f, rate: String(mtNarData.monthly?.toFixed(3) || f.rate), dir: mtNarData.dir || f.dir })); }, [mtNarData]);
  useEffect(() => { setFields(f => ({ ...f, gla: String(glaNarData.rate?.toFixed(2) || f.gla), glaMethod: glaNarData.method || f.glaMethod })); }, [glaNarData]);
  function generate() {
    const annRate = fmt(Number(fields.rate) * 12, 2);
    const gla = Number(fields.gla);
    const text = `Market Conditions and Comparable Selection Addendum\n\nThe subject property is located within ${fields.market || '[Market Area]'}. To determine the appropriate market conditions adjustment, the appraiser analyzed ${fields.n} arm's-length sales during the period of ${fields.period}, utilizing data from ${fields.source}.\n\nMedian sale price analysis over the study period indicates a ${fields.dir} market at an indicated rate of approximately ${fmtPct(Number(fields.rate), 3)} per month (${annRate}% annualized). The trend was established through time-series analysis of median sale prices plotted against time of sale.\n${gla > 0 ? `\nGross Living Area adjustments were extracted through ${fields.glaMethod} of sales within the subject's competitive market area. The indicated rate of $${fmt(gla, 2)}/SF reflects actual buyer behavior as evidenced by the analyzed sales data.\n` : ''}\nComparable sales were selected based on the following criteria: ${fields.sel}.\n\nAll adjustments presented in this report are market-derived and supported by the data described above and contained in the appraiser's work file. The appraiser's professional judgment was applied throughout this analysis in accordance with USPAP.\n\nPrepared by: ${subject.appraiser || '[Appraiser Name / License]'}`;
    setGenerated(text);
  }
  return (
    <div className="dash-page">
      <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Narrative Builder</h1><p className="muted max">Generate editable addendum language for market conditions, GLA support, comp selection, and reconciliation. Fields pre-fill from Market Conditions and GLA Study results.</p></section>
      <section className="panel-card">
        <h2>Narrative Inputs</h2>
        <div className="form-grid">
          {[['market', 'Market Area'], ['period', 'Analysis Period'], ['n', 'Sales Analyzed'], ['source', 'Data Source'], ['rate', 'Monthly Rate (%)'], ['dir', 'Direction'], ['gla', 'GLA Rate ($/SF)'], ['glaMethod', 'GLA Method'], ['sel', 'Comp Selection Criteria']].map(([k, l]) => (
            <label key={k}>{l}<input type="text" value={fields[k]} onChange={e => setFields({ ...fields, [k]: e.target.value })} /></label>
          ))}
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}><button className="btn gold" onClick={generate}>Generate Narrative Draft</button></div>
      </section>
      {generated && (
        <section className="panel-card" style={{ borderColor: 'rgba(214,176,74,.4)' }}>
          <h2>Narrative Draft (Editable)</h2>
          <textarea className="big-text" style={{ minHeight: 320, fontFamily: 'inherit', lineHeight: 1.7 }} defaultValue={generated} key={generated} />
          <div className="btn-row"><button className="btn ghost" onClick={() => navigator.clipboard?.writeText(generated)}>Copy Text</button></div>
        </section>
      )}
    </div>
  );
}

// ── Export Workfile ───────────────────────────────────────────────────────────
function ExportWorkfile({ subject, sales, adjRows, glaNarData, mtNarData, saveProject }) {
  const [sections, setSections] = useState({ subject: true, market: true, gla: true, adjustments: true, data: true, narrative: true });
  function toggle(k) { setSections(s => ({ ...s, [k]: !s[k] })); }
  function downloadJSON() {
    const w = { subject, importedSales: sales, adjRows, glaNarData, mtNarData, savedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(w, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'appraisal_workfile.json'; a.click();
  }
  function printPDF() {
    const vals = adjRows.map(r => r.adjusted).filter(v => v > 0);
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const med = vals.length ? Math.round(median(vals)) : null;
    const prices = sales.map(s => s.sale_price_n).filter(v => isFinite(v));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>ValoraIQ Workfile</title><style>body{font-family:Arial,sans-serif;color:#111;margin:28px;font-size:12px;line-height:1.45}h1{font-family:Georgia,serif;color:#1a2744;font-size:24px;margin:0 0 4px}h2{font-family:Georgia,serif;color:#1a2744;font-size:17px;border-bottom:2px solid #c5a028;padding-bottom:5px;margin-top:24px}.meta{color:#555;margin-bottom:18px}.disc{border:1px solid #e3c56f;background:#fff8e6;padding:10px;margin-top:14px}table{width:100%;border-collapse:collapse;margin:8px 0 14px}th{background:#1a2744;color:white;text-align:left;padding:6px;font-size:10px;text-transform:uppercase}td{border-bottom:1px solid #ddd;padding:6px;vertical-align:top}@media print{button{display:none}}</style></head><body><h1>ValoraIQ Appraisal Workfile</h1><div class="meta">Prepared ${new Date().toLocaleString()} · ${subject.address || 'Subject property'}</div><div class="disc"><strong>Work File Note:</strong> This report summarizes calculations, imported data, and analytical outputs from ValoraIQ. Retain with source MLS exports, photos, inspection notes, and the analyst's reconciliation.</div>` +
      (sections.subject ? `<h2>Subject Property</h2><table><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody><tr><td>Address</td><td>${[subject.address, subject.city].filter(Boolean).join(', ') || '—'}</td></tr><tr><td>Effective Date</td><td>${subject.effdate || '—'}</td></tr><tr><td>GLA</td><td>${subject.gla ? fmt(subject.gla) + ' SF' : '—'}</td></tr><tr><td>Site</td><td>${subject.site ? fmt(subject.site) + ' SF' : '—'}</td></tr><tr><td>Year Built</td><td>${subject.year || '—'}</td></tr><tr><td>Quality / Condition</td><td>${(subject.qual || '—') + ' / ' + (subject.cond || '—')}</td></tr><tr><td>Opinion of Value</td><td>${money(subject.value)}</td></tr><tr><td>Appraiser</td><td>${subject.appraiser || '—'}</td></tr></tbody></table>` : '') +
      (sections.market ? `<h2>Market Conditions</h2><table><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody><tr><td>Monthly Rate</td><td>${fmt(mtNarData.monthly, 3)}%</td></tr><tr><td>Annualized Rate</td><td>${fmt((mtNarData.monthly || 0) * 12, 2)}%</td></tr><tr><td>Direction</td><td>${mtNarData.dir || '—'}</td></tr></tbody></table>` : '') +
      (sections.gla ? `<h2>GLA Adjustment Support</h2><table><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody><tr><td>GLA Rate</td><td>${glaNarData.rate ? '$' + fmt(glaNarData.rate, 2) + '/SF' : '—'}</td></tr><tr><td>Method</td><td>${glaNarData.method || '—'}</td></tr></tbody></table>` : '') +
      (sections.adjustments && adjRows.length ? `<h2>Adjustment Grid</h2><table><thead><tr><th>#</th><th>Comp</th><th>Sale Price</th><th>Net Adj</th><th>Adjusted</th></tr></thead><tbody>${adjRows.map(r => `<tr><td>${r.rank}</td><td>${r.address || '—'}</td><td>${money(r.price)}</td><td>${fmtD(r.totalAdj)}</td><td>${money(r.adjusted)}</td></tr>`).join('')}</tbody></table><p><strong>Reconciliation:</strong> Average ${money(avg)}; Median ${money(med)}</p>` : '') +
      (sections.data ? `<h2>Imported Sales Summary</h2><table><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody><tr><td>Total Sales</td><td>${sales.length}</td></tr><tr><td>Median Sale Price</td><td>${money(median(prices))}</td></tr><tr><td>Price Range</td><td>${prices.length ? money(Math.min(...prices)) + ' – ' + money(Math.max(...prices)) : '—'}</td></tr></tbody></table>` : '') +
      `<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
    const w = window.open('', '_blank'); if (!w) { alert('Popup blocked. Allow popups and try again.'); return; } w.document.open(); w.document.write(html); w.document.close();
  }
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Workfile Export</p>
        <h1>Save / Export / Print Workfile</h1>
        <p className="muted max">Save the project to your cloud account, download a JSON workfile, or print a clean PDF for your appraisal workfile.</p>
        <div className="btn-row">
          <button className="btn gold" onClick={saveProject}>Save Project to Cloud</button>
          <button className="btn ghost" onClick={downloadJSON}>Download JSON ⇩</button>
        </div>
        <div className="status-banner" style={{ marginTop: 12 }}>JSON exports contain subject and sales data — store like any confidential workfile. Use Save Project to Cloud to preserve your work across devices.</div>
      </section>
      <section className="panel-card">
        <h2>Print / Save PDF</h2>
        <p className="muted" style={{ marginBottom: 14 }}>Select sections to include. In the browser print window choose <strong>Save as PDF</strong>.</p>
        <div className="check-list">
          {[['subject', 'Subject Property Summary'], ['market', 'Market Conditions'], ['gla', 'GLA Adjustment Support'], ['adjustments', 'Adjustment Grid + Reconciliation'], ['data', 'Imported Sales Summary'], ['narrative', 'Narrative Draft']].map(([k, l]) => (
            <label key={k}><input type="checkbox" checked={sections[k]} onChange={() => toggle(k)} /> {l}</label>
          ))}
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}><button className="btn gold" onClick={printPDF}>Print Workfile / Save PDF</button></div>
      </section>
    </div>
  );
}

// ── Agent tools ───────────────────────────────────────────────────────────────
function PricingStrategy({ sales, selectedComps, subject }) {
  const selectedSet = new Set(selectedComps);
  const comps = sales.filter(s => selectedSet.has(s._id ?? s.address));
  const useComps = comps.length ? comps : sales;
  const prices = useComps.map(s => s.sale_price_n).filter(v => isFinite(v) && v > 0);
  const doms = useComps.map(s => s.dom).filter(v => isFinite(v) && v >= 0);
  const medPrice = prices.length ? median(prices) : null;
  const medDom = doms.length ? Math.round(median(doms)) : null;
  const listPrices = useComps.map(s => s.sale_price_n).filter(Boolean);
  const hasSales = prices.length > 0;

  if (!hasSales) return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Agent Tool</p>
        <h1>Pricing Strategy</h1>
        <p className="muted max">Import MLS data and select comps in Comp Ranking to generate a data-driven pricing strategy snapshot.</p>
        <div className="status-banner">No sales data available. Import MLS data and select comparable sales first.</div>
      </section>
    </div>
  );

  const low = Math.min(...prices), high = Math.max(...prices);
  const suggestedList = medPrice ? Math.round(medPrice / 1000) * 1000 : null;

  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Agent Tool</p>
        <h1>Pricing Strategy Snapshot</h1>
        <p className="muted max">Derived from {useComps.length} {comps.length ? 'selected' : 'imported'} comparable sales. Select comps in Comp Ranking to refine this analysis.</p>
        <div className="metric-grid three">
          <div><b>{money(suggestedList)}</b><span>Median Comp Price</span></div>
          <div><b>{money(low)} – {money(high)}</b><span>Comp Price Range</span></div>
          <div><b>{medDom !== null ? `${medDom} days` : '—'}</b><span>Median DOM</span></div>
        </div>
        <div className="status-banner" style={{ marginTop: 16 }}>
          Based on {prices.length} comparable sale{prices.length !== 1 ? 's' : ''}. List price recommendation requires professional judgment — use these indicators as a starting point.
        </div>
      </section>
      <section className="table-card">
        <div className="card-head"><h2>Comparable Sales Used</h2><span>{useComps.length} records</span></div>
        <table>
          <thead><tr><th>Address</th><th>Price</th><th>GLA</th><th>$/SF</th><th>DOM</th><th>Date</th></tr></thead>
          <tbody>{useComps.slice(0, 10).map((s, i) => (
            <tr key={i}>
              <td>{s.address || '—'}<span>{s.city || ''}</span></td>
              <td>{money(s.sale_price_n)}</td>
              <td>{s.gla_n ? fmt(s.gla_n) : '—'}</td>
              <td>{s.sale_price_n && s.gla_n ? money(Math.round(s.sale_price_n / s.gla_n)) : '—'}</td>
              <td>{isFinite(s.dom) ? s.dom : '—'}</td>
              <td>{s.sale_date || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}

function SellerNet() {
  const [price, setPrice] = useState('');
  const [mort, setMort] = useState('');
  const [comm, setComm] = useState(5.5);
  const [cost, setCost] = useState('');
  const p = toNum(price), m = toNum(mort), co = toNum(cost);
  const net = !isNaN(p) && p > 0 ? p - (isNaN(m) ? 0 : m) - (p * comm / 100) - (isNaN(co) ? 0 : co) : null;
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Agent Tool</p>
        <h1>Seller Net Sheet</h1>
        <p className="muted max">Enter the anticipated sale price, mortgage payoff, commission rate, and estimated closing costs to calculate the seller's net proceeds.</p>
        <div className="form-grid">
          <label>Sale Price<input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 450000" /></label>
          <label>Mortgage Payoff<input type="number" value={mort} onChange={e => setMort(e.target.value)} placeholder="e.g. 280000" /></label>
          <label>Commission %<input type="number" value={comm} step="0.1" onChange={e => setComm(Number(e.target.value))} /></label>
          <label>Estimated Closing Costs<input type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="e.g. 5000" /></label>
        </div>
        {net !== null && (
          <div className="net-result">
            Estimated Seller Net <strong style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(net)}</strong>
          </div>
        )}
        {!price && <div className="status-banner" style={{ marginTop: 12 }}>Enter a sale price to calculate net proceeds.</div>}
      </section>
    </div>
  );
}

function ExportLike({ title, items }) {
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Export Center</p>
        <h1>{title}</h1>
        <p className="muted max">Select the sections to include in your export. Save your project first to ensure all data is current.</p>
        <div className="check-list">{items.map(i => <label key={i}><input type="checkbox" defaultChecked /> {i}</label>)}</div>
        <div className="btn-row" style={{ marginTop: 16 }}><button className="btn gold">Generate Export</button></div>
      </section>
    </div>
  );
}

function Photos({ persona }) {
  const [files, setFiles] = useState([]);
  function handleUpload(e) {
    const newFiles = Array.from(e.target.files || []).map(f => ({ name: f.name, url: URL.createObjectURL(f), file: f }));
    setFiles(prev => [...prev, ...newFiles]);
    e.target.value = '';
  }
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Photos & Exhibits</p>
        <h1>{persona === 'appraiser' ? 'Subject and Comp Exhibits' : 'Listing Photo Organizer'}</h1>
        <p className="muted max">Upload photos to organize them by exhibit. Photos are stored in your browser for this session. Cloud photo storage is available when saving projects.</p>
        <label className="upload-box">
          <strong>Click to upload photos</strong>
          <span>JPG, PNG, HEIC and other image formats accepted.</span>
          <input type="file" accept="image/*" multiple onChange={handleUpload} />
        </label>
      </section>
      {files.length > 0 && (
        <section className="panel-card">
          <div className="card-head"><h2>Uploaded Photos</h2><span>{files.length} photo{files.length !== 1 ? 's' : ''}</span></div>
          <div className="photo-grid">
            {files.map((f, i) => (
              <div className="photo-tile" key={i}>
                <img src={f.url} alt={f.name} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6 }} />
                <b style={{ fontSize: '0.75rem', marginTop: 4, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</b>
                <button className="btn ghost small" style={{ marginTop: 4 }} onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {files.length === 0 && (
        <section className="panel-card">
          <p className="muted">No photos uploaded yet. Use the upload area above to add photos for this project.</p>
        </section>
      )}
    </div>
  );
}

// ── AI Assistant (real Anthropic API) ─────────────────────────────────────────
function Assistant({ persona, subject, sales, adjRows, glaNarData, mtNarData }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const appraiserPrompts = [
    'Draft market conditions narrative from my data',
    'Summarize concession evidence from imported sales',
    'Review my adjustment grid and flag potential outliers',
    'Write reconciliation addendum language',
  ];
  const agentPrompts = [
    'Create seller talking points from my comp data',
    'Summarize market activity for my listing presentation',
    'Write a pricing strategy narrative',
    'Draft an intro for my listing presentation',
  ];
  const prompts = persona === 'appraiser' ? appraiserPrompts : agentPrompts;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function buildContext() {
    const parts = [];
    if (persona === 'appraiser') {
      parts.push(`You are an AI workflow assistant inside ValoraIQ, a professional real estate appraisal platform. You help appraisers draft editable narrative language, analyze market data, and support workfile documentation. You do not make final appraisal conclusions — those remain the appraiser's professional responsibility under USPAP.`);
    } else {
      parts.push(`You are an AI workflow assistant inside ValoraIQ, a professional real estate CMA and listing presentation platform for agents and brokers. You help agents craft compelling narratives, summarize market data, and prepare seller-facing materials. You do not replace the agent's professional pricing judgment.`);
    }
    if (subject?.address) parts.push(`Subject property: ${[subject.address, subject.city].filter(Boolean).join(', ')}. GLA: ${subject.gla || 'unknown'} SF. Year: ${subject.year || 'unknown'}. Quality: ${subject.qual || 'unknown'}. Condition: ${subject.cond || 'unknown'}. Effective date: ${subject.effdate || 'unknown'}.`);
    if (sales.length) {
      const prices = sales.map(s => s.sale_price_n).filter(v => isFinite(v) && v > 0);
      const med = prices.length ? median(prices) : null;
      parts.push(`Imported sales: ${sales.length} records. Median sale price: ${med ? money(med) : 'unknown'}. Price range: ${prices.length ? `${money(Math.min(...prices))} – ${money(Math.max(...prices))}` : 'unknown'}.`);
    }
    if (mtNarData?.monthly) parts.push(`Market conditions: ${mtNarData.monthly.toFixed(3)}% per month (${(mtNarData.monthly * 12).toFixed(2)}% annualized), direction: ${mtNarData.dir || 'unknown'}.`);
    if (glaNarData?.rate) parts.push(`GLA adjustment rate: $${fmt(glaNarData.rate, 2)}/SF via ${glaNarData.method || 'analysis'}.`);
    if (adjRows.length) {
      const vals = adjRows.map(r => r.adjusted).filter(v => v > 0);
      if (vals.length) parts.push(`Adjustment grid: ${adjRows.length} comps. Adjusted range: ${money(Math.min(...vals))} – ${money(Math.max(...vals))}. Median adjusted: ${money(median(vals))}.`);
    }
    return parts.join('\n\n');
  }

  async function sendMessage(text) {
    const userText = text || input.trim();
    if (!userText) return;
    setInput('');
    setError('');
    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const systemContext = buildContext();
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemContext,
          messages: apiMessages,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `API error ${response.status}`);
      }
      const data = await response.json();
      const assistantText = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
      setMessages([...newMessages, { role: 'assistant', content: assistantText }]);
    } catch (err) {
      setError(err.message || 'Request failed. Check your network connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">AI Workflow Assistant</p>
        <h1>{persona === 'appraiser' ? 'Narrative and evidence support' : 'Seller conversation support'}</h1>
        <p className="muted max">Ask questions or select a prompt below. The assistant has access to your current project data — subject property, imported sales, market conditions, GLA rates, and adjustment grid.</p>
        <div className="prompt-grid">
          {prompts.map(p => (
            <button key={p} onClick={() => sendMessage(p)} disabled={loading}>{p}</button>
          ))}
        </div>
      </section>

      {(messages.length > 0 || loading || error) && (
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2>Conversation</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 10, background: m.role === 'user' ? 'var(--gold)' : 'rgba(255,255,255,0.06)', color: m.role === 'user' ? '#111' : 'var(--text)', fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {m.content}
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 4 }}>{m.role === 'user' ? 'You' : 'ValoraIQ AI'}</span>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--muted)', fontSize: '0.9rem' }}>Thinking…</div>
              </div>
            )}
            {error && <div className="status-banner">{error}</div>}
            <div ref={bottomRef} />
          </div>
          {messages.length > 0 && (
            <div className="btn-row">
              <button className="btn ghost small" onClick={() => { const txt = messages.map(m => `${m.role === 'user' ? 'You' : 'AI'}: ${m.content}`).join('\n\n'); navigator.clipboard?.writeText(txt); }}>Copy conversation</button>
              <button className="btn ghost small" onClick={() => { setMessages([]); setError(''); }}>Clear</button>
            </div>
          )}
        </section>
      )}

      <section className="panel-card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            className="big-text"
            style={{ flex: 1, minHeight: 80, resize: 'vertical' }}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or request a narrative draft… (Enter to send, Shift+Enter for new line)"
            disabled={loading}
          />
          <button className="btn gold" onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{ minWidth: 80, alignSelf: 'flex-end' }}>
            {loading ? '…' : 'Send'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: '0.75rem' }}>AI workflow assistance only. Appraisers and agents remain responsible for all professional conclusions.</p>
      </section>
    </div>
  );
}

function Panel({ title, eyebrow, copy }) {
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted max">{copy}</p>
      </section>
    </div>
  );
}

// ── Chart styles ──────────────────────────────────────────────────────────────
const chartStyle = `.market-line-wrap{width:100%;overflow-x:auto;margin:1rem 0}.market-line-svg{width:100%;min-width:520px;height:260px}.market-line-svg line{stroke:rgba(255,255,255,.18);stroke-width:1}.market-line-svg path{fill:none;stroke:var(--cyan);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.market-line-svg circle{fill:var(--gold);stroke:var(--navy);stroke-width:2}.market-line-svg text{fill:var(--muted);font-size:10px}`;

// ── App root ──────────────────────────────────────────────────────────────────
function App() {
  useEffect(() => { const s = document.createElement('style'); s.textContent = chartStyle; document.head.appendChild(s); return () => s.remove(); }, []);
  const path = usePath();
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!authReady) return <main className="auth-page"><section className="auth-card"><h1>Loading ValoraIQ…</h1></section></main>;

  if (path === '/login' || path === '/signup') {
    if (session) { navigate('/appraiser'); return null; }
    return <Auth type={path === '/signup' ? 'signup' : 'login'} />;
  }

  if (path.startsWith('/appraiser')) return session ? <DashboardShell persona="appraiser" session={session} /> : <Auth type="login" />;
  if (path.startsWith('/agent')) return session ? <DashboardShell persona="agent" session={session} /> : <Auth type="login" />;

  return <Landing />;
}

createRoot(document.getElementById('root')).render(<App />);

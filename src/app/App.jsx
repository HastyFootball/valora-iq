import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/globals.css';
import { supabase } from '../lib/supabaseClient';

// ── Router ──────────────────────────────────────────────────────────────────
const routes = ['/', '/login', '/signup', '/appraiser', '/agent'];
function navigate(path) { window.history.pushState({}, '', path); window.dispatchEvent(new Event('popstate')); if (!path.includes('/appraiser/') && !path.includes('/agent/') && !path.includes('/demo/')) window.scrollTo({ top: 0, behavior: 'smooth' }); }
function usePath() { const [path, setPath] = useState(location.pathname); useEffect(() => { const fn = () => setPath(location.pathname); addEventListener('popstate', fn); return () => removeEventListener('popstate', fn) }, []); return routes.some(r => path === r || path.startsWith('/appraiser/') || path.startsWith('/agent/') || path.startsWith('/demo/appraiser') || path.startsWith('/demo/agent')) ? path : '/'; }
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

// ── Sample data ──────────────────────────────────────────────────────────────
const sampleSales = [
  { _id: 0, address: '123 Maple Street', city: 'Greenville, SC', status: 'Sold', sale_price_n: 425000, gla_n: 2050, site_sf_n: 9100, year_built_n: 2001, sale_date: '2025-01-15', quality: 'Q3', condition: 'C3', garage: '2-Car Attached', basement: 'None', pool: 'No', dom: 12, concessions_n: 0, lat: 34.8526, lon: -82.3940 },
  { _id: 1, address: '456 Oak Avenue', city: 'Greenville, SC', status: 'Sold', sale_price_n: 438000, gla_n: 2140, site_sf_n: 9800, year_built_n: 1998, sale_date: '2025-02-21', quality: 'Q3', condition: 'C2', garage: '2-Car Attached', basement: 'Partial Finished', pool: 'No', dom: 8, concessions_n: 6500, lat: 34.8610, lon: -82.3820 },
  { _id: 2, address: '789 Pine Road', city: 'Greenville, SC', status: 'Sold', sale_price_n: 407500, gla_n: 1905, site_sf_n: 8500, year_built_n: 2004, sale_date: '2025-03-05', quality: 'Q4', condition: 'C3', garage: '2-Car Attached', basement: 'None', pool: 'No', dom: 18, concessions_n: 3000, lat: 34.8420, lon: -82.4050 },
  { _id: 3, address: '321 Elm Drive', city: 'Greenville, SC', status: 'Pending', sale_price_n: 449900, gla_n: 2210, site_sf_n: 10200, year_built_n: 2002, sale_date: '2025-04-18', quality: 'Q3', condition: 'C3', garage: '2-Car Attached', basement: 'Full Finished', pool: 'Yes', dom: 6, concessions_n: 0, lat: 34.8660, lon: -82.3970 },
  { _id: 4, address: '654 Cedar Lane', city: 'Greenville, SC', status: 'Active', sale_price_n: 459000, gla_n: 2260, site_sf_n: 10500, year_built_n: 2000, sale_date: '2025-05-07', quality: 'Q3', condition: 'C2', garage: '3-Car Attached', basement: 'None', pool: 'No', dom: 21, concessions_n: 8000, lat: 34.8720, lon: -82.3880 },
  { _id: 5, address: '910 Birch Court', city: 'Greenville, SC', status: 'Sold', sale_price_n: 415000, gla_n: 1980, site_sf_n: 8800, year_built_n: 2003, sale_date: '2024-12-10', quality: 'Q3', condition: 'C3', garage: '2-Car Attached', basement: 'None', pool: 'No', dom: 14, concessions_n: 5000, lat: 34.8490, lon: -82.4010 },
  { _id: 6, address: '247 Willow Way', city: 'Greenville, SC', status: 'Sold', sale_price_n: 441000, gla_n: 2090, site_sf_n: 9200, year_built_n: 1999, sale_date: '2024-11-22', quality: 'Q3', condition: 'C3', garage: '2-Car Attached', basement: 'None', pool: 'No', dom: 9, concessions_n: 0, lat: 34.8555, lon: -82.3905 },
];
const defaultSubject = { address: '100 Valora Way', city: 'Greenville, SC', effdate: '2025-05-20', gla: 2100, site: 9500, year: 2000, beds: 3, baths: 2, garage: '2-Car Attached', basement: 'None', pool: 'No', qual: 'Q3', cond: 'C3', value: 435000, lat: 34.8526, lon: -82.3940 };

// ── Navigation helpers ────────────────────────────────────────────────────────
const appraiserTabs = ['Dashboard', 'Projects', 'Subject Property', 'MLS Import', 'Q/C Analyzer', 'Market Conditions', 'GLA Study', 'Comp Ranking', 'Site / Land Value', 'Adjustment Grid', 'Concessions', 'Reconciliation', 'Narrative', 'Export Workfile', 'Photos / Exhibits', 'AI Assistant'];
const agentTabs = ['Dashboard', 'Projects', 'Property Overview', 'MLS Import', 'Market Snapshot', 'Pricing Strategy', 'Comp Ranking', 'Seller Net Sheet', 'Listing Presentation', 'Photos', 'AI Assistant', 'CMA Export'];
function slug(s) { return s.toLowerCase().replace(/\//g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, ''); }
function iconFor(t) { if (t.includes('Import')) return '⬆'; if (t.includes('Market') || t.includes('Snapshot')) return '↗'; if (t.includes('Export') || t.includes('Workfile')) return '⇩'; if (t.includes('Project')) return '▣'; if (t.includes('AI')) return '✦'; if (t.includes('Photo')) return '◉'; if (t.includes('Net')) return '$'; if (t.includes('Comp')) return '★'; if (t.includes('Q/C')) return '◆'; if (t.includes('Site')) return '◌'; if (t.includes('GLA')) return '⌖'; if (t.includes('Concession')) return '©'; if (t.includes('Reconcil')) return '⊞'; if (t.includes('Narrative')) return '✎'; if (t.includes('Pricing')) return '$'; return '⌂'; }

// ── Public pages ──────────────────────────────────────────────────────────────
function PublicNav() { return <header className="public-nav"><Link to="/" className="plain"><Logo /></Link><nav><a href="/#workflows">Workflows</a><a href="/#features">Features</a><a href="/#pricing">Pricing</a><Link to="/login">Log in</Link><Link className="btn small gold" to="/signup">Start free</Link></nav></header> }
function Landing() { return <><PublicNav /><main><section className="hero"><div className="hero-grid"><div><p className="eyebrow">Professional Real Estate Intelligence Workspace</p><h1>One platform. Two workflows. Cleaner real estate decisions.</h1><p className="hero-copy">ValoraIQ helps appraisers build defensible valuation support and helps agents create persuasive CMA and listing presentations from the same market intelligence engine.</p><div className="hero-actions"><Link className="btn gold" to="/signup">Start building →</Link><Link className="btn glass" to="/signup">Start free</Link></div></div><div className="hero-preview"><div className="preview-header"><span /><span /><span /></div><div className="preview-title">Market Snapshot</div><div className="metric-grid three"><div><b>$425k</b><span>Median Sold</span></div><div><b>18</b><span>DOM</span></div><div><b>97.4%</b><span>List/Sale</span></div></div><div className="fake-chart">{[42, 55, 48, 68, 61, 78, 90].map(h => <i key={h} style={{ height: `${h}%` }} />)}</div><div className="preview-card"><b>Professional-use positioning</b><span>Market evidence, workflow support, and presentation outputs without replacing professional judgment.</span></div></div></div></section><section className="section" id="workflows"><p className="eyebrow center">Persona-specific dashboards</p><h2>Appraisers and agents should not see the same product.</h2><div className="workflow-cards"><article><h3>Appraiser Workspace</h3><p>Subject, MLS import, Q/C analyzer, market conditions, GLA study, comp ranking, site value, adjustments, concessions, reconciliation, narrative, and workfile export.</p><Link to="/signup">Start appraiser workspace</Link></article><article><h3>Agent/Broker Workspace</h3><p>Property overview, market snapshot, pricing strategy, active/pending/sold intelligence, seller net sheet, listing presentation, and CMA export.</p><Link to="/signup">Start agent workspace</Link></article></div></section><section className="section" id="features"><p className="eyebrow center">Core platform</p><h2>From raw MLS data to clear, client-ready outputs.</h2><div className="feature-grid">{['MLS Import', 'Comp Ranking + Geocoding', 'Q/C Analyzer', 'Market Conditions Modifier', 'GLA Regression + Paired Sales', 'Workfile Save / Export'].map(t => <div className="feature-card" key={t}><div className="glyph">✦</div><h3>{t}</h3><p>Premium workflow support designed for real estate professionals.</p></div>)}</div></section><section className="section pricing" id="pricing"><p className="eyebrow center">Pricing preview</p><h2>Start with the workflow. Add cloud accounts next.</h2><p className="muted max center-block">Auth, database persistence, billing, teams, and saved cloud projects are ready for the next Supabase phase.</p></section></main></> }
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
        setMessage('Account created. Check your email if Supabase asks you to confirm it, then log in.');
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

  return <><PublicNav /><main className="auth-page"><form className="auth-card" onSubmit={submit}><p className="eyebrow">{type === 'login' ? 'Welcome back' : 'Start free'}</p><h1>{type === 'login' ? 'Log in to ValoraIQ' : 'Create your workspace'}</h1>{type === 'signup' && <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />}<input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} /><input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} /><button className="btn gold full" disabled={busy}>{busy ? 'Working…' : type === 'login' ? 'Log in' : 'Create account'}</button><p className="muted">{type === 'login' ? 'Need an account?' : 'Already have an account?'} <Link to={type === 'login' ? '/signup' : '/login'}>{type === 'login' ? 'Sign up' : 'Log in'}</Link></p>{message && <div className="status-banner">{message}</div>}</form></main></>;
}

// ── Dashboard shell ───────────────────────────────────────────────────────────
function emptySubject() { return { address: '', city: '', effdate: new Date().toISOString().slice(0, 10), gla: '', site: '', year: '', beds: '', baths: '', garage: '', basement: '', pool: '', qual: '', cond: '', value: '', appraiser: '' }; }
function emptyWorkspace() { return { subject: emptySubject(), sales: [], selectedComps: [], adjRows: [], glaNarData: { rate: 0, method: '' }, mtNarData: { monthly: 0, dir: 'stable' } }; }
function demoWorkspace() { return { subject: defaultSubject, sales: sampleSales, selectedComps: [], adjRows: [], glaNarData: { rate: 0, method: '' }, mtNarData: { monthly: 0, dir: 'stable' } }; }
function projectNameFromData(data, fallback = 'Untitled Project') { return data?.subject?.address || data?.subject?.city || fallback; }

function DashboardShell({ persona, session, demoMode = false }) {
  const initial = demoMode ? demoWorkspace() : emptyWorkspace();
  const [tab, setTab] = useState('Dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [subject, setSubject] = useState(initial.subject);
  const [sales, setSales] = useState(initial.sales);
  const [selectedComps, setSelectedComps] = useState(initial.selectedComps);
  const [adjRows, setAdjRows] = useState(initial.adjRows);
  const [glaNarData, setGlaNarData] = useState(initial.glaNarData);
  const [mtNarData, setMtNarData] = useState(initial.mtNarData);

  const [cloudStatus, setCloudStatus] = useState('');
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [currentProjectName, setCurrentProjectName] = useState(demoMode ? 'Demo Project' : '');
  const [projectsLoading, setProjectsLoading] = useState(false);
  const user = session?.user;
  const isAppraiser = persona === 'appraiser';
  const tabs = isAppraiser ? appraiserTabs : agentTabs;

  useEffect(() => {
    const parts = location.pathname.split('/');
    const routePart = demoMode ? parts[3] : parts[2];
    if (routePart) {
      const match = tabs.find(t => slug(t) === routePart);
      if (match) setTab(match);
    }
  }, [persona, demoMode]);

  useEffect(() => {
    if (!demoMode && user) fetchProjects();
  }, [demoMode, user?.id, persona]);

  function setRoute(t) {
    setTab(t);
    const base = demoMode ? `/demo/${persona}` : `/${persona}`;
    window.history.pushState({}, '', `${base}${t === 'Dashboard' ? '' : '/' + slug(t)}`);
  }

  function workspacePayload() {
    return { subject, sales, selectedComps, adjRows, glaNarData, mtNarData, savedAt: new Date().toISOString() };
  }

  function applyWorkspace(data) {
    const w = data || emptyWorkspace();
    setSubject(w.subject || emptySubject());
    setSales(Array.isArray(w.sales) ? w.sales : []);
    setSelectedComps(Array.isArray(w.selectedComps) ? w.selectedComps : []);
    setAdjRows(Array.isArray(w.adjRows) ? w.adjRows : []);
    setGlaNarData(w.glaNarData || { rate: 0, method: '' });
    setMtNarData(w.mtNarData || { monthly: 0, dir: 'stable' });
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
    if (data?.length && !currentProjectId) {
  openProject(data[0]);
}
  }

  function newProject() {
    const name = window.prompt('Project name?', subject.address || currentProjectName || 'New Project');
    if (name === null) return;
    applyWorkspace(emptyWorkspace());
    setCurrentProjectId(null);
    setCurrentProjectName(name.trim() || 'New Project');
    setCloudStatus('New blank project started. Add a subject/import sales, then click Save Project.');
    setRoute(persona === 'appraiser' ? 'Subject Property' : 'Property Overview');
  }

  async function saveProject() {
    if (demoMode) { setCloudStatus('Demo mode does not save. Sign up or log in to save real projects.'); return; }
    if (!user) { setCloudStatus('Log in before saving.'); return; }
    const payload = workspacePayload();
    const name = (currentProjectName || projectNameFromData(payload, '') || window.prompt('Project name?', 'New Project') || '').trim();
    if (!name) { setCloudStatus('Project was not saved because it needs a name.'); return; }
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
    if (demoMode) return;
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
    navigate('/login');
  }

  const activeProjectLabel = demoMode ? 'Demo Mode' : currentProjectName || 'No project open';

  return (
    <div className={`dashboard-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className="sidebar">
        <Logo compact={collapsed} />
        <div className="mode-toggle">
          <button className={isAppraiser ? 'active' : ''} onClick={() => navigate(demoMode ? '/demo/appraiser' : '/appraiser')}>Appraiser</button>
          <button className={!isAppraiser ? 'active' : ''} onClick={() => navigate(demoMode ? '/demo/agent' : '/agent')}>Agent/Broker</button>
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
            {demoMode ? <>
              <Link className="btn ghost" to="/signup">Start free</Link>
              <Link className="btn gold" to="/login">Log in</Link>
            </> : <>
              <button className="btn ghost" onClick={newProject}>New Project</button>
              <button className="btn gold" onClick={saveProject}>Save Project</button>
              <button className="btn ghost" onClick={() => setRoute('Projects')}>Open</button>
              <button className="btn ghost" onClick={signOut}>Sign out</button>
              <button className="avatar">{(user?.email || 'VQ').slice(0, 2).toUpperCase()}</button>
            </>}
          </div>
        </header>
        {cloudStatus && <div className={`status-banner ${cloudStatus.toLowerCase().includes('saved') || cloudStatus.toLowerCase().includes('opened') || cloudStatus.toLowerCase().includes('created') ? 'success' : ''}`} style={{ margin: '12px 24px 0' }}>{cloudStatus}</div>}
        <Workspace persona={persona} demoMode={demoMode} tab={tab} setRoute={setRoute} subject={subject} setSubject={setSubject} sales={sales} setSales={setSales} selectedComps={selectedComps} setSelectedComps={setSelectedComps} adjRows={adjRows} setAdjRows={setAdjRows} glaNarData={glaNarData} setGlaNarData={setGlaNarData} mtNarData={mtNarData} setMtNarData={setMtNarData} projects={projects} projectsLoading={projectsLoading} currentProjectId={currentProjectId} currentProjectName={currentProjectName} newProject={newProject} openProject={openProject} deleteProject={deleteProject} saveProject={saveProject} fetchProjects={fetchProjects} />
      </main>
    </div>
  );
}

function Workspace({ persona, demoMode, tab, setRoute, subject, setSubject, sales, setSales, selectedComps, setSelectedComps, adjRows, setAdjRows, glaNarData, setGlaNarData, mtNarData, setMtNarData, projects, projectsLoading, currentProjectId, currentProjectName, newProject, openProject, deleteProject, saveProject, fetchProjects }) {
  if (tab === 'Dashboard') return persona === 'appraiser' ? <AppraiserHome sales={sales} projects={projects} demoMode={demoMode} setRoute={setRoute} newProject={newProject} /> : <AgentHome sales={sales} projects={projects} demoMode={demoMode} setRoute={setRoute} newProject={newProject} />;
  if (tab === 'Projects') return <Projects persona={persona} demoMode={demoMode} projects={projects} projectsLoading={projectsLoading} currentProjectId={currentProjectId} newProject={newProject} openProject={openProject} deleteProject={deleteProject} fetchProjects={fetchProjects} />;
  if (tab === 'Subject Property' || tab === 'Property Overview') return <SubjectForm persona={persona} subject={subject} setSubject={setSubject} />;
  if (tab.includes('Import')) return <ImportData persona={persona} sales={sales} setSales={setSales} demoMode={demoMode} />;
  if (tab === 'Q/C Analyzer') return <QCAnalyzer sales={sales} setSales={setSales} subject={subject} />;
  if (tab === 'Market Conditions' || tab === 'Market Snapshot') return <MarketConditions persona={persona} sales={sales} setMtNarData={setMtNarData} />;
  if (tab === 'GLA Study') return <GLAStudy sales={sales} subject={subject} setGlaNarData={setGlaNarData} />;
  if (tab === 'Comp Ranking') return <CompRanking subject={subject} setSubject={setSubject} sales={sales} setSales={setSales} selectedComps={selectedComps} setSelectedComps={setSelectedComps} />;
  if (tab === 'Site / Land Value') return <SiteValue />;
  if (tab === 'Adjustment Grid') return <Adjustments selectedComps={selectedComps} sales={sales} subject={subject} adjRows={adjRows} setAdjRows={setAdjRows} />;
  if (tab === 'Concessions') return <Concessions sales={sales} />;
  if (tab === 'Reconciliation') return <Reconciliation adjRows={adjRows} />;
  if (tab === 'Narrative') return <NarrativeBuilder subject={subject} sales={sales} glaNarData={glaNarData} mtNarData={mtNarData} />;
  if (tab === 'Export Workfile') return <ExportWorkfile subject={subject} sales={sales} adjRows={adjRows} glaNarData={glaNarData} mtNarData={mtNarData} saveProject={saveProject} demoMode={demoMode} />;
  if (tab === 'Pricing Strategy') return <PricingStrategy />;
  if (tab === 'Seller Net Sheet') return <SellerNet />;
  if (tab.includes('Presentation') || tab === 'CMA Export') return <ExportLike title={tab} items={['Pricing snapshot', 'Active/pending/sold summary', 'Selected comps', 'Seller net sheet', 'Talking points']} />;
  if (tab.includes('Photos')) return <Photos persona={persona} />;
  if (tab === 'AI Assistant') return <Assistant persona={persona} />;
  return <Panel title={tab} eyebrow={persona === 'appraiser' ? 'Appraiser Workflow' : 'Agent Workflow'} copy="This section is wired into the ValoraIQ platform shell." />;
}

// ── KPI + home ────────────────────────────────────────────────────────────────
function KPI({ label, value, helper }) { return <div className="kpi"><div className="kpi-icon">✦</div><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div> }
function AppraiserHome({ sales, projects = [], demoMode, setRoute, newProject }) {
  const projectCount = demoMode ? 5 : projects.length;
  return <div className="dash-page">
    <section className="welcome"><p className="eyebrow">{demoMode ? 'Interactive Demo' : 'Good morning'}</p><h1>Appraiser intelligence workspace</h1><p>{demoMode ? 'Explore a fully loaded example without signing up. Real signed-in workspaces start blank and save only your projects.' : 'Create a project, import MLS data, run the tools, and save your work to Supabase.'}</p></section>
    <div className="kpi-row"><KPI label="Projects" value={projectCount} helper={demoMode ? 'demo examples' : 'saved to your account'} /><KPI label="Imported Sales" value={sales.length} helper="current project" /><KPI label="Current Project" value={sales.length ? 'Active' : 'Blank'} helper={sales.length ? 'data loaded' : 'start or open one'} /><KPI label="Storage" value={demoMode ? 'Demo' : 'Cloud'} helper={demoMode ? 'not saved' : 'Supabase'} /></div>
    <div className="two-col"><ProjectTable projects={projects} demoMode={demoMode} setRoute={setRoute} /><QuickActions persona="appraiser" setRoute={setRoute} newProject={newProject} demoMode={demoMode} /></div>
    <section className="panel-card"><h2>Professional Use Only</h2><p className="muted">ValoraIQ provides market analysis and valuation support. Appraisers remain responsible for all appraisal conclusions.</p></section>
  </div>;
}
function AgentHome({ sales, projects = [], demoMode, setRoute, newProject }) {
  return <div className="dash-page">
    <section className="welcome"><p className="eyebrow">{demoMode ? 'Interactive Demo' : 'Good morning'}</p><h1>Agent/Broker pricing workspace</h1><p>{demoMode ? 'Explore a fully loaded example without signing up. Real signed-in workspaces start blank and save only your projects.' : 'Create a CMA/listing project, import market data, and save it to your account.'}</p></section>
    <div className="kpi-row"><KPI label="Projects" value={demoMode ? 5 : projects.length} helper={demoMode ? 'demo examples' : 'saved to your account'} /><KPI label="Imported Records" value={sales.length} helper="current project" /><KPI label="Current Project" value={sales.length ? 'Active' : 'Blank'} helper={sales.length ? 'data loaded' : 'start or open one'} /><KPI label="Storage" value={demoMode ? 'Demo' : 'Cloud'} helper={demoMode ? 'not saved' : 'Supabase'} /></div>
    <div className="two-col"><PricingStrategy compact /><QuickActions persona="agent" setRoute={setRoute} newProject={newProject} demoMode={demoMode} /></div>
  </div>;
}
function ProjectTable({ projects = [], demoMode, setRoute }) {
  const demoRows = [['123 Maple Street', 'Appraisal', 'In Progress', '$438k'], ['456 Oak Avenue', 'CMA', 'Review', '$510k'], ['789 Pine Road', 'Market Study', 'Draft', '$425k']];
  const rows = demoMode ? demoRows : projects.slice(0, 3).map(p => [p.name, p.persona === 'agent' ? 'CMA' : 'Appraisal', 'Saved', p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—']);
  return <div className="table-card"><div className="card-head"><h2>{demoMode ? 'Demo Recent Projects' : 'Recent Projects'}</h2><button onClick={() => setRoute('Projects')}>View all →</button></div>{rows.length ? <table><thead><tr><th>Project</th><th>Type</th><th>Status</th><th>{demoMode ? 'Indication' : 'Updated'}</th></tr></thead><tbody>{rows.map(r => <tr key={r[0]}><td><b>{r[0]}</b><span>{demoMode ? 'Demo data' : 'Saved project'}</span></td><td>{r[1]}</td><td><em>{r[2]}</em></td><td>{r[3]}</td></tr>)}</tbody></table> : <div className="status-banner">No saved projects yet. Click New Project to start one.</div>}</div>
}
function QuickActions({ persona, setRoute, newProject, demoMode }) {
  const actions = persona === 'appraiser'
    ? [['New Appraisal Project', 'Projects'], ['Import MLS Data', 'MLS Import'], ['Run Q/C Analyzer', 'Q/C Analyzer'], ['Run Market Conditions', 'Market Conditions'], ['Run GLA Study', 'GLA Study'], ['Rank Comparables', 'Comp Ranking'], ['Export Workfile PDF', 'Export Workfile']]
    : [['New CMA Project', 'Projects'], ['Import MLS Data', 'MLS Import'], ['Rank Comparables', 'Comp Ranking'], ['Build Seller Presentation', 'Listing Presentation'], ['Create Seller Net Sheet', 'Seller Net Sheet']];
  return <div className="quick-card"><h2>Quick Actions</h2>{actions.map(([label, target]) => <button key={label} onClick={() => label.startsWith('New') && !demoMode && newProject ? newProject() : setRoute(target)}>{label}<span>›</span></button>)}</div>;
}

// ── Projects ──────────────────────────────────────────────────────────────────
function Projects({ persona, demoMode, projects = [], projectsLoading, currentProjectId, newProject, openProject, deleteProject, fetchProjects }) {
  const demoProjects = ['123 Maple Street', '456 Oak Avenue', '789 Pine Road', '321 Elm Drive', '654 Cedar Lane'].map((name, i) => ({ id: `demo-${i}`, name, persona, updated_at: new Date(Date.now() - i * 86400000).toISOString(), data: demoWorkspace() }));
  const list = demoMode ? demoProjects : projects;
  return <div className="dash-page">
    <section className="panel-card row-between"><div><p className="eyebrow">Projects</p><h1>{persona === 'appraiser' ? 'Appraisal Projects' : 'CMA & Listing Projects'}</h1><p className="muted max">{demoMode ? 'These are demo examples only. Sign up to create real saved projects.' : 'Create, open, and delete your saved Supabase projects. Opening a project loads its subject, sales, Q/C edits, selected comps, adjustments, and narrative data.'}</p></div><div className="btn-row"><button className="btn gold" onClick={() => demoMode ? navigate('/signup') : newProject()}>{demoMode ? 'Start Real Project' : '+ New Project'}</button>{!demoMode && <button className="btn ghost" onClick={fetchProjects}>Refresh</button>}</div></section>
    {projectsLoading && <section className="panel-card"><p className="muted">Loading projects…</p></section>}
    {!projectsLoading && !list.length && <section className="panel-card"><h2>No projects yet</h2><p className="muted">Click <strong>+ New Project</strong>, enter a project name, then add your subject and import MLS data.</p></section>}
    <div className="project-grid">{list.map((proj, i) => <article className={`project-card ${currentProjectId === proj.id ? 'selected' : ''}`} key={proj.id}><span>{persona === 'appraiser' ? 'Appraisal' : i % 2 ? 'Listing CMA' : 'Seller Strategy'}</span><h3>{proj.name}</h3><p>{demoMode ? 'Demo example' : `Updated ${proj.updated_at ? new Date(proj.updated_at).toLocaleString() : '—'}`}</p><div><em>{currentProjectId === proj.id ? 'Open' : demoMode ? 'Demo' : 'Saved'}</em><button className="btn ghost small" onClick={() => demoMode ? null : openProject(proj)}>{demoMode ? 'Demo Only' : 'Open'}</button>{!demoMode && <button className="btn ghost small" onClick={() => deleteProject(proj)}>Delete</button>}</div></article>)}</div>
  </div>;
}

// ── Subject form ──────────────────────────────────────────────────────────────
function SubjectForm({ persona, subject, setSubject }) {
  const [saved, setSaved] = useState(false); const [message, setMessage] = useState('');
  const fields = [['address', 'Street Address'], ['city', 'City, State, ZIP'], ['effdate', 'Effective / Analysis Date', 'date'], ['gla', 'GLA', 'number'], ['site', 'Site Area SF', 'number'], ['year', 'Year Built', 'number'], ['beds', 'Bedrooms', 'number'], ['baths', 'Baths', 'number'], ['garage', 'Garage'], ['basement', 'Basement'], ['pool', 'Pool'], ['qual', 'Quality Rating'], ['cond', 'Condition Rating'], ['value', 'Opinion / Target Value', 'number'], ['appraiser', 'Appraiser Name / License']];
  function update(key, type, value) { setSaved(false); setSubject({ ...subject, [key]: type === 'number' ? (value === '' ? '' : toNum(value)) : value }); }
  function save() { setSaved(true); setMessage('Subject profile saved. Values carry into comp ranking, market analysis, site value, adjustment grid, narrative, and workfile exports.'); }
  async function geo() { const q = encodeURIComponent([subject.address, subject.city].filter(Boolean).join(', ')); if (!q) { setMessage('Enter a street address and city first.'); return; } setMessage('Geocoding subject address…'); try {const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`); const d = await r.json(); if (d?.[0]) { setSubject({ ...subject, lat: Number(d[0].lat), lon: Number(d[0].lon) }); setSaved(true); setMessage(`Geocoded → ${Number(d[0].lat).toFixed(5)}, ${Number(d[0].lon).toFixed(5)}`); } else setMessage('No result. Try a fuller address with ZIP.'); } catch { setMessage('Geocoding failed. You can continue without distance ranking.'); } }
  return <div className="dash-page"><section className="panel-card"><p className="eyebrow">{persona === 'appraiser' ? 'Subject Property' : 'Property Overview'}</p><h1>{persona === 'appraiser' ? 'Subject Property Profile' : 'Listing Property Profile'}</h1><p className="muted max">Edit the property, save it, and geocode it. Saved values carry into comp ranking, market comparison, adjustment support, site value, narrative, and exports during this session.</p><div className="form-grid">{fields.map(([key, label, type = 'text']) => <label key={key}>{label}<input type={type} value={subject[key] ?? ''} onChange={e => update(key, type, e.target.value)} /></label>)}</div><div className="btn-row"><button className="btn gold" onClick={save}>Save Subject</button><button className="btn ghost" onClick={geo}>Save & Geocode Subject</button><button className="btn ghost" onClick={() => navigate(`/${persona}/mls-import`)}>Continue to MLS Import</button></div><div className={`status-banner ${saved ? 'success' : ''}`}>{message || `Coordinates: ${subject.lat ? `${Number(subject.lat).toFixed(5)}, ${Number(subject.lon).toFixed(5)}` : 'not geocoded yet'}`}</div></section></div>;
}

// ── MLS Import ────────────────────────────────────────────────────────────────
function ImportData({ persona, sales, setSales, demoMode = false }) {
  const [headers, setHeaders] = useState([]); const [rawRows, setRawRows] = useState([]); const [mapping, setMapping] = useState({}); const [preview, setPreview] = useState(sales); const [fileName, setFileName] = useState(demoMode ? 'Demo sales' : ''); const [importStatus, setImportStatus] = useState('Upload a CSV to review and remap fields before the data is used.'); const [committed, setCommitted] = useState(false); const [geocoding, setGeocoding] = useState(false);
  const required = ['sale_price', 'sale_date', 'gla'];
  const mappedOk = required.every(f => mapping[f] !== undefined && mapping[f] !== '');
  async function handle(e) { const f = e.target.files?.[0]; if (!f) return; const text = await f.text(); const parsed = parseCSVMatrix(text); const m = autoMapHeaders(parsed.headers); setHeaders(parsed.headers); setRawRows(parsed.rows); setMapping(m); setPreview(rowsFromMapping(parsed.headers, parsed.rows, m)); setFileName(f.name); setCommitted(false); setImportStatus(`Loaded ${f.name}. Review the column mapping below before applying.`); e.target.value = ''; }
 async function apply() {
    if (demoMode) { setImportStatus('CSV import is not available in demo mode. Sign up or log in to import your own data.'); return; }
    if (!mappedOk) { setImportStatus('Map Sale Price, Sale Date, and GLA before applying. Optional fields improve analysis.'); return; }
    const records = rowsFromMapping(headers, rawRows, mapping);
    setGeocoding(true);
    setCommitted(false);
    setPreview(records);
    setImportStatus(`Mapped ${records.length} record(s). Geocoding missing coordinates before applying...`);
    const result = await geocodeMissingSales(records, msg => setImportStatus(msg));
    setPreview(result.records);
    setSales(result.records);
    setCommitted(true);
    setGeocoding(false);
    setImportStatus(`Applied ${result.records.length} record(s). Geocoded ${result.geocoded} sale(s), kept ${result.skipped} existing/provided or ungeocodable sale(s), and attempted ${result.attempted} lookup(s). These records now feed Q/C, Market Conditions, GLA Study, Comp Ranking, Adjustments, Concessions, and exports.`);
  }
  function updateMap(field, value) { const next = { ...mapping, [field]: value }; setMapping(next); setPreview(rowsFromMapping(headers, rawRows, next)); setCommitted(false); setImportStatus('Mapping changed. Review the preview, then click Apply Mapping & Use These Records.'); }
  function loadDemo() { setHeaders([]); setRawRows([]); setMapping({}); setSales(sampleSales); setPreview(sampleSales); setFileName('Demo sales'); setCommitted(true); setImportStatus('Demo sales loaded. Upload a CSV anytime to replace them.'); }
  return <div className="dash-page">
    <section className="panel-card">
      <p className="eyebrow">MLS Import</p><h1>{persona === 'appraiser' ? 'Import appraisal sales data' : 'Import CMA market data'}</h1>
      <p className="muted max">Upload your MLS CSV, verify the field mapping, inspect the preview, then apply it.</p>
      {demoMode ? (
  <div className="upload-box locked">
    <strong>CSV import is not available in demo mode</strong>
    <span>Demo explores pre-loaded sample data. <Link to="/signup">Create a free account</Link> to import your own MLS CSV files.</span>
  </div>
) : (
  <label className="upload-box"><strong>Click to upload MLS CSV</strong><span>After upload, the mapping review panel opens below.</span><input type="file" accept=".csv,text/csv" onChange={handle} /></label>
)}
<div className="btn-row">{demoMode && <button className="btn ghost" onClick={loadDemo}>Load Demo Sales</button>}{fileName && <span className="muted">Current file: {fileName}</span>}</div>
      <div className={`status-banner ${committed ? 'success' : ''}`}>{importStatus}</div>
    </section>
    {headers.length > 0 && <section className="panel-card mapping-panel">
      <div className="card-head"><div><p className="eyebrow">Step 1</p><h2>Confirm Column Mapping</h2></div><button className="btn gold small" onClick={apply} disabled={geocoding}>{geocoding ? 'Geocoding…' : 'Apply Mapping'}</button></div>
      <div className="mapping-required-row">{required.map(f => <span key={f} className={mapping[f] !== undefined && mapping[f] !== '' ? 'map-ok' : 'map-missing'}>{FIELD_LABELS[f]} {mapping[f] !== undefined && mapping[f] !== '' ? '✓' : 'missing'}</span>)}</div>
      <div className="mapper-grid">{Object.keys(FIELD_LABELS).map(field => { const req = required.includes(field); const selected = mapping[field] ?? ''; const sample = selected !== '' && rawRows[0] ? rawRows[0][Number(selected)] : ''; return <label key={field} className={req ? 'required-map' : ''}>{FIELD_LABELS[field]} {req && <em>Required</em>}<select value={selected} onChange={e => updateMap(field, e.target.value)}><option value="">— Not in CSV —</option>{headers.map((h, i) => <option key={h + i} value={i}>{h}</option>)}</select><small>{sample ? `Sample: ${sample}` : 'No sample mapped'}</small></label>; })}</div>
      <div className="btn-row"><button className="btn gold" onClick={apply} disabled={geocoding}>{geocoding ? 'Geocoding Sales…' : 'Apply Mapping & Use These Records'}</button><button className="btn ghost" onClick={() => { setHeaders([]); setRawRows([]); setMapping({}); setPreview(sales); setImportStatus('Import cancelled.'); }}>Cancel Import</button></div>
    </section>}
    {preview.length > 0 && <section className="table-card">
      <div className="card-head"><div><p className="eyebrow">Step 2</p><h2>{headers.length && !committed ? 'Preview Before Applying' : 'Active Records'}</h2></div><span>{preview.length} rows</span></div>
      <table><thead><tr><th>Address</th><th>City</th><th>Status</th><th>Price</th><th>Date</th><th>GLA</th><th>Site</th><th>Year</th><th>Q</th><th>C</th><th>Geo</th></tr></thead><tbody>{preview.slice(0, 25).map((r, i) => <tr key={i}><td>{r.address || '—'}</td><td>{r.city || '—'}</td><td>{r.status || '—'}</td><td>{money(r.sale_price_n)}</td><td>{r.sale_date || '—'}</td><td>{r.gla_n || '—'}</td><td>{r.site_sf_n || '—'}</td><td>{r.year_built_n || '—'}</td><td>{r.quality || '—'}</td><td>{r.condition || '—'}</td><td>{r.lat && r.lon ? '✓' : r.geocode_status || '—'}</td></tr>)}</tbody></table>
    </section>}
  </div>;
}

// ── Q/C Analyzer ──────────────────────────────────────────────────────────────
function Distribution({ title, data }) { const max = Math.max(1, ...data.map(d => d[1])); return <section className="panel-card"><h2>{title}</h2><div className="bar-list">{data.map(([k, v]) => <div key={k}><span>{k}</span><i><b style={{ width: `${v / max * 100}%` }} /></i><em>{v}</em></div>)}</div></section> }
function QCAnalyzer({ sales, setSales, subject }) {
  const [ran, setRan] = useState(false);
  const [reviewEdits, setReviewEdits] = useState({});
  const [applyMessage, setApplyMessage] = useState('');
  const ratingOptions = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
  const conditionOptions = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
  const counts = (field, prefix) => ['1', '2', '3', '4', '5', '6'].map(n => { const key = prefix + n; return [key, sales.filter(s => String(s[field] || '').toUpperCase().startsWith(key)).length]; });
  const q = counts('quality', 'Q'), c = counts('condition', 'C');
  const qn = ratingNum(subject.qual), cn = ratingNum(subject.cond);
  const flagged = sales.map((s, i) => {
    const key = s._id ?? `${s.address || 'sale'}-${i}`;
    const missing = !s.quality || !s.condition;
    const qnum = ratingNum(s.quality), cnum = ratingNum(s.condition);
    const qdiff = qn && qnum ? Math.abs(qnum - qn) : 0;
    const cdiff = cn && cnum ? Math.abs(cnum - cn) : 0;
    const risk = missing ? 95 : (qdiff > 1 || cdiff > 1 ? 80 : (qdiff + cdiff > 0 ? 48 : 18));
    const suggestQ = qnum ? `Q${Math.min(6, Math.max(1, Math.round((qnum + (qn || qnum)) / 2)))}` : subject.qual || 'Q3';
    const suggestC = cnum ? `C${Math.min(6, Math.max(1, Math.round((cnum + (cn || cnum)) / 2)))}` : subject.cond || 'C3';
    return { ...s, _reviewKey: key, _risk: risk, _suggestQ: suggestQ, _suggestC: suggestC, _reason: missing ? 'Missing Q/C data' : qdiff > 1 || cdiff > 1 ? 'Large spread from subject rating' : 'Typical market point' };
  }).sort((a, b) => b._risk - a._risk).slice(0, 10);
  useEffect(() => {
    if (!ran) return;
    const next = {};
    flagged.forEach(s => {
      next[s._reviewKey] = reviewEdits[s._reviewKey] || { quality: s.quality || s._suggestQ, condition: s.condition || s._suggestC };
    });
    setReviewEdits(next);
  }, [ran, sales.length, subject.qual, subject.cond]);
  function updateReview(key, field, value) {
    setApplyMessage('');
    setReviewEdits(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [field]: value } }));
  }
  function applyReviewSamples() {
    const keys = new Set(flagged.map(s => s._reviewKey));
    let changed = 0;
    const updated = sales.map((s, i) => {
      const key = s._id ?? `${s.address || 'sale'}-${i}`;
      if (!keys.has(key) || !reviewEdits[key]) return s;
      const quality = reviewEdits[key].quality || s.quality;
      const condition = reviewEdits[key].condition || s.condition;
      if (quality !== s.quality || condition !== s.condition) changed++;
      return { ...s, quality, condition, qc_reviewed: true };
    });
    setSales(updated);
    setApplyMessage(changed ? `Applied ${changed} Q/C sample update(s). Updated ratings now feed comp ranking, adjustment grid, and exports.` : 'No Q/C changes were needed.');
  }
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Q/C Analyzer</h1><p className="muted max">Analyze quality and condition distribution, compare the subject to the market, edit the suggested review samples, then apply the verified Q/C ratings back to the sales data.</p><div className="btn-row"><button className="btn gold" onClick={() => { setRan(true); setApplyMessage(''); }}>Analyze Q/C + Show Review Samples</button><button className="btn ghost" onClick={() => { setRan(false); setReviewEdits({}); setApplyMessage(''); }}>Reset</button></div><div className="qc-summary"><div><h2>Subject Quality</h2><b>{subject.qual || '—'}</b><span>{qn ? 'Rating captured' : 'Set rating in Subject Property'}</span></div><div><h2>Subject Condition</h2><b>{subject.cond || '—'}</b><span>{cn ? 'Rating captured' : 'Set rating in Subject Property'}</span></div></div>{applyMessage && <div className="status-banner success">{applyMessage}</div>}</section>
    <section className="two-col"><Distribution title="Quality Distribution" data={q} /><Distribution title="Condition Distribution" data={c} /></section>
    {ran && <section className="table-card"><div className="card-head"><div><h2>10 Suggested Q/C Review Samples</h2><span>Edit the verified rating for each sample, then apply the updates.</span></div><button className="btn gold small" onClick={applyReviewSamples}>Apply Q/C Rating Adjustments</button></div><table><thead><tr><th>Sale</th><th>Current Q/C</th><th>Suggested Review</th><th>Verified Q</th><th>Verified C</th><th>Flag / Reason</th></tr></thead><tbody>{flagged.map(s => { const edit = reviewEdits[s._reviewKey] || { quality: s.quality || s._suggestQ, condition: s.condition || s._suggestC }; return <tr key={s._reviewKey}><td>{s.address || '—'}<span>{s.city || ''}</span></td><td>{s.quality || '—'} / {s.condition || '—'}</td><td>{s._suggestQ} / {s._suggestC}</td><td><select className="cell-input" value={edit.quality || ''} onChange={e => updateReview(s._reviewKey, 'quality', e.target.value)}><option value="">—</option>{ratingOptions.map(x => <option key={x} value={x}>{x}</option>)}</select></td><td><select className="cell-input" value={edit.condition || ''} onChange={e => updateReview(s._reviewKey, 'condition', e.target.value)}><option value="">—</option>{conditionOptions.map(x => <option key={x} value={x}>{x}</option>)}</select></td><td><em className={s._risk >= 70 ? 'flag-warn' : 'flag-good'}>{s._reason}</em></td></tr>; })}</tbody></table></section>}
    <section className="table-card"><div className="card-head"><h2>Q/C Review Flags</h2><span>{sales.length} sales reviewed</span></div><table><thead><tr><th>Sale</th><th>Q</th><th>C</th><th>Flag</th></tr></thead><tbody>{sales.slice(0, 15).map((s, i) => { const missing = !s.quality || !s.condition; const qdiff = qn && ratingNum(s.quality) ? Math.abs(ratingNum(s.quality) - qn) : 0; const cdiff = cn && ratingNum(s.condition) ? Math.abs(ratingNum(s.condition) - cn) : 0; return <tr key={i}><td>{s.address || '—'}</td><td>{s.quality || '—'}</td><td>{s.condition || '—'}</td><td><em className={missing || qdiff > 1 || cdiff > 1 ? 'flag-warn' : 'flag-good'}>{s.qc_reviewed ? 'Reviewed / updated' : missing ? 'Missing rating' : qdiff > 1 || cdiff > 1 ? 'Large Q/C spread' : 'Typical'}</em></td></tr>; })}</tbody></table></section>
  </div>;
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
  return <div className="market-line-wrap">
    <svg className="market-line-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Median sale price line graph">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} />
      <path d={d} />
      {coords.map(p => <g key={p.key}><circle cx={p.x} cy={p.y} r="4"><title>{p.key}: {money(p.yMod)} ({p.n} sales)</title></circle><text x={p.x} y={h - 10} textAnchor="middle">{p.key}</text></g>)}
    </svg>
  </div>;
}

function MarketConditions({ persona, sales, setMtNarData }) {
  const [mode, setMode] = useState('rolling3'); const [minSales, setMinSales] = useState(1); const [ran, setRan] = useState(false);
  const series = useMemo(() => marketSeries(sales, minSales, mode), [sales, minSales, mode]);
  function generate() { setRan(true); setMtNarData({ monthly: series.monthly, dir: series.monthly > 0.1 ? 'increasing' : series.monthly < -0.1 ? 'declining' : 'stable' }); }
  const modeLabels = { raw: 'Raw period medians', rolling3: 'Rolling 3-month median', quarterly: 'Quarterly modifier', weighted: 'Weighted trend line' };
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">{persona === 'appraiser' ? 'Market Conditions Tool' : 'Market Snapshot'}</p><h1>{persona === 'appraiser' ? 'Market Conditions / Rolling Modifier' : 'Active / Pending / Sold Market Snapshot'}</h1><p className="muted max">Rolling 3-month median, quarterly grouping, and weighted trend line options for thin or volatile markets.</p>
      <div className="form-grid compact"><label>Limited Data Modifier<select value={mode} onChange={e => { setMode(e.target.value); setRan(false); }}><option value="raw">Off — raw period medians</option><option value="rolling3">Rolling 3-month median</option><option value="quarterly">Quarterly modifier</option><option value="weighted">Weighted trend line by sale count</option></select></label><label>Minimum Sales Per Period<input type="number" value={minSales} min="1" onChange={e => { setMinSales(Number(e.target.value) || 1); setRan(false); }} /></label></div>
      <div className="btn-row"><button className="btn gold" onClick={generate}>Generate Market Study</button>{ran && <span className="status-pill">Study generated using {modeLabels[mode]}</span>}</div>
      {ran && <div className="metric-grid four"><div><b>{series.monthly.toFixed(3)}%</b><span>Monthly Rate</span></div><div><b>{(series.monthly * 12).toFixed(2)}%</b><span>Annualized</span></div><div><b>{series.points.length}</b><span>Periods Used</span></div><div><b>{series.monthly > 0.1 ? '↑ Increasing' : series.monthly < -0.1 ? '↓ Declining' : '→ Stable'}</b><span>Direction</span></div></div>}
    </section>
    {ran ? <section className="chart-card"><h2>Median Sale Price Trend</h2><MarketLineChart points={series.points} max={series.max} /><div className="table-card embedded"><table><thead><tr><th>Period</th><th>Sales</th><th>Raw Median</th><th>Modified Median</th></tr></thead><tbody>{series.points.map(p => <tr key={p.key}><td>{p.key}</td><td>{p.n}</td><td>{money(p.y)}</td><td>{money(p.yMod)}</td></tr>)}</tbody></table></div></section>
      : <section className="panel-card"><h2>Ready to generate</h2><p className="muted">Choose a modifier, then click Generate Market Study.</p></section>}
  </div>;
}

// ── GLA Study ─────────────────────────────────────────────────────────────────
function GLAStudy({ sales, subject, setGlaNarData }) {
  const [mtRate, setMtRate] = useState(0); const [regResult, setRegResult] = useState(null); const [pairedRows, setPairedRows] = useState([{ pa: '', ga: '', pb: '', gb: '' }]); const [pairedResult, setPairedResult] = useState(null);
  const [applyInputs, setApplyInputs] = useState({ sg: subject.gla || '', cg: '', rate: '', cp: '' }); const [applyResult, setApplyResult] = useState(null);
  function runRegression() { const pairs = sales.filter(s => !isNaN(s.gla_n) && !isNaN(s.sale_price_n) && s.gla_n > 0 && s.sale_price_n > 0).map(s => { let adjPrice = s.sale_price_n; if (mtRate !== 0 && subject.effdate && s.sale_date) { const m = monthsBetween(subject.effdate, s.sale_date); adjPrice *= (1 + mtRate / 100 * m); } return { x: s.gla_n, y: adjPrice }; }); if (pairs.length < 3) { alert('Need at least 3 sales with GLA and price data.'); return; } const { b, r2, n } = linReg(pairs); const rel = r2 >= 0.8 ? 'Strong (R²≥0.80)' : r2 >= 0.6 ? 'Moderate (R²≥0.60)' : r2 >= 0.4 ? 'Weak (R²≥0.40) — corroborate with paired sales' : 'Poor — use paired sales method'; setRegResult({ slope: b, r2, n, rel }); setGlaNarData({ rate: b, method: 'simple linear regression' }); }
  function calcPaired() { const rates = []; const results = pairedRows.map((r, i) => { const pa = toNum(r.pa), ga = toNum(r.ga), pb = toNum(r.pb), gb = toNum(r.gb); if ([pa, ga, pb, gb].every(v => !isNaN(v)) && ga !== gb) { const rate = (pa - pb) / (ga - gb); rates.push(rate); return { i, rate, valid: true }; } return { i, valid: false }; }); if (!rates.length) { alert('Enter at least one complete pair.'); return; } const avg = rates.reduce((a, b2) => a + b2, 0) / rates.length; const med = median(rates); setPairedResult({ results, avg, med, min: Math.min(...rates), max: Math.max(...rates) }); setGlaNarData({ rate: med, method: 'paired sales analysis' }); }
  function calcApply() { const sg = toNum(applyInputs.sg), cg = toNum(applyInputs.cg), rate = toNum(applyInputs.rate), cp = toNum(applyInputs.cp); if ([sg, cg, rate, cp].some(isNaN)) { alert('Fill all fields.'); return; } const diff = sg - cg, dollar = diff * rate, adj = cp + dollar; setApplyResult({ diff, dollar, adj, pct: Math.abs(dollar / cp * 100) }); }
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>GLA Adjustment Study</h1><p className="muted max">Extract a per-square-foot GLA adjustment using regression analysis, paired sales, or apply an existing rate. Results feed the narrative and adjustment grid.</p></section>
    <section className="panel-card"><h2>Method 1 — Simple Linear Regression</h2><p className="muted">Regresses time-adjusted sale prices against GLA for all imported sales with valid data.</p>
      <div className="form-grid compact"><label>Market Conditions Rate (% / month)<input type="number" step="0.001" value={mtRate} onChange={e => setMtRate(toNum(e.target.value) || 0)} /></label></div>
      <div className="btn-row"><button className="btn gold" onClick={runRegression}>Run GLA Regression</button></div>
      {regResult && <div className="metric-grid four" style={{ marginTop: 16 }}><div><b>${fmt(regResult.slope, 2)}/SF</b><span>Slope ($/SF)</span></div><div><b>{fmt(regResult.r2, 3)}</b><span>R²</span></div><div><b>{regResult.n}</b><span>Sales Used</span></div><div><b style={{ fontSize: '1rem', lineHeight: 1.3 }}>{regResult.rel}</b><span>Reliability</span></div></div>}
    </section>
    <section className="panel-card"><h2>Method 2 — Paired Sales Analysis</h2><p className="muted">Isolate GLA differences between matched pairs. Add pairs, then calculate.</p>
      {pairedRows.map((r, i) => <div key={i} className="form-grid" style={{ marginBottom: 8 }}><label>Sale A Price ($)<input type="number" value={r.pa} onChange={e => setPairedRows(pairedRows.map((x, j) => j === i ? { ...x, pa: e.target.value } : x))} /></label><label>Sale A GLA (SF)<input type="number" value={r.ga} onChange={e => setPairedRows(pairedRows.map((x, j) => j === i ? { ...x, ga: e.target.value } : x))} /></label><label>Sale B Price ($)<input type="number" value={r.pb} onChange={e => setPairedRows(pairedRows.map((x, j) => j === i ? { ...x, pb: e.target.value } : x))} /></label><label>Sale B GLA (SF)<input type="number" value={r.gb} onChange={e => setPairedRows(pairedRows.map((x, j) => j === i ? { ...x, gb: e.target.value } : x))} /></label></div>)}
      <div className="btn-row"><button className="btn ghost" onClick={() => setPairedRows([...pairedRows, { pa: '', ga: '', pb: '', gb: '' }])}>+ Add Pair</button><button className="btn gold" onClick={calcPaired}>Calculate Paired Rates</button></div>
      {pairedResult && <div className="metric-grid four" style={{ marginTop: 16 }}><div><b>${fmt(pairedResult.avg, 2)}/SF</b><span>Average Rate</span></div><div><b>${fmt(pairedResult.med, 2)}/SF</b><span>Median Rate</span></div><div><b>${fmt(pairedResult.min, 2)} – ${fmt(pairedResult.max, 2)}</b><span>Range</span></div><div><b>{pairedResult.results.filter(r => r.valid).length}</b><span>Valid Pairs</span></div></div>}
    </section>
    <section className="panel-card"><h2>Apply GLA Rate</h2><p className="muted">Calculate the dollar adjustment and adjusted price for a single comparable.</p>
      <div className="form-grid"><label>Subject GLA (SF)<input type="number" value={applyInputs.sg} onChange={e => setApplyInputs({ ...applyInputs, sg: e.target.value })} /></label><label>Comp GLA (SF)<input type="number" value={applyInputs.cg} onChange={e => setApplyInputs({ ...applyInputs, cg: e.target.value })} /></label><label>Rate ($/SF)<input type="number" step="0.01" value={applyInputs.rate} onChange={e => setApplyInputs({ ...applyInputs, rate: e.target.value })} /></label><label>Comp Sale Price ($)<input type="number" value={applyInputs.cp} onChange={e => setApplyInputs({ ...applyInputs, cp: e.target.value })} /></label></div>
      <div className="btn-row"><button className="btn gold" onClick={calcApply}>Apply GLA Rate</button></div>
      {applyResult && <div className="metric-grid four" style={{ marginTop: 16 }}><div><b>{fmt(applyResult.diff)} SF</b><span>GLA Difference</span></div><div><b>{fmtD(applyResult.dollar)}</b><span>Dollar Adjustment</span></div><div><b>{money(applyResult.adj)}</b><span>Adjusted Price</span></div><div><b>{fmt(applyResult.pct, 1)}%</b><span>Pct of Sale Price</span></div></div>}
    </section>
  </div>;
}

// ── Comp Ranking ──────────────────────────────────────────────────────────────
function CompRanking({ subject, setSubject, sales, setSales, selectedComps, setSelectedComps }) {
  const [w, setW] = useState({ gla: 24, distance: 18, date: 18, site: 10, year: 8, garage: 7, basement: 5, pool: 4, qual: 3, cond: 3 }); const [busy, setBusy] = useState('');
  const ranked = useMemo(() => sales.map((s, idx) => ({ ...s, _key: s._id ?? s.address ?? idx, _distance: distanceMiles(subject.lat, subject.lon, s.lat, s.lon), _score: scoreComp(s, subject, w) })).sort((a, b) => b._score - a._score), [sales, subject, w]);
  const selectedSet = new Set(selectedComps);
  function toggleComp(key) { setSelectedComps(selectedSet.has(key) ? selectedComps.filter(x => x !== key) : [...selectedComps, key]); }
  async function geocodeOne(addr) { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`); const d = await r.json(); return d?.[0] ? { lat: Number(d[0].lat), lon: Number(d[0].lon) } : null; }
  async function geoSubject() { setBusy('Geocoding subject…'); const res = await geocodeOne([subject.address, subject.city].filter(Boolean).join(', ')); if (res) setSubject({ ...subject, ...res }); setBusy(''); }
  async function geoComps() { setBusy('Geocoding comps…'); const updated = []; for (let i = 0; i < sales.length; i++) { const s = sales[i]; if (s.lat && s.lon) { updated.push(s); continue; } const addr = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '); if (!addr) { updated.push(s); continue; } try { const res = await geocodeOne(addr); updated.push(res ? { ...s, ...res } : s); } catch { updated.push(s); } await new Promise(r => setTimeout(r, 650)); } setSales(updated); setBusy(''); }
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Comp Ranking Tool</p><h1>Comparable Sale Ranking + Geocoding</h1><p className="muted max">Ranks comps by GLA, distance, date, site, age, garage, basement, pool, quality, and condition. Select comps to carry into the Adjustment Grid.</p>
      <div className="btn-row"><button className="btn gold" onClick={geoSubject}>Geocode Subject</button><button className="btn ghost" onClick={geoComps}>Geocode Comparable Sales</button>{busy && <span className="muted">{busy}</span>}<span className="status-pill">{selectedComps.length} selected</span></div>
      <div className="weight-grid">{Object.keys(w).map(k => <label key={k}>{k}<input type="number" value={w[k]} onChange={e => setW({ ...w, [k]: Number(e.target.value) || 0 })} /></label>)}</div>
      <div className="muted" style={{ marginTop: 8 }}>Weight total: {Object.values(w).reduce((a, b) => a + b, 0)}</div>
    </section>
    <section className="rank-grid">{ranked.slice(0, 12).map((s, i) => <article className={`rank-card ${selectedSet.has(s._key) ? 'selected' : ''}`} key={s._key}><div className="rank-num">#{i + 1}</div><div><div className="row-between"><div><h3>{s.address || 'Address not mapped'}</h3><p>{s.city || ''}</p></div><label className="select-comp"><input type="checkbox" checked={selectedSet.has(s._key)} onChange={() => toggleComp(s._key)} /> Use comp</label></div><div className="rank-meta"><span>Score <b>{fmt(s._score, 0)}</b></span><span>Price <b>{money(s.sale_price_n)}</b></span><span>GLA <b>{fmt(s.gla_n)}</b></span><span>Distance <b>{s._distance !== null ? `${fmt(s._distance, 2)} mi` : '—'}</b></span><span>Q/C <b>{s.quality || '—'} / {s.condition || '—'}</b></span><span>Status <b>{s.status || '—'}</b></span></div>{s.lat && s.lon && <a className="map-link" href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=16/${s.lat}/${s.lon}`} target="_blank" rel="noreferrer">Open map ↗</a>}</div></article>)}</section>
  </div>;
}

// ── Site Value ────────────────────────────────────────────────────────────────
function SiteValue() {
  const [land, setLand] = useState([{ price: 85000, site: 9500 }, { price: 92000, site: 10500 }, { price: 78000, site: 8700 }]);
  const [imp, setImp] = useState(350000); const [total, setTotal] = useState(435000); const [pct, setPct] = useState(20); const [ran, setRan] = useState(false);
  const avg = land.reduce((a, r) => a + (Number(r.price) || 0) / (Number(r.site) || 1), 0) / Math.max(1, land.length);
  const allocation = total * pct / 100; const abstraction = total - imp;
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Site / Land Value Support</h1><p className="muted max">Support site value using vacant land sales, allocation, and abstraction methods.</p><button className="btn gold" onClick={() => setRan(true)}>Calculate Site / Land Value</button>{ran && <div className="metric-grid three" style={{ marginTop: 16 }}><div><b>{money(avg)}/SF</b><span>Avg $/SF (Land Sales)</span></div><div><b>{money(allocation)}</b><span>Allocation Indication</span></div><div><b>{money(abstraction)}</b><span>Abstraction Indication</span></div></div>}</section>
    <section className="table-card"><div className="card-head"><h2>Vacant Land Sales</h2><button onClick={() => setLand([...land, { price: 0, site: 0 }])}>+ Add Sale</button></div><table><thead><tr><th>Sale Price</th><th>Site SF</th><th>$/SF</th><th></th></tr></thead><tbody>{land.map((r, i) => <tr key={i}><td><input className="cell-input" type="number" value={r.price} onChange={e => { setRan(false); setLand(land.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x)); }} /></td><td><input className="cell-input" type="number" value={r.site} onChange={e => { setRan(false); setLand(land.map((x, j) => j === i ? { ...x, site: Number(e.target.value) } : x)); }} /></td><td>{money((r.price || 0) / (r.site || 1))}/SF</td><td><button className="btn ghost small" onClick={() => setLand(land.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table></section>
    <section className="panel-card"><h2>Allocation / Abstraction Methods</h2><div className="form-grid"><label>Total Property Value<input type="number" value={total} onChange={e => { setRan(false); setTotal(Number(e.target.value)); }} /></label><label>Allocation % to Site<input type="number" value={pct} onChange={e => { setRan(false); setPct(Number(e.target.value)); }} /></label><label>Improvement Value Estimate<input type="number" value={imp} onChange={e => { setRan(false); setImp(Number(e.target.value)); }} /></label></div></section>
  </div>;
}

// ── Adjustment Grid ───────────────────────────────────────────────────────────
function Adjustments({ selectedComps, sales, subject, adjRows, setAdjRows }) {
  const [mtRate, setMtRate] = useState(0); const [glaRate, setGlaRate] = useState(0); const [siteRate, setSiteRate] = useState(0); const [ageRate, setAgeRate] = useState(0); const [condRate, setCondRate] = useState(0); const [qualRate, setQualRate] = useState(0); const [topN, setTopN] = useState(6); const [built, setBuilt] = useState(false);
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
    setAdjRows(rows); setBuilt(true);
  }
  function editAdj(i, k, v) { const next = adjRows.map((r, j) => { if (j !== i) return r; const updated = { ...r, [k]: toNum(v) || 0 }; updated.totalAdj = updated.timeAdj + updated.glaAdj + updated.siteAdj + updated.ageAdj + updated.condAdj + updated.qualAdj + updated.otherAdj; updated.adjusted = updated.price + updated.totalAdj; return updated; }); setAdjRows(next); }
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Adjustment Grid</h1><p className="muted max">Select comps in Comp Ranking then build the grid. Rate inputs pre-calculate each adjustment — all cells are editable after build.</p>
      <div className="form-grid"><label>Market Conditions (% / month)<input type="number" step="0.001" value={mtRate} onChange={e => setMtRate(toNum(e.target.value) || 0)} /></label><label>GLA Rate ($/SF)<input type="number" step="0.01" value={glaRate} onChange={e => setGlaRate(toNum(e.target.value) || 0)} /></label><label>Site Rate ($/SF)<input type="number" step="0.01" value={siteRate} onChange={e => setSiteRate(toNum(e.target.value) || 0)} /></label><label>Age Rate ($/year)<input type="number" step="1" value={ageRate} onChange={e => setAgeRate(toNum(e.target.value) || 0)} /></label><label>Condition Rate ($/rating step)<input type="number" step="100" value={condRate} onChange={e => setCondRate(toNum(e.target.value) || 0)} /></label><label>Quality Rate ($/rating step)<input type="number" step="100" value={qualRate} onChange={e => setQualRate(toNum(e.target.value) || 0)} /></label><label>Top N Comps<input type="number" min="1" max="12" value={topN} onChange={e => setTopN(Number(e.target.value) || 6)} /></label></div>
      {selectedRows.length > 0 ? <div className="selected-comps-row">{selectedRows.slice(0, topN).map(s => <span key={s._id}>{s.address}</span>)}</div> : <div className="status-banner">No comps selected — build will use top {topN} ranked sales. Select comps in Comp Ranking for better control.</div>}
      <div className="btn-row" style={{ marginTop: 16 }}><button className="btn gold" onClick={build}>Build Adjustment Grid</button>{built && <span className="status-pill">Grid built — cells are editable</span>}</div>
    </section>
    {adjRows.length > 0 && <section className="table-card" style={{ overflowX: 'auto' }}>
      <div className="card-head"><h2>Adjustment Grid</h2><button className="btn ghost small" onClick={() => { const csv = ['Rank,Address,Sale Price,Date,Score,Time,GLA,Site,Age,Cond,Qual,Other,Net Adj,Adjusted,Notes'].concat(adjRows.map(r => [r.rank, `"${r.address}"`, r.price, r.date, Math.round(r.score), Math.round(r.timeAdj), Math.round(r.glaAdj), Math.round(r.siteAdj), Math.round(r.ageAdj), Math.round(r.condAdj), Math.round(r.qualAdj), Math.round(r.otherAdj), Math.round(r.totalAdj), Math.round(r.adjusted), `"${r.note}"`].join(','))).join('\n'); const b = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'adjustment_grid.csv'; a.click(); }}>Export CSV ⇩</button></div>
      <table><thead><tr><th>#</th><th>Comp</th><th>Sale Price</th><th>Date</th><th>Score</th><th>Time</th><th>GLA</th><th>Site</th><th>Age</th><th>Cond</th><th>Qual</th><th>Other</th><th>Net Adj</th><th>Adjusted</th><th>Notes</th></tr></thead>
        <tbody>{adjRows.map((r, i) => <tr key={i}><td>{r.rank}</td><td>{r.address || '—'}</td><td>{money(r.price)}</td><td>{r.date || '—'}</td><td>{fmt(r.score, 0)}</td>{['timeAdj', 'glaAdj', 'siteAdj', 'ageAdj', 'condAdj', 'qualAdj', 'otherAdj'].map(k => <td key={k}><input className="cell-input" defaultValue={Math.round(r[k])} onBlur={e => editAdj(i, k, e.target.value)} style={{ width: 80 }} /></td>)}<td style={{ color: r.totalAdj >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtD(r.totalAdj)}</td><td><b>{money(r.adjusted)}</b></td><td><input className="cell-input wide" defaultValue={r.note} onBlur={e => { const next = adjRows.map((x, j) => j === i ? { ...x, note: e.target.value } : x); setAdjRows(next); }} style={{ width: 160 }} /></td></tr>)}</tbody>
      </table>
    </section>}
  </div>;
}

// ── Concessions ───────────────────────────────────────────────────────────────
function Concessions({ sales }) {
  const [view, setView] = useState('all'); const [ran, setRan] = useState(false);
  const withConc = sales.filter(s => s.concessions_n > 0);
  const display = view === 'with' ? withConc : sales.filter(s => s.sale_price_n > 0);
  const freq = sales.length ? (withConc.length / sales.length * 100) : 0;
  const amounts = withConc.map(s => s.concessions_n);
  const medConc = median(amounts); const avgConc = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
  const concPcts = withConc.map(s => s.concessions_n / s.sale_price_n * 100).filter(v => isFinite(v));
  const medPct = median(concPcts);
  function narrativeText() { if (!withConc.length) return 'No seller concession data was mapped in the imported MLS records. If concessions are relevant, import a CSV with a seller concession column and remap the field.'; return `Of the ${sales.length} imported sales, ${withConc.length} (${fmt(freq, 1)}%) reflect seller-paid concessions. The median concession was ${money(medConc)}, representing approximately ${fmt(medPct, 1)}% of the sale price for those transactions. This factual summary is drawn from the imported MLS data and does not constitute a conclusion regarding market typicality or price influence. Professional judgment is required to determine whether any adjustment is warranted.`; }
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Seller Concessions Analysis</h1><p className="muted max">Summarize seller-paid closing costs, credits, and financing concessions as facts from the MLS data. Documents what is present without forcing a threshold-based conclusion.</p>
      <div className="form-grid compact"><label>Analysis View<select value={view} onChange={e => setView(e.target.value)}><option value="all">All imported sales</option><option value="with">Only sales with concessions</option></select></label></div>
      <div className="btn-row"><button className="btn gold" onClick={() => setRan(true)}>Run Concessions Study</button>{ran && <span className="status-pill">Study complete</span>}</div>
      {ran && <div className="metric-grid four" style={{ marginTop: 16 }}><div><b>{withConc.length} / {sales.length}</b><span>Sales with Concessions</span></div><div><b>{fmt(freq, 1)}%</b><span>Frequency</span></div><div><b>{money(medConc)}</b><span>Median Concession</span></div><div><b>{fmt(medPct, 1)}%</b><span>Median % of Sale Price</span></div></div>}
    </section>
    {ran && <section className="panel-card"><h2>Factual Narrative (Editable)</h2><p className="muted" style={{ marginBottom: 8 }}>This is a factual summary. Edit before copying into a report addendum.</p><textarea className="big-text" defaultValue={narrativeText()} style={{ minHeight: 140 }} /><div className="btn-row"><button className="btn ghost" onClick={() => navigator.clipboard?.writeText(narrativeText())}>Copy Text</button></div></section>}
    {ran && display.length > 0 && <section className="table-card"><div className="card-head"><h2>Concession Detail</h2><span>{display.length} records</span></div><table><thead><tr><th>Address</th><th>Sale Price</th><th>Concessions</th><th>Conc %</th><th>Net Price</th><th>Status</th></tr></thead><tbody>{display.map((s, i) => <tr key={i}><td>{s.address || '—'}</td><td>{money(s.sale_price_n)}</td><td>{s.concessions_n > 0 ? money(s.concessions_n) : '—'}</td><td>{s.concessions_n > 0 && s.sale_price_n ? fmt(s.concessions_n / s.sale_price_n * 100, 1) + '%' : '—'}</td><td>{s.concessions_n > 0 && s.sale_price_n ? money(s.sale_price_n - s.concessions_n) : '—'}</td><td>{s.status || '—'}</td></tr>)}</tbody></table></section>}
  </div>;
}

// ── Reconciliation ────────────────────────────────────────────────────────────
function Reconciliation({ adjRows }) {
  const vals = adjRows.map(r => r.adjusted).filter(v => v > 0);
  if (!vals.length) return <div className="dash-page"><section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Reconciliation</h1><p className="muted">Build the Adjustment Grid first. Reconciliation indicators will appear here automatically once the grid has comps.</p></section></div>;
  const weights = adjRows.map(r => Math.max(1, r.score || 1));
  const wAvg = adjRows.reduce((a, r) => a + r.adjusted * Math.max(1, r.score || 1), 0) / weights.reduce((a, b) => a + b, 0);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length; const med = median(vals); const low = Math.min(...vals); const high = Math.max(...vals);
  const [opinion, setOpinion] = useState(''); const [rationale, setRationale] = useState('');
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Reconciliation Summary</h1><p className="muted max">Statistical indicators from the adjustment grid. Final opinion of value is the appraiser's reconciled professional conclusion.</p></section>
    <div className="metric-grid four"><div><b>{money(low)}</b><span>Low Adjusted</span></div><div><b>{money(med)}</b><span>Median</span></div><div><b>{money(avg)}</b><span>Mean</span></div><div><b>{money(wAvg)}</b><span>Score-Weighted</span></div></div>
    <section className="panel-card"><h2>Range Analysis</h2><div className="metric-grid three"><div><b>{money(high - low)}</b><span>Range Spread</span></div><div><b>{money(high)}</b><span>High Adjusted</span></div><div><b>{adjRows.length}</b><span>Comps Reconciled</span></div></div></section>
    <section className="panel-card" style={{ borderColor: 'rgba(214,176,74,.4)' }}><h2>Suggested Reconciliation Language</h2><p className="muted" style={{ marginBottom: 12 }}>Auto-drafted from the grid. Edit before use in report addendum.</p><textarea className="big-text" style={{ minHeight: 120 }} defaultValue={`The adjusted comparables indicate a range from ${money(low)} to ${money(high)}, with a median of ${money(med)} and a similarity-score-weighted indication of ${money(Math.round(wAvg))}. Greatest weight has been placed on the sales requiring the fewest and most supportable adjustments, with consideration given to proximity, date of sale, physical similarity, and overall reliability. The final opinion of value reflects the appraiser's professional judgment applied to this market evidence.`} /></section>
    <section className="panel-card"><h2>Appraiser's Opinion of Value</h2><div className="form-grid"><label>Final Value Opinion ($)<input type="number" value={opinion} onChange={e => setOpinion(e.target.value)} placeholder={Math.round(wAvg)} /></label></div><label style={{ display: 'block', marginTop: 12, color: 'var(--muted)' }}>Reconciliation Rationale<textarea className="big-text" style={{ minHeight: 100 }} value={rationale} onChange={e => setRationale(e.target.value)} placeholder="Explain the weight given to each comparable and how the final value was concluded…" /></label>{opinion && <div className="net-result">Opinion of Value <strong>{money(toNum(opinion))}</strong></div>}</section>
    <section className="table-card"><div className="card-head"><h2>Comp Summary</h2></div><table><thead><tr><th>Rank</th><th>Comp</th><th>Sale Price</th><th>Net Adj</th><th>Adjusted</th><th>Score</th></tr></thead><tbody>{adjRows.map(r => <tr key={r.rank}><td>{r.rank}</td><td>{r.address || '—'}</td><td>{money(r.price)}</td><td style={{ color: r.totalAdj >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtD(r.totalAdj)}</td><td><b>{money(r.adjusted)}</b></td><td>{fmt(r.score, 0)}</td></tr>)}</tbody></table></section>
  </div>;
}

// ── Narrative Builder ─────────────────────────────────────────────────────────
function NarrativeBuilder({ subject, sales, glaNarData, mtNarData }) {
  const [fields, setFields] = useState({ market: subject.city || '[Market Area]', period: '12 months ending ' + (subject.effdate || new Date().toISOString().slice(0, 10)), n: String(sales.length), source: 'MLS data', rate: String(mtNarData.monthly?.toFixed(3) || '0'), dir: mtNarData.dir || 'stable', gla: String(glaNarData.rate?.toFixed(2) || '0'), glaMethod: glaNarData.method || 'paired sales analysis', sel: 'within the subject neighborhood, similar GLA, and within 12 months of the effective date' });
  const [generated, setGenerated] = useState('');
  useEffect(() => { setFields(f => ({ ...f, rate: String(mtNarData.monthly?.toFixed(3) || f.rate), dir: mtNarData.dir || f.dir })); }, [mtNarData]);
  useEffect(() => { setFields(f => ({ ...f, gla: String(glaNarData.rate?.toFixed(2) || f.gla), glaMethod: glaNarData.method || f.glaMethod })); }, [glaNarData]);
  function generate() {
    const annRate = fmt(Number(fields.rate) * 12, 2); const gla = Number(fields.gla);
    const text = `Market Conditions and Comparable Selection Addendum\n\nThe subject property is located within ${fields.market}. To determine the appropriate market conditions adjustment, the appraiser analyzed ${fields.n} arm's-length sales during the period of ${fields.period}, utilizing data from ${fields.source}.\n\nMedian sale price analysis over the study period indicates a ${fields.dir} market at an indicated rate of approximately ${fmtPct(Number(fields.rate), 3)} per month (${annRate}% annualized). The trend was established through time-series analysis of median sale prices plotted against time of sale.\n${gla > 0 ? `\nGross Living Area adjustments were extracted through ${fields.glaMethod} of sales within the subject's competitive market area. The indicated rate of $${fmt(gla, 2)}/SF reflects actual buyer behavior as evidenced by the analyzed sales data.\n` : ''}\nComparable sales were selected based on the following criteria: ${fields.sel}.\n\nAll adjustments presented in this report are market-derived and supported by the data described above and contained in the appraiser's work file. The appraiser's professional judgment was applied throughout this analysis in accordance with USPAP.\n\nPrepared by: ${subject.appraiser || '[Appraiser Name / License]'}`;
    setGenerated(text);
  }
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Appraiser Tool</p><h1>Narrative Builder</h1><p className="muted max">Generate editable addendum language for market conditions, GLA support, comp selection, and reconciliation. Fields pre-fill from Market Conditions and GLA Study results.</p></section>
    <section className="panel-card"><h2>Narrative Inputs</h2><div className="form-grid">{[['market', 'Market Area'], ['period', 'Analysis Period'], ['n', 'Sales Analyzed'], ['source', 'Data Source'], ['rate', 'Monthly Rate (%)'], ['dir', 'Direction'], ['gla', 'GLA Rate ($/SF)'], ['glaMethod', 'GLA Method'], ['sel', 'Comp Selection Criteria']].map(([k, l]) => <label key={k}>{l}<input type="text" value={fields[k]} onChange={e => setFields({ ...fields, [k]: e.target.value })} /></label>)}</div>
      <div className="btn-row" style={{ marginTop: 16 }}><button className="btn gold" onClick={generate}>Generate Narrative Draft</button></div>
    </section>
    {generated && <section className="panel-card" style={{ borderColor: 'rgba(214,176,74,.4)' }}><h2>Narrative Draft (Editable)</h2><textarea className="big-text" style={{ minHeight: 320, fontFamily: 'inherit', lineHeight: 1.7 }} defaultValue={generated} key={generated} /><div className="btn-row"><button className="btn ghost" onClick={() => navigator.clipboard?.writeText(generated)}>Copy Text</button></div></section>}
  </div>;
}

// ── Export Workfile ───────────────────────────────────────────────────────────
function ExportWorkfile({ subject, sales, adjRows, glaNarData, mtNarData, saveProject, demoMode = false }) {
  const [sections, setSections] = useState({ subject: true, market: true, gla: true, adjustments: true, data: true, narrative: true });
  function toggle(k) { setSections(s => ({ ...s, [k]: !s[k] })); }
  function saveLocal() { const w = { subject, importedSales: sales, adjRows, glaNarData, mtNarData, savedAt: new Date().toISOString() }; localStorage.setItem('valoraiqWorkfile', JSON.stringify(w)); alert('Workfile saved to this browser.'); }
  function downloadJSON() { const w = { subject, importedSales: sales, adjRows, glaNarData, mtNarData, savedAt: new Date().toISOString() }; const blob = new Blob([JSON.stringify(w, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'appraisal_workfile.json'; a.click(); }
  function restoreLocal() { const raw = localStorage.getItem('valoraiqWorkfile'); if (!raw) { alert('No browser save found.'); return; } const w = JSON.parse(raw); alert(`Workfile restored. Saved at: ${w.savedAt || 'unknown'}. Reload the page to apply imported sales.`); }
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
  return <div className="dash-page">
    <section className="panel-card"><p className="eyebrow">Workfile Export</p><h1>Save / Export / Print Workfile</h1><p className="muted max">Save the session locally, download a JSON workfile, restore a previous save, or print a clean PDF for your appraisal workfile.</p>
      <div className="btn-row">{!demoMode && <button className="btn gold" onClick={saveProject}>Save Project to Cloud</button>}<button className="btn ghost" onClick={saveLocal}>Save to Browser</button><button className="btn ghost" onClick={restoreLocal}>Restore Browser Save</button><button className="btn ghost" onClick={downloadJSON}>Download JSON ⇩</button></div>
      <div className="status-banner" style={{ marginTop: 12 }}>Browser saves stay in localStorage on this device. JSON exports contain subject and sales data — store like any confidential workfile.</div>
    </section>
    <section className="panel-card"><h2>Print / Save PDF</h2><p className="muted" style={{ marginBottom: 14 }}>Select sections to include. In the browser print window choose <strong>Save as PDF</strong>.</p>
      <div className="check-list">{[['subject', 'Subject Property Summary'], ['market', 'Market Conditions'], ['gla', 'GLA Adjustment Support'], ['adjustments', 'Adjustment Grid + Reconciliation'], ['data', 'Imported Sales Summary'], ['narrative', 'Narrative Draft']].map(([k, l]) => <label key={k}><input type="checkbox" checked={sections[k]} onChange={() => toggle(k)} /> {l}</label>)}</div>
      <div className="btn-row" style={{ marginTop: 16 }}><button className="btn gold" onClick={printPDF}>Print Workfile / Save PDF</button></div>
    </section>
  </div>;
}

// ── Agent tools ───────────────────────────────────────────────────────────────
function PricingStrategy({ compact = false }) { return <section className={`strategy-card ${compact ? '' : 'large'}`}><p className="eyebrow">Agent Only</p><h1>Pricing Strategy Snapshot</h1><div className="metric-grid three"><div><b>$510k</b><span>Recommended List</span></div><div><b>$495k–$525k</b><span>Likely Contract Range</span></div><div><b>14–21</b><span>Expected DOM</span></div></div><p>Position pricing slightly below current active competition while staying aligned with pending momentum and closed-sale proof.</p></section> }
function SellerNet() { const [price, setPrice] = useState(510000); const [mort, setMort] = useState(310000); const [comm, setComm] = useState(5.5); const [cost, setCost] = useState(6500); const net = price - mort - (price * comm / 100) - cost; return <div className="dash-page"><section className="panel-card"><p className="eyebrow">Agent Only</p><h1>Seller Net Sheet</h1><div className="form-grid"><label>Sale Price<input type="number" value={price} onChange={e => setPrice(+e.target.value)} /></label><label>Mortgage Payoff<input type="number" value={mort} onChange={e => setMort(+e.target.value)} /></label><label>Commission %<input type="number" value={comm} onChange={e => setComm(+e.target.value)} /></label><label>Closing Costs<input type="number" value={cost} onChange={e => setCost(+e.target.value)} /></label></div><div className="net-result">Estimated Seller Net <strong>{money(net)}</strong></div></section></div> }
function ExportLike({ title, items }) { return <div className="dash-page"><section className="panel-card"><p className="eyebrow">Export Center</p><h1>{title}</h1><p className="muted max">PDF export preview is structured. Branded PDF generation can be upgraded after backend setup.</p><div className="check-list">{items.map(i => <label key={i}><input type="checkbox" defaultChecked /> {i}</label>)}</div><button className="btn gold">Generate Preview Export</button></section></div> }
function Photos({ persona }) { return <div className="dash-page"><section className="panel-card"><p className="eyebrow">Photos & Exhibits</p><h1>{persona === 'appraiser' ? 'Subject and Comp Exhibits' : 'Listing Photo Organizer'}</h1><p className="muted max">Drag/drop photo management. Supabase Storage will store images securely by project.</p><div className="photo-grid">{['Subject Front', 'Kitchen', 'Comparable 1', 'Map Exhibit'].map(x => <div className="photo-tile" key={x}><span>◉</span><b>{x}</b></div>)}</div></section></div> }
function Assistant({ persona }) { const prompts = persona === 'appraiser' ? ['Draft market conditions narrative', 'Summarize concession evidence', 'Identify outlier comps', 'Explain reconciliation support'] : ['Create seller talking points', 'Explain pricing strategy', 'Summarize active competition', 'Write listing presentation intro']; const [output, setOutput] = useState(''); function runPrompt(p) { const t = persona === 'appraiser' ? `${p}: Based on the imported market evidence, ValoraIQ would draft editable professional language, identify the relevant support, and flag items requiring human review. This is workflow assistance only and not an automated appraisal conclusion.` : `${p}: ValoraIQ would convert the selected comps, pricing snapshot, and market activity into client-friendly talking points for a seller presentation. The agent remains responsible for final pricing advice.`; setOutput(t); } return <div className="dash-page"><section className="panel-card"><p className="eyebrow">AI Workflow Assistant</p><h1>{persona === 'appraiser' ? 'Narrative and evidence support' : 'Seller conversation support'}</h1><p className="muted max">Workflow assistance, not automated valuation or appraisal replacement.</p><div className="prompt-grid">{prompts.map(p => <button key={p} onClick={() => runPrompt(p)}>{p}</button>)}</div><textarea className="big-text" value={output} onChange={e => setOutput(e.target.value)} placeholder="Select a prompt above or type your own question…" /></section></div> }
function Panel({ title, eyebrow, copy }) { return <div className="dash-page"><section className="panel-card"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted max">{copy}</p></section></div> }

// ── Line chart CSS ────────────────────────────────────────────────────────────
// (injected inline to avoid needing extra CSS edits)
const chartStyle = `.line-chart{height:160px;display:flex;align-items:end;gap:4px;margin:1rem 0}.line-chart i{flex:1;border-radius:6px 6px 0 0;background:linear-gradient(var(--cyan),rgba(77,225,255,.05));min-height:8px;cursor:pointer;transition:opacity .2s}.line-chart i:hover{opacity:.75}.market-line-wrap{width:100%;overflow-x:auto;margin:1rem 0}.market-line-svg{width:100%;min-width:520px;height:260px}.market-line-svg line{stroke:rgba(255,255,255,.18);stroke-width:1}.market-line-svg path{fill:none;stroke:var(--cyan);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.market-line-svg circle{fill:var(--gold);stroke:var(--navy);stroke-width:2}.market-line-svg text{fill:var(--muted);font-size:10px}

.upload-box.locked{cursor:default;opacity:.8;border-style:dashed;border-color:rgba(214,176,74,.3);background:rgba(214,176,74,.04);pointer-events:none}
.upload-box.locked strong{color:var(--muted)}
.upload-box.locked a{color:var(--gold);text-decoration:underline;pointer-events:all}
.empty-state{padding:2rem;text-align:center}
.empty-state p{margin:.5rem 0}`;
  
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
  if (path === '/login') return session ? <DashboardShell persona="appraiser" session={session} /> : <Auth type="login" />;
  if (path === '/signup') return session ? <DashboardShell persona="appraiser" session={session} /> : <Auth type="signup" />;
  if (path.startsWith('/appraiser')) return session ? <DashboardShell persona="appraiser" session={session} /> : <Auth type="login" />;
  if (path.startsWith('/agent')) return session ? <DashboardShell persona="agent" session={session} /> : <Auth type="login" />;
  return <Landing />;
  if (path.startsWith('/demo')) 
  {navigate('/signup');
   return null;
  }
  return <Landing />;
}

createRoot(document.getElementById('root')).render(<App />);

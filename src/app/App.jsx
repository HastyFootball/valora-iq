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
  const total = records.length;
  for (let i = 0; i < records.length; i++) {
    const s = records[i];
    if (s.lat && s.lon) {
      updated.push({ ...s, geocode_status: s.geocode_status || 'provided' });
      skipped++;
      onProgress?.({ current: i + 1, total, attempted, geocoded, skipped, address: buildAddress(s), message: 'Coordinates already provided.' });
      continue;
    }
    const addr = buildAddress(s);
    if (!addr) {
      updated.push({ ...s, geocode_status: 'missing_address' });
      skipped++;
      onProgress?.({ current: i + 1, total, attempted, geocoded, skipped, address: 'Missing address', message: 'Skipped: missing address.' });
      continue;
    }
    attempted++;
    onProgress?.({ current: i + 1, total, attempted, geocoded, skipped, address: addr, message: `Geocoding ${i + 1} of ${total}` });
    try {
      const res = await geocodeAddress(addr);
      if (res?.lat && res?.lon) { updated.push({ ...s, ...res }); geocoded++; }
      else updated.push({ ...s, geocode_status: 'not_found' });
    } catch {
      updated.push({ ...s, geocode_status: 'failed' });
    }
    onProgress?.({ current: i + 1, total, attempted, geocoded, skipped, address: addr, message: `Completed ${i + 1} of ${total}` });
    await new Promise(r => setTimeout(r, 650));
  }
  return { records: updated, attempted, geocoded, skipped };
}

// ── Market series ────────────────────────────────────────────────────────────
function periodKey(date, quarter = false) { const d = new Date(date); if (isNaN(d)) return null; if (quarter) return `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function periodIndex(key) { if (key.includes('Q')) { const [y, q] = key.split(' Q').map(Number); return y * 12 + (q - 1) * 3; } const [y, m] = key.split('-').map(Number); return y * 12 + m - 1; }
function marketSeries(sales, minSales, mode) { const quarter = mode === 'quarterly'; const groups = {}; sales.forEach(s => { const marketDate = s.contract_date || s.pending_date || s.sale_date; const k = periodKey(marketDate, quarter); if (!k || !s.sale_price_n) return; (groups[k] ?? (groups[k] = [])).push(s.sale_price_n); }); let pts = Object.keys(groups).sort((a, b) => periodIndex(a) - periodIndex(b)).map(k => ({ key: k, x: periodIndex(k), y: median(groups[k]), n: groups[k].length })).filter(p => p.n >= minSales); if (pts.length < 2) pts = Object.keys(groups).sort((a, b) => periodIndex(a) - periodIndex(b)).map(k => ({ key: k, x: periodIndex(k), y: median(groups[k]), n: groups[k].length })); if (mode === 'rolling3' && !quarter) { pts = pts.map(p => { const neighbors = pts.filter(q => Math.abs(q.x - p.x) <= 1); const pool = neighbors.flatMap(q => Array(q.n).fill(q.y)); return { ...p, yMod: median(pool.length ? pool : [p.y]) }; }); } else if (mode === 'weighted' && pts.length > 1) { const x0 = pts[0].x, sw = pts.reduce((a, p) => a + p.n, 0), sx = pts.reduce((a, p) => a + (p.x - x0) * p.n, 0), sy = pts.reduce((a, p) => a + p.y * p.n, 0), sxy = pts.reduce((a, p) => a + (p.x - x0) * p.y * p.n, 0), sx2 = pts.reduce((a, p) => a + (p.x - x0) ** 2 * p.n, 0); const dn = sw * sx2 - sx * sx; const b = dn ? (sw * sxy - sx * sy) / dn : 0; const a = sw ? (sy - b * sx) / sw : 0; pts = pts.map(p => ({ ...p, yMod: a + b * (p.x - x0) })); } else pts = pts.map(p => ({ ...p, yMod: p.y })); const first = pts[0], last = pts[pts.length - 1]; const months = first && last ? Math.max(1, last.x - first.x) : 1; const monthly = first && last && first.yMod ? ((last.yMod - first.yMod) / first.yMod * 100) / months : 0; return { points: pts, monthly, max: Math.max(1, ...pts.map(p => p.yMod)) }; }


// ── Workfile analytics helpers ──────────────────────────────────────────────
function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function clampNum(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }
function roundTo(n, step = 1000) { return isFinite(n) ? Math.round(n / step) * step : 0; }
function safeVals(arr) { return (arr || []).filter(v => isFinite(v) && !isNaN(v)); }
function meanVal(arr) { const vals = safeVals(arr); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN; }
function stdevVal(arr) { const vals = safeVals(arr); if (vals.length < 2) return 0; const m = meanVal(vals); return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1)); }
function quantileVal(arr, q) { const vals = safeVals(arr).sort((a, b) => a - b); if (!vals.length) return NaN; const pos = (vals.length - 1) * q; const base = Math.floor(pos); const rest = pos - base; return vals[base + 1] !== undefined ? vals[base] + rest * (vals[base + 1] - vals[base]) : vals[base]; }

const SQFT_PER_ACRE = 43560;
function parseSiteArea(value, unitHint = '') {
  if (value === null || value === undefined || value === '') return NaN;
  const raw = String(value).trim();
  const hint = String(unitHint || '').toLowerCase();
  const n = toNum(raw);
  if (!isFinite(n)) return NaN;
  const rawLower = raw.toLowerCase();
  const saysAcres = /\b(ac|acre|acres|acreage)\b/.test(rawLower) || /\b(ac|acre|acres|acreage)\b/.test(hint);
  const saysSqft = /\b(sf|sq\.?\s*ft|sqft|square\s*feet|square\s*foot|lot\s*sf|site\s*sf)\b/.test(rawLower) || /\b(sf|sq\.?\s*ft|sqft|square\s*feet|square\s*foot|lot\s*sf|site\s*sf)\b/.test(hint);
  if (saysAcres && !saysSqft) return n * SQFT_PER_ACRE;
  // MLS exports commonly store site size as acres. If no SF language exists, small land values are presumed acres.
  // This catches values like 0.18, 0.25, 1.00, 5, 12.4, etc. while preserving obvious SF values like 10890.
  if (!saysSqft && n > 0 && n < 100) return n * SQFT_PER_ACRE;
  return n;
}
function siteDisplay(sf) {
  const n = Number(sf);
  if (!isFinite(n) || n <= 0) return '—';
  return n >= SQFT_PER_ACRE ? `${fmt(n / SQFT_PER_ACRE, 2)} ac (${fmt(n)} sf)` : `${fmt(n)} sf`;
}
function medianAbsDeviation(vals) {
  const clean = safeVals(vals);
  if (!clean.length) return 0;
  const m = median(clean);
  return median(clean.map(v => Math.abs(v - m)));
}
function theilSenFeatureRate(sales, featureKey) {
  const pts = (sales || []).map(s => ({ x: featureValue(s, featureKey), y: s.sale_price_n })).filter(p => isFinite(p.x) && isFinite(p.y) && p.y > 0);
  if (pts.length < 5) return { n: pts.length, rate: NaN, intercept: NaN, r2: 0 };
  const slopes = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - pts[i].x;
      if (dx !== 0) slopes.push((pts[j].y - pts[i].y) / dx);
    }
  }
  if (!slopes.length) return { n: pts.length, rate: NaN, intercept: NaN, r2: 0 };
  const rate = median(slopes);
  const intercept = median(pts.map(p => p.y - rate * p.x));
  const yMean = meanVal(pts.map(p => p.y));
  const ssTot = pts.reduce((a, p) => a + (p.y - yMean) ** 2, 0);
  const ssRes = pts.reduce((a, p) => a + (p.y - (intercept + rate * p.x)) ** 2, 0);
  return { n: pts.length, rate, intercept, r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0 };
}
function robustGridSearchFeatureRate(sales, featureKey, mode = 'lad', tau = 0.5) {
  const pts = (sales || []).map(s => ({ x: featureValue(s, featureKey), y: s.sale_price_n })).filter(p => isFinite(p.x) && isFinite(p.y) && p.y > 0);
  if (pts.length < 6) return { n: pts.length, rate: NaN, intercept: NaN, loss: NaN };
  const ols = regressionFeatureRate(sales, featureKey);
  const ts = theilSenFeatureRate(sales, featureKey);
  const candidateCenter = isFinite(ts.rate) ? ts.rate : ols.rate;
  if (!isFinite(candidateCenter)) return { n: pts.length, rate: NaN, intercept: NaN, loss: NaN };
  const xVals = pts.map(p => p.x), yVals = pts.map(p => p.y);
  const xSpread = Math.max(1, quantileVal(xVals, 0.85) - quantileVal(xVals, 0.15));
  const ySpread = Math.max(1, quantileVal(yVals, 0.85) - quantileVal(yVals, 0.15));
  const rateSpread = Math.max(Math.abs(candidateCenter) * 1.2, ySpread / xSpread * 2);
  const candidates = [];
  for (let i = -18; i <= 18; i++) candidates.push(candidateCenter + (i / 18) * rateSpread);
  let best = { rate: NaN, intercept: NaN, loss: Infinity };
  candidates.forEach(rate => {
    const residualIntercepts = pts.map(p => p.y - rate * p.x);
    const intercept = mode === 'quantile' ? quantileVal(residualIntercepts, tau) : median(residualIntercepts);
    const loss = pts.reduce((a, p) => {
      const e = p.y - (intercept + rate * p.x);
      if (mode === 'quantile') return a + (e >= 0 ? tau * e : (tau - 1) * e);
      return a + Math.abs(e);
    }, 0);
    if (loss < best.loss) best = { rate, intercept, loss };
  });
  return { n: pts.length, rate: best.rate, intercept: best.intercept, loss: best.loss };
}
function ladFeatureRate(sales, featureKey) { return robustGridSearchFeatureRate(sales, featureKey, 'lad', 0.5); }
function quantileRegressionFeatureRate(sales, featureKey, tau = 0.5) { return robustGridSearchFeatureRate(sales, featureKey, 'quantile', tau); }
function iqrFilterByPrice(sales) { const prices = sales.map(s => s.sale_price_n).filter(v => isFinite(v) && v > 0); if (prices.length < 6) return sales; const q1 = quantileVal(prices, 0.25), q3 = quantileVal(prices, 0.75), iqr = q3 - q1; return sales.filter(s => !s.sale_price_n || (s.sale_price_n >= q1 - 1.5 * iqr && s.sale_price_n <= q3 + 1.5 * iqr)); }
function featureValue(record, key) {
  if (!record) return null;
  if (key === 'gla') return Number(record.gla_n ?? record.gla);
  if (key === 'site') return parseSiteArea(record.site_sf_n ?? record.site, record.site_unit || record.siteUnit || 'sf');
  if (key === 'garage') { const raw = String(record.garage || '').toLowerCase(); const m = raw.match(/(\d+(\.\d+)?)/); if (m) return Number(m[1]); if (raw.includes('none') || raw === 'no') return 0; return raw ? 1 : null; }
  if (key === 'bath') return Number(record.baths ?? record.bath ?? record.full_baths ?? record.fullBaths);
  if (key === 'bed') return Number(record.beds ?? record.bedrooms ?? record.bed);
  if (key === 'age') { const y = Number(record.year_built_n ?? record.year); return y ? new Date().getFullYear() - y : null; }
  if (key === 'condition') return ratingNum(record.condition ?? record.cond);
  if (key === 'quality') return ratingNum(record.quality ?? record.qual);
  return null;
}
function pairedFeatureRates(sales, featureKey) {
  const filtered = iqrFilterByPrice((sales || []).filter(s => s.sale_price_n > 0));
  const pairs = [];
  for (let i = 0; i < filtered.length; i++) for (let j = i + 1; j < filtered.length; j++) {
    const a = filtered[i], b = filtered[j]; const av = featureValue(a, featureKey), bv = featureValue(b, featureKey);
    if (!isFinite(av) || !isFinite(bv) || av === bv) continue;
    const glaClose = a.gla_n && b.gla_n ? Math.abs(a.gla_n - b.gla_n) / Math.max(a.gla_n, b.gla_n) <= 0.18 : true;
    const ageClose = a.year_built_n && b.year_built_n ? Math.abs(a.year_built_n - b.year_built_n) <= 12 : true;
    const qcClose = Math.abs((ratingNum(a.quality) || 0) - (ratingNum(b.quality) || 0)) <= 1 && Math.abs((ratingNum(a.condition) || 0) - (ratingNum(b.condition) || 0)) <= 1;
    if (!glaClose || !ageClose || !qcClose) continue;
    const rate = (a.sale_price_n - b.sale_price_n) / (av - bv); if (isFinite(rate)) pairs.push({ rate, a, b });
  }
  const rates = pairs.map(p => p.rate).filter(v => isFinite(v));
  return rates.length ? { n: rates.length, median: median(rates), low: quantileVal(rates, 0.25), high: quantileVal(rates, 0.75), pairs: pairs.slice(0, 12) } : { n: 0, median: NaN, low: NaN, high: NaN, pairs: [] };
}
function groupedFeatureRate(sales, featureKey) {
  const buckets = {};
  (sales || []).forEach(s => { const v = featureValue(s, featureKey); if (!isFinite(v) || !s.sale_price_n) return; const k = String(v); (buckets[k] ?? (buckets[k] = [])).push(s.sale_price_n); });
  const groups = Object.keys(buckets).map(k => ({ x: Number(k), n: buckets[k].length, med: median(buckets[k]) })).filter(g => isFinite(g.x) && g.n >= 2).sort((a, b) => a.x - b.x);
  if (groups.length < 2) return { n: groups.reduce((a, g) => a + g.n, 0), rate: NaN, groups };
  const rates = [];
  for (let i = 0; i < groups.length - 1; i++) if (groups[i].x !== groups[i + 1].x) rates.push((groups[i + 1].med - groups[i].med) / (groups[i + 1].x - groups[i].x));
  return { n: groups.reduce((a, g) => a + g.n, 0), rate: median(rates), groups };
}
function regressionFeatureRate(sales, featureKey) { const pairs = (sales || []).map(s => ({ x: featureValue(s, featureKey), y: s.sale_price_n })).filter(p => isFinite(p.x) && isFinite(p.y) && p.y > 0); if (pairs.length < 4) return { n: pairs.length, rate: NaN, r2: 0 }; const r = linReg(pairs); return { n: pairs.length, rate: r.b, r2: r.r2 || 0 }; }
function sensitivityFeatureRate(sales, featureKey) { const rates = []; const base = (sales || []).filter(s => s.sale_price_n > 0); for (let i = 0; i < base.length; i++) { const r = regressionFeatureRate(base.filter((_, idx) => idx !== i), featureKey); if (isFinite(r.rate)) rates.push(r.rate); } return rates.length ? { n: rates.length, rate: median(rates), low: quantileVal(rates, 0.20), high: quantileVal(rates, 0.80) } : { n: 0, rate: NaN, low: NaN, high: NaN }; }
function robustRegressionBundle(sales, featureKey) {
  const linear = regressionFeatureRate(sales, featureKey);
  const theil = theilSenFeatureRate(sales, featureKey);
  const lad = ladFeatureRate(sales, featureKey);
  const quant = quantileRegressionFeatureRate(sales, featureKey, 0.5);
  return { linear, theil, lad, quant };
}
function buildAdjustmentSupportCards({ subject, sales, adjRows, glaNarData }) {
  const selectedAddresses = new Set((adjRows || []).map(r => String(r.address || '').toLowerCase()));
  const workSales = selectedAddresses.size ? sales.filter(s => selectedAddresses.has(String(s.address || '').toLowerCase())) : sales;
  const fallbackSales = workSales.length >= 4 ? workSales : sales;
  const specs = [
    { key: 'gla', title: 'GLA', unit: ' / SqFt', fallback: Number(glaNarData?.rate) || 0, round: 1, format: v => `$${fmt(v, 2)} / SqFt` },
    { key: 'site', title: 'Lot Size', unit: ' / SqFt', fallback: 0, round: 0.05, format: v => `$${fmt(v, 2)} / SqFt` },
    { key: 'garage', title: 'Garage Spaces', unit: ' / Space', fallback: 0, round: 1000, format: v => money(v) },
    { key: 'bath', title: 'Bath Adjustment', unit: ' / Bath', fallback: 0, round: 1000, format: v => money(v) },
    { key: 'bed', title: 'Bedroom Adjustment', unit: ' / Bedroom', fallback: 0, round: 1000, format: v => money(v) },
    { key: 'condition', title: 'Condition Rating', unit: ' / Rating Step', fallback: 0, round: 1000, format: v => money(v) },
    { key: 'quality', title: 'Quality Rating', unit: ' / Rating Step', fallback: 0, round: 1000, format: v => money(v) }
  ];
  return specs.map(spec => {
    const paired = pairedFeatureRates(fallbackSales, spec.key), grouped = groupedFeatureRate(fallbackSales, spec.key), robust = robustRegressionBundle(fallbackSales, spec.key), reg = robust.linear, theil = robust.theil, lad = robust.lad, quantReg = robust.quant, sens = sensitivityFeatureRate(fallbackSales, spec.key);
    const priorGlaStudy = spec.key === 'gla' && Number(glaNarData?.rate) > 0 && String(glaNarData?.method || '').trim();
    const methodSignals = [];
    if (paired.n >= 2 && isFinite(paired.median)) methodSignals.push({ name: `Paired sales (${paired.n} pairings)`, value: paired.median, weight: paired.n >= 4 ? 1.2 : 1 });
    if (grouped.groups?.length >= 2 && isFinite(grouped.rate)) methodSignals.push({ name: `Grouped data (${grouped.groups.length} groups)`, value: grouped.rate, weight: 1 });
    if (reg.n >= 4 && isFinite(reg.rate) && (reg.r2 || 0) >= 0.10) methodSignals.push({ name: `Linear regression (${reg.n} sales, R² ${fmt(reg.r2, 2)})`, value: reg.rate, weight: (reg.r2 || 0) >= 0.35 ? 1.2 : 0.8 });
    if (theil.n >= 5 && isFinite(theil.rate)) methodSignals.push({ name: `Theil-Sen robust regression (${theil.n} sales, R² ${fmt(theil.r2, 2)})`, value: theil.rate, weight: 1 });
    if (lad.n >= 6 && isFinite(lad.rate)) methodSignals.push({ name: `LAD regression (${lad.n} sales)`, value: lad.rate, weight: 0.9 });
    if (quantReg.n >= 6 && isFinite(quantReg.rate)) methodSignals.push({ name: `Quantile regression (${quantReg.n} sales)`, value: quantReg.rate, weight: 0.9 });
    if (sens.n >= 4 && isFinite(sens.rate)) methodSignals.push({ name: `Sensitivity analysis (${sens.n} iterations)`, value: sens.rate, weight: 0.8 });
    if (priorGlaStudy) methodSignals.push({ name: `Prior GLA study (${String(glaNarData.method).trim()})`, value: Number(glaNarData.rate), weight: 1 });

    const raw = methodSignals.map(m => m.value).filter(v => isFinite(v) && Math.abs(v) > 0);
    const absVals = raw.map(v => Math.abs(v));
    const supportCount = methodSignals.length;
    const conclusionRaw = absVals.length ? median(absVals) : NaN;
    const conclusion = isFinite(conclusionRaw) ? (spec.round < 1 ? Math.round(conclusionRaw / spec.round) * spec.round : roundTo(conclusionRaw, spec.round)) : null;
    const lowRaw = absVals.length ? quantileVal(absVals, 0.20) : NaN, highRaw = absVals.length ? quantileVal(absVals, 0.80) : NaN;
    const spread = conclusion ? Math.abs(highRaw - lowRaw) / Math.max(1, conclusion) : 9;
    const consistencyBonus = spread < 0.45 ? 20 : spread < 0.80 ? 10 : 0;
    const r2Bonus = Math.min(22, (Math.max(reg.r2 || 0, theil.r2 || 0)) * 40);
    const confidenceScore = absVals.length ? clampNum((supportCount * 16) + r2Bonus + consistencyBonus + (absVals.length >= 4 ? 10 : 0), 5, 96) : 0;
    const hasSupportedValue = !!(conclusion && supportCount >= 2 && absVals.length >= 2 && confidenceScore >= 45);
    const hasDirectionalSupport = !!(!hasSupportedValue && conclusion && supportCount >= 1 && absVals.length >= 1);
    const unsupported = !hasSupportedValue && !hasDirectionalSupport;
    const confidence = hasSupportedValue
      ? (confidenceScore >= 75 ? 'Strong' : 'Moderate')
      : hasDirectionalSupport
        ? 'Directional Only'
        : 'Unsupported';
    const low = isFinite(lowRaw) ? (spec.round < 1 ? Math.round(lowRaw / spec.round) * spec.round : roundTo(lowRaw, spec.round)) : null;
    const high = isFinite(highRaw) ? (spec.round < 1 ? Math.round(highRaw / spec.round) * spec.round : roundTo(highRaw, spec.round)) : null;
    const methods = methodSignals.map(m => m.name);
    const supportFailureReasons = [];
    if (!raw.length) supportFailureReasons.push('No usable market-derived indication was isolated.');
    if (supportCount < 2) supportFailureReasons.push('Fewer than two independent support methods were available.');
    if (absVals.length < 2) supportFailureReasons.push('Insufficient cross-checking observations.');
    if (spread >= 0.80 && absVals.length >= 2) supportFailureReasons.push('Indications were too dispersed for a reliable point estimate.');
    if (confidenceScore < 45 && absVals.length) supportFailureReasons.push('Support score did not meet the threshold for a dollar conclusion.');
    const displayValue = hasSupportedValue ? spec.format(conclusion) : hasDirectionalSupport ? 'Directional Only' : 'N/A';
    const displayRange = hasSupportedValue && low !== null && high !== null ? `${spec.format(low)} to ${spec.format(high)}` : 'N/A';
    const narrative = hasSupportedValue
      ? `${spec.title} support indicates a reconciled adjustment of ${spec.format(conclusion)}. The indicated support range is approximately ${displayRange}. This conclusion is based on ${methods.join(', ').toLowerCase()} and should be reconciled with appraiser judgment, property-specific comparability, and verification from source data.`
      : hasDirectionalSupport
        ? `${spec.title} produced directional market support, but the available evidence did not meet the reliability threshold for a dollar adjustment conclusion. Reasons: ${supportFailureReasons.join(' ') || 'limited market support.'}`
        : `${spec.title} is shown as N/A because the imported data did not provide sufficient market support for a credible adjustment conclusion. Reasons: ${supportFailureReasons.join(' ') || 'no isolated market reaction was identified.'}`;
    return { ...spec, conclusion, low, high, confidence, confidenceScore: Math.round(confidenceScore), hasSupportedValue, hasDirectionalSupport, unsupported, displayValue, displayRange, methods, supportFailureReasons, paired, grouped, reg, theil, lad, quantReg, sens, narrative };
  });
}
function buildMarketWorkfileSupport(sales, mtNarData) {
  const valid = (sales || []).filter(s => s.sale_price_n > 0 && (s.contract_date || s.sale_date));
  const series = marketSeries(valid, 1, 'rolling3');
  const monthly = Number(mtNarData?.monthly) || series.monthly || 0;
  const doms = valid.map(s => s.dom).filter(v => isFinite(v) && v >= 0), prices = valid.map(s => s.sale_price_n).filter(v => isFinite(v) && v > 0);
  const medDom = doms.length ? Math.round(median(doms)) : null, medPrice = prices.length ? Math.round(median(prices)) : null;
  const priceMin = prices.length ? Math.min(...prices) : null, priceMax = prices.length ? Math.max(...prices) : null;
  const annual = monthly * 12, dir = Math.abs(monthly) < 0.25 ? 'relatively stable' : monthly > 0 ? 'increasing' : 'declining';
  const volatility = prices.length > 2 && medPrice ? stdevVal(prices) / medPrice : 0;
  const velocityScore = clampNum(70 + (monthly * 5) - ((medDom || 45) - 45) * 0.45 - volatility * 40, 5, 96);
  const velocityLabel = velocityScore >= 75 ? 'Highly Competitive' : velocityScore >= 55 ? 'Balanced / Competitive' : velocityScore >= 35 ? 'Softening' : 'Limited Demand Signal';
  return { valid, series, monthly, annual, dir, medDom, medPrice, priceMin, priceMax, velocityScore: Math.round(velocityScore), velocityLabel, narrative: `Market conditions analysis was performed using ${valid.length} imported sale record(s), with emphasis on contract date when available and sale date when contract date was not available. The indicated trend is ${dir}, with an estimated monthly rate of ${fmtPct(monthly, 3)} (${fmtPct(annual, 2)} annualized). Median sale price within the analyzed data is ${money(medPrice)}, with a price range from ${money(priceMin)} to ${money(priceMax)}. ${medDom !== null ? `Median days on market is ${medDom} days. ` : ''}The analysis supports appraiser review of whether a market conditions adjustment is warranted.` };
}
function sparklineSvg(points, width = 640, height = 170) {
  const pts = (points || []).filter(p => isFinite(p.yMod || p.y));
  if (pts.length < 2) return '<div class="empty-chart">Insufficient trend data</div>';
  const pad = 24, vals = pts.map(p => p.yMod || p.y), min = Math.min(...vals), max = Math.max(...vals), range = Math.max(1, max - min);
  const d = pts.map((p, i) => { const x = pad + (i / Math.max(1, pts.length - 1)) * (width - pad * 2); const y = height - pad - (((p.yMod || p.y) - min) / range) * (height - pad * 2); return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
  const dots = pts.map((p, i) => { const x = pad + (i / Math.max(1, pts.length - 1)) * (width - pad * 2); const y = height - pad - (((p.yMod || p.y) - min) / range) * (height - pad * 2); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${escHtml(p.key)}: ${money(p.yMod || p.y)}</title></circle>`; }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="wf-chart" role="img" aria-label="Market trend chart"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}"/><path d="${d}"/>${dots}</svg>`;
}
function supportCardHtml(card) {
  const methodHtml = card.methods.length ? card.methods.map(m => `<li>${escHtml(m)}</li>`).join('') : '<li>No reliable support method met threshold.</li>';
  const reasonsHtml = !card.hasSupportedValue && card.supportFailureReasons?.length ? `<h4>Why no dollar conclusion?</h4><ul>${card.supportFailureReasons.map(r => `<li>${escHtml(r)}</li>`).join('')}</ul>` : '';
  const ticks = [0, 25, 50, 75, 100].map(x => `<i style="left:${x}%"></i>`).join('');
  return `<article class="support-card ${card.hasSupportedValue ? 'supported' : card.hasDirectionalSupport ? 'directional' : 'unsupported'}"><header><span>${escHtml(card.title)}</span><strong>${escHtml(card.displayValue)}</strong></header><div class="range-row"><b>Support Range: ${escHtml(card.displayRange)}</b><b>${card.confidenceScore}/100</b></div><div class="dot-range">${ticks}<em style="left:${clampNum(card.confidenceScore, 2, 98)}%"></em></div><div class="confidence"><b>${escHtml(card.confidence)}</b><span>${card.hasSupportedValue ? 'Dollar conclusion supported' : 'No dollar conclusion shown'}</span></div><h4>Calculated Support Methods</h4><ul>${methodHtml}</ul>${reasonsHtml}<p>${escHtml(card.narrative)}</p></article>`;
}
function buildWorkfileHtml({ subject, sales, adjRows, sections, supportCards, marketSupport }) {
  const vals = (adjRows || []).map(r => r.adjusted).filter(v => v > 0), adjLow = vals.length ? Math.min(...vals) : null, adjHigh = vals.length ? Math.max(...vals) : null, adjMed = vals.length ? Math.round(median(vals)) : null;
  const generatedAt = new Date().toLocaleString();
  const subjectHtml = sections.subject ? `<section><h2>Subject Property Summary</h2><div class="grid-4"><div><span>Address</span><b>${escHtml(subject.address || '—')}</b></div><div><span>City</span><b>${escHtml(subject.city || '—')}</b></div><div><span>Effective Date</span><b>${escHtml(subject.effdate || '—')}</b></div><div><span>Opinion / Target</span><b>${money(subject.value)}</b></div><div><span>GLA</span><b>${fmt(subject.gla)} SF</b></div><div><span>Site</span><b>${siteDisplay(subject.site)}</b></div><div><span>Year Built</span><b>${escHtml(subject.year || '—')}</b></div><div><span>Q/C</span><b>${escHtml(subject.qual || '—')} / ${escHtml(subject.cond || '—')}</b></div></div></section>` : '';
  const marketHtml = sections.market ? `<section><h2>Market Conditions Support</h2><div class="grid-4"><div><span>Sales Analyzed</span><b>${marketSupport.valid.length}</b></div><div><span>Monthly Trend</span><b>${fmtPct(marketSupport.monthly, 3)}</b></div><div><span>Annualized</span><b>${fmtPct(marketSupport.annual, 2)}</b></div><div><span>Market Velocity</span><b>${marketSupport.velocityScore}/100</b></div></div>${sparklineSvg(marketSupport.series.points)}<p class="narrative">${escHtml(marketSupport.narrative)}</p></section>` : '';
  const supportHtml = sections.support ? `<section class="page-break"><h2>Sales Comparison Adjustment Support</h2><p class="narrative">The following support cards summarize market-derived indications for common adjustment categories. These exhibits are intended for workfile support and appraiser reconciliation, not as a substitute for professional judgment.</p><div class="support-grid">${supportCards.map(supportCardHtml).join('')}</div></section>` : '';
  const gridRows = (adjRows || []).map(r => `<tr><td>${r.rank || ''}</td><td>${escHtml(r.address || '')}</td><td>${money(r.price)}</td><td>${escHtml(r.date || '')}</td><td>${fmtD(r.timeAdj)}</td><td>${fmtD(r.glaAdj)}</td><td>${fmtD(r.siteAdj)}</td><td>${fmtD(r.condAdj)}</td><td>${fmtD(r.totalAdj)}</td><td>${money(r.adjusted)}</td></tr>`).join('');
  const gridHtml = sections.adjustments ? `<section class="page-break"><h2>Adjustment Grid and Reconciliation</h2><div class="grid-3"><div><span>Adjusted Low</span><b>${money(adjLow)}</b></div><div><span>Adjusted High</span><b>${money(adjHigh)}</b></div><div><span>Adjusted Median</span><b>${money(adjMed)}</b></div></div><table><thead><tr><th>Rank</th><th>Comparable</th><th>Sale Price</th><th>Date</th><th>Time</th><th>GLA</th><th>Site</th><th>Cond</th><th>Total Adj</th><th>Adjusted</th></tr></thead><tbody>${gridRows || '<tr><td colspan="10">No adjustment rows have been generated.</td></tr>'}</tbody></table><p class="narrative">Adjusted indicators were reviewed for reasonableness, bracketing, and consistency. The final value conclusion remains the responsibility of the appraiser.</p></section>` : '';
  const dataRows = (sales || []).slice(0, 80).map(s => `<tr><td>${escHtml(s.address || '')}</td><td>${escHtml(s.status || '')}</td><td>${money(s.sale_price_n)}</td><td>${escHtml(s.sale_date || '')}</td><td>${fmt(s.gla_n)}</td><td>${siteDisplay(s.site_sf_n)}</td><td>${escHtml(s.garage || '')}</td><td>${fmt(s.dom)}</td><td>${escHtml(s.quality || '')}/${escHtml(s.condition || '')}</td></tr>`).join('');
  const dataHtml = sections.data ? `<section class="page-break"><h2>Imported Sales Data Summary</h2><table><thead><tr><th>Address</th><th>Status</th><th>Price</th><th>Sale Date</th><th>GLA</th><th>Site</th><th>Garage</th><th>DOM</th><th>Q/C</th></tr></thead><tbody>${dataRows || '<tr><td colspan="9">No imported sales data.</td></tr>'}</tbody></table></section>` : '';
  const narrativeHtml = sections.narrative ? `<section><h2>Workfile Narrative Summary</h2><p class="narrative">The appraiser analyzed the imported competitive market data for market conditions, property characteristics, comparable selection, and sales comparison adjustment support. Market-derived tools were used to identify patterns and support professional judgment. The analysis is retained in the workfile for reference, review, and future revision.</p><p class="disclaimer">Professional Use Notice: ValoraIQ provides analytical support, summaries, and workfile exhibits. The appraiser is responsible for verification of source data, selection of comparable sales, reconciliation of adjustments, compliance with assignment conditions, and final appraisal conclusions.</p></section>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><title>ValoraIQ Appraiser Workfile</title><style>@page{size:letter;margin:0.45in}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:12px;line-height:1.45;background:#fff}h1{font-family:Georgia,serif;color:#11213f;font-size:27px;margin:0 0 4px}h2{font-family:Georgia,serif;color:#11213f;font-size:18px;border-bottom:3px solid #c9a23c;padding-bottom:6px;margin:24px 0 12px}h3,h4{margin:8px 0;color:#11213f}.cover{border:2px solid #11213f;padding:18px;margin-bottom:18px;background:linear-gradient(135deg,#f7f9fc,#fff7df)}.meta{color:#555}.brand{color:#c9a23c;font-weight:bold;letter-spacing:.08em;text-transform:uppercase}.grid-3,.grid-4{display:grid;gap:8px;margin:10px 0}.grid-3{grid-template-columns:repeat(3,1fr)}.grid-4{grid-template-columns:repeat(4,1fr)}.grid-3 div,.grid-4 div{border:1px solid #d9dee8;background:#f8fafc;padding:9px;border-radius:6px}.grid-3 span,.grid-4 span{display:block;color:#667085;font-size:10px;text-transform:uppercase;font-weight:bold}.grid-3 b,.grid-4 b{display:block;color:#111827;font-size:14px;margin-top:2px}table{width:100%;border-collapse:collapse;margin:10px 0 16px;page-break-inside:auto}tr{page-break-inside:avoid}th{background:#11213f;color:white;text-align:left;padding:6px;font-size:9px;text-transform:uppercase}td{border-bottom:1px solid #e5e7eb;padding:6px;vertical-align:top}.narrative{font-size:12px;color:#222;background:#fbfcff;border-left:4px solid #c9a23c;padding:10px;margin:10px 0}.disclaimer{border:1px solid #e3c56f;background:#fff8e6;padding:10px;margin-top:14px}.page-break{break-before:page;page-break-before:always}.support-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.support-card{border:2px solid #0f5d93;border-radius:2px;overflow:hidden;page-break-inside:avoid;background:#fff}.support-card header{background:linear-gradient(#0f68a7,#073c70);color:#fff;text-align:center;padding:9px}.support-card header span{display:block;font-weight:bold}.support-card header strong{display:block;font-size:23px}.range-row{display:flex;justify-content:space-between;padding:6px 8px;font-size:11px}.dot-range{height:24px;margin:0 10px 6px;position:relative;border-top:3px solid #999}.dot-range i{position:absolute;top:-7px;width:2px;height:10px;background:#bbb}.dot-range em{position:absolute;top:-9px;width:14px;height:14px;background:#0f68a7;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #0f68a7}.confidence{display:flex;justify-content:space-between;background:#f1f7fb;border-top:1px solid #d7e7f3;border-bottom:1px solid #d7e7f3;padding:6px 8px}.confidence b{color:#0f5d93}.confidence span{color:#555}.support-card h4{font-size:11px;margin:8px 8px 4px}.support-card ul{margin:0 8px 8px 20px;padding:0}.support-card p{margin:8px;padding:8px;background:#f8fafc;border:1px solid #edf0f5}.wf-chart{width:100%;height:190px;border:1px solid #d9dee8;background:#f8fafc}.wf-chart line{stroke:#cbd5e1}.wf-chart path{fill:none;stroke:#0f68a7;stroke-width:4}.wf-chart circle{fill:#c9a23c;stroke:white;stroke-width:2}.empty-chart{border:1px solid #d9dee8;padding:30px;text-align:center;color:#667085;background:#f8fafc}</style></head><body><div class="cover"><div class="brand">ValoraIQ Appraiser Workfile</div><h1>${escHtml(subject.address || 'Appraisal Workfile Support')}</h1><div class="meta">${escHtml(subject.city || '')} · Effective Date: ${escHtml(subject.effdate || '—')} · Generated: ${escHtml(generatedAt)}</div><p class="disclaimer">This workfile exhibit is intended to support appraiser analysis. It should be retained with source MLS exports, verification notes, inspection notes, photographs, sketches, engagement documents, and any additional support required by the assignment.</p></div>${subjectHtml}${marketHtml}${supportHtml}${gridHtml}${dataHtml}${narrativeHtml}</body></html>`;
}

// ── CSV import ───────────────────────────────────────────────────────────────
const FIELD_ALIASES = { address: ['address', 'property address', 'street address', 'full address', 'street'], city: ['city', 'municipality', 'city state zip'], state: ['state'], zip: ['zip', 'zipcode', 'zip code', 'postal code'], status: ['status', 'mls status'], sale_price: ['sale price', 'close price', 'sold price', 'list price', 'price', 'sp', 'lp'], sale_date: ['sale date', 'close date', 'sold date', 'closing date'], contract_date: ['contract date', 'under contract date', 'pending date', 'contract signed date', 'ratified date'], gla: ['gla', 'living area', 'sqft', 'sf', 'sq ft', 'above grade'], site_sf: ['acres', 'acreage', 'lot acres', 'site acres', 'land acres', 'land area', 'lot size', 'site size', 'site area', 'lot sf', 'lot sqft'], year_built: ['year built', 'yr built', 'built', 'year constructed'], quality: ['quality', 'q rating', 'q'], condition: ['condition', 'c rating', 'c'], garage: ['garage', 'parking', 'garage spaces'], basement: ['basement', 'bsmt'], pool: ['pool'], dom: ['dom', 'days on market'], lat: ['lat', 'latitude'], lon: ['lon', 'lng', 'longitude'], list_price: ['list price', 'original list price', 'original price', 'lp', 'olp', 'asking price'], concessions: ['seller concessions', 'seller concession', 'concessions', 'seller paid costs', 'seller credit', 'concession amount'] };
const FIELD_LABELS = { address: 'Address', city: 'City', state: 'State', zip: 'ZIP', status: 'Status', sale_price: 'Sale Price', sale_date: 'Sale Date', contract_date: 'Contract Date', gla: 'GLA', site_sf: 'Site / Lot Size', year_built: 'Year Built', quality: 'Quality', condition: 'Condition', garage: 'Garage', basement: 'Basement', pool: 'Pool', dom: 'DOM', lat: 'Latitude', lon: 'Longitude', list_price: 'List Price', concessions: 'Concessions $' };
function parseCSVMatrix(text) { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < text.length; i++) { const c = text[i], n2 = text[i + 1]; if (c === '"' && q && n2 === '"') { cur += '"'; i++; } else if (c === '"') { q = !q; } else if (c === ',' && !q) { row.push(cur.trim()); cur = ''; } else if ((c === '\n' || c === '\r') && !q) { if (c === '\r' && n2 === '\n') i++; row.push(cur.trim()); if (row.some(Boolean)) rows.push(row); row = []; cur = ''; } else cur += c; } row.push(cur.trim()); if (row.some(Boolean)) rows.push(row); return { headers: rows[0] || [], rows: rows.slice(1) }; }
function autoMapHeaders(headers) { const map = {}; headers.forEach((h, i) => { const hl = h.toLowerCase().trim(); Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => { if (map[field] === undefined && aliases.some(a => hl === a || hl.includes(a) || a.includes(hl))) map[field] = String(i); }); }); return map; }
function rowsFromMapping(headers, rows, map) { return rows.map((cells, i) => { const get = f => map[f] !== undefined && map[f] !== '' ? cells[Number(map[f])] || '' : ''; return { _id: i, address: get('address'), city: get('city'), state: get('state'), zip: get('zip'), status: get('status') || 'Sold', sale_price_n: toNum(get('sale_price')), gla_n: toNum(get('gla')), site_sf_n: parseSiteArea(get('site_sf'), headers[Number(map.site_sf)] || ''), year_built_n: toNum(get('year_built')), sale_date: get('sale_date'), contract_date: get('contract_date'), quality: get('quality'), condition: get('condition'), garage: get('garage'), basement: get('basement'), pool: get('pool'), dom: toNum(get('dom')), list_price_n: toNum(get('list_price')), concessions_n: toNum(get('concessions')), lat: toNum(get('lat')) || null, lon: toNum(get('lon')) || null }; }).filter(r => r.address || r.sale_price_n || r.gla_n); }

// ── Navigation helpers ────────────────────────────────────────────────────────
const appraiserTabs = ['Dashboard', 'Projects', 'Walkthrough', 'Subject Property', 'MLS Import', 'Q/C Analyzer', 'Market Conditions', 'GLA Study', 'Comp Ranking', 'Site / Land Value', 'Adjustment Grid', 'Concessions', 'Reconciliation', 'Narrative', 'Export Workfile', 'Photos / Exhibits'];
const agentTabs = ['Dashboard', 'Projects', 'Walkthrough', 'Property Overview', 'MLS Import', 'Q/C Analyzer', 'Market Snapshot', 'GLA Study', 'Pricing Strategy', 'Comp Ranking', 'Adjustment Grid', 'Concessions', 'Seller Net Sheet', 'Listing Presentation', 'Photos', 'CMA Export'];
function slug(s) { return s.toLowerCase().replace(/\//g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, ''); }
function iconFor(t) { if (t.includes('Walkthrough')) return '?'; if (t.includes('Import')) return '⬆'; if (t.includes('Market') || t.includes('Snapshot')) return '↗'; if (t.includes('Export') || t.includes('Workfile')) return '⇩'; if (t.includes('Project')) return '▣'; if (t.includes('AI')) return '✦'; if (t.includes('Photo')) return '◉'; if (t.includes('Net')) return '$'; if (t.includes('Comp')) return '★'; if (t.includes('Q/C')) return '◆'; if (t.includes('Site')) return '◌'; if (t.includes('GLA')) return '⌖'; if (t.includes('Concession')) return '©'; if (t.includes('Reconcil')) return '⊞'; if (t.includes('Narrative')) return '✎'; if (t.includes('Pricing')) return '$'; return '⌂'; }

// ── Public pages ──────────────────────────────────────────────────────────────
function PublicNav() { return <header className="public-nav"><Link to="/" className="plain"><Logo /></Link><nav><a href="/#workflows">Workflows</a><a href="/#features">Features</a><a href="/#pricing">Pricing</a><Link to="/login">Log in</Link><Link className="btn small gold" to="/signup">Start free</Link></nav></header> }

function Landing() {
  return (
    <>
      <PublicNav />

      <main>
        {/* ── HERO ───────────────────────────────────── */}
        <section className="hero">
          <div className="hero-grid">
            <div>
              <p className="eyebrow">
                Professional Real Estate Analysis Workspace
              </p>

              <h1>
                Import MLS data. Analyze properties. Build cleaner workflows.
              </h1>

              <p className="hero-copy">
                ValoraIQ helps appraisers and agents turn raw MLS exports into
                organized market analysis, comparable rankings, adjustment
                support, and client-ready reports.
              </p>

              <div className="hero-actions">
                <Link className="btn gold" to="/signup">
                  Start building →
                </Link>

                <Link className="btn glass" to="/login">
                  Log in
                </Link>
              </div>
            </div>

            <div className="hero-preview">
              <div className="preview-header">
                <span />
                <span />
                <span />
              </div>

              <div className="preview-title">
                MLS Workflow Import
              </div>

              <div className="preview-card">
                <b>
                  Upload MLS exports and organize your analysis instantly
                </b>

                <span>
                  Automatically map fields, analyze comparables, track market
                  trends, and build appraisal or CMA workflows from one
                  workspace.
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── WORKFLOWS ─────────────────────────────── */}
        <section className="section" id="workflows">
          <p className="eyebrow center">
            Purpose-built workflows
          </p>

          <h2>
            Purpose-built workflows for appraisers and agents.
          </h2>

          <div className="workflow-cards">
            <article>
              <h3>Appraiser Workspace</h3>

              <p>
                Import MLS data, rank comparables, analyze market trends,
                build adjustment support, generate narratives, and organize
                complete appraisal workflows.
              </p>

              <Link to="/signup">
                Start appraiser workspace
              </Link>
            </article>

            <article>
              <h3>Agent/Broker Workspace</h3>

              <p>
                Create CMAs, analyze active and sold comparables, build
                pricing strategies, generate seller net sheets, and organize
                listing presentations.
              </p>

              <Link to="/signup">
                Start agent workspace
              </Link>
            </article>
          </div>
        </section>

        {/* ── BUILT FOR ─────────────────────────────── */}
        <section className="section">
          <p className="eyebrow center">
            Built For
          </p>

          <h2>
            Designed for real estate professionals.
          </h2>

          <div className="feature-grid">
            {[
              'Residential Appraisers',
              'Review Appraisers',
              'Real Estate Agents',
              'Broker Price Opinions',
              'CMA Preparation',
              'Market Analysis'
            ].map(t => (
              <div className="feature-card" key={t}>
                <div className="glyph">✦</div>
                <h3>{t}</h3>
              </div>
            ))}
          </div>
        </section>

        {/* ── FEATURES ──────────────────────────────── */}
        <section className="section" id="features">
          <p className="eyebrow center">
            Core platform
          </p>

          <h2>
            From raw MLS data to clear, client-ready outputs.
          </h2>

          <div className="feature-grid">
            {[
              'MLS Import',
              'Comparable Ranking',
              'Quality & Condition Analysis',
              'Market Trend Analysis',
              'GLA Analysis',
              'Project Save & Export'
            ].map(t => (
              <div className="feature-card" key={t}>
                <div className="glyph">✦</div>
                <h3>{t}</h3>

                <p>
                  Professional workflow support designed for real estate
                  analysis and reporting.
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── PRICING ───────────────────────────────── */}
        <section className="section pricing" id="pricing">
          <p className="eyebrow center">
            Pricing
          </p>

          <h2>
            Start free. Save projects to the cloud.
          </h2>

          <p className="muted max center-block">
            Create an account to save projects, organize workflows,
            generate reports, and access valuation tools from anywhere.
          </p>

          <div style={{ textAlign: 'center', marginTop: '2rem' }}>
            <Link className="btn gold" to="/signup">
              Create free account →
            </Link>
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
function emptySubject() { return { address: '', city: '', effdate: new Date().toISOString().slice(0, 10), gla: '', site: '', siteUnit: 'sf', year: '', beds: '', baths: '', garage: '', basement: '', pool: '', qual: '', cond: '', value: '', appraiser: '' }; }
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

function demoWorkspace() {
  const today = new Date().toISOString().slice(0, 10);
  const subject = {
    address: '411 Boxbury Way', city: 'Fountain Inn, SC 29644', effdate: today,
    gla: 2250, site: 10890, siteUnit: 'sf', year: 2018, beds: 4, baths: 2.5,
    garage: '2-car', basement: 'None', pool: 'No', qual: 'Q4', cond: 'C2', value: 325000,
    appraiser: '', lat: 34.6894, lon: -82.1951
  };
  const sales = [
    { _id: 1, address: '309 Meadow Gate Court', city: 'Fountain Inn', state: 'SC', zip: '29644', status: 'SLD', sale_price_n: 289999, sale_date: '2026-05-07', contract_date: '2026-04-18', gla_n: 2307, site_sf_n: 10500, year_built_n: 2020, quality: 'Q4', condition: 'C1', garage: '2-car', basement: 'None', pool: 'No', dom: 12, concessions_n: 2500, lat: 34.6905, lon: -82.1947, qc_source: 'demo verified' },
    { _id: 2, address: '215 Mosby Drive', city: 'Fountain Inn', state: 'SC', zip: '29644', status: 'SLD', sale_price_n: 311900, sale_date: '2026-02-10', contract_date: '2026-01-24', gla_n: 2175, site_sf_n: 9800, year_built_n: 2017, quality: 'Q4', condition: 'C1', garage: '2-car', basement: 'None', pool: 'No', dom: 8, concessions_n: 0, lat: 34.6889, lon: -82.1962, qc_source: 'demo verified' },
    { _id: 3, address: '205 Mosby Drive', city: 'Fountain Inn', state: 'SC', zip: '29644', status: 'SLD', sale_price_n: 311900, sale_date: '2026-02-11', contract_date: '2026-01-28', gla_n: 2175, site_sf_n: 10020, year_built_n: 2017, quality: 'Q4', condition: 'C1', garage: '2-car', basement: 'None', pool: 'No', dom: 9, concessions_n: 0, lat: 34.6892, lon: -82.1966, qc_source: 'demo verified' },
    { _id: 4, address: '304 Meadow Gate Court', city: 'Fountain Inn', state: 'SC', zip: '29644', status: 'SLD', sale_price_n: 294000, sale_date: '2026-04-23', contract_date: '2026-04-02', gla_n: 2307, site_sf_n: 10900, year_built_n: 2021, quality: 'Q4', condition: 'C1', garage: '2-car', basement: 'None', pool: 'No', dom: 15, concessions_n: 1500, lat: 34.6911, lon: -82.1952, qc_source: 'demo verified' },
    { _id: 5, address: '127 Laurel Trace', city: 'Fountain Inn', state: 'SC', zip: '29644', status: 'SLD', sale_price_n: 339400, sale_date: '2025-05-14', contract_date: '2025-04-29', gla_n: 2360, site_sf_n: 11200, year_built_n: 2019, quality: 'Q4', condition: 'C2', garage: '2-car', basement: 'None', pool: 'No', dom: 18, concessions_n: 3000, lat: 34.6875, lon: -82.1974, qc_source: 'demo verified' },
    { _id: 6, address: '88 Juniper Bend', city: 'Fountain Inn', state: 'SC', zip: '29644', status: 'SLD', sale_price_n: 305000, sale_date: '2025-10-08', contract_date: '2025-09-20', gla_n: 2110, site_sf_n: 9200, year_built_n: 2015, quality: 'Q4', condition: 'C2', garage: '2-car', basement: 'None', pool: 'No', dom: 23, concessions_n: 0, lat: 34.6869, lon: -82.1938, qc_source: 'demo verified' }
  ];
  const adjRows = sales.slice(0, 3).map((s, i) => ({
    rank: i + 1, address: s.address, price: s.sale_price_n, date: s.sale_date, score: 86 - i * 4,
    timeAdj: -1500 * (i + 1), glaAdj: (subject.gla - s.gla_n) * 45, siteAdj: 0, ageAdj: 0,
    condAdj: i === 0 ? -5000 : -2500, qualAdj: 0, otherAdj: 0,
    totalAdj: (-1500 * (i + 1)) + ((subject.gla - s.gla_n) * 45) + (i === 0 ? -5000 : -2500),
    adjusted: s.sale_price_n + ((-1500 * (i + 1)) + ((subject.gla - s.gla_n) * 45) + (i === 0 ? -5000 : -2500)),
    note: 'Demo support row. Verify before report use.'
  }));
  return {
    subject,
    sales,
    selectedComps: [1, 2, 3],
    adjRows,
    glaNarData: { rate: 45, method: 'demo paired sales / regression support' },
    mtNarData: { monthly: -0.31, dir: 'declining' },
    marketStudyState: { mode: 'rolling3', minSales: 1, ran: true, showRaw: true, showModified: true },
    glaStudyState: { mtRate: -0.31, regResult: null, pairedRows: [{ pa: '', ga: '', pb: '', gb: '' }], pairedResult: null, applyInputs: { sg: subject.gla, cg: '', rate: 45, cp: '' }, applyResult: null },
    siteValueState: { land: [], imp: '', total: '', pct: 20, ran: false, selectedRate: 0 },
    adjustmentDefaults: { mtRate: -0.31, glaRate: 45, siteRate: 0, ageRate: 0, condRate: 2500, qualRate: 0, topN: 6, built: true },
    savedAt: new Date().toISOString()
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


  function loadDemoProject() {
    const demo = demoWorkspace();
    applyWorkspace(demo);
    setCurrentProjectId(null);
    setCurrentProjectName('Demo Appraisal Project');
    setCloudStatus('Loaded demo project. Explore the dashboard, Market Conditions, Comp Ranking, Adjustment Grid, and Export Workfile pages.');
    setRoute('Dashboard');
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
          newProject={newProject} loadDemoProject={loadDemoProject} openProject={openProject} deleteProject={deleteProject}
          saveProject={saveProject} fetchProjects={fetchProjects}
        />
      </main>
    </div>
  );
}

function Workspace({ persona, tab, setRoute, subject, setSubject, sales, setSales, selectedComps, setSelectedComps, adjRows, setAdjRows, glaNarData, setGlaNarData, mtNarData, setMtNarData, marketStudyState, setMarketStudyState, glaStudyState, setGlaStudyState, siteValueState, setSiteValueState, adjustmentDefaults, setAdjustmentDefaults, projects, projectsLoading, currentProjectId, currentProjectName, newProject, loadDemoProject, openProject, deleteProject, saveProject, fetchProjects }) {
  if (tab === 'Dashboard') return persona === 'appraiser'
    ? <AppraiserHome sales={sales} projects={projects} selectedComps={selectedComps} adjRows={adjRows} marketStudyState={marketStudyState} currentProjectName={currentProjectName} setRoute={setRoute} newProject={newProject} loadDemoProject={loadDemoProject} openProject={openProject} deleteProject={deleteProject} />
    : <AgentHome sales={sales} projects={projects} selectedComps={selectedComps} currentProjectName={currentProjectName} setRoute={setRoute} newProject={newProject} loadDemoProject={loadDemoProject} openProject={openProject} deleteProject={deleteProject} />;
  if (tab === 'Projects') return <Projects persona={persona} projects={projects} projectsLoading={projectsLoading} currentProjectId={currentProjectId} newProject={newProject} openProject={openProject} deleteProject={deleteProject} fetchProjects={fetchProjects} />;
  if (tab === 'Walkthrough') return <Walkthrough persona={persona} setRoute={setRoute} />;
  if (tab === 'Subject Property' || tab === 'Property Overview') return <SubjectForm persona={persona} subject={subject} setSubject={setSubject} setRoute={setRoute} />;
  if (tab.includes('Import')) return <ImportData persona={persona} sales={sales} setSales={setSales} />;
  if (tab === 'Q/C Analyzer') return <QCAnalyzer persona={persona} sales={sales} setSales={setSales} subject={subject} />;
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
  if (tab === 'Listing Presentation') {
  return (
    <ListingPresentationExport
      subject={subject}
      sales={sales}
      selectedComps={selectedComps}
    />
  );
}

if (tab === 'CMA Export') {
  return (
    <CMAExport
      subject={subject}
      sales={sales}
      selectedComps={selectedComps}
      adjRows={adjRows}
    />
  );
}
  if (tab.includes('Photos')) return <Photos persona={persona} />;
  if (tab === 'AI Assistant') {
    setRoute('Dashboard');
    return null;
  }
  return <Panel title={tab} eyebrow={persona === 'appraiser' ? 'Appraiser Workflow' : 'Agent Workflow'} copy="This section is part of the ValoraIQ platform." />;
}

// ── KPI + home ────────────────────────────────────────────────────────────────
function KPI({ label, value, helper }) { return <div className="kpi"><div className="kpi-icon">✦</div><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div> }

function WorkflowProgress({ persona, sales = [], selectedComps = [], adjRows = [], marketStudyState = {}, currentProjectName = '', setRoute }) {
  const isAppraiser = persona === 'appraiser';
  const steps = [
    { label: 'Project', route: 'Projects', done: !!currentProjectName, help: currentProjectName || 'Open or create' },
    { label: isAppraiser ? 'Subject' : 'Property', route: isAppraiser ? 'Subject Property' : 'Property Overview', done: !!currentProjectName || sales.length > 0, help: 'Profile baseline' },
    { label: 'MLS Import', route: 'MLS Import', done: sales.length > 0, help: `${sales.length} records` },
    { label: 'Q/C Review', route: 'Q/C Analyzer', done: sales.some(s => s.qc_source || s.qc_reviewed), help: sales.some(s => s.qc_source || s.qc_reviewed) ? 'Reviewed' : 'Needs review' },
    { label: isAppraiser ? 'Market Conditions' : 'Market Snapshot', route: isAppraiser ? 'Market Conditions' : 'Market Snapshot', done: !!marketStudyState?.ran, help: marketStudyState?.ran ? 'Study generated' : 'Run trend' },
    { label: 'Comp Ranking', route: 'Comp Ranking', done: selectedComps.length > 0, help: `${selectedComps.length} selected` },
    { label: isAppraiser ? 'Export' : 'CMA Export', route: isAppraiser ? 'Export Workfile' : 'CMA Export', done: adjRows.length > 0, help: adjRows.length ? 'Ready' : 'Pending' }
  ];
  const complete = steps.filter(s => s.done).length;
  const next = steps.find(s => !s.done) || steps[steps.length - 1];
  const pct = Math.round((complete / steps.length) * 100);
  return (
    <section className="workflow-progress-card">
      <div className="workflow-progress-head">
        <div>
          <p className="eyebrow">Guided Workflow</p>
          <h2>{pct}% complete</h2>
          <p className="muted">Recommended next step: <strong>{next.label}</strong></p>
        </div>
        <button className="btn gold" onClick={() => setRoute(next.route)}>Continue →</button>
      </div>
      <div className="workflow-progress-bar"><b style={{ width: `${pct}%` }} /></div>
      <div className="workflow-step-row">
        {steps.map(step => (
          <button key={step.label} className={`workflow-step ${step.done ? 'done' : step.label === next.label ? 'active' : ''}`} onClick={() => setRoute(step.route)}>
            <span>{step.done ? '✓' : step.label === next.label ? '→' : '•'}</span>
            <b>{step.label}</b>
            <small>{step.help}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProjectIntelligencePanel({ persona, sales = [], selectedComps = [], adjRows = [], marketStudyState = {}, setRoute }) {
  const missingGeo = sales.filter(s => !(s.lat && s.lon)).length;
  const missingQC = sales.filter(s => !s.quality || !s.condition).length;
  const selected = selectedComps.length;
  const hasAnyProjectData = sales.length > 0 || selected > 0 || adjRows.length > 0;
  const health = !hasAnyProjectData ? 0 : Math.min(96,
    (sales.length ? 22 : 0) +
    (sales.length && missingGeo === 0 ? 14 : 0) +
    (sales.length && missingQC === 0 ? 14 : 0) +
    (marketStudyState?.ran ? 16 : 0) +
    (selected ? 20 : 0) +
    (adjRows.length ? 10 : 0)
  );
  const confidenceLabel = health >= 75 ? 'Strong' : health >= 45 ? 'Building' : health > 0 ? 'Needs Work' : 'No Data';
  const confidenceClass = health >= 75 ? 'high' : health >= 45 ? 'mid' : 'low';
  const nextRoute = !sales.length ? 'MLS Import' : missingQC ? 'Q/C Analyzer' : !selected ? 'Comp Ranking' : persona === 'appraiser' ? 'Market Conditions' : 'Market Snapshot';
  const nextLabel = !sales.length ? 'Import MLS data' : missingQC ? 'Review Q/C ratings' : !selected ? 'Select comps' : persona === 'appraiser' ? 'Run Market Conditions' : 'Run Market Snapshot';
  return (
    <section className="intelligence-grid">
      <article className="confidence-card-v2">
        <div className="confidence-head">
          <div>
            <p className="eyebrow">Analysis Confidence</p>
            <h2>{health}%</h2>
          </div>
          <span className={`confidence-badge ${confidenceClass}`}>{confidenceLabel}</span>
        </div>
        <div className="confidence-bar"><b style={{ width: `${health}%` }} /></div>
        <p className="muted">{health === 0 ? 'No project data yet. Confidence will build as you import MLS data, geocode, review Q/C, run Market Conditions, select comps, and build support.' : 'Confidence improves as MLS data, geocoding, Q/C, Market Conditions, comp selection, and adjustment support are completed.'}</p>
      </article>
      <article className="intelligence-card">
        <p className="eyebrow">Smart Warnings</p>
        <ul className="smart-list">
          <li className={!sales.length ? 'warn' : 'ok'}>{sales.length ? `${sales.length} records imported` : 'No MLS records imported yet'}</li>
          <li className={missingGeo ? 'warn' : 'ok'}>{missingGeo ? `${missingGeo} records missing coordinates` : 'Geocoding complete or ready'}</li>
          <li className={missingQC ? 'warn' : 'ok'}>{missingQC ? `${missingQC} records need Q/C review` : 'Q/C review looks complete'}</li>
          <li className={selected ? 'ok' : 'warn'}>{selected ? `${selected} comps selected` : 'No comps selected yet'}</li>
        </ul>
      </article>
      <article className="intelligence-card">
        <p className="eyebrow">Recommended Next Step</p>
        <h2>{nextLabel}</h2>
        <p className="muted">ValoraIQ recommends the next workflow action based on the current project status.</p>
        <button className="btn ghost small" onClick={() => setRoute(nextRoute)}>Go to {nextRoute}</button>
      </article>
    </section>
  );
}

function AppraiserHome({ sales, projects = [], selectedComps = [], adjRows = [], marketStudyState = {}, currentProjectName = '', setRoute, newProject, loadDemoProject, openProject, deleteProject }) {
  const projectCount = projects.length;
  const currentLabel = currentProjectName || (sales.length ? 'Unsaved Project' : 'No project open');
  return (
    <div className="dash-page">
      <section className="welcome premium-welcome">
        <p className="eyebrow">Appraiser Workspace</p>
        <h1>Appraisal intelligence workspace</h1>
        <p>Build support for Q/C analysis, market conditions, GLA study, comparable selection, site value, adjustments, concessions, reconciliation, and workfile exports.</p>
        <div className="btn-row"><button className="btn gold" onClick={newProject}>Start New Project</button><button className="btn ghost" onClick={loadDemoProject}>Try Sample Project</button><button className="btn ghost" onClick={() => setRoute('Export Workfile')}>Preview Export Center</button></div>
      </section>
      <WorkflowProgress persona="appraiser" sales={sales} selectedComps={selectedComps} adjRows={adjRows} marketStudyState={marketStudyState} currentProjectName={currentProjectName} setRoute={setRoute} />
      <ProjectIntelligencePanel persona="appraiser" sales={sales} selectedComps={selectedComps} adjRows={adjRows} marketStudyState={marketStudyState} setRoute={setRoute} />
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

function AgentHome({ sales, projects = [], selectedComps = [], currentProjectName = '', setRoute, newProject, loadDemoProject, openProject, deleteProject }) {
  const currentLabel = currentProjectName || (sales.length ? 'Unsaved Project' : 'No project open');
  return (
    <div className="dash-page">
      <section className="welcome premium-welcome">
        <p className="eyebrow">Agent/Broker Workspace</p>
        <h1>CMA and listing pricing workspace</h1>
        <p>Create a CMA project, import market data, rank comparables, and build a seller presentation.</p>
        <div className="btn-row"><button className="btn gold" onClick={newProject}>Start New Project</button><button className="btn ghost" onClick={loadDemoProject}>Try Sample Project</button></div>
      </section>
      <WorkflowProgress persona="agent" sales={sales} selectedComps={selectedComps} adjRows={[]} currentProjectName={currentProjectName} setRoute={setRoute} />
      <ProjectIntelligencePanel persona="agent" sales={sales} selectedComps={selectedComps} adjRows={[]} setRoute={setRoute} />
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
    : [['New CMA Project', 'Projects'], ['Import MLS Data', 'MLS Import'], ['Run Quality/Condition Analyzer', 'Q/C Analyzer'], ['Run Market Snapshot', 'Market Snapshot'], ['Run GLA Study', 'GLA Study'], ['Rank Comparables', 'Comp Ranking'], ['Build Adjustment Grid', 'Adjustment Grid'], ['Build Seller Presentation', 'Listing Presentation'], ['Create Seller Net Sheet', 'Seller Net Sheet']];
  return (
    <div className="quick-card">
      <h2>Quick Actions</h2>
      {actions.map(([label, target]) => (
        <button key={label} onClick={() => label.startsWith('New') && newProject ? newProject() : setRoute(target)}>{label}<span>›</span></button>
      ))}
    </div>
  );
}


function Walkthrough({ persona, setRoute }) {
  const isAppraiser = persona === 'appraiser';
  const steps = isAppraiser
    ? [
      ['1', 'Create or open a project', 'Use Projects to start a new appraisal file or open a saved one. Save often after each major workflow step.', 'Projects'],
      ['2', 'Enter the subject', 'Complete the Subject Property profile, then geocode it so distance-based comp ranking works properly.', 'Subject Property'],
      ['3', 'Import MLS CSV data', 'Upload your export, confirm column mapping, then wait for the geocoding overlay to finish before leaving the page.', 'MLS Import'],
      ['4', 'Review Q/C ratings', 'Use the Q/C Analyzer to review a sample and apply consistent quality/condition estimates across the dataset.', 'Q/C Analyzer'],
      ['5', 'Run Market Conditions', 'Generate the MC study from contract dates when present. Review raw medians, modified medians, and suggested adjustments.', 'Market Conditions'],
      ['6', 'Rank and select comps', 'Use Comp Ranking to compare sales by similarity, distance, date, and property characteristics, then select comps for the grid.', 'Comp Ranking'],
      ['7', 'Build support and export', 'Run GLA, Site Value, Adjustment Grid, Reconciliation, Narrative, and Export Workfile as needed.', 'Adjustment Grid']
    ]
    : [
      ['1', 'Create or open a CMA project', 'Use Projects to start a listing workflow or open a saved CMA.', 'Projects'],
      ['2', 'Enter the property overview', 'Complete the subject/listing profile so the CMA tools have a baseline.', 'Property Overview'],
      ['3', 'Import MLS CSV data', 'Upload your export, confirm mapping, and wait for the geocoding overlay to finish.', 'MLS Import'],
      ['4', 'Review market and comps', 'Run the Market Snapshot, Q/C Analyzer, GLA Study, and Comp Ranking tools.', 'Market Snapshot'],
      ['5', 'Prepare listing outputs', 'Build pricing strategy, seller net sheet, listing presentation, photos, and CMA export.', 'Pricing Strategy']
    ];

  return (
    <div className="dash-page">
      <section className="walkthrough-hero">
        <p className="eyebrow">New User Walkthrough</p>
        <h1>How to use ValoraIQ</h1>
        <p>Follow this sequence from project setup through import, analysis, comp selection, and reporting. Each step below can take you directly to the right page.</p>
      </section>
      <section className="walkthrough-grid">
        {steps.map(([num, title, copy, route]) => (
          <article className="walkthrough-card" key={num}>
            <div className="walkthrough-step">{num}</div>
            <h2>{title}</h2>
            <p>{copy}</p>
            <button className="btn ghost small" onClick={() => setRoute(route)}>Go to {route}</button>
          </article>
        ))}
      </section>
      <section className="panel-card">
        <h2>Tip</h2>
        <p className="muted">For MLS Import, stay on the page while geocoding runs. The overlay shows live progress and will disappear when the records are applied.</p>
      </section>
    </div>
  );
}

function GeocodeOverlay({ progress }) {
  const total = progress?.total || 0;
  const current = progress?.current || 0;
  const pct = total ? Math.round((current / total) * 100) : 0;
  return (
    <div className="geo-overlay" role="status" aria-live="polite">
      <div className="geo-modal">
        <div className="geo-spinner"><span>V</span></div>
        <p className="eyebrow">Please stay on this page</p>
        <h2>Geocoding comparable sales</h2>
        <p className="muted">ValoraIQ is matching addresses to coordinates for distance ranking and map links. Do not click away until this completes.</p>
        <div className="geo-progress"><b style={{ width: `${pct}%` }} /></div>
        <div className="metric-grid three">
          <div><b>{current}/{total}</b><span>Processed</span></div>
          <div><b>{progress.geocoded || 0}</b><span>Geocoded</span></div>
          <div><b>{progress.skipped || 0}</b><span>Skipped / Provided</span></div>
        </div>
        <small>{progress.address || progress.message || 'Starting...'}</small>
      </div>
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
function SubjectForm({ persona, subject, setSubject, setRoute }) {
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const fields = [
    ['address', 'Street Address'], ['city', 'City, State, ZIP'],
    ['effdate', 'Effective / Analysis Date', 'date'],
    ['gla', 'GLA', 'number'], ['site', 'Site Area (Acres or SF)', 'site'],
    ['year', 'Year Built', 'number'], ['beds', 'Bedrooms', 'number'],
    ['baths', 'Baths', 'number'], ['garage', 'Garage'], ['basement', 'Basement'],
    ['pool', 'Pool'], ['qual', 'Quality Rating'], ['cond', 'Condition Rating'],
    ['value', 'Opinion / Target Value', 'number'], ['appraiser', 'Appraiser Name / License']
  ];
  function update(key, type, value) { setSaved(false); if (key === 'site') { const sf = parseSiteArea(value, subject.siteUnit || ''); const unit = /\b(ac|acre|acres)\b/i.test(String(value)) || (isFinite(toNum(value)) && toNum(value) > 0 && toNum(value) < 50 && String(value).includes('.')) ? 'ac' : 'sf'; setSubject({ ...subject, site: value === '' ? '' : sf, siteUnit: unit }); return; } setSubject({ ...subject, [key]: type === 'number' ? (value === '' ? '' : toNum(value)) : value }); }
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
            <label key={key}>{label}<input type={type === 'site' ? 'text' : type} value={key === 'site' ? (subject.site ? siteDisplay(subject.site) : '') : (subject[key] ?? '')} placeholder={key === 'site' ? 'Example: 0.25 acres or 10,890 sf' : ''} onChange={e => update(key, type, e.target.value)} />{key === 'site' && <small>Acres are assumed when a decimal such as 0.25 is entered; values are converted to square feet for calculations.</small>}</label>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={save}>Save Subject</button>
          <button className="btn ghost" onClick={geo}>Save & Geocode Subject</button>
          <button className="btn ghost" onClick={() => setRoute('MLS Import')}>Continue to MLS Import</button>
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
  const [geoProgress, setGeoProgress] = useState(null);
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
    setGeocoding(true); setGeoProgress({ current: 0, total: records.length, attempted: 0, geocoded: 0, skipped: 0, address: '', message: 'Starting geocoding...' }); setCommitted(false); setPreview(records);
    setImportStatus(`Mapped ${records.length} record(s). Geocoding missing coordinates…`);
    const result = await geocodeMissingSales(records, progress => { setGeoProgress(progress); setImportStatus(`${progress.message}: ${progress.address || ''}`); });
    setPreview(result.records); setSales(result.records); setCommitted(true); setGeocoding(false); setGeoProgress(null);
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

      {geocoding && geoProgress && <GeocodeOverlay progress={geoProgress} />}

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
            <thead><tr><th>Address</th><th>City</th><th>Status</th><th>Price</th><th>Sold Date</th><th>Contract Date</th><th>GLA</th><th>Site</th><th>Year</th><th>Q</th><th>C</th><th>Geo</th></tr></thead>
            <tbody>{preview.slice(0, 25).map((r, i) => (
              <tr key={i}><td>{r.address || '—'}</td><td>{r.city || '—'}</td><td>{r.status || '—'}</td><td>{money(r.sale_price_n)}</td><td>{r.sale_date || '—'}</td><td>{r.contract_date || '—'}</td><td>{r.gla_n || '—'}</td><td>{siteDisplay(r.site_sf_n)}</td><td>{r.year_built_n || '—'}</td><td>{r.quality || '—'}</td><td>{r.condition || '—'}</td><td>{r.lat && r.lon ? '✓' : r.geocode_status || '—'}</td></tr>
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
function QCAnalyzer({ persona = 'appraiser', sales, setSales, subject }) {
  const [ran, setRan] = useState(false);
  const [reviewEdits, setReviewEdits] = useState({});
  const [applyMessage, setApplyMessage] = useState('');
  const ratingOptions = [
    ['Q1', 'Excellent'],
    ['Q2', 'Very Good'],
    ['Q3', 'Good'],
    ['Q4', 'Average'],
    ['Q5', 'Below Average'],
    ['Q6', 'Poor']
  ];
  const conditionOptions = [
    ['C1', 'New / Never Lived In'],
    ['C2', 'Good'],
    ['C3', 'Above Average'],
    ['C4', 'Average'],
    ['C5', 'Below Average'],
    ['C6', 'Poor']
  ];
  const qualityLabel = v => {
    const code = String(v || '').toUpperCase().match(/Q[1-6]/)?.[0];
    const found = ratingOptions.find(([r]) => r === code);
    return found ? `${found[0]} ${found[1]}` : v || '—';
  };
  const conditionLabel = v => {
    const code = String(v || '').toUpperCase().match(/C[1-6]/)?.[0];
    const found = conditionOptions.find(([r]) => r === code);
    return found ? `${found[0]} ${found[1]}` : v || '—';
  };

  const sampleSize = Math.min(
    sales.length,
    Math.max(6, Math.ceil((sales.length || 0) * 0.18))
  );

  function percentileRank(sortedVals, value) {
    if (!sortedVals.length || value === null || value === undefined || isNaN(value)) return 0.5;
    const idx = sortedVals.findIndex(v => value <= v);
    if (idx < 0) return 1;
    return sortedVals.length === 1 ? 0.5 : idx / (sortedVals.length - 1);
  }

  function nearestKnownRating(sale, knownSales, fieldPrefix) {
    const candidates = knownSales
      .filter(k => ratingNum(k[fieldPrefix]) && k._reviewKey !== sale._reviewKey)
      .map(k => ({ sale: k, score: similarityScore(sale, k) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!candidates.length) return null;
    const nums = candidates.map(c => ratingNum(c.sale[fieldPrefix])).filter(Boolean);
    return nums.length ? median(nums) : null;
  }

  const flagged = useMemo(() => {
    const validSales = sales.map((s, i) => ({
      ...s,
      _reviewKey: s._id ?? `${s.address || 'sale'}-${i}`
    }));

    const knownRated = validSales.filter(s => ratingNum(s.quality) || ratingNum(s.condition));
    const priceVals = validSales.map(s => s.sale_price_n).filter(v => !isNaN(v)).sort((a, b) => a - b);
    const glaVals = validSales.map(s => s.gla_n).filter(v => !isNaN(v)).sort((a, b) => a - b);
    const yearVals = validSales.map(s => s.year_built_n).filter(v => !isNaN(v)).sort((a, b) => a - b);
    const siteVals = validSales.map(s => s.site_sf_n).filter(v => !isNaN(v)).sort((a, b) => a - b);
    const subjectQ = ratingNum(subject.qual);
    const subjectC = ratingNum(subject.cond);

    const scored = validSales.map(s => {
      const qNum = ratingNum(s.quality);
      const cNum = ratingNum(s.condition);
      const missingQ = !qNum;
      const missingC = !cNum;
      const pricePct = percentileRank(priceVals, s.sale_price_n);
      const glaPct = percentileRank(glaVals, s.gla_n);
      const yearPct = percentileRank(yearVals, s.year_built_n);
      const sitePct = percentileRank(siteVals, s.site_sf_n);
      const profileSpread = Math.max(pricePct, glaPct, yearPct, sitePct) - Math.min(pricePct, glaPct, yearPct, sitePct);
      const edgeProfile = [pricePct, glaPct, yearPct, sitePct].some(v => v <= 0.12 || v >= 0.88);
      const qFromNearest = nearestKnownRating(s, knownRated, 'quality');
      const cFromNearest = nearestKnownRating(s, knownRated, 'condition');
      const qConflict = qNum && qFromNearest ? Math.abs(qNum - qFromNearest) : 0;
      const cConflict = cNum && cFromNearest ? Math.abs(cNum - cFromNearest) : 0;
      const subjectConflict = Math.max(
        qNum && subjectQ ? Math.abs(qNum - subjectQ) : 0,
        cNum && subjectC ? Math.abs(cNum - subjectC) : 0
      );
      const possibleBoundary =
        (qFromNearest && !missingQ && Math.abs(qNum - qFromNearest) >= 0.75) ||
        (cFromNearest && !missingC && Math.abs(cNum - cFromNearest) >= 0.75) ||
        profileSpread >= 0.55;

      let risk = 20;
      if (missingQ || missingC) risk += 45;
      if (qConflict >= 1 || cConflict >= 1) risk += 32;
      if (subjectConflict >= 1) risk += 18;
      if (edgeProfile) risk += 14;
      if (possibleBoundary) risk += 10;
      if (!s.gla_n || !s.sale_price_n) risk += 8;

      const reasons = [];
      if (missingQ || missingC) reasons.push('missing Q/C');
      if (qConflict >= 1 || cConflict >= 1) reasons.push('neighbor conflict');
      if (subjectConflict >= 1) reasons.push('differs from subject');
      if (edgeProfile) reasons.push('edge profile');
      if (possibleBoundary) reasons.push('rating boundary');
      if (!reasons.length) reasons.push('representative check');

      const suggestedQNum = qNum || qFromNearest || subjectQ || 3;
      const suggestedCNum = cNum || cFromNearest || subjectC || 3;

      return {
        ...s,
        _risk: Math.min(100, Math.round(risk)),
        _suggestQ: `Q${Math.round(Math.max(1, Math.min(6, suggestedQNum)))}`,
        _suggestC: `C${Math.round(Math.max(1, Math.min(6, suggestedCNum)))}`,
        _reason: reasons.slice(0, 2).join(' + '),
        _bucketKey: `${Math.round(pricePct * 4)}-${Math.round(glaPct * 4)}-${Math.round(yearPct * 3)}`
      };
    });

    const picked = [];
    const used = new Set();
    const addPick = sale => {
      if (!sale || used.has(sale._reviewKey) || picked.length >= sampleSize) return;
      used.add(sale._reviewKey);
      picked.push(sale);
    };

    scored
      .filter(s => !ratingNum(s.quality) || !ratingNum(s.condition))
      .sort((a, b) => b._risk - a._risk)
      .forEach(addPick);

    scored
      .filter(s => s._risk >= 65)
      .sort((a, b) => b._risk - a._risk)
      .forEach(addPick);

    const buckets = [...new Set(scored.map(s => s._bucketKey))];
    buckets.forEach(bucket => {
      const best = scored
        .filter(s => s._bucketKey === bucket)
        .sort((a, b) => b._risk - a._risk)[0];
      addPick(best);
    });

    scored.sort((a, b) => b._risk - a._risk).forEach(addPick);
    return picked.slice(0, sampleSize);
  }, [sales, subject.qual, subject.cond, sampleSize]);

  const counts = (field, prefix) =>
    ['1', '2', '3', '4', '5', '6'].map(n => {
      const key = prefix + n;
      return [key, sales.filter(s => String(s[field] || '').toUpperCase().startsWith(key)).length];
    });

  const q = counts('quality', 'Q');
  const c = counts('condition', 'C');
  const qn = ratingNum(subject.qual);
  const cn = ratingNum(subject.cond);

  useEffect(() => {
    if (!ran) return;
    const next = {};
    flagged.forEach(s => {
      next[s._reviewKey] = reviewEdits[s._reviewKey] || {
        quality: s.quality || s._suggestQ,
        condition: s.condition || s._suggestC
      };
    });
    setReviewEdits(next);
  }, [ran, sales.length, subject.qual, subject.cond]);

  function updateReview(key, field, value) {
    setApplyMessage('');
    setReviewEdits(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: value
      }
    }));
  }

  function similarityScore(a, b) {
    let score = 0;

    if (a.gla_n && b.gla_n) {
      score += Math.max(0, 40 - Math.abs(a.gla_n - b.gla_n) / 50);
    }

    if (a.sale_price_n && b.sale_price_n) {
      score += Math.max(0, 30 - Math.abs(a.sale_price_n - b.sale_price_n) / 10000);
    }

    if (a.year_built_n && b.year_built_n) {
      score += Math.max(0, 20 - Math.abs(a.year_built_n - b.year_built_n));
    }

    if (a.site_sf_n && b.site_sf_n) {
      score += Math.max(0, 10 - Math.abs(a.site_sf_n - b.site_sf_n) / 1000);
    }

    return score;
  }

  function applyReviewSamples() {
    const reviewed = flagged
      .map(s => ({
        ...s,
        quality: reviewEdits[s._reviewKey]?.quality || s.quality || '',
        condition: reviewEdits[s._reviewKey]?.condition || s.condition || ''
      }))
      .filter(s => s.quality && s.condition);

    if (!reviewed.length) {
      setApplyMessage('Select Q and C ratings for the review samples first.');
      return;
    }

    const updated = sales.map((s, i) => {
      const key = s._id ?? `${s.address || 'sale'}-${i}`;
      const manual = reviewed.find(r => r._reviewKey === key);

      if (manual) {
        return {
          ...s,
          quality: manual.quality,
          condition: manual.condition,
          qc_reviewed: true,
          qc_source: 'manual sample'
        };
      }

      const nearest = reviewed
        .map(r => ({ r, score: similarityScore(s, r) }))
        .sort((a, b) => b.score - a.score)[0]?.r;

      return {
        ...s,
        quality: nearest?.quality || s.quality || subject.qual || 'Q3',
        condition: nearest?.condition || s.condition || subject.cond || 'C3',
        qc_reviewed: false,
        qc_source: 'estimated from reviewed sample'
      };
    });

    setSales(updated);
    setApplyMessage(`Applied Q/C ratings to all ${updated.length} imported sales using ${reviewed.length} reviewed sample(s).`);
  }

  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">{persona === 'appraiser' ? 'Appraiser Tool' : 'Agent/Broker Tool'}</p>
        <h1>{persona === 'appraiser' ? 'Q/C Analyzer' : 'Quality / Condition Analyzer'}</h1>
        <p className="muted max">ValoraIQ now chooses Q/C review samples strategically: missing ratings, likely rating-boundary sales, outliers, neighbor conflicts, and representative comps across the dataset. After review, it estimates quality and condition ratings for the remaining sales based on similarity. The plain-English labels make the rating scale easier to use for both appraisers and agents.</p>

        <div className="btn-row">
          <button className="btn gold" onClick={() => { setRan(true); setApplyMessage(''); }}>
            Analyze Q/C + Show Review Samples
          </button>
          <button className="btn ghost" onClick={() => { setRan(false); setReviewEdits({}); setApplyMessage(''); }}>
            Reset
          </button>
        </div>

        <div className="qc-summary">
          <div><h2>Subject Quality</h2><b>{qualityLabel(subject.qual)}</b><span>{qn ? 'Rating captured' : persona === 'appraiser' ? 'Set rating in Subject Property' : 'Set rating in Property Overview'}</span></div>
          <div><h2>Subject Condition</h2><b>{conditionLabel(subject.cond)}</b><span>{cn ? 'Rating captured' : persona === 'appraiser' ? 'Set rating in Subject Property' : 'Set rating in Property Overview'}</span></div>
        </div>

        {applyMessage && <div className="status-banner success">{applyMessage}</div>}
      </section>

      <section className="two-col">
        <Distribution title="Quality Distribution" data={q} />
        <Distribution title="Condition Distribution" data={c} />
      </section>

      {ran && (
        <section className="table-card">
          <div className="card-head">
            <div>
              <h2>{flagged.length} Smart Q/C Review Samples</h2>
              <span>These are selected because their Q/C rating could materially change the model.</span>
            </div>
            <button className="btn gold small" onClick={applyReviewSamples}>
              Apply Q/C Rating Adjustments
            </button>
          </div>

          <table>
            <thead>
              <tr><th>Sale</th><th>Current Q/C</th><th>Suggested</th><th>Verified Q</th><th>Verified C</th><th>Why selected</th><th>Risk</th></tr>
            </thead>
            <tbody>
              {flagged.map(s => {
                const edit = reviewEdits[s._reviewKey] || {
                  quality: s.quality || s._suggestQ,
                  condition: s.condition || s._suggestC
                };

                return (
                  <tr key={s._reviewKey}>
                    <td>{s.address || '—'}<span>{s.city || ''}</span></td>
                    <td>{qualityLabel(s.quality)} / {conditionLabel(s.condition)}</td>
                    <td>{qualityLabel(s._suggestQ)} / {conditionLabel(s._suggestC)}</td>
                    <td>
                      <select className="cell-input" style={{ color: '#f8fafc', background: '#0b2342' }} value={edit.quality || ''} onChange={e => updateReview(s._reviewKey, 'quality', e.target.value)}>
                        <option value="" style={{ color: '#f8fafc', background: '#0b2342' }}>—</option>
                        {ratingOptions.map(([code, label]) => <option key={code} value={code} style={{ color: '#f8fafc', background: '#0b2342' }}>{code} {label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="cell-input" style={{ color: '#f8fafc', background: '#0b2342' }} value={edit.condition || ''} onChange={e => updateReview(s._reviewKey, 'condition', e.target.value)}>
                        <option value="" style={{ color: '#f8fafc', background: '#0b2342' }}>—</option>
                        {conditionOptions.map(([code, label]) => <option key={code} value={code} style={{ color: '#f8fafc', background: '#0b2342' }}>{code} {label}</option>)}
                      </select>
                    </td>
                    <td><em className={s._risk >= 70 ? 'flag-warn' : 'flag-good'}>{s._reason}</em></td>
                    <td><b>{s._risk}</b>/100</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="table-card">
        <div className="card-head"><h2>Q/C Review Flags</h2><span>{sales.length} sales reviewed</span></div>
        <table>
          <thead><tr><th>Sale</th><th>Q</th><th>C</th><th>Source</th></tr></thead>
          <tbody>
            {sales.slice(0, 15).map((s, i) => (
              <tr key={i}>
                <td>{s.address || '—'}</td>
                <td>{qualityLabel(s.quality)}</td>
                <td>{conditionLabel(s.condition)}</td>
                <td><em className={s.qc_source ? 'flag-good' : 'flag-warn'}>{s.qc_source || 'Not rated yet'}</em></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ── Market Conditions ─────────────────────────────────────────────────────────
function MarketLineChart({ points, max, showRaw = true, showModified = true }) {
  if (!points.length) return <div className="status-banner">No valid market trend points available.</div>;

  const w = 960, h = 360, padL = 76, padR = 34, padT = 34, padB = 58;
  const vals = points
    .flatMap(p => [showRaw ? p.y : null, showModified ? p.yMod : null])
    .filter(v => Number.isFinite(v));

  const rawMin = Math.min(...vals);
  const rawMax = Math.max(max || 1, ...vals);
  const buffer = Math.max(2500, (rawMax - rawMin) * 0.12);
  const minY = Math.max(0, rawMin - buffer);
  const maxY = rawMax + buffer;
  const span = Math.max(1, maxY - minY);
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const denom = Math.max(1, points.length - 1);

  const xFor = i => padL + (i / denom) * chartW;
  const yFor = v => padT + ((maxY - v) / span) * chartH;

  const coords = points.map((p, i) => ({
    ...p,
    x: xFor(i),
    rawY: yFor(p.y),
    modY: yFor(p.yMod)
  }));

  const pathFor = key => coords.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p[key].toFixed(1)}`).join(' ');
  const rawPath = pathFor('rawY');
  const modPath = pathFor('modY');
  const activeKey = showModified ? 'modY' : 'rawY';
  const activeValue = p => showModified ? p.yMod : p.y;
  const areaTop = pathFor(activeKey);
  const areaPath = `${areaTop} L ${coords[coords.length - 1].x.toFixed(1)} ${h - padB} L ${coords[0].x.toFixed(1)} ${h - padB} Z`;
  const yTicks = [maxY, minY + span * 0.75, minY + span * 0.5, minY + span * 0.25, minY];

  return (
    <div className="premium-market-chart-wrap clean-chart">
      <div className="premium-chart-toolbar">
        <div>
          <p className="eyebrow">Trend Visualization</p>
          <h3>Contract-date market movement</h3>
        </div>
        <div className="chart-legend">
          {showRaw && <span><i className="raw" /> Raw Median</span>}
          {showModified && <span><i className="modified" /> Modified / Trend</span>}
        </div>
      </div>

      <svg className="premium-market-svg clean-market-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Market conditions trend graph">
        <rect x={padL} y={padT} width={chartW} height={chartH} rx="18" fill="#0a2345" stroke="rgba(150,190,255,.18)" />

        {yTicks.map((tick, i) => {
          const y = yFor(tick);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="rgba(180,210,255,.16)" strokeWidth="1" />
              <text x={padL - 14} y={y + 4} textAnchor="end" fill="#a9c5ee" fontSize="12" fontWeight="700">{money(Math.round(tick))}</text>
            </g>
          );
        })}

        <path d={areaPath} fill="rgba(77,225,255,.10)" />
        {showRaw && <path d={rawPath} fill="none" stroke="#d6b04a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 6" />}
        {showModified && <path d={modPath} fill="none" stroke="#4de1ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}

        {coords.map((p, i) => {
          const activeY = p[activeKey];
          const labelValue = activeValue(p);
          const showLabel = i === 0 || i === coords.length - 1 || i % 3 === 0;
          return (
            <g key={p.key}>
              {showRaw && <circle cx={p.x} cy={p.rawY} r="4.5" fill="#d6b04a" stroke="#071933" strokeWidth="2"><title>{p.key} Raw Median: {money(p.y)} ({p.n} sales)</title></circle>}
              {showModified && <circle cx={p.x} cy={p.modY} r="5" fill="#4de1ff" stroke="#071933" strokeWidth="2"><title>{p.key} Modified Median: {money(p.yMod)} ({p.n} sales)</title></circle>}
              {showLabel && <text x={p.x} y={Math.max(20, activeY - 14)} textAnchor="middle" fill="#f8fafc" fontSize="12" fontWeight="900">{money(Math.round(labelValue))}</text>}
              <text x={p.x} y={h - 22} textAnchor="middle" fill="#9fc5ff" fontSize="11" fontWeight="700">{p.key}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function analyzeMarketIntelligence(sales, series, mode) {
  const all = sales || [];
  const valid = all.filter(s => s.sale_price_n > 0 && (s.contract_date || s.sale_date));
  const sold = valid.filter(s => /sold|sld|closed|clsd/i.test(String(s.status || '')) || !s.status);
  const active = all.filter(s => /active|act|listed/i.test(String(s.status || '')));
  const pending = all.filter(s => /pending|under contract|contingent|uc|pnd/i.test(String(s.status || '')));
  const domVals = valid.map(s => s.dom).filter(v => isFinite(v) && v >= 0);
  const prices = valid.map(s => s.sale_price_n).filter(v => isFinite(v) && v > 0);
  const ppsfVals = valid.map(s => s.sale_price_n && s.gla_n ? s.sale_price_n / s.gla_n : NaN).filter(v => isFinite(v));
  const lpRatios = valid.map(s => {
    const list = s.list_price_n || s.original_list_price_n || s.sale_price_n;
    return list && s.sale_price_n ? (s.sale_price_n / list) * 100 : null;
  }).filter(v => isFinite(v));
  const monthly = Number(series?.monthly || 0);
  const annual = monthly * 12;
  const medDom = domVals.length ? Math.round(median(domVals)) : null;
  const medPpsf = ppsfVals.length ? median(ppsfVals) : null;
  const spLp = lpRatios.length ? median(lpRatios) : null;
  const quarter = mode === 'quarterly';
  const domSeries = periodMetricSeries(valid, s => s.dom, median, quarter).filter(p => p.n >= 1);
  const ppsfSeries = periodMetricSeries(valid, s => s.sale_price_n && s.gla_n ? s.sale_price_n / s.gla_n : NaN, median, quarter).filter(p => p.n >= 1);
  const countSeries = periodCountSeries(sold.length ? sold : valid, quarter);
  const domTrend = (() => {
    const sorted = valid.filter(s => isFinite(s.dom) && s.dom >= 0).sort((a, b) => dateToMonths(a.contract_date || a.sale_date) - dateToMonths(b.contract_date || b.sale_date));
    if (sorted.length < 6) return 0;
    const half = Math.floor(sorted.length / 2);
    const first = median(sorted.slice(0, half).map(s => s.dom));
    const last = median(sorted.slice(half).map(s => s.dom));
    return last - first;
  })();
  const trailingAvgSales = (() => {
    if (!countSeries.length) return 0;
    const recent = countSeries.slice(-6);
    return meanVal(recent.map(p => p.y));
  })();
  const monthlySales = series?.points?.length ? meanVal(series.points.map(p => p.n)) : trailingAvgSales;
  const monthsSupply = monthlySales ? active.length / monthlySales : 0;
  const supplyLabel = monthsSupply ? (monthsSupply < 3 ? 'Seller-favored' : monthsSupply <= 6 ? 'Balanced' : 'Buyer-favored') : 'Not enough active data';
  const supplySeries = countSeries.map((p, i) => {
    const recent = countSeries.slice(Math.max(0, i - 5), i + 1);
    const absorption = meanVal(recent.map(q => q.y));
    return { ...p, y: absorption ? active.length / absorption : 0, absorption, active: active.length };
  }).filter(p => isFinite(p.y) && p.y > 0);
  const priceVolatility = prices.length > 2 && median(prices) ? stdevVal(prices) / median(prices) : 0;
  const confidence = clampNum((series?.points?.length || 0) * 10 + (valid.length >= 12 ? 20 : valid.length) + (domVals.length ? 10 : 0) + (active.length ? 8 : 0) - priceVolatility * 30, 18, 96);
  const velocityScore = clampNum(62 + monthly * 6 + (pending.length * 4) - Math.max(0, (medDom || 45) - 45) * 0.42 - Math.max(0, monthsSupply - 4) * 7 + (spLp ? (spLp - 98) * 1.3 : 0) - priceVolatility * 45, 4, 98);
  const direction = Math.abs(monthly) < 0.15 ? 'Relatively Stable' : monthly > 0 ? 'Increasing' : 'Declining';
  const inventoryPressure = monthsSupply ? `${fmt(monthsSupply, 1)} months supply - ${supplyLabel}` : 'Active inventory not mapped';
  const statusCounts = {
    active: active.length,
    pending: pending.length,
    sold: sold.length || valid.length,
    total: all.length
  };
  const narrative = `The imported competitive market data indicates ${direction.toLowerCase()} price movement using the selected ${mode} method. The calculated trend is ${monthly >= 0 ? '+' : ''}${fmt(monthly, 3)}% per month, or approximately ${annual >= 0 ? '+' : ''}${fmt(annual, 2)}% annualized. ${medDom !== null ? `Median exposure time is ${medDom} days and the DOM trend changed by ${fmt(domTrend, 0)} days from the earlier sample to the later sample. ` : ''}${monthsSupply ? `Active inventory indicates approximately ${fmt(monthsSupply, 1)} months of supply, which is classified as ${supplyLabel.toLowerCase()}. ` : ''}${spLp ? `The median sale-to-list ratio is ${fmt(spLp, 1)}%, which provides additional support for market pressure. ` : ''}The Market Velocity Score is ${Math.round(velocityScore)}/100. These indicators should be reconciled with appraiser judgment, market participant interviews, and any neighborhood-specific evidence.`;
  return {
    valid, sold, active, pending, domVals, prices, ppsfVals, lpRatios, monthly, annual, medDom, medPpsf, spLp, domTrend,
    domSeries, ppsfSeries, countSeries, supplySeries, monthlySales, monthsSupply, supplyLabel, statusCounts,
    priceVolatility, confidence: Math.round(confidence), velocityScore: Math.round(velocityScore), direction, inventoryPressure, narrative
  };
}

function MiniMetricTrend({ label, value, helper, score }) {
  return (
    <article className="market-intel-card batch2-metric-card">
      <span>{label}</span>
      <b>{value}</b>
      <div className="confidence-bar"><i style={{ width: `${clampNum(score ?? 55, 0, 100)}%` }} /></div>
      <p>{helper}</p>
    </article>
  );
}


function periodMetricSeries(sales, metricFn, aggregate = median, quarter = false) {
  const groups = {};
  (sales || []).forEach(s => {
    const marketDate = s.contract_date || s.pending_date || s.sale_date;
    const k = periodKey(marketDate, quarter);
    const v = metricFn(s);
    if (!k || !isFinite(v)) return;
    (groups[k] ?? (groups[k] = [])).push(v);
  });
  return Object.keys(groups).sort((a, b) => periodIndex(a) - periodIndex(b)).map(k => ({ key: k, x: periodIndex(k), y: aggregate(groups[k]), n: groups[k].length }));
}

function periodCountSeries(sales, quarter = false) {
  const groups = {};
  (sales || []).forEach(s => {
    const marketDate = s.contract_date || s.pending_date || s.sale_date;
    const k = periodKey(marketDate, quarter);
    if (!k) return;
    (groups[k] ?? (groups[k] = [])).push(s);
  });
  return Object.keys(groups).sort((a, b) => periodIndex(a) - periodIndex(b)).map(k => ({ key: k, x: periodIndex(k), y: groups[k].length, n: groups[k].length }));
}

function SimpleTrendChart({ title, subtitle, points = [], valueFormatter = v => fmt(v), bar = false, lineLabel = 'Trend', empty = 'Insufficient data.' }) {
  if (!points.length) return <div className="status-banner">{empty}</div>;
  const w = 920, h = 260, padL = 70, padR = 30, padT = 30, padB = 48;
  const vals = points.map(p => p.y).filter(v => isFinite(v));
  const minRaw = Math.min(...vals, 0);
  const maxRaw = Math.max(...vals, 1);
  const buffer = Math.max(1, (maxRaw - minRaw) * 0.15);
  const minY = Math.max(0, minRaw - buffer);
  const maxY = maxRaw + buffer;
  const span = Math.max(1, maxY - minY);
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const denom = Math.max(1, points.length - 1);
  const xFor = i => padL + (i / denom) * chartW;
  const yFor = v => padT + ((maxY - v) / span) * chartH;
  const coords = points.map((p, i) => ({ ...p, cx: xFor(i), cy: yFor(p.y) }));
  const path = coords.map((p, i) => `${i ? 'L' : 'M'} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`).join(' ');
  const yTicks = [maxY, minY + span * 0.5, minY];
  return (
    <div className="premium-market-chart-wrap mini-exhibit-chart">
      <div className="premium-chart-toolbar"><div><p className="eyebrow">{subtitle}</p><h3>{title}</h3></div><div className="chart-legend"><span><i className="modified" /> {lineLabel}</span></div></div>
      <svg className="premium-market-svg mini-market-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
        <rect x={padL} y={padT} width={chartW} height={chartH} rx="16" fill="#0a2345" stroke="rgba(150,190,255,.16)" />
        {yTicks.map((tick, i) => <g key={i}><line x1={padL} y1={yFor(tick)} x2={w-padR} y2={yFor(tick)} stroke="rgba(180,210,255,.15)" /><text x={padL-12} y={yFor(tick)+4} textAnchor="end" fill="#a9c5ee" fontSize="11" fontWeight="700">{valueFormatter(tick)}</text></g>)}
        {bar ? coords.map((p, i) => {
          const bw = Math.max(12, chartW / Math.max(1, coords.length) * 0.54);
          return <rect key={p.key} x={p.cx - bw / 2} y={p.cy} width={bw} height={h - padB - p.cy} rx="7" fill="rgba(77,225,255,.72)"><title>{p.key}: {valueFormatter(p.y)}</title></rect>;
        }) : <path d={path} fill="none" stroke="#4de1ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
        {!bar && coords.map((p, i) => <circle key={p.key} cx={p.cx} cy={p.cy} r="5" fill="#d6b04a" stroke="#071933" strokeWidth="2"><title>{p.key}: {valueFormatter(p.y)} ({p.n || 0} records)</title></circle>)}
        {coords.map((p, i) => (i === 0 || i === coords.length - 1 || i % 3 === 0) && <text key={p.key + '-label'} x={p.cx} y={h - 20} textAnchor="middle" fill="#9fc5ff" fontSize="10" fontWeight="700">{p.key}</text>)}
      </svg>
    </div>
  );
}

function HousingSupplyChart({ intel }) {
  const points = intel?.supplySeries || [];
  if (!points.length) return <div className="status-banner">Map status and sale dates to generate housing supply support.</div>;
  return <SimpleTrendChart title="Housing Supply / Absorption" subtitle="Supply Pressure" points={points} valueFormatter={v => `${fmt(v, 1)} mo`} lineLabel="Months Supply" empty="Insufficient supply data." />;
}

function MarketMapScatter({ sales = [] }) {
  const geo = sales.filter(s => isFinite(s.lat) && isFinite(s.lon) && s.sale_price_n > 0);
  if (geo.length < 2) return <div className="status-banner">Geocode imported sales to unlock the market map exhibit.</div>;
  const w = 920, h = 360, pad = 34;
  const lats = geo.map(s => Number(s.lat));
  const lons = geo.map(s => Number(s.lon));
  const prices = geo.map(s => Number(s.sale_price_n));
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
  const xFor = lon => pad + ((lon - minLon) / Math.max(0.00001, maxLon - minLon)) * (w - pad * 2);
  const yFor = lat => h - pad - ((lat - minLat) / Math.max(0.00001, maxLat - minLat)) * (h - pad * 2);
  const rFor = price => 5 + ((price - minPrice) / Math.max(1, maxPrice - minPrice)) * 11;
  return (
    <div className="premium-market-chart-wrap market-map-card">
      <div className="premium-chart-toolbar"><div><p className="eyebrow">Geographic Exhibit</p><h3>Sale Location / Price Map</h3></div><div className="chart-legend"><span><i className="modified" /> Higher price = larger marker</span></div></div>
      <svg className="market-map-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Market sale location map">
        <defs><radialGradient id="mapGlow"><stop offset="0%" stopColor="#4de1ff" stopOpacity=".85"/><stop offset="100%" stopColor="#4de1ff" stopOpacity=".12"/></radialGradient></defs>
        <rect x="0" y="0" width={w} height={h} rx="24" fill="#081b38" />
        {[0,1,2,3,4].map(i => <g key={i}><line x1={pad} x2={w-pad} y1={pad+i*(h-pad*2)/4} y2={pad+i*(h-pad*2)/4} stroke="rgba(255,255,255,.08)"/><line y1={pad} y2={h-pad} x1={pad+i*(w-pad*2)/4} x2={pad+i*(w-pad*2)/4} stroke="rgba(255,255,255,.08)"/></g>)}
        {geo.map((s, i) => {
          const status = String(s.status || '').toLowerCase();
          const fill = status.includes('active') ? '#4fffb0' : status.includes('pending') || status.includes('contingent') ? '#d6b04a' : '#4de1ff';
          return <circle key={(s.address || 'sale') + i} cx={xFor(Number(s.lon))} cy={yFor(Number(s.lat))} r={rFor(Number(s.sale_price_n))} fill={fill} fillOpacity=".72" stroke="#071933" strokeWidth="2"><title>{s.address}: {money(s.sale_price_n)} | {s.status || 'Sale'}</title></circle>;
        })}
      </svg>
      <p className="muted">This is a relative geospatial exhibit generated from geocoded MLS records. It is not a parcel map, but it helps visualize clustering, outliers, and price location patterns.</p>
    </div>
  );
}

function MarketConditions({ persona, sales, setMtNarData, marketStudyState, setMarketStudyState, setAdjustmentDefaults }) {
  const state = marketStudyState || { mode: 'rolling3', minSales: 1, ran: false, showRaw: true, showModified: true };
  const mode = state.mode ?? 'rolling3';
  const minSales = state.minSales ?? 1;
  const ran = !!state.ran;
  const showRaw = state.showRaw ?? true;
  const showModified = state.showModified ?? true;
  const series = useMemo(() => marketSeries(sales, minSales, mode), [sales, minSales, mode]);
  const intel = useMemo(() => analyzeMarketIntelligence(sales, series, mode), [sales, series, mode]);

  function updateState(patch) {
    setMarketStudyState(prev => ({ ...(prev || { mode: 'rolling3', minSales: 1, ran: false, showRaw: true, showModified: true }), ...patch }));
  }

  function pctChange(current, previous) {
    if (!current || !previous || !isFinite(current) || !isFinite(previous)) return null;
    return ((current - previous) / previous) * 100;
  }

  function formatPctChange(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  }

  function adjustmentText(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (Math.abs(v) < 0.1) return 'No material adjustment';
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}% to current period`;
  }

  const latestPoint = series.points[series.points.length - 1];
  const rows = series.points.map((p, i) => {
    const prev = i > 0 ? series.points[i - 1] : null;
    return { ...p, momRaw: prev ? pctChange(p.y, prev.y) : null, momModified: prev ? pctChange(p.yMod, prev.yMod) : null, cumulativeToLatest: latestPoint ? pctChange(latestPoint.yMod, p.yMod) : null };
  });

  function generate() {
    const dir = intel.monthly > 0.15 ? 'increasing' : intel.monthly < -0.15 ? 'declining' : 'stable';
    updateState({ ran: true, lastSeries: series, lastIntel: intel });
    setMtNarData({ monthly: series.monthly, dir, narrative: intel.narrative, velocityScore: intel.velocityScore, monthsSupply: intel.monthsSupply, medDom: intel.medDom, spLp: intel.spLp, medPpsf: intel.medPpsf });
    setAdjustmentDefaults(prev => ({ ...(prev || {}), mtRate: Number(series.monthly || 0) }));
  }

  const modeLabels = { raw: 'Raw period medians', rolling3: 'Rolling 3-month median', quarterly: 'Quarterly modifier', weighted: 'Weighted trend line' };

  return (
    <div className="dash-page batch2-market-page">
      <section className="premium-welcome batch2-market-hero">
        <div>
          <p className="eyebrow">{persona === 'appraiser' ? 'Batch 2 Market Intelligence' : 'Market Snapshot'}</p>
          <h1>{persona === 'appraiser' ? 'Market Conditions Intelligence Engine' : 'Market Intelligence Snapshot'}</h1>
          <p>Analyze contract-date price movement, DOM compression, inventory pressure, velocity, and workfile-ready market condition language from imported MLS data.</p>
          <div className="btn-row">
            <button className="btn gold" onClick={generate} disabled={!sales.length}>Generate Market Intelligence</button>
            {!sales.length && <span className="muted">Import MLS data first.</span>}
            {ran && <span className="status-pill">Generated with {modeLabels[mode]}</span>}
          </div>
        </div>
        <div className="comp-hero-score">
          <span>Market Velocity</span>
          <b>{intel.velocityScore}</b>
          <em>/100</em>
        </div>
      </section>

      <section className="panel-card">
        <div className="form-grid compact">
          <label>Modifier Method<select value={mode} onChange={e => updateState({ mode: e.target.value, ran: false })}><option value="raw">Off - raw period medians</option><option value="rolling3">Rolling 3-month median</option><option value="quarterly">Quarterly modifier</option><option value="weighted">Weighted trend line by sale count</option></select></label>
          <label>Minimum Sales Per Period<input type="number" value={minSales} min="1" onChange={e => updateState({ minSales: Number(e.target.value) || 1, ran: false })} /></label>
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <label className="status-pill"><input type="checkbox" checked={showRaw} onChange={e => updateState({ showRaw: e.target.checked })} /> Show Raw Line</label>
          <label className="status-pill"><input type="checkbox" checked={showModified} onChange={e => updateState({ showModified: e.target.checked })} /> Show Modified Line</label>
        </div>
      </section>

      {ran ? (
        <>
          <section className="intelligence-grid batch2-market-metrics">
            <MiniMetricTrend label="Price Direction" value={intel.direction} score={intel.confidence} helper={`${fmt(intel.monthly, 3)}% monthly / ${fmt(intel.annual, 2)}% annualized`} />
            <MiniMetricTrend label="DOM Compression" value={intel.medDom !== null ? `${intel.medDom} days` : 'Not mapped'} score={clampNum(80 - Math.max(0, intel.medDom || 45), 10, 90)} helper={intel.domVals.length ? `${intel.domTrend >= 0 ? '+' : ''}${fmt(intel.domTrend, 0)} day trend from early to recent sample` : 'Map DOM to enable exposure-time support.'} />
            <MiniMetricTrend label="Inventory Pressure" value={intel.inventoryPressure} score={intel.monthsSupply ? clampNum(85 - intel.monthsSupply * 8, 10, 95) : 35} helper={`${intel.active.length} active / ${intel.pending.length} pending / ${intel.sold.length} sold records identified`} />
          </section>

          <section className="chart-card batch2-chart-card">
            <div className="card-head"><div><p className="eyebrow">Premium Exhibit</p><h2>Median Sale Price Trend by Contract Date</h2></div><span className="status-pill">Confidence {intel.confidence}/100</span></div>
            <MarketLineChart points={series.points} max={series.max} showRaw={showRaw} showModified={showModified} />
            <div className="mc-insight-strip">
              <div><span>Trend Confidence</span><b>{intel.confidence >= 75 ? 'High' : intel.confidence >= 50 ? 'Moderate' : 'Limited'}</b></div>
              <div><span>Suggested Adjustment</span><b>{Math.abs(series.monthly) < 0.1 ? 'No material adjustment' : `${series.monthly > 0 ? '+' : ''}${series.monthly.toFixed(2)}% / month`}</b></div>
              <div><span>Appraiser Review</span><b>{Math.abs(series.monthly) >= 0.25 ? 'Adjustment support indicated' : 'Monitor / corroborate'}</b></div>
            </div>
          </section>

          <section className="market-exhibit-grid">
            <article className="chart-card"><SimpleTrendChart title="Days on Market Trend" subtitle="Exposure Time" points={intel.domSeries} valueFormatter={v => `${fmt(v, 0)} d`} lineLabel="Median DOM" empty="Map DOM to generate exposure-time trend support." /></article>
            <article className="chart-card"><HousingSupplyChart intel={intel} /></article>
            <article className="chart-card"><SimpleTrendChart title="Sale Count / Absorption" subtitle="Market Activity" points={intel.countSeries} valueFormatter={v => fmt(v, 0)} bar lineLabel="Closed Sales" empty="Insufficient sale-date data for absorption." /></article>
            <article className="chart-card"><SimpleTrendChart title="Median Price Per Sq Ft" subtitle="Buyer Reaction" points={intel.ppsfSeries} valueFormatter={v => `$${fmt(v, 0)}/sf`} lineLabel="Median $/SF" empty="Map price and GLA to generate price-per-square-foot support." /></article>
          </section>

          <section className="market-map-grid">
            <MarketMapScatter sales={sales} />
            <article className="panel-card market-pressure-card">
              <p className="eyebrow">Market Pressure Summary</p>
              <h2>Supply, Demand, and Exposure</h2>
              <div className="metric-grid three">
                <div><b>{intel.statusCounts.active}</b><span>Active</span></div>
                <div><b>{intel.statusCounts.pending}</b><span>Pending</span></div>
                <div><b>{intel.statusCounts.sold}</b><span>Sold / Closed</span></div>
              </div>
              <div className="smart-list">
                <li className={intel.monthsSupply && intel.monthsSupply <= 6 ? 'ok' : 'warn'}>{intel.monthsSupply ? `${fmt(intel.monthsSupply, 1)} months supply (${intel.supplyLabel})` : 'Active inventory not available'}</li>
                <li className={intel.domTrend <= 0 ? 'ok' : 'warn'}>{intel.domVals.length ? `${intel.domTrend >= 0 ? '+' : ''}${fmt(intel.domTrend, 0)} day DOM trend` : 'DOM not mapped'}</li>
                <li className={intel.spLp && intel.spLp >= 98 ? 'ok' : 'warn'}>{intel.spLp ? `${fmt(intel.spLp, 1)}% median sale-to-list ratio` : 'List price not mapped'}</li>
                <li className="ok">{intel.medPpsf ? `${money(intel.medPpsf)}/SF median price-per-square-foot` : 'GLA and price needed for $/SF trend'}</li>
              </div>
            </article>
          </section>

          <section className="panel-card mc-ai-panel">
            <div className="card-head"><div><p className="eyebrow">Reviewer-Safe Narrative</p><h2>Market Conditions Explanation</h2></div><button className="btn ghost small" onClick={() => navigator.clipboard?.writeText(intel.narrative)}>Copy Narrative</button></div>
            <textarea className="big-text" defaultValue={intel.narrative} />
          </section>

          <section className="table-card" style={{ overflowX: 'auto' }}>
            <div className="card-head"><h2>Period-Level Support</h2><span>{rows.length} periods</span></div>
            <table><thead><tr><th>Period</th><th>Sales</th><th>Raw Median</th><th>Modified Median</th><th>Raw MoM %</th><th>Modified MoM %</th><th>Change to Latest</th><th>Suggested Adjustment</th></tr></thead><tbody>{rows.map(p => <tr key={p.key}><td>{p.key}</td><td>{p.n}</td><td>{money(p.y)}</td><td>{money(p.yMod)}</td><td>{formatPctChange(p.momRaw)}</td><td>{formatPctChange(p.momModified)}</td><td>{formatPctChange(p.cumulativeToLatest)}</td><td>{adjustmentText(p.cumulativeToLatest)}</td></tr>)}</tbody></table>
          </section>
        </>
      ) : (
        <section className="panel-card"><h2>Ready to generate</h2><p className="muted">{sales.length ? 'Choose a method, then click Generate Market Intelligence.' : 'Import MLS data first, then return here to run the market study.'}</p></section>
      )}
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
function compTier(score) {
  if (score >= 88) return { label: 'Elite Match', cls: 'elite', confidence: 'High confidence' };
  if (score >= 75) return { label: 'Strong Match', cls: 'strong', confidence: 'Good confidence' };
  if (score >= 60) return { label: 'Support Match', cls: 'support', confidence: 'Moderate confidence' };
  return { label: 'Review Carefully', cls: 'review', confidence: 'Low confidence' };
}

function percentMatch(value) {
  return Math.max(0, Math.min(100, Math.round(value || 0)));
}

function compSimilarityBreakdown(s, subject) {
  const gla = subject.gla && s.gla_n ? 100 - Math.min(100, Math.abs(s.gla_n - subject.gla) / subject.gla * 250) : 35;
  const distance = s._distance !== null ? 100 - Math.min(100, s._distance / 5 * 100) : 35;
  const dateBasis = s.contract_date || s.sale_date;
  const date = dateBasis ? 100 - Math.min(100, monthsBetween(subject.effdate || new Date().toISOString().slice(0, 10), dateBasis) / 24 * 100) : 40;
  const site = subject.site && s.site_sf_n ? 100 - Math.min(100, Math.abs(s.site_sf_n - subject.site) / subject.site * 220) : 45;
  const age = subject.year && s.year_built_n ? 100 - Math.min(100, Math.abs(s.year_built_n - subject.year) / 25 * 100) : 45;
  const q = ratingNum(subject.qual) && ratingNum(s.quality) ? 100 - Math.min(100, Math.abs(ratingNum(subject.qual) - ratingNum(s.quality)) / 3 * 100) : 50;
  const c = ratingNum(subject.cond) && ratingNum(s.condition) ? 100 - Math.min(100, Math.abs(ratingNum(subject.cond) - ratingNum(s.condition)) / 3 * 100) : 50;
  return { gla: percentMatch(gla), distance: percentMatch(distance), date: percentMatch(date), site: percentMatch(site), age: percentMatch(age), qc: percentMatch((q + c) / 2) };
}

function compReasonTags(s, subject, breakdown) {
  const tags = [];
  if (breakdown.gla >= 85) tags.push('Excellent GLA bracket');
  else if (breakdown.gla >= 65) tags.push('Usable GLA support');
  else tags.push('GLA adjustment likely');
  if (breakdown.distance >= 85) tags.push('Very close proximity');
  else if (breakdown.distance >= 60) tags.push('Competitive location');
  if (breakdown.date >= 80) tags.push('Recent market evidence');
  if (breakdown.qc >= 85) tags.push('Strong Q/C alignment');
  else if (breakdown.qc < 55) tags.push('Q/C review needed');
  if (subject.year && s.year_built_n && Math.abs(s.year_built_n - subject.year) <= 5) tags.push('Similar effective age');
  if (!s.lat || !s.lon) tags.push('Needs geocoding');
  return tags.slice(0, 5);
}

function MatchBar({ label, value }) {
  return <div className="premium-match-bar"><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><em>{value}</em></div>;
}

function CompRanking({ subject, setSubject, sales, setSales, selectedComps, setSelectedComps }) {
  const [w, setW] = useState({ gla: 24, distance: 18, date: 18, site: 10, year: 8, garage: 7, basement: 5, pool: 4, qual: 3, cond: 3 });
  const [busy, setBusy] = useState('');
  const ranked = useMemo(() => sales.map((s, idx) => ({ ...s, _key: s._id ?? s.address ?? idx, _distance: distanceMiles(subject.lat, subject.lon, s.lat, s.lon), _score: scoreComp(s, subject, w) })).sort((a, b) => b._score - a._score), [sales, subject, w]);
  const selectedSet = new Set(selectedComps);
  const recommended = ranked.slice(0, 6);
  const bestPrimary = ranked.slice(0, 3);
  const missingGeo = sales.filter(s => !(s.lat && s.lon)).length;
  const avgScore = ranked.length ? ranked.slice(0, Math.min(6, ranked.length)).reduce((a, s) => a + s._score, 0) / Math.min(6, ranked.length) : 0;

  function toggleComp(key) { setSelectedComps(selectedSet.has(key) ? selectedComps.filter(x => x !== key) : [...selectedComps, key]); }
  function useRecommended() { setSelectedComps(bestPrimary.map(s => s._key)); }
  async function geocodeOne(addr) { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`); const d = await r.json(); return d?.[0] ? { lat: Number(d[0].lat), lon: Number(d[0].lon) } : null; }
  async function geoSubject() { setBusy('Geocoding subject…'); const res = await geocodeOne([subject.address, subject.city].filter(Boolean).join(', ')); if (res) setSubject({ ...subject, ...res }); setBusy(''); }
  async function geoComps() { setBusy('Geocoding comps…'); const updated = []; for (let i = 0; i < sales.length; i++) { const s = sales[i]; if (s.lat && s.lon) { updated.push(s); continue; } const addr = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '); if (!addr) { updated.push(s); continue; } try { const res = await geocodeOne(addr); updated.push(res ? { ...s, ...res } : s); } catch { updated.push(s); } await new Promise(r => setTimeout(r, 650)); } setSales(updated); setBusy(''); }

  return (
    <div className="dash-page premium-comp-page">
      <section className="premium-comp-hero">
        <div>
          <p className="eyebrow">Comp Ranking Intelligence</p>
          <h1>Comparable Recommendation Engine</h1>
          <p>Rank, explain, and select the strongest comparable sales using similarity scoring, match diagnostics, Q/C alignment, date relevance, and geocoding status.</p>
        </div>
        <div className="comp-hero-score">
          <span>Top Set Strength</span>
          <b>{fmt(avgScore, 0)}</b>
          <em>/100</em>
        </div>
      </section>

      <section className="comp-command-grid">
        <article className="comp-command-card primary">
          <p className="eyebrow">Recommended Primary Set</p>
          <h2>{bestPrimary.length ? bestPrimary.map((s, i) => `#${i + 1}`).join('  ') : 'Import MLS data first'}</h2>
          <p className="muted">ValoraIQ recommends the highest-scoring comps as a starting primary set. Appraiser judgment controls final selection.</p>
          <div className="btn-row">
            <button className="btn gold" onClick={useRecommended} disabled={!bestPrimary.length}>Use Recommended Set</button>
            <span className="status-pill">{selectedComps.length} selected</span>
          </div>
        </article>
        <article className="comp-command-card">
          <p className="eyebrow">Data Readiness</p>
          <ul className="smart-list compact-list">
            <li className={sales.length ? 'ok' : 'warn'}>{sales.length ? `${sales.length} sales imported` : 'No imported sales'}</li>
            <li className={missingGeo ? 'warn' : 'ok'}>{missingGeo ? `${missingGeo} need geocoding` : 'Coordinates ready'}</li>
            <li className={subject.lat && subject.lon ? 'ok' : 'warn'}>{subject.lat && subject.lon ? 'Subject geocoded' : 'Subject not geocoded'}</li>
          </ul>
        </article>
        <article className="comp-command-card">
          <p className="eyebrow">Actions</p>
          <div className="btn-row vertical">
            <button className="btn gold" onClick={geoSubject}>Geocode Subject</button>
            <button className="btn ghost" onClick={geoComps}>Geocode Comparable Sales</button>
            {busy && <span className="muted">{busy}</span>}
          </div>
        </article>
      </section>

      <section className="panel-card comp-weight-panel">
        <div className="card-head"><div><p className="eyebrow">Scoring Weights</p><h2>Fine-tune the recommendation model</h2></div><span className="status-pill">Total {Object.values(w).reduce((a, b) => a + b, 0)}</span></div>
        <div className="weight-grid premium-weight-grid">{Object.keys(w).map(k => <label key={k}>{k}<input type="number" value={w[k]} onChange={e => setW({ ...w, [k]: Number(e.target.value) || 0 })} /></label>)}</div>
      </section>

      {!sales.length && <section className="panel-card"><h2>No sales imported yet</h2><p className="muted">Go to MLS Import to upload your data, then return here to rank and select comps.</p></section>}

      <section className="premium-rank-grid">
        {ranked.map((s, i) => {
          const breakdown = compSimilarityBreakdown(s, subject);
          const tier = compTier(s._score);
          const tags = compReasonTags(s, subject, breakdown);
          const selected = selectedSet.has(s._key);
          return (
            <article className={`premium-rank-card ${tier.cls} ${selected ? 'selected' : ''}`} key={s._key}>
              <div className="premium-rank-header">
                <div className="rank-badge">#{i + 1}</div>
                <div className="comp-title-block">
                  <h2>{s.address || 'Address not mapped'}</h2>
                  <p>{[s.city, s.state, s.zip].filter(Boolean).join(', ') || 'Location not mapped'}</p>
                </div>
                <div className="score-orb">
                  <span>Match</span>
                  <b>{fmt(s._score, 0)}</b>
                </div>
                <label className="premium-select-comp"><input type="checkbox" checked={selected} onChange={() => toggleComp(s._key)} /> Use comp</label>
              </div>

              <div className="comp-tier-row">
                <span className={`tier-pill ${tier.cls}`}>{tier.label}</span>
                <span className="tier-pill neutral">{tier.confidence}</span>
                <span className="tier-pill neutral">{s.contract_date ? 'Contract date available' : 'Sold date basis'}</span>
              </div>

              <div className="premium-comp-body">
                <div className="comp-facts-grid">
                  <div><span>Price</span><b>{money(s.sale_price_n)}</b></div>
                  <div><span>Sold Date</span><b>{s.sale_date || '—'}</b></div>
                  <div><span>Contract Date</span><b>{s.contract_date || '—'}</b></div>
                  <div><span>GLA</span><b>{fmt(s.gla_n)}</b></div>
                  <div><span>Distance</span><b>{s._distance !== null ? `${fmt(s._distance, 2)} mi` : '—'}</b></div>
                  <div><span>Q/C</span><b>{s.quality || '—'} / {s.condition || '—'}</b></div>
                </div>

                <div className="comp-explain-card">
                  <p className="eyebrow">Why this comp matters</p>
                  <div className="reason-tag-row">{tags.map(tag => <em key={tag}>{tag}</em>)}</div>
                  <div className="premium-match-bars">
                    <MatchBar label="GLA" value={breakdown.gla} />
                    <MatchBar label="Distance" value={breakdown.distance} />
                    <MatchBar label="Date" value={breakdown.date} />
                    <MatchBar label="Site" value={breakdown.site} />
                    <MatchBar label="Age" value={breakdown.age} />
                    <MatchBar label="Q/C" value={breakdown.qc} />
                  </div>
                </div>
              </div>

              <div className="comp-card-footer">
                <span>Status: <b>{s.status || '—'}</b></span>
                {s.lat && s.lon ? <a className="map-link" href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=16/${s.lat}/${s.lon}`} target="_blank" rel="noreferrer">Open map ↗</a> : <span className="muted">No map coordinates yet</span>}
              </div>
            </article>
          );
        })}
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
function AdjustmentEvidenceCard({ card, onUse }) {
  const statusClass = card.hasSupportedValue ? (card.confidenceScore >= 70 ? 'strong' : 'moderate') : card.hasDirectionalSupport ? 'directional' : 'unsupported';
  return (
    <article className={`adjustment-evidence-card ${statusClass}`}>
      <div className="evidence-head">
        <div><span>{card.title}</span><strong>{card.displayValue}</strong></div>
        <b>{card.confidenceScore}/100</b>
      </div>
      <div className="confidence-bar"><i style={{ width: `${card.confidenceScore}%` }} /></div>
      <p>{card.hasSupportedValue ? `Support range ${card.displayRange}. ${card.confidence} confidence based on available data.` : `${card.confidence}: no dollar adjustment conclusion is displayed because the support threshold was not met.`}</p>
      <ul>{card.methods.length ? card.methods.map(m => <li key={m}>{m}</li>) : <li>No reliable support method met threshold.</li>}</ul>
      {!card.hasSupportedValue && card.supportFailureReasons?.length > 0 && <ul className="support-failures">{card.supportFailureReasons.map(r => <li key={r}>{r}</li>)}</ul>}
      <div className="btn-row">
        <button className="btn ghost small" onClick={() => onUse(card)} disabled={!card.hasSupportedValue}>Use this indication</button>
        <button className="btn ghost small" onClick={() => navigator.clipboard?.writeText(card.narrative)}>Copy defense</button>
      </div>
    </article>
  );
}

function Adjustments({ selectedComps, sales, subject, adjRows, setAdjRows, adjustmentDefaults, setAdjustmentDefaults }) {
  const defaults = adjustmentDefaults || {};
  const mtRate = defaults.mtRate ?? 0;
  const glaRate = defaults.glaRate ?? 0;
  const siteRate = defaults.siteRate ?? 0;
  const ageRate = defaults.ageRate ?? 0;
  const condRate = defaults.condRate ?? 0;
  const qualRate = defaults.qualRate ?? 0;
  const bathRate = defaults.bathRate ?? 0;
  const garageRate = defaults.garageRate ?? 0;
  const bedroomRate = defaults.bedroomRate ?? 0;
  const topN = defaults.topN ?? 6;
  const built = !!defaults.built;
  const selectedSet = new Set(selectedComps);
  const selectedRows = sales.filter(s => { const key = s._id ?? s.address; return selectedSet.has(key); }).sort((a, b) => (b._score || 0) - (a._score || 0));
  const supportCards = useMemo(() => buildAdjustmentSupportCards({ subject, sales, adjRows: selectedRows.map((s, i) => ({ rank: i + 1, address: s.address })), glaNarData: { rate: glaRate } }), [subject, sales, selectedRows, glaRate]);
  const supportByKey = Object.fromEntries(supportCards.map(c => [c.key, c]));

  function updateDefault(key, value) { setAdjustmentDefaults(prev => ({ ...(prev || {}), [key]: value })); }

  function useSupport(card) {
    if (!card?.hasSupportedValue) return;
    const val = Math.round(card.conclusion || 0);
    const map = { gla: 'glaRate', site: 'siteRate', condition: 'condRate', quality: 'qualRate', garage: 'garageRate', bath: 'bathRate', bed: 'bedroomRate' };
    if (map[card.key]) updateDefault(map[card.key], card.key === 'gla' || card.key === 'site' ? card.conclusion : val);
  }

  function garageSpaces(v) {
    const raw = String(v || '').toLowerCase();
    const m = raw.match(/(\d+(\.\d+)?)/);
    if (m) return Number(m[1]);
    if (raw.includes('none') || raw === 'no') return 0;
    return raw ? 1 : 0;
  }

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
      const garageAdj = garageRate ? (garageSpaces(subject.garage) - garageSpaces(s.garage)) * garageRate : 0;
      const bedroomAdj = bedroomRate && subject.beds && s.beds ? (Number(subject.beds) - Number(s.beds)) * bedroomRate : 0;
      const bathAdj = bathRate && subject.baths && s.baths ? (Number(subject.baths) - Number(s.baths)) * bathRate : 0;
      const otherAdj = garageAdj + bedroomAdj + bathAdj;
      const totalAdj = timeAdj + glaAdj + siteAdj + ageAdj + condAdj + qualAdj + otherAdj;
      const noteParts = [];
      if (supportByKey.gla?.hasSupportedValue && glaAdj) noteParts.push(`GLA supported at ${supportByKey.gla.format(supportByKey.gla.conclusion)}`);
      if (supportByKey.garage?.hasSupportedValue && garageAdj) noteParts.push(`Garage supported at ${supportByKey.garage.format(supportByKey.garage.conclusion)}`);
      if (supportByKey.condition?.hasSupportedValue && condAdj) noteParts.push(`Condition supported at ${supportByKey.condition.format(supportByKey.condition.conclusion)}`);
      return { rank: i + 1, address: s.address || '', price: s.sale_price_n || 0, date: s.sale_date || '', score: s._score || 0, timeAdj, glaAdj, siteAdj, ageAdj, condAdj, qualAdj, otherAdj, totalAdj, adjusted: (s.sale_price_n || 0) + totalAdj, note: noteParts.join('; ') };
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

  const vals = adjRows.map(r => r.adjusted).filter(v => isFinite(v) && v > 0);
  const defenseNarrative = `Adjustment support was developed using available imported sales and selected comparable data. The system reviewed paired-sale relationships, grouped-data indications, regression signals, and sensitivity checks where enough observations existed. The appraiser should reconcile the displayed indications with verification, market participant behavior, bracketing, and overall comparability before relying on any adjustment.`;

  return (
    <div className="dash-page batch3-adjustment-page">
      <section className="premium-welcome batch3-hero">
        <div><p className="eyebrow">Batch 3 Adjustment Support Studio</p><h1>Adjustment Support + Reviewer Defense</h1><p>Generate adjustment indications, confidence ranges, method explanations, and an editable grid that can flow into your appraiser workfile.</p><div className="btn-row"><button className="btn gold" onClick={build} disabled={!sales.length}>Build / Rebuild Adjustment Grid</button><button className="btn ghost" onClick={() => navigator.clipboard?.writeText(defenseNarrative)}>Copy Defense Narrative</button>{built && <span className="status-pill">Grid built - cells are editable</span>}</div></div>
        <div className="comp-hero-score"><span>Supported Items</span><b>{supportCards.filter(c => c.hasSupportedValue).length}</b><em>/{supportCards.length}</em></div>
      </section>

      <section className="panel-card">
        <div className="card-head"><div><p className="eyebrow">Adjustment Inputs</p><h2>Rates carried to grid</h2></div><span className="status-pill">Use cards below to fill rates</span></div>
        <div className="form-grid">
          <label>Market Conditions (% / month)<input type="number" step="0.001" value={mtRate} onChange={e => updateDefault('mtRate', toNum(e.target.value) || 0)} /></label>
          <label>GLA Rate ($/SF)<input type="number" step="0.01" value={glaRate} onChange={e => updateDefault('glaRate', toNum(e.target.value) || 0)} /></label>
          <label>Site Rate ($/SF)<input type="number" step="0.01" value={siteRate} onChange={e => updateDefault('siteRate', toNum(e.target.value) || 0)} /></label>
          <label>Garage Rate ($/space)<input type="number" step="500" value={garageRate} onChange={e => updateDefault('garageRate', toNum(e.target.value) || 0)} /></label>
          <label>Bath Rate ($/bath)<input type="number" step="500" value={bathRate} onChange={e => updateDefault('bathRate', toNum(e.target.value) || 0)} /></label>
          <label>Bedroom Rate ($/bedroom)<input type="number" step="500" value={bedroomRate} onChange={e => updateDefault('bedroomRate', toNum(e.target.value) || 0)} /></label>
          <label>Age Rate ($/year)<input type="number" step="1" value={ageRate} onChange={e => updateDefault('ageRate', toNum(e.target.value) || 0)} /></label>
          <label>Condition Rate ($/rating step)<input type="number" step="100" value={condRate} onChange={e => updateDefault('condRate', toNum(e.target.value) || 0)} /></label>
          <label>Quality Rate ($/rating step)<input type="number" step="100" value={qualRate} onChange={e => updateDefault('qualRate', toNum(e.target.value) || 0)} /></label>
          <label>Top N Comps<input type="number" min="1" max="12" value={topN} onChange={e => updateDefault('topN', Number(e.target.value) || 6)} /></label>
        </div>
        {selectedRows.length > 0 ? <div className="selected-comps-row">{selectedRows.slice(0, topN).map(s => <span key={s._id ?? s.address}>{s.address}</span>)}</div> : <div className="status-banner">No comps selected. Select comps in Comp Ranking for best results, or the grid will use the first {topN} imported sales.</div>}
      </section>

      <section className="panel-card">
        <div className="card-head"><div><p className="eyebrow">Methodology Comparison</p><h2>Adjustment evidence cards</h2></div><span className="status-pill">Paired + grouped + regression + sensitivity</span></div>
        <div className="adjustment-evidence-grid">{supportCards.map(card => <AdjustmentEvidenceCard key={card.key} card={card} onUse={useSupport} />)}</div>
      </section>

      <section className="panel-card mc-ai-panel">
        <div className="card-head"><div><p className="eyebrow">Reviewer Defense</p><h2>Methodology explanation</h2></div><button className="btn ghost small" onClick={() => navigator.clipboard?.writeText(defenseNarrative)}>Copy</button></div>
        <textarea className="big-text" defaultValue={defenseNarrative} />
      </section>

      {adjRows.length > 0 && (
        <>
          <section className="intelligence-grid">
            <MiniMetricTrend label="Adjusted Low" value={money(Math.min(...vals))} score={70} helper="Lowest adjusted comparable indicator" />
            <MiniMetricTrend label="Adjusted Median" value={money(median(vals))} score={85} helper="Median adjusted value indication" />
            <MiniMetricTrend label="Adjusted High" value={money(Math.max(...vals))} score={70} helper="Highest adjusted comparable indicator" />
          </section>
          <section className="table-card" style={{ overflowX: 'auto' }}>
            <div className="card-head"><h2>Adjustment Grid</h2><button className="btn ghost small" onClick={() => { const csv = ['Rank,Address,Sale Price,Date,Score,Time,GLA,Site,Age,Cond,Qual,Other,Net Adj,Adjusted,Notes'].concat(adjRows.map(r => [r.rank, `"${r.address}"`, r.price, r.date, Math.round(r.score), Math.round(r.timeAdj), Math.round(r.glaAdj), Math.round(r.siteAdj), Math.round(r.ageAdj), Math.round(r.condAdj), Math.round(r.qualAdj), Math.round(r.otherAdj), Math.round(r.totalAdj), Math.round(r.adjusted), `"${r.note}"`].join(','))).join('\n'); const b = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'adjustment_grid.csv'; a.click(); }}>Export CSV ⇩</button></div>
            <table><thead><tr><th>#</th><th>Comp</th><th>Sale Price</th><th>Date</th><th>Score</th><th>Time</th><th>GLA</th><th>Site</th><th>Age</th><th>Cond</th><th>Qual</th><th>Other</th><th>Net Adj</th><th>Adjusted</th><th>Notes</th></tr></thead><tbody>{adjRows.map((r, i) => <tr key={i}><td>{r.rank}</td><td>{r.address || '—'}</td><td>{money(r.price)}</td><td>{r.date || '—'}</td><td>{fmt(r.score, 0)}</td>{['timeAdj', 'glaAdj', 'siteAdj', 'ageAdj', 'condAdj', 'qualAdj', 'otherAdj'].map(k => <td key={k}><input className="cell-input" defaultValue={Math.round(r[k])} onBlur={e => editAdj(i, k, e.target.value)} style={{ width: 80 }} /></td>)}<td style={{ color: r.totalAdj >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtD(r.totalAdj)}</td><td><b>{money(r.adjusted)}</b></td><td><input className="cell-input wide" defaultValue={r.note} onBlur={e => { const next = adjRows.map((x, j) => j === i ? { ...x, note: e.target.value } : x); setAdjRows(next); }} style={{ width: 190 }} /></td></tr>)}</tbody></table>
          </section>
        </>
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
  const [sections, setSections] = useState({ subject: true, market: true, support: true, adjustments: true, data: true, narrative: true });
  const [status, setStatus] = useState('Ready to generate a professional appraiser workfile package.');
  function toggle(k) { setSections(s => ({ ...s, [k]: !s[k] })); }

  const marketSupport = useMemo(() => buildMarketWorkfileSupport(sales, mtNarData), [sales, mtNarData]);
  const supportCards = useMemo(() => buildAdjustmentSupportCards({ subject, sales, adjRows, glaNarData }), [subject, sales, adjRows, glaNarData]);
  const adjustedVals = (adjRows || []).map(r => r.adjusted).filter(v => isFinite(v) && v > 0);
  const completeness = Math.round(clampNum((subject?.address ? 15 : 0) + ((sales || []).length ? 25 : 0) + (marketSupport.valid.length >= 3 ? 15 : 0) + (supportCards.find(c => c.key === 'gla')?.hasSupportedValue ? 15 : 0) + ((adjRows || []).length ? 20 : 0) + (supportCards.filter(c => c.hasSupportedValue).length >= 3 ? 10 : 0), 0, 100));

  function generatePdf() {
    const html = buildWorkfileHtml({ subject, sales, adjRows, sections, supportCards, marketSupport });
    const w = window.open('', '_blank');
    if (!w) { setStatus('Popup was blocked. Allow popups for this site, then generate again.'); return; }
    w.document.open(); w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => w.print(), 650);
    setStatus('Workfile package generated. In the print dialog choose Save as PDF to save it to the computer workfile.');
  }
  function downloadHtml() {
    const html = buildWorkfileHtml({ subject, sales, adjRows, sections, supportCards, marketSupport });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (subject?.address || 'ValoraIQ_Workfile').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    a.href = url; a.download = `${safeName}_workfile_support.html`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    setStatus('HTML workfile exhibit downloaded. This can be saved directly in the appraiser workfile folder.');
  }
  function copyNarrative() {
    const lines = [marketSupport.narrative, '', ...supportCards.map(c => `${c.title}: ${c.narrative}`), '', 'The appraiser reviewed the above analytics for reasonableness and reconciled final conclusions using professional judgment.'];
    navigator.clipboard?.writeText(lines.join('\n'));
    setStatus('Narrative support copied to clipboard.');
  }

  return (
    <div className="dash-page premium-workfile-page">
      <section className="premium-welcome workfile-hero">
        <div>
          <p className="eyebrow">Appraiser Workfile Studio</p>
          <h1>Generate defensible workfile support</h1>
          <p>Build a print-ready appraiser workfile package with market conditions, adjustment support cards, GLA support, reconciliation, imported sales, and reviewer-safe narrative language.</p>
          <div className="btn-row">
            <button className="btn gold" onClick={generatePdf}>Generate Workfile PDF</button>
            <button className="btn ghost" onClick={downloadHtml}>Download HTML Exhibit</button>
            <button className="btn ghost" onClick={copyNarrative}>Copy Narrative</button>
            <button className="btn ghost" onClick={saveProject}>Save Project to Cloud</button>
          </div>
        </div>
        <div className="comp-hero-score"><span>Workfile Readiness</span><b>{completeness}</b><em>/100</em></div>
      </section>

      <section className="intelligence-grid">
        <article className="intelligence-card primary"><p className="eyebrow">Market Conditions</p><h2>{marketSupport.dir}</h2><p className="muted">{fmtPct(marketSupport.monthly, 3)} monthly · {fmtPct(marketSupport.annual, 2)} annualized · {marketSupport.valid.length} sales analyzed</p></article>
        <article className="intelligence-card"><p className="eyebrow">Market Velocity</p><h2>{marketSupport.velocityScore}/100</h2><p className="muted">{marketSupport.velocityLabel}</p></article>
        <article className="intelligence-card"><p className="eyebrow">Adjusted Value Indicators</p><h2>{adjustedVals.length ? `${money(Math.min(...adjustedVals))} – ${money(Math.max(...adjustedVals))}` : 'Pending'}</h2><p className="muted">{adjustedVals.length ? `Median adjusted indicator: ${money(median(adjustedVals))}` : 'Build the adjustment grid to populate reconciliation support.'}</p></article>
      </section>

      <section className="panel-card">
        <div className="card-head"><div><p className="eyebrow">Export Controls</p><h2>Choose workfile sections</h2></div><button className="btn gold small" onClick={generatePdf}>Generate PDF</button></div>
        <div className="check-list">
          {[['subject', 'Subject Property Summary'], ['market', 'Market Conditions + Trend Chart'], ['support', 'Adjustment Support Studio Cards'], ['adjustments', 'Adjustment Grid + Reconciliation'], ['data', 'Imported Sales Summary'], ['narrative', 'Narrative + Professional Use Notice']].map(([k, l]) => (<label key={k}><input type="checkbox" checked={sections[k]} onChange={() => toggle(k)} /> {l}</label>))}
        </div>
        <div className="status-banner success">{status}</div>
      </section>

      <section className="panel-card">
        <div className="card-head"><div><p className="eyebrow">Adjustment Support Studio</p><h2>Preview support cards</h2></div><span className="status-pill">{supportCards.filter(c => c.hasSupportedValue).length}/{supportCards.length} supported</span></div>
        <div className="workfile-support-preview">
          {supportCards.map(card => (<article className={`workfile-support-card ${card.hasSupportedValue ? 'supported' : card.hasDirectionalSupport ? 'directional' : 'unsupported'}`} key={card.key}><div><span>{card.title}</span><strong>{card.displayValue}</strong></div><div className="confidence-bar"><b style={{ width: `${card.confidenceScore}%` }} /></div><p>{card.hasSupportedValue ? `${card.confidence} support · Range ${card.displayRange}` : `${card.confidence} · No dollar conclusion shown`}</p><small>{card.methods.length ? card.methods.join(' · ') : (card.supportFailureReasons || []).join(' · ')}</small></article>))}
        </div>
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

function selectedComparableRows(sales = [], selectedComps = []) {
  const selectedSet = new Set(selectedComps);
  const comps = sales.filter(s => selectedSet.has(s._id ?? s.address));
  return comps.length ? comps : sales;
}

function priceStats(rows = []) {
  const prices = rows.map(s => s.sale_price_n).filter(v => Number.isFinite(v) && v > 0);
  return {
    prices,
    low: prices.length ? Math.min(...prices) : null,
    high: prices.length ? Math.max(...prices) : null,
    medianPrice: prices.length ? median(prices) : null,
    avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null
  };
}

function printableClientReport(title, subject, rows, stats, type = 'listing') {
  const compRows = rows.slice(0, type === 'listing' ? 8 : 12).map(s => `
    <tr>
      <td>${s.address || '—'}<br><small>${[s.city, s.state, s.zip].filter(Boolean).join(', ')}</small></td>
      <td>${money(s.sale_price_n)}</td>
      <td>${s.gla_n ? fmt(s.gla_n) : '—'}</td>
      <td>${s.sale_price_n && s.gla_n ? money(Math.round(s.sale_price_n / s.gla_n)) : '—'}</td>
      <td>${s.dom ?? '—'}</td>
      <td>${s.sale_date || '—'}</td>
    </tr>`).join('');

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:0;color:#10213f;background:#f7f8fb}
        .page{max-width:980px;margin:auto;background:white;min-height:100vh;padding:36px}
        .hero{background:linear-gradient(135deg,#071933,#0a2d58);color:white;border-radius:24px;padding:32px;margin-bottom:24px}
        .eyebrow{text-transform:uppercase;letter-spacing:.14em;color:#d6b04a;font-size:12px;font-weight:800}
        h1{font-family:Georgia,serif;font-size:34px;margin:8px 0 6px} h2{font-family:Georgia,serif;color:#10213f;margin-top:26px}
        .muted{color:#60708d}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0}.metric{border:1px solid #dfe5ef;border-radius:16px;padding:16px;background:#fbfcff}.metric b{font-size:24px;display:block;color:#10213f}.metric span{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#60708d;font-weight:800}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#10213f;color:white;text-align:left;padding:10px;font-size:11px;text-transform:uppercase}td{border-bottom:1px solid #e6ebf3;padding:10px;vertical-align:top}small{color:#60708d}.note{background:#fff8e6;border:1px solid #e7ca73;border-radius:14px;padding:14px;margin-top:20px}@media print{body{background:white}.page{padding:0}.hero{border-radius:0}}
      </style>
    </head>
    <body>
      <div class="page">
        <section class="hero">
          <div class="eyebrow">ValoraIQ ${type === 'listing' ? 'Listing Presentation' : 'CMA Export'}</div>
          <h1>${subject?.address || title}</h1>
          <p>${[subject?.city, subject?.state, subject?.zip].filter(Boolean).join(', ') || 'Prepared client presentation'}</p>
        </section>
        <section class="grid">
          <div class="metric"><b>${money(stats.medianPrice)}</b><span>Pricing Anchor</span></div>
          <div class="metric"><b>${stats.low ? `${money(stats.low)} – ${money(stats.high)}` : '—'}</b><span>Comparable Range</span></div>
          <div class="metric"><b>${rows.length}</b><span>Comps Reviewed</span></div>
        </section>
        <h2>${type === 'listing' ? 'Featured Comparable Sales' : 'Comparable Market Summary'}</h2>
        <table><thead><tr><th>Address</th><th>Price</th><th>GLA</th><th>$/SF</th><th>DOM</th><th>Date</th></tr></thead><tbody>${compRows || '<tr><td colspan="6">No comparable sales imported yet.</td></tr>'}</tbody></table>
        <div class="note"><strong>Client-facing note:</strong> This is a market analysis aid, not an appraisal. Pricing strategy should be finalized with agent judgment, property condition, showing feedback, and current competition.</div>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
    </body>
  </html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Popup blocked. Allow popups and try again.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function ListingPresentationExport({ subject, sales = [], selectedComps = [] }) {
  const useComps = selectedComparableRows(sales, selectedComps);
  const stats = priceStats(useComps);
  const selectedCount = selectedComps.length;

  return (
    <div className="dash-page">
      <section className="strategy-card large">
        <p className="eyebrow">Listing Presentation</p>
        <h1>{subject?.address || 'Seller Presentation'}</h1>
        <p className="muted max">A clean, seller-facing presentation built from your imported MLS data and selected comparable sales.</p>
        <div className="metric-grid three">
          <div><b>{money(stats.medianPrice)}</b><span>Suggested Pricing Anchor</span></div>
          <div><b>{stats.low ? `${money(stats.low)} – ${money(stats.high)}` : '—'}</b><span>Comparable Range</span></div>
          <div><b>{useComps.length}</b><span>{selectedCount ? 'Selected Comps Used' : 'Imported Records Used'}</span></div>
        </div>
        <div className="status-banner" style={{ marginTop: 16 }}>This presentation is intentionally client-facing: clean pricing story, featured comps, and market position without appraisal workfile-level methodology.</div>
        <div className="btn-row"><button className="btn gold" onClick={() => printableClientReport('Listing Presentation', subject, useComps, stats, 'listing')}>Generate Presentation PDF</button></div>
      </section>

      <section className="table-card">
        <div className="card-head"><h2>Featured Comparable Sales</h2><span>{useComps.length} records</span></div>
        <table>
          <thead><tr><th>Address</th><th>Price</th><th>GLA</th><th>$/SF</th><th>DOM</th><th>Date</th></tr></thead>
          <tbody>{useComps.slice(0, 8).map((s, i) => (
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

function CMAExport({ subject, sales = [], selectedComps = [], adjRows = [] }) {
  const useComps = selectedComparableRows(sales, selectedComps);
  const stats = priceStats(useComps);
  const adjustedVals = adjRows.map(r => r.adjusted).filter(v => Number.isFinite(v) && v > 0);
  const adjustedMedian = adjustedVals.length ? median(adjustedVals) : null;

  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">CMA Export</p>
        <h1>{subject?.address || 'Comparative Market Analysis'}</h1>
        <p className="muted max">A clean client-facing CMA summary for agents and brokers.</p>
        <div className="metric-grid three">
          <div><b>{money(adjustedMedian || stats.medianPrice)}</b><span>{adjustedMedian ? 'Adjusted Pricing Anchor' : 'Median Comparable Price'}</span></div>
          <div><b>{stats.low ? `${money(stats.low)} – ${money(stats.high)}` : '—'}</b><span>Comparable Price Range</span></div>
          <div><b>{useComps.length}</b><span>Comparable Sales</span></div>
        </div>
        <div className="status-banner" style={{ marginTop: 16 }}>This CMA is designed for buyer/seller discussion. It summarizes the market evidence without appraiser workfile-level support language.</div>
        <div className="btn-row"><button className="btn gold" onClick={() => printableClientReport('CMA Export', subject, useComps, stats, 'cma')}>Generate Export / Save PDF</button></div>
      </section>

      <section className="table-card">
        <div className="card-head"><h2>CMA Comparable Summary</h2><span>{useComps.length} records</span></div>
        <table>
          <thead><tr><th>Address</th><th>Price</th><th>GLA</th><th>$/SF</th><th>DOM</th><th>Date</th></tr></thead>
          <tbody>{useComps.slice(0, 12).map((s, i) => (
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

function ExportLike({ title, items = [] }) {
  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">Export Center</p>
        <h1>{title}</h1>
        <p className="muted max">This export section is available, but the dedicated Listing Presentation and CMA Export screens should be used for agent-facing PDFs.</p>
        <div className="check-list">{items.map(i => <label key={i}><input type="checkbox" defaultChecked /> {i}</label>)}</div>
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
  const [copyStatus, setCopyStatus] = useState('');
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function buildContext() {
    const parts = [];

    parts.push(
      persona === 'appraiser'
        ? `You are an AI workflow assistant inside ValoraIQ, a professional real estate appraisal platform. Help appraisers draft editable narrative language, analyze market data, and support workfile documentation. Do not make final appraisal conclusions.`
        : `You are an AI workflow assistant inside ValoraIQ, a professional CMA and listing presentation platform. Help agents summarize market data and prepare seller-facing materials. Do not replace professional pricing judgment.`
    );

    if (subject?.address) {
      parts.push(`Subject property: ${[subject.address, subject.city].filter(Boolean).join(', ')}. GLA: ${subject.gla || 'unknown'} SF. Year: ${subject.year || 'unknown'}. Quality: ${subject.qual || 'unknown'}. Condition: ${subject.cond || 'unknown'}. Effective date: ${subject.effdate || 'unknown'}.`);
    }

    if (sales.length) {
      const prices = sales.map(s => s.sale_price_n).filter(v => isFinite(v) && v > 0);
      parts.push(`Imported sales: ${sales.length}. Median sale price: ${prices.length ? money(median(prices)) : 'unknown'}. Price range: ${prices.length ? `${money(Math.min(...prices))} – ${money(Math.max(...prices))}` : 'unknown'}.`);
    }

    if (mtNarData?.monthly) {
      parts.push(`Market conditions: ${mtNarData.monthly.toFixed(3)}% per month, direction: ${mtNarData.dir || 'unknown'}.`);
    }

    if (glaNarData?.rate) {
      parts.push(`GLA adjustment rate: $${fmt(glaNarData.rate, 2)}/SF via ${glaNarData.method || 'analysis'}.`);
    }

    if (adjRows.length) {
      const vals = adjRows.map(r => r.adjusted).filter(v => v > 0);
      if (vals.length) {
        parts.push(`Adjustment grid: ${adjRows.length} comps. Adjusted range: ${money(Math.min(...vals))} – ${money(Math.max(...vals))}. Median adjusted: ${money(median(vals))}.`);
      }
    }

    return parts.join('\n\n');
  }

  async function sendMessage(text) {
    const userText = text || input.trim();
    if (!userText) return;

    setInput('');
    setError('');
    setCopyStatus('');

    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: buildContext(),
          messages: newMessages.map(m => ({
            role: m.role,
            content: m.content
          }))
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `API error ${response.status}`);
      }

      setMessages([...newMessages, {
        role: 'assistant',
        content: data.text || 'No response returned.'
      }]);
    } catch (err) {
      setError(err.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }

  async function copyConversation() {
    const txt = messages.map(m => `${m.role === 'user' ? 'You' : 'ValoraIQ AI'}: ${m.content}`).join('\n\n');

    try {
      await navigator.clipboard.writeText(txt);
      setCopyStatus('Conversation copied.');
    } catch {
      const area = document.createElement('textarea');
      area.value = txt;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      setCopyStatus('Conversation copied.');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="dash-page">
      <section className="panel-card">
        <p className="eyebrow">AI Workflow Assistant</p>
        <h1>{persona === 'appraiser' ? 'Narrative and evidence support' : 'Seller conversation support'}</h1>
        <p className="muted max">Ask questions or select a prompt below. The assistant uses your current project data.</p>

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

            {loading && <div className="status-banner">Thinking…</div>}
            {error && <div className="status-banner">{error}</div>}
            {copyStatus && <div className="status-banner success">{copyStatus}</div>}
            <div ref={bottomRef} />
          </div>

          {messages.length > 0 && (
            <div className="btn-row">
              <button className="btn ghost small" onClick={copyConversation}>Copy conversation</button>
              <button className="btn ghost small" onClick={() => { setMessages([]); setError(''); setCopyStatus(''); }}>Clear</button>
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
            placeholder="Ask a question or request a narrative draft…"
            disabled={loading}
          />
          <button className="btn gold" onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{ minWidth: 80 }}>
            {loading ? '…' : 'Send'}
          </button>
        </div>
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

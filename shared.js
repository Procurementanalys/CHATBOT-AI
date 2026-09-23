// shared.js — dipakai bareng oleh admin.html dan chat.html
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, collection } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
export const ready = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => { if (user) resolve(user); else signInAnonymously(auth).catch(err => console.error("Auth gagal:", err)); });
});

export const TYPES = [
  { key: 'master', label: 'Master List', periodic: false },
  { key: 'pareto', label: 'Master List Pareto', periodic: false },
  { key: 'store', label: 'Store List', periodic: false },
  { key: 'sales', label: 'Sales Data', periodic: true },
  { key: 'stock', label: 'Stock On Hand', periodic: true },
  { key: 'po', label: 'PO Transaction', periodic: true },
  { key: 'receiving', label: 'Receiving Transaction', periodic: true },
];
export const typeMap = Object.fromEntries(TYPES.map(t => [t.key, t]));

// ---------- Column detection & normalisasi ----------
function pick(headers, cands) {
  const low = headers.map(h => String(h).toLowerCase().trim());
  for (const c of cands) { const i = low.findIndex(h => h === c); if (i > -1) return headers[i]; }
  for (const c of cands) { const i = low.findIndex(h => h.includes(c)); if (i > -1) return headers[i]; }
  return null;
}
export function normalizeRows(rawRows) {
  if (!rawRows.length) return { rows: [], headers: [] };
  const headers = Object.keys(rawRows[0]);
  const col = {
    sku: pick(headers, ['sku', 'kode item', 'kode produk', 'item code', 'kode']),
    name: pick(headers, ['nama item', 'item name', 'nama produk', 'product name', 'deskripsi']),
    category: pick(headers, ['kategori', 'category', 'kelompok']),
    store: pick(headers, ['store', 'toko', 'kode toko', 'store code']),
    qty: pick(headers, ['qty', 'quantity', 'jumlah', 'sales qty', 'qty jual']),
    date: pick(headers, ['tanggal', 'date', 'periode', 'period']),
    pareto: pick(headers, ['pareto', 'pareto class', 'kelas']),
  };
  const rows = rawRows.map(r => ({
    sku: col.sku ? String(r[col.sku] ?? '').trim() : '',
    name: col.name ? String(r[col.name] ?? '').trim() : '',
    category: col.category ? String(r[col.category] ?? '').trim() : '',
    store: col.store ? String(r[col.store] ?? '').trim() : '',
    qty: col.qty ? Number(r[col.qty]) || 0 : 0,
    date: col.date ? r[col.date] : '',
    pareto: col.pareto ? String(r[col.pareto] ?? '').trim() : '',
  }));
  return { rows, headers };
}

// ---------- Firestore data layer (chunked, batas 1 doc Firestore ~1MB) ----------
const CHUNK_SIZE = 800;
async function deleteChunks(id) {
  const snap = await getDocs(collection(db, 'datasets', id, 'chunks'));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}
export async function saveDataset(type, period, rows, headers, fileName) {
  await ready;
  const id = `${type}__${period}`;
  await deleteChunks(id);
  const chunkCount = Math.max(1, Math.ceil(rows.length / CHUNK_SIZE));
  for (let i = 0; i < chunkCount; i++) {
    const chunkRows = rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await setDoc(doc(db, 'datasets', id, 'chunks', String(i)), { rows: chunkRows });
  }
  await setDoc(doc(db, 'datasets', id), { type, period, headers, rowCount: rows.length, fileName, chunkCount, uploadedAt: new Date().toISOString() });
}
export async function deleteDataset(id) {
  await ready;
  await deleteChunks(id);
  await deleteDoc(doc(db, 'datasets', id));
}
export async function listDatasets() {
  await ready;
  const snap = await getDocs(collection(db, 'datasets'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function loadDataset(meta) {
  const chunksSnap = await getDocs(collection(db, 'datasets', meta.id, 'chunks'));
  let rows = [];
  chunksSnap.docs.sort((a, b) => Number(a.id) - Number(b.id)).forEach(c => { rows = rows.concat(c.data().rows || []); });
  return { ...meta, rows };
}
export async function getByType(type) { const all = await listDatasets(); return all.filter(d => d.type === type); }
export async function getLatest(type) {
  const arr = await getByType(type); if (!arr.length) return null;
  arr.sort((a, b) => b.period.localeCompare(a.period));
  return loadDataset(arr[0]);
}
export async function getLastNPeriods(type, n) {
  const arr = await getByType(type); arr.sort((a, b) => b.period.localeCompare(a.period));
  return Promise.all(arr.slice(0, n).map(loadDataset));
}

// ---------- Formula engine (murni rumus, tanpa AI) ----------
export function sumQtyBySku(rows) { const m = {}; rows.forEach(r => { if (!r.sku) return; m[r.sku] = (m[r.sku] || 0) + r.qty; }); return m; }
export function fmt(n) { return Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 }); }

export async function computeForecastAndMOI() {
  const salesPeriods = await getLastNPeriods('sales', 3);
  if (!salesPeriods.length) return { ok: false, reason: 'Sales Data belum diupload.' };
  const perPeriodTotals = salesPeriods.map(p => ({ period: p.period, map: sumQtyBySku(p.rows), total: p.rows.reduce((a, r) => a + r.qty, 0) }));
  const allSkus = new Set(); perPeriodTotals.forEach(p => Object.keys(p.map).forEach(s => allSkus.add(s)));
  const forecast = {};
  allSkus.forEach(sku => {
    const vals = perPeriodTotals.map(p => p.map[sku] || 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const trendAdj = vals.length >= 2 ? (vals[0] - vals[vals.length - 1]) / (vals.length - 1) : 0;
    forecast[sku] = Math.max(0, avg + trendAdj * 0.5);
  });
  const totalForecast = Object.values(forecast).reduce((a, b) => a + b, 0);
  const avgMonthlyTotal = perPeriodTotals.reduce((a, p) => a + p.total, 0) / perPeriodTotals.length;
  const stockDs = await getLatest('stock');
  let moiNow = null, moiNext = null, stockTotal = null;
  if (stockDs) {
    stockTotal = stockDs.rows.reduce((a, r) => a + r.qty, 0);
    moiNow = avgMonthlyTotal > 0 ? stockTotal / avgMonthlyTotal : null;
    moiNext = totalForecast > 0 ? stockTotal / totalForecast : null;
  }
  return { ok: true, salesPeriods: salesPeriods.map(p => p.period), avgMonthlyTotal, totalForecast, forecast, stockTotal, moiNow, moiNext, hasStock: !!stockDs };
}

export async function computeBreakdown(keyword) {
  const master = await getLatest('master');
  if (!master) return { ok: false, reason: 'Master List belum diupload.' };
  const kw = keyword.toLowerCase();
  const items = master.rows.filter(r => r.category && r.category.toLowerCase().includes(kw));
  const paretoDs = await getLatest('pareto');
  const paretoMap = {}; if (paretoDs) paretoDs.rows.forEach(r => { if (r.sku) paretoMap[r.sku] = r.pareto; });
  const salesLatest = await getLastNPeriods('sales', 1);
  const salesMap = salesLatest.length ? sumQtyBySku(salesLatest[0].rows) : {};
  return { ok: true, items, paretoMap, salesMap, count: items.length };
}

export async function computeOOSRisk() {
  const stockDs = await getLatest('stock');
  if (!stockDs) return { ok: false, reason: 'Stock On Hand belum diupload.' };
  const salesPeriods = await getLastNPeriods('sales', 3);
  if (!salesPeriods.length) return { ok: false, reason: 'Sales Data belum diupload.' };
  const masterDs = await getLatest('master');
  const nameMap = {}; if (masterDs) masterDs.rows.forEach(r => { if (r.sku) nameMap[r.sku] = r.name; });
  const stockMap = sumQtyBySku(stockDs.rows);
  const perPeriodMaps = salesPeriods.map(p => sumQtyBySku(p.rows));
  const allSkus = new Set(Object.keys(stockMap)); perPeriodMaps.forEach(m => Object.keys(m).forEach(s => allSkus.add(s)));
  const risky = [];
  allSkus.forEach(sku => {
    const vals = perPeriodMaps.map(m => m[sku] || 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const stock = stockMap[sku] || 0;
    if (avg <= 0) return;
    const moi = stock / avg;
    if (moi < 0.5) risky.push({ sku, name: nameMap[sku] || '', stock, avgMonthly: avg, moi });
  });
  risky.sort((a, b) => a.moi - b.moi);
  return { ok: true, risky, count: risky.length };
}

export function extractCategoryKeyword(text) {
  const m = text.toLowerCase().match(/kategori\s+([a-z0-9\s]+)/);
  return m ? m[1].trim() : null;
}

// Panggil backend Cloud Function (lihat ai-config.js). Prompt HARUS berisi angka
// hasil rumus yang sudah dihitung — instruksi di dalamnya melarang model menambah
// angka baru, jadi narasi AI tetap terkunci ke data asli. Return null kalau endpoint
// belum di-set atau gagal, supaya chat tetap jalan normal pakai rumus saja.
export async function askAIInsight(endpoint, dataSummary, userQuestion) {
  if (!endpoint || endpoint.includes('GANTI')) return null;
  const prompt = `Kamu asisten procurement. Berikut angka HASIL RUMUS yang sudah dihitung dari data perusahaan (jangan mengarang angka lain, jangan mengubah angka ini):\n${dataSummary}\n\nPertanyaan pengguna: "${userQuestion}"\n\nTulis 2-3 kalimat insight singkat dalam Bahasa Indonesia berdasarkan angka di atas saja — soal tren, risiko, atau yang perlu diperhatikan tim purchasing. Jangan ulangi semua angka mentah, jangan tambahkan angka yang tidak ada di data di atas.`;
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
    if (!r.ok) return null;
    const data = await r.json();
    return data.text || null;
  } catch (e) { return null; }
}

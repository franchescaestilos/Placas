(() => {
'use strict';

const $ = s => document.querySelector(s);
const DB_NAME = 'RegistroPlacasDB', STORE = 'placas';
let db, stream = null, worker = null, scanning = false, timer = null, startedAt = 0, deleteId = null, toastTimer;

/* ---------- Utilidades ---------- */
const pad = n => String(n).padStart(2, '0');
const fmtFecha = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtHora = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDia = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, error) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), error ? 5000 : 3000);
}
const setStatus = m => { $('#status').textContent = m; };

/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB no disponible'));
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      s.createIndex('timestamp', 'timestamp');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function run(mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => res(r && r.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const dbAll = () => run('readonly', s => s.getAll());
const dbAdd = rec => run('readwrite', s => s.add(rec));
const dbDelete = id => run('readwrite', s => s.delete(id));
function dbError(e) { console.error(e); toast('⚠️ Error en la base de datos local (IndexedDB). Cierra y vuelve a abrir la aplicación.', true); }

/* ---------- Navegación ---------- */
function show(name) {
  $('#screen-scan').classList.toggle('active', name === 'scan');
  $('#screen-list').classList.toggle('active', name === 'list');
  $('#tab-scan').classList.toggle('active', name === 'scan');
  $('#tab-list').classList.toggle('active', name === 'list');
  if (name === 'list') { stopCamera(); resetScanUI(); renderList(); }
}

/* ---------- Cámara ---------- */
function resetScanUI() {
  $('#idle').classList.remove('hidden');
  $('#cam').classList.add('hidden');
  $('#result').classList.add('hidden');
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('⚠️ Este navegador no permite acceder a la cámara. Usa Chrome con HTTPS.', true);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    toast('⚠️ No se pudo acceder a la cámara. Revisa los permisos del navegador.', true);
    return;
  }
  const v = $('#video');
  v.srcObject = stream;
  v.onloadedmetadata = () => {
    if (v.videoWidth) $('#video-wrap').style.aspectRatio = v.videoWidth + '/' + v.videoHeight;
  };
  try { await v.play(); } catch (e) { /* autoplay ya activo */ }
  $('#idle').classList.add('hidden');
  $('#result').classList.add('hidden');
  $('#cam').classList.remove('hidden');
  startScanning();
}

function stopCamera() {
  scanning = false;
  clearTimeout(timer);
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  $('#video').srcObject = null;
}

/* ---------- OCR ---------- */
async function initWorker() {
  if (worker) return worker;
  if (!window.Tesseract) throw new Error('Tesseract no cargado');
  setStatus('Cargando OCR...');
  const w = await Tesseract.createWorker('eng');
  await w.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
    tessedit_pageseg_mode: '7'
  });
  worker = w;
  return w;
}

function captureFrame() {
  const v = $('#video');
  if (!v.videoWidth) return null;
  const sx = v.videoWidth * 0.1, sy = v.videoHeight * 0.35, sw = v.videoWidth * 0.8, sh = v.videoHeight * 0.3;
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = Math.round(640 * sh / sw);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.6)';
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function findPlate(text) {
  const up = (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i + 6 <= up.length; i++) {
    const s = up.substr(i, 6);
    if (/[A-Z]/.test(s) && /\d/.test(s)) return s.slice(0, 3) + '-' + s.slice(3);
  }
  return null;
}

function startScanning() {
  scanning = true;
  startedAt = Date.now();
  setStatus('Detectando placa...');
  loop();
}

async function loop() {
  if (!scanning) return;
  try {
    const w = await initWorker();
    if (!scanning) return;
    setStatus('Detectando placa...');
    const c = captureFrame();
    if (c) {
      const { data } = await w.recognize(c);
      if (!scanning) return;
      const p = data.confidence > 50 ? findPlate(data.text) : null;
      if (p) return found(p);
    }
    if (Date.now() - startedAt > 20000) setStatus('No se detecta ninguna placa. Acerca la cámara o escribe la placa manualmente.');
  } catch (e) {
    console.error(e);
    scanning = false;
    setStatus('⚠️ No se pudo cargar o ejecutar el OCR. Verifica tu conexión a Internet.');
    toast('⚠️ El OCR no pudo reconocer los caracteres. Puedes escribir la placa manualmente.', true);
    return;
  }
  timer = setTimeout(loop, 250);
}

function found(plate) {
  scanning = false;
  clearTimeout(timer);
  $('#video').pause();
  setStatus('');
  showResult(plate);
}

function showResult(plate) {
  $('#idle').classList.add('hidden');
  $('#result').classList.remove('hidden');
  const i = $('#plate-input');
  i.value = plate || '';
  i.focus();
  if (plate) i.select();
}

function retry() {
  $('#result').classList.add('hidden');
  if (stream) {
    $('#cam').classList.remove('hidden');
    $('#video').play().catch(() => {});
    startScanning();
  } else startCamera();
}

/* ---------- Guardar ---------- */
function cleanPlate(v) {
  v = v.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const raw = v.replace(/-/g, '');
  return raw.length === 6 ? raw.slice(0, 3) + '-' + raw.slice(3) : v;
}

async function savePlate() {
  const placa = cleanPlate($('#plate-input').value);
  if (placa.replace(/-/g, '').length < 4) { toast('⚠️ Escribe una placa válida antes de guardar.', true); return; }
  const now = new Date();
  try {
    await dbAdd({ placa, fecha: fmtFecha(now), hora: fmtHora(now), timestamp: now.toISOString() });
  } catch (e) { return dbError(e); }
  toast(`✓ Placa ${placa} guardada correctamente`);
  $('#result').classList.add('hidden');
  if (stream) {
    $('#cam').classList.remove('hidden');
    $('#video').play().catch(() => {});
    startScanning();
  } else resetScanUI();
}

/* ---------- Lista, búsqueda y eliminación ---------- */
async function renderList() {
  let all;
  try { all = await dbAll(); } catch (e) { return dbError(e); }
  all.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '') || b.id - a.id);
  $('#total').textContent = 'Total de placas: ' + all.length;
  const q = $('#search').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const rows = q ? all.filter(r => r.placa.replace(/-/g, '').includes(q)) : all;
  const ul = $('#list');
  if (!rows.length) {
    ul.innerHTML = `<li class="empty">${all.length ? 'No se encontraron placas con esa búsqueda.' : 'Aún no hay placas registradas. Escanea la primera.'}</li>`;
    return;
  }
  ul.innerHTML = rows.map(r => `<li><div><div class="plate">${esc(r.placa)}</div><div class="date">${esc(r.fecha)} — ${esc(r.hora)}</div></div><button class="del" data-id="${r.id}" data-p="${esc(r.placa)}">🗑️ Eliminar</button></li>`).join('');
}

function askDelete(id, placa) {
  deleteId = id;
  $('#modal-plate').textContent = placa;
  $('#modal').classList.remove('hidden');
}

async function confirmDelete() {
  const placa = $('#modal-plate').textContent;
  $('#modal').classList.add('hidden');
  try { await dbDelete(deleteId); } catch (e) { return dbError(e); }
  deleteId = null;
  await renderList();
  toast(`✓ Placa ${placa} eliminada correctamente.`);
}

/* ---------- Exportar / respaldo ---------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function sortedAsc() {
  const all = await dbAll();
  return all.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '') || a.id - b.id);
}

async function exportExcel() {
  try {
    if (!window.XLSX) throw new Error('XLSX no cargado');
    const all = await sortedAsc();
    if (!all.length) return toast('⚠️ No existen registros para exportar.', true);
    const rows = [['N°', 'Placa', 'Fecha', 'Hora']].concat(all.map((r, i) => [i + 1, r.placa, r.fecha, r.hora]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 12 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Placas');
    XLSX.writeFile(wb, `registro_placas_${isoDia()}.xlsx`);
    toast('✓ Excel descargado correctamente.');
  } catch (e) {
    console.error(e);
    toast('⚠️ No se pudo generar el Excel. Verifica tu conexión e inténtalo de nuevo.', true);
  }
}

async function createBackup() {
  try {
    const all = await sortedAsc();
    if (!all.length) return toast('⚠️ No existen registros para respaldar.', true);
    download(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }), `respaldo_placas_${isoDia()}.json`);
    toast('✓ Respaldo creado correctamente.');
  } catch (e) { dbError(e); }
}

async function restoreBackup(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every(r => r && typeof r.placa === 'string' && r.placa.trim())) throw new Error('formato');
  } catch (e) {
    toast('⚠️ El archivo de respaldo no es válido.', true);
    return;
  }
  try {
    const existing = await dbAll();
    const keys = new Set(existing.map(r => r.placa + '|' + r.timestamp));
    let added = 0;
    for (const r of data) {
      const d = r.timestamp ? new Date(r.timestamp) : new Date();
      const ok = !isNaN(d);
      const rec = {
        placa: r.placa.trim().toUpperCase(),
        fecha: r.fecha || (ok ? fmtFecha(d) : ''),
        hora: r.hora || (ok ? fmtHora(d) : ''),
        timestamp: ok ? d.toISOString() : new Date().toISOString()
      };
      const k = rec.placa + '|' + rec.timestamp;
      if (keys.has(k)) continue;
      keys.add(k);
      await dbAdd(rec);
      added++;
    }
    await renderList();
    toast(`✓ Respaldo restaurado: ${added} placa(s) agregada(s).`);
  } catch (e) { dbError(e); }
}

/* ---------- Inicio ---------- */
async function init() {
  try { db = await openDB(); } catch (e) { dbError(e); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  $('#tab-scan').onclick = () => show('scan');
  $('#tab-list').onclick = () => show('list');
  $('#btn-start').onclick = startCamera;
  $('#btn-manual').onclick = () => showResult('');
  $('#btn-stop').onclick = () => { stopCamera(); resetScanUI(); };
  $('#btn-save').onclick = savePlate;
  $('#btn-retry').onclick = retry;
  $('#plate-input').addEventListener('keydown', e => { if (e.key === 'Enter') savePlate(); });
  $('#search').addEventListener('input', renderList);
  $('#list').addEventListener('click', e => {
    const b = e.target.closest('.del');
    if (b) askDelete(Number(b.dataset.id), b.dataset.p);
  });
  $('#modal-cancel').onclick = () => $('#modal').classList.add('hidden');
  $('#modal-ok').onclick = confirmDelete;
  $('#btn-excel').onclick = exportExcel;
  $('#btn-backup').onclick = createBackup;
  $('#btn-restore').onclick = () => $('#file').click();
  $('#file').onchange = e => { restoreBackup(e.target.files[0]); e.target.value = ''; };
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) { stopCamera(); resetScanUI(); } });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
}

window.addEventListener('DOMContentLoaded', init);
})();

import { configured, savePlate, deletePlate, lastRecord, listPlates, searchPlates, countPlates, allPlates } from "./firebase.js";
import { Scanner, normalizePlate, isValidPlate } from "./scanner.js";
import { exportExcel } from "./export.js";

const $ = id => document.getElementById(id);
let dupFor = null, cursor = null, saving = false, searchT;

const setStatus = (t, c = "") => { $("status").textContent = t; $("status").className = "status " + c; };
function toast(msg, err) {
  const t = $("toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200);
}
const fmtDate = r => {
  if (!r.ms) return `${r.fecha} — ${r.hora}`;
  const d = new Date(r.ms);
  return `${r.fecha} — ${d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
};
const fbError = e => { console.error(e); toast("Error de conexión con Firebase", true); };

// ---------- Escáner ----------
const scanner = new Scanner($("video"), $("frame"), {
  onLive: () => { $("cam").classList.add("live"); $("idle").hidden = true; setStatus("Cámara activa"); },
  onStatus: t => setStatus(t),
  onPlate: p => { navigator.vibrate?.(60); showResult(p); },
  onError: e => { setStatus("Error de OCR", "err"); showResult(""); }
});

function camFail(e) {
  scanner.stop();
  $("cam").classList.remove("live"); $("idle").hidden = false;
  setStatus("Error de cámara", "err");
  let m = "No se pudo abrir la cámara.";
  if (!window.isSecureContext) m = "La cámara solo funciona con HTTPS. Abre la app desde su dirección https://.";
  else if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError")
    m = "Permiso de cámara denegado. En Chrome: toca el candado 🔒 junto a la dirección → Permisos → Cámara → Permitir. Luego recarga la página.";
  else if (e.name === "NotFoundError") m = "No se encontró ninguna cámara en este dispositivo.";
  else if (e.name === "NotReadableError") m = "La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.";
  $("camError").textContent = m; $("camError").hidden = false;
}

async function startCam() {
  $("camError").hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) return camFail({ name: "Unsupported" });
  setStatus("Abriendo cámara…"); $("idle").hidden = true;
  try { await scanner.start(); }
  catch (e) {
    if (e.kind === "ocr") { setStatus("Error de OCR", "err"); toast("No se pudo cargar el OCR. Escribe la placa a mano.", true); showResult(""); }
    else camFail(e);
  }
}

// ---------- Resultado / guardado ----------
function showResult(p) {
  $("plateInput").value = p; dupFor = null; $("dupWarn").hidden = true;
  $("btnSave").textContent = "Guardar placa";
  $("cam").classList.add("found");
  if (p) setStatus("Placa detectada", "ok");
  $("sheet").classList.add("show");
  if (!p) $("plateInput").focus();
}
function hideResult() { $("sheet").classList.remove("show"); $("cam").classList.remove("found"); }

function next() {
  hideResult();
  if (scanner.active) { setStatus("Detectando…"); scanner.resume(); } else startCam();
}

async function save() {
  if (saving) return;
  const p = normalizePlate($("plateInput").value);
  if (!p) return toast("Ingresa una placa", true);
  if (!isValidPlate(p)) return toast("Formato de placa no válido (ej. ABC-123)", true);
  $("plateInput").value = p;
  saving = true; $("btnSave").disabled = true; $("btnSave").textContent = "Guardando…"; setStatus("Guardando…");
  try {
    if (dupFor !== p) {
      const prev = await lastRecord(p);
      if (prev) {
        dupFor = p;
        $("dupWarn").textContent = `Esta placa ya fue registrada anteriormente: ${fmtDate(prev)}.`;
        $("dupWarn").hidden = false; $("btnSave").textContent = "Registrar de nuevo";
        return;
      }
    }
    await savePlate(p);
    toast(`✓ Placa ${p} guardada correctamente`);
    setStatus("Guardado correctamente", "ok");
    next();
  } catch (e) { fbError(e); $("btnSave").textContent = dupFor === p ? "Registrar de nuevo" : "Guardar placa"; }
  finally { saving = false; $("btnSave").disabled = false; }
}

// ---------- Lista ----------
const row = r => `<li><div class="info"><b>${r.placa}</b><span>${fmtDate(r)}</span></div><button class="del" data-id="${r.id}" data-placa="${r.placa}">🗑️ Eliminar</button></li>`;
async function loadList(more = false) {
  $("listError").hidden = true;
  try {
    if (!more) { cursor = null; $("list").innerHTML = ""; countPlates().then(n => $("total").textContent = `Total de placas: ${n}`).catch(() => {}); }
    const q = normalizeSearch($("search").value);
    if (q) {
      const recs = await searchPlates(q);
      $("list").innerHTML = recs.map(row).join("") || '<li class="empty">Sin resultados</li>';
      $("btnMore").hidden = true; return;
    }
    const res = await listPlates(cursor);
    cursor = res.cursor;
    $("list").insertAdjacentHTML("beforeend", res.recs.map(row).join(""));
    if (!more && !res.recs.length) $("list").innerHTML = '<li class="empty">Aún no hay placas. Escanea la primera.</li>';
    $("btnMore").hidden = !res.more;
  } catch (e) {
    console.error(e);
    $("listError").textContent = configured ? "Error de conexión con Firebase. Revisa tu internet y las reglas de Firestore." : "Firebase no está configurado. Completa js/firebase.js.";
    $("listError").hidden = false;
  }
}
const normalizeSearch = s => s.toUpperCase().replace(/\s/g, "");

// ---------- Eliminar (solo desde "Escaneados"; no existe edición) ----------
let pending = null;
$("list").onclick = e => {
  const b = e.target.closest(".del"); if (!b) return;
  pending = { id: b.dataset.id, placa: b.dataset.placa, li: b.closest("li") };   // aún NO se elimina
  $("cPlate").textContent = `"${pending.placa}"`;
  $("confirm").hidden = false;
};
const closeConfirm = () => { $("confirm").hidden = true; pending = null; };
$("cCancel").onclick = closeConfirm;
$("confirm").onclick = e => { if (e.target.id === "confirm" && !$("cOk").disabled) closeConfirm(); };
$("cOk").onclick = async () => {
  if (!pending) return;
  const { id, placa, li } = pending;
  $("cOk").disabled = $("cCancel").disabled = true; $("cOk").textContent = "Eliminando…";
  try {
    await deletePlate(id);
    li.remove();
    if (!$("list").children.length) $("list").innerHTML = `<li class="empty">${$("search").value ? "Sin resultados" : "Aún no hay placas. Escanea la primera."}</li>`;
    countPlates().then(n => $("total").textContent = `Total de placas: ${n}`).catch(() => {});
    toast(`✓ Placa ${placa} eliminada correctamente.`);
    closeConfirm();
  } catch (e) { fbError(e); closeConfirm(); }
  $("cOk").disabled = $("cCancel").disabled = false; $("cOk").textContent = "Eliminar";
};

// ---------- Eventos ----------
function show(v) {
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.id === "view-" + v));
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.view === v));
  if (v === "list") { scanner.stop(); $("cam").classList.remove("live"); $("idle").hidden = false; hideResult(); setStatus("Cámara apagada"); loadList(); }
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => show(b.dataset.view));
$("btnStart").onclick = startCam;
$("btnManual").onclick = () => { scanner.pause(); showResult(""); };
$("btnSave").onclick = save;
$("btnRetry").onclick = next;
$("plateInput").oninput = () => { dupFor = null; $("dupWarn").hidden = true; $("btnSave").textContent = "Guardar placa"; };
$("plateInput").onkeydown = e => e.key === "Enter" && save();
$("search").oninput = () => { clearTimeout(searchT); searchT = setTimeout(() => loadList(), 300); };
$("btnMore").onclick = () => loadList(true);
$("btnExport").onclick = async () => {
  const b = $("btnExport"); b.disabled = true; b.textContent = "Preparando…";
  try { exportExcel(await allPlates()); } catch (e) { fbError(e); }
  b.disabled = false; b.textContent = "📥 Descargar Excel";
};
if (!configured) { $("camError").textContent = "Firebase no está configurado. Completa js/firebase.js antes de guardar placas."; $("camError").hidden = false; }

// ============================================================
//  FIREBASE: pega aquí la configuración de tu proyecto
//  (Consola Firebase → Configuración del proyecto → Tus apps → Web)
// ============================================================
const firebaseConfig = {
  // apiKey: "...",
  // authDomain: "...",
  // projectId: "...",
  // storageBucket: "...",
  // messagingSenderId: "...",
  // appId: "..."
};

// Autenticación anónima (recomendada con las reglas del README).
// Para usar usuarios con correo en el futuro, reemplaza ensureAuth().
const USE_AUTH = true;

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc, query, where, orderBy, limit, startAfter,
         serverTimestamp, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const configured = !!firebaseConfig.projectId;
const app = configured ? initializeApp(firebaseConfig) : null;
const db = configured ? getFirestore(app) : null;
const PAGE = 50;
let authReady = null;

async function ensureAuth() {
  if (!configured) throw new Error("Firebase no configurado");
  if (!USE_AUTH) return;
  authReady ??= import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js")
    .then(async ({ getAuth, signInAnonymously }) => {
      const auth = getAuth(app);
      if (!auth.currentUser) await signInAnonymously(auth);
    }).catch(e => { authReady = null; throw e; });
  return authReady;
}

const col = () => collection(db, "placas");
const pad = n => String(n).padStart(2, "0");
export async function deletePlate(documentId) {
  await ensureAuth();
  await deleteDoc(doc(db, "placas", documentId));   // elimina el documento en Firestore
}

const toRec = d => {
  const x = d.data();
  return { id: d.id, placa: x.placa, fecha: x.fecha, hora: x.hora, ms: x.timestamp?.toMillis?.() ?? 0, snap: d };
};

export async function savePlate(placa) {
  await ensureAuth();
  const d = new Date();
  await addDoc(col(), {
    placa,
    fecha: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    hora: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    timestamp: serverTimestamp()
  });
}

export async function lastRecord(placa) {
  await ensureAuth();
  const s = await getDocs(query(col(), where("placa", "==", placa)));
  let best = null;
  s.forEach(d => { const r = toRec(d); if (!best || r.ms >= best.ms) best = r; });
  return best;
}

export async function listPlates(cursor) {
  await ensureAuth();
  const q = query(col(), orderBy("timestamp", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(PAGE));
  const s = await getDocs(q);
  const recs = s.docs.map(toRec);
  return { recs, cursor: s.docs.at(-1), more: s.size === PAGE };
}

export async function searchPlates(text) {
  await ensureAuth();
  const s = await getDocs(query(col(), where("placa", ">=", text), where("placa", "<=", text + "\uf8ff"), limit(100)));
  return s.docs.map(toRec).sort((a, b) => b.ms - a.ms);
}

export async function countPlates() {
  await ensureAuth();
  return (await getCountFromServer(col())).data().count;
}

export async function allPlates() {
  await ensureAuth();
  return (await getDocs(query(col(), orderBy("timestamp", "asc")))).docs.map(toRec);
}

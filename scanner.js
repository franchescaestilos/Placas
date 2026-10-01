// Cámara + OCR (Tesseract.js). Detecta placas dentro del marco central.
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const normalizePlate = s => {
  const c = (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c.length > 6 ? `${c.slice(0, c.length - 3)}-${c.slice(-3)}` : c;
};
// Formatos peruanos habituales: ABC-123, A1B-234, 1234-AB (moto/otros), 5–7 caracteres
export const isValidPlate = p => /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(p) || /^[A-Z0-9]{5,7}$/.test(p) || /^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/.test(p);

const DIGIT = { O: "0", Q: "0", I: "1", L: "1", Z: "2", S: "5", B: "8" };
function extract(text) {
  for (const line of text.toUpperCase().split("\n")) {
    const c = line.replace(/[^A-Z0-9]/g, "");
    for (let i = 0; i + 6 <= c.length; i++) {
      const head = c.slice(i, i + 3);
      const tail = [...c.slice(i + 3, i + 6)].map(ch => DIGIT[ch] ?? ch).join("");
      if (/^\d{3}$/.test(tail) && /[A-Z]/.test(head)) return `${head}-${tail}`;
    }
  }
  return null;
}

export class Scanner {
  constructor(video, frame, cb) { Object.assign(this, { video, frame, cb, stream: null, worker: null, running: false }); }
  get active() { return !!this.stream; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.cb.onLive();
    try {
      if (!this.worker) {
        this.cb.onStatus("Cargando OCR…");
        this.worker = await Tesseract.createWorker("eng");
        await this.worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-", tessedit_pageseg_mode: "7" });
      }
    } catch (e) { e.kind = "ocr"; throw e; }
    this.resume();
  }

  resume() { if (this.running || !this.worker) return; this.running = true; this.last = null; this.cb.onStatus("Detectando…"); this.loop(); }
  pause() { this.running = false; }
  stop() { this.pause(); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.video.srcObject = null; }

  crop() {
    const v = this.video, vr = v.getBoundingClientRect(), fr = this.frame.getBoundingClientRect();
    const s = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
    const sx = (fr.left - vr.left + (v.videoWidth * s - vr.width) / 2) / s;
    const sy = (fr.top - vr.top + (v.videoHeight * s - vr.height) / 2) / s;
    const sw = fr.width / s, sh = fr.height / s;
    const c = (this.canvas ??= document.createElement("canvas"));
    c.width = 520; c.height = Math.round(520 * sh / sw);
    const x = c.getContext("2d");
    x.filter = "grayscale(1) contrast(1.6)";
    x.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  async loop() {
    while (this.running) {
      try {
        const { data } = await this.worker.recognize(this.crop());
        const p = extract(data.text);
        if (this.running && p && data.confidence >= 55) {
          if (this.last === p || data.confidence >= 80) { this.running = false; this.cb.onPlate(p); return; }
          this.last = p;
        } else this.last = null;
      } catch (e) { this.running = false; e.kind = "ocr"; this.cb.onError(e); return; }
      await sleep(200);
    }
  }
}

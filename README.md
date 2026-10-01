# Registro de Placas

Web app móvil para registrar placas con la cámara (OCR en el navegador con Tesseract.js) y guardarlas en Firebase Firestore. Sin build: solo archivos estáticos.

## 1. Configurar Firebase
1. Entra a https://console.firebase.google.com → **Agregar proyecto**.
2. **Compilación → Firestore Database → Crear base de datos** (modo producción, región cercana, p. ej. `southamerica-east1`).
3. **Configuración del proyecto → Tus apps → Web (`</>`)**: registra la app y copia el objeto `firebaseConfig`.
4. Pégalo en **`js/firebase.js`** (sección `firebaseConfig`). Ahí no hay credenciales reales por defecto.
5. **Compilación → Authentication → Comenzar → Anónimo → Habilitar** (necesario porque `USE_AUTH = true`).
   Más adelante puedes cambiar a correo/contraseña modificando solo `ensureAuth()` en `js/firebase.js`.
6. **Firestore → Reglas**, pega y publica:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /placas/{id} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.keys().hasOnly(['placa','fecha','hora','timestamp'])
        && request.resource.data.placa is string
        && request.resource.data.placa.size() >= 5
        && request.resource.data.placa.size() <= 8;
      allow update: if false;           // las placas no se editan
      allow delete: if request.auth != null;   // solo se pueden eliminar
    }
  }
}
```
> Eliminar: cada registro usa su ID de documento de Firestore (`documentId`) y se borra de la base de datos tras confirmar. Sin la regla `delete` de arriba, Firestore rechazará la eliminación.
> La autenticación anónima evita escrituras sin pasar por la app, pero no identifica personas. Para control real de quién registra, usa correo/contraseña y limita las reglas por `request.auth.uid` o lista de correos.
> En Google Cloud → Credenciales, restringe la API key a tu dominio (HTTP referrers).

## 2. Publicar (HTTPS obligatorio para la cámara)
- **Netlify**: arrastra la carpeta en https://app.netlify.com/drop.
- **GitHub Pages**: sube el proyecto → Settings → Pages → rama `main`.
- **Vercel**: `vercel` dentro de la carpeta.
En Firebase → Authentication → Settings → **Dominios autorizados**, agrega tu dominio publicado.

## 3. Probar en Android
**Opción A (la más simple):** publica en Netlify, abre la URL `https://…` en Chrome del teléfono, pulsa **📷 Escanear placa** y acepta el permiso de cámara.
**Opción B (local):** `python -m http.server 8080` en la carpeta; conecta el teléfono por USB con depuración activada; en la PC abre `chrome://inspect/#devices` → *Port forwarding* `8080 → localhost:8080`; en el teléfono abre `http://localhost:8080` (localhost cuenta como contexto seguro).

Si la cámara falla: candado 🔒 junto a la URL → Permisos → Cámara → Permitir → recargar.

## Consejos para mejor lectura OCR
Buena luz, placa dentro del marco y paralela al teléfono, 30–60 cm. Si falla, corrige manualmente en el campo antes de guardar.

## Estructura
`index.html` · `css/style.css` · `js/app.js` (UI y flujo) · `js/scanner.js` (cámara + OCR + validación) · `js/firebase.js` (config + Firestore) · `js/export.js` (Excel)

## Notas
- La primera vez se descarga el motor OCR (~10 MB); luego queda en caché.
- Colección `placas`: `placa`, `fecha` (dd/mm/aaaa), `hora` (HH:mm), `timestamp`.
- La búsqueda es por prefijo (`ABC`, `ABC-1`). Primera consulta ordenada por `timestamp` puede pedir crear un índice simple automático; no requiere índices compuestos.

// Copia cyclocoach/ -> mobile/www/ para el build nativo de Capacitor.
// cyclocoach/index.html es el wizard "Crear Perfil" (sin guard de auth); en la
// web ese caso lo resuelve el redirect de vercel.json ("/" -> login.html), que
// no existe dentro de una app nativa. Aqui se sustituye por un redirect propio
// para que la app nativa arranque siempre en login.html.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'cyclocoach');
const DEST = path.join(__dirname, '..', 'www');

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

fs.writeFileSync(
  path.join(DEST, 'index.html'),
  '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body><script>location.replace("login.html");</script></body></html>\n'
);

console.log(`[mobile] www generado en ${DEST}`);

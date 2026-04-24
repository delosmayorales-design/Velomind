const jwt = require('jsonwebtoken');
const supabase = require('../db'); // ← ahora apunta a Supabase

const SECRET = process.env.JWT_SECRET || 'cyclocoach_dev_secret_change_in_prod';

async function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) {
    console.warn(`[Auth] 401: Petición sin cabecera Authorization en ${req.originalUrl}`);
    return res.status(401).json({ error: 'Token requerido', code: 'NO_TOKEN' });
  }

  if (!header.startsWith('Bearer ')) {
    console.warn(`[Auth] 401: Formato de cabecera inválido: "${header.substring(0, 15)}..."`);
    return res.status(401).json({ error: 'Formato de cabecera inválido. Debe ser Bearer <token>', code: 'INVALID_HEADER_FORMAT' });
  }

  const token = header.split(' ')[1];

  if (!token || token === 'null' || token === 'undefined' || token === '') {
    console.warn(`[Auth] 401: Sesión nula o vacía en ${req.originalUrl}`);
    return res.status(401).json({ 
      error: 'Tu sesión ha expirado o no es válida. Por favor, inicia sesión de nuevo.', 
      code: 'INVALID_SESSION' 
    });
  }

  if (!token.includes('.')) {
    console.error(`[Auth] ❌ ERROR CRÍTICO: Se recibió un token de Strava en la cabecera Authorization.`);
    return res.status(401).json({ 
      error: 'Error de Integración: El navegador está enviando el token de Strava como si fuera tu sesión de VeloMind.',
      code: 'STRAVA_TOKEN_IN_HEADER'
    });
  }

  if (token.split('.').length !== 3) {
    console.warn(`[Auth] 401: Sesión corrupta detectada. El token recibido es: "${token.substring(0, 15)}..."`);
    return res.status(401).json({ 
      error: 'Sesión corrupta. Por favor, cierra sesión y vuelve a entrar.', 
      code: 'INVALID_JWT'
    });
  }

  try {
    const payload = jwt.verify(token, SECRET);
    const userId = payload.id; // Se elimina parseInt() para soportar UUIDs de Supabase

    // ✅ Consulta a Supabase en vez de SQLite
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('id', userId)
      .single();

    if (error || !user) {
      console.warn(`[Auth] 401: Usuario ID ${userId} no encontrado en Supabase.`);
      return res.status(401).json({ 
        error: 'Usuario no encontrado. Por favor, inicia sesión de nuevo.', 
        code: 'USER_NOT_FOUND' 
      });
    }

    req.user = user;
    next();
  } catch (e) {
    console.error('[Auth] Error validando JWT:', e.message);
    const code = e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    return res.status(401).json({ error: e.message, code });
  }
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

module.exports = { requireAuth, signToken };

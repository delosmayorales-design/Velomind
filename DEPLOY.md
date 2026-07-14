# Guía de Deploy — VeloMind / CycloCoach Pro

Como la base de datos está alojada externamente en **Supabase**, el despliegue del backend (Node.js/Express) es muy sencillo. 

> ⚠️ **Nota importante sobre Vercel:** No se recomienda desplegar este backend en Vercel u otros entornos puramente "Serverless" debido a que la ruta de análisis biomecánico en vídeo utiliza `multer` para escritura temporal en disco, lo cual genera errores en sistemas de archivos de solo lectura.

Se recomienda el uso de **Render.com** o **Railway.app**.

## Despliegue en Render.com (Recomendado)

1. Sube tu código a un repositorio de **GitHub**.
2. Crea una cuenta en Render.com.
3. Haz clic en **"New"** -> **"Web Service"**.
4. Conecta tu repositorio de GitHub.
5. Configura los comandos de despliegue:
   - **Root Directory:** `backend` (si el package.json está ahí) o dejar en blanco si está en la raíz.
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`

## Variables de Entorno (Environment Variables)

Debes añadir las siguientes variables en el panel de control de tu hosting (Render/Railway):

* `SUPABASE_URL`: Tu URL del proyecto de Supabase (ej: https://xxx.supabase.co)
* `SUPABASE_SERVICE_ROLE_KEY`: Clave de servicio de Supabase (usada por `backend/db.js`)
* `JWT_SECRET`: Una contraseña larga e inventada para firmar las sesiones — **obligatoria**,
  el servidor no arranca sin ella, en ningún entorno.
* `JWT_EXPIRES_IN`: Duración del token (opcional, por defecto `7d`)
* `ADMIN_EMAIL`: Email que se marca como administrador (opcional)
* `ALLOWED_ORIGINS`: Lista de orígenes permitidos por CORS, separados por coma
* `FRONTEND_URL`: URL del frontend (usada en emails y redirects de OAuth/verificación)
* `BACKEND_URL`: URL pública del backend (usada en el enlace de verificación de email)
* `GOOGLE_API_KEY`: API Key de Gemini (Necesaria para análisis biomecánico de video)
* `ANTHROPIC_API_KEY`: API Key de Claude (Opcional)
* `OPENAI_API_KEY`: API Key de OpenAI (Opcional)
* `GROQ_API_KEY`: API Key de Groq (Opcional, modelo Llama rápido)
* `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`: Credenciales de tu app de Strava
* `STRAVA_REDIRECT_URI`: Ej: https://api.velomind.org/api/providers/strava/callback
* `GARMIN_CLIENT_ID` / `GARMIN_CLIENT_SECRET` / `GARMIN_REDIRECT_URI`: Credenciales OAuth2 de Garmin
* `SENDGRID_API_KEY`: Clave de SendGrid (recuperación de contraseña y verificación de email)
* `SENDGRID_FROM_EMAIL`: Remitente de los correos transaccionales
* `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL`: Claves para notificaciones push (web-push)

### Pagos (Stripe) — preparado, todavía no activo

No es necesario configurar esto para desplegar hoy: el cobro real está deliberadamente
apagado hasta que haya un volumen de usuarios que lo justifique (ver `PREMIUM_ENFORCEMENT`
más abajo). Cuando se decida activarlo, hace falta:

* Instalar el paquete `stripe` en `backend/package.json` (hoy no está instalado)
* `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
* `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`: IDs de precio de Stripe
* `PREMIUM_ENFORCEMENT=true`: activa el bloqueo real de las funciones de IA para
  usuarios sin suscripción (con esta variable ausente o en `false`, no cambia nada
  para nadie — es el interruptor para encender el cobro)

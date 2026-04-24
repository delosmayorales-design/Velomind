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
* `SUPABASE_ANON_KEY`: Tu clave pública de Supabase
* `JWT_SECRET`: Una contraseña larga e inventada para cifrar las sesiones
* `GOOGLE_API_KEY`: API Key de Gemini (Necesaria para análisis biomecánico de video)
* `ANTHROPIC_API_KEY`: API Key de Claude (Opcional)
* `OPENAI_API_KEY`: API Key de OpenAI (Opcional)
* `GROQ_API_KEY`: API Key de Groq (Opcional, modelo Llama rápido)
* `STRAVA_CLIENT_ID`: ID de tu app de Strava
* `STRAVA_CLIENT_SECRET`: Secreto de tu app de Strava
* `STRAVA_REDIRECT_URI`: Ej: https://tu-app.onrender.com/integrations.html

# Despliegue y Operaciones (DevOps) — VeloMind

Esta guía define los procedimientos recomendados para desplegar VeloMind en entornos de producción.

---

## 1. Topología del Despliegue

La arquitectura requiere la separación de tres capas operativas:

1. **Base de Datos (BaaS):** Alojado en Supabase.
2. **Backend (Node.js REST API):** Alojado en un proveedor de infraestructura como código con sistema de archivos persistente o temporal (Render.com, Railway.app, DigitalOcean).
3. **Frontend (Static / SPA):** Alojado en un CDN o edge network (Vercel, Netlify, GitHub Pages o el mismo servidor Node).

> ⚠️ **RESTRICCIÓN IMPORTANTE:** El backend de VeloMind **NO DEBE** desplegarse en entornos puramente "Serverless" como Vercel Functions o AWS Lambda de forma directa. La funcionalidad de análisis de vídeo (`/biomechanics-video`) requiere el uso de `multer` para guardar archivos grandes (hasta 100MB) temporalmente en disco. Recomendamos **Render.com (Web Service)** o **Railway**.

---

## 2. Variables de Entorno (`.env`)

El backend requiere las siguientes variables configuradas en el proveedor de hosting para funcionar correctamente:

### Seguridad y Base de Datos
```env
PORT=3000
JWT_SECRET=generar_una_cadena_larga_y_aleatoria_para_produccion
SUPABASE_URL=https://[ID-PROYECTO].supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1...
FRONTEND_URL=https://www.velomind.org  # Usado para redirecciones OAuth y CORS
```

### Proveedores de Inteligencia Artificial (Solo uno es estrictamente requerido)
```env
GOOGLE_API_KEY=AIzaSy...           # Principal, requerida para el análisis en vídeo
GEMINI_MODEL=gemini-1.5-flash      # Opcional, por defecto gemini-1.5-flash
ANTHROPIC_API_KEY=sk-ant-...       # Fallback de texto
OPENAI_API_KEY=sk-proj-...         # Fallback de texto
GROQ_API_KEY=gsk_...               # Fallback de respuesta rápida
```

### Integraciones Deportivas
```env
STRAVA_CLIENT_ID=12345
STRAVA_CLIENT_SECRET=abcdef123456...
STRAVA_REDIRECT_URI=https://api.velomind.com/api/providers/strava/callback

GARMIN_CLIENT_ID=tu_garmin_client_id
GARMIN_CLIENT_SECRET=tu_garmin_client_secret
GARMIN_REDIRECT_URI=https://api.velomind.com/api/providers/garmin/callback
```

---

## 3. Instrucciones de Deploy en Render.com (Backend)

1. Crea un **Web Service** en Render.
2. Conecta tu repositorio de GitHub.
3. Configura:
   - **Root Directory:** `backend` (si el backend está en una subcarpeta) o vacío si la raíz de git contiene el package.json.
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. Ve a la pestaña **Environment** y carga las variables listadas arriba.

---

## 4. Instrucciones de Deploy FrontEnd (Vercel)

El directorio `cyclocoach` (que contiene el index.html, css, js) es un sitio estático que puede estar desacoplado.
1. Importa el repositorio a Vercel.
2. **Framework Preset:** Selecciona `Other`.
3. **Root Directory:** `cyclocoach`.
4. Para asegurarte de que el FrontEnd apunte correctamente al BackEnd de Producción, edita en `js/auth.js` o inyecta en tu build un script que declare: `window.API_URL = "https://tu-backend-en-render.com/api";`

---

## 5. Actualizaciones de la Base de Datos (Migrations)

Al utilizar Supabase, puedes conectar tu proyecto local vía CLI (`supabase start`) y generar migraciones SQL, o utilizar el Dashboard de Supabase para añadir columnas nuevas cuando evolucione la aplicación. Asegúrate de replicar la tabla `password_reset_tokens` y `pmc` cuando despliegues una instancia de cero.
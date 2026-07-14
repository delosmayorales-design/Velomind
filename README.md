# 🚴 VeloMind — Entrenador Personal de Ciclismo con IA

Plataforma de entrenamiento ciclista de alto rendimiento que utiliza **IA (Gemini/Claude)** y datos reales de **Strava/Garmin** para generar planes de entrenamiento, nutrición y análisis biomecánico.

---

## 🏗️ Arquitectura

```
AppCoach/
├── backend/                    # Node.js + Express + Supabase (Postgres)
│   ├── server.js               # Punto de entrada
│   ├── db.js                   # Cliente de Supabase
│   ├── .env                    # Variables de entorno (NO subir a git)
│   ├── .env.example            # Plantilla
│   ├── middleware/
│   │   ├── auth.js             # Validación JWT (requireAuth, requireAdmin)
│   │   └── subscriptionMiddleware.js  # Gating Premium (preparado, apagado — ver Pagos)
│   ├── migrations/              # Cambios de esquema, aplicados a mano en Supabase SQL Editor
│   ├── routes/
│   │   ├── auth.js             # Registro, login, verificación de email, perfil, borrado de cuenta
│   │   ├── activities.js       # CRUD actividades + batch sync
│   │   ├── analytics.js        # PMC, zonas, récords, semanal
│   │   ├── providers.js        # Strava/Garmin/Google Fit OAuth + sync real
│   │   ├── body.js             # Registro de peso corporal
│   │   ├── coach.js            # Coach IA: análisis, biomecánica, nutrición, estrategia de carrera
│   │   ├── garage.js           # Mi Garaje: bicis, componentes, mantenimiento
│   │   ├── plans.js            # Planes de entrenamiento/nutrición, biomecánica, export FIT
│   │   ├── payments.js         # Checkout/portal/webhook de Stripe (preparado, no activo)
│   │   ├── routes.js           # Rutas guardadas por el usuario
│   │   ├── groupRides.js       # Salidas grupales: crear, unirse, chat, invitaciones
│   │   ├── push.js             # Notificaciones push (web-push)
│   │   ├── wellness.js         # Registro de bienestar/sueño
│   │   └── feedback.js         # Feedback de usuarios con respuesta de admin
│   └── services/
│       ├── pmc.js              # CTL/ATL/TSB (fórmula TrainingPeaks)
│       ├── ai.js                # Cascada de proveedores de IA (Anthropic/OpenAI/Gemini/Groq)
│       ├── planRecalculator.js  # Recalculo/adaptación de plan semanal
│       ├── pushScheduler.js     # Recordatorios y alertas programadas
│       └── demoCleanup.js       # Borrado diario de cuentas demo
│
└── cyclocoach/                 # Frontend HTML/CSS/JS (sin build step)
    ├── login.html              # Login/registro con JWT
    ├── verify-email.html       # Confirmación de email
    ├── index.html              # Onboarding — crear perfil de atleta
    ├── dashboard.html          # Dashboard PMC + métricas
    ├── activities.html         # Importar GPX/TCX/CSV + sync Strava
    ├── analytics.html          # Análisis avanzado de rendimiento
    ├── training-plan.html      # Plan de entrenamiento personalizado
    ├── nutrition.html          # Plan de nutrición por objetivo
    ├── body-weight.html        # Seguimiento peso + W/kg
    ├── integrations.html       # Conectar Strava/Garmin
    ├── garaje.html              # Mi Garaje: bicis y mantenimiento
    ├── salidas-grupales.html   # Salidas grupales
    ├── pricing.html             # Planes Free/Premium
    ├── feedback.html            # Feedback de usuarios
    ├── js/
    │   ├── auth.js             # Módulo JWT (habla con backend)
    │   ├── backend-sync.js     # Sincronización frontend ↔ backend
    │   ├── app.js              # Motor: AppState, PMC, planes, parsers
    │   ├── fit-encoder.js       # Exportación de entrenos a FIT/TCX/ZWO
    │   └── meal-generator.js    # Generador de menús de nutrición
    └── css/
        └── style.css           # Diseño oscuro profesional
```

---

## ⚡ Arranque Rápido

### 1. Instalar backend

```bash
cd backend
npm install
```

### 2. Configurar variables de entorno

```bash
# Copia backend/.env.example a backend/.env y completa, como mínimo:
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
# El servidor NO arranca si falta JWT_SECRET, en ningún entorno.
```

### 3. Iniciar backend

```bash
node server.js
# ó en desarrollo con auto-reload:
node --watch server.js
```

Verás:
```
🚴 VeloMind Backend v2.0
🚀 http://localhost:3000
```

### 4. Servir frontend

```bash
# En AppCoach/ (directorio raíz)
npx http-server . --port 8085
```

### 5. Abrir en el navegador

```
http://localhost:8085/cyclocoach/login.html
```

---

## 🔑 Flujo de autenticación

```
Usuario → login.html
         POST /api/auth/register       →  bcryptjs hash + JWT + email de verificación
         GET  /api/auth/verify-email   →  el usuario confirma desde el enlace del correo
         POST /api/auth/login          →  verificar hash + JWT (403 si el email no está verificado)
         GET  /api/auth/verify         →  validar JWT en cada página
         PUT  /api/auth/profile        →  guardar perfil de atleta

Todas las páginas protegidas cargan js/auth.js que:
  1. Lee el token JWT de localStorage
  2. Redirige a login.html si no hay token o está expirado
  3. Verifica el token con el backend en segundo plano
  4. Fallback offline: usa datos de localStorage si el backend no responde
```

---

## 🔌 Conectar Strava (opcional)

1. Ve a [strava.com/settings/api](https://www.strava.com/settings/api)
2. Crea una aplicación y copia el **Client ID** y **Client Secret**
3. Pon como URL de callback: `http://localhost:8085/cyclocoach/oauth-callback.html`
4. Edita `backend/.env`:
   ```
   STRAVA_CLIENT_ID=tu_client_id
   STRAVA_CLIENT_SECRET=tu_client_secret
   ```
5. Reinicia el backend
6. En la app: **Integraciones → Conectar Strava**

Sin credenciales de Strava, la app funciona en **modo demo** (genera actividades realistas basadas en tu FTP).

---

## 📊 Qué hace la app

### Como entrenador personal
- Calcula **CTL** (fitness), **ATL** (fatiga) y **TSB** (forma) con la fórmula exacta de TrainingPeaks
- Genera planes semanales reales según tu **FTP, objetivo y horas disponibles**:
  - **Resistencia**: 80/20, fondones Z2, tempo progresivo
  - **Subir FTP**: clásico 2×20 min, sweetspot, intervalos umbral
  - **VO₂ Max**: 4×4, 5×5, micro-intervalos
  - **Gran Fondo**: simulacros de 4-6h, bloques en subidas
  - **Sprints**: potencia neuromuscular, series anaeróbicas
- Cada sesión incluye **estructura detallada**: calentamiento, intervalos con vatios exactos, recuperación, vuelta a la calma
- Detecta la fase automáticamente (base, build, pico, carrera, recuperación) según la fecha del evento

### Como nutricionista
- Calcula calorías diarias según metabolismo basal + gasto de entreno
- Distribuye macros (proteína, carbohidratos, grasa) según objetivo y día de entreno
- Genera estrategia de **nutrición en carrera** (60-90g/h carbohidratos para salidas +90 min)
- Pre-workout, intra-workout y post-workout personalizados

### Seguimiento de composición corporal
- Registro diario de peso, % grasa, % músculo
- Calcula **W/kg** en tiempo real con escala de categorías Coggan
- IMC, masa grasa, masa magra
- Proyección de objetivo de peso con fecha estimada

---

## 🗄️ Base de datos

**Supabase (Postgres)** — cliente en `backend/db.js`, cambios de esquema en `backend/migrations/*.sql` (se aplican a mano en el SQL Editor de Supabase, no hay runner automático):

| Tabla | Descripción |
|---|---|
| `users` | Usuarios con perfil de atleta, tokens OAuth, `email_verified`, `subscription_tier` |
| `activities` | Actividades con métricas de potencia, HR, TSS calculado |
| `weight_log` | Historial de peso y composición corporal |
| `pmc` | PMC calculado (CTL/ATL/TSB) persistido por día |
| `training_plans` / `training_plans_history` | Plan semanal actual e histórico de generaciones |
| `nutrition_plans` | Planes de nutrición guardados |
| `bikes` / `bike_components` / `component_history` | Mi Garaje: bicis, componentes y su historial de mantenimiento |
| `group_rides` / `group_ride_participants` / `group_ride_comments` / `group_ride_invitations` | Salidas grupales |
| `password_reset_tokens` / `email_verification_tokens` | Tokens de un solo uso para recuperar contraseña y confirmar email |
| `stripe_webhook_events` | Idempotencia de webhooks de Stripe (preparado, no activo) |
| `feedback` | Feedback de usuarios con respuesta de admin |

---

## 🔐 Seguridad

- Passwords: **bcryptjs** (10 rounds)
- Tokens: **JWT**, expiración configurable (`JWT_EXPIRES_IN`, por defecto 7 días). El servidor
  **no arranca** si `JWT_SECRET` no está definido, en ningún entorno.
- Verificación de email obligatoria para cuentas nuevas (los usuarios ya existentes quedan
  verificados automáticamente al desplegar la migración).
- CORS: allowlist exacto de orígenes en `ALLOWED_ORIGINS` (sin comodines de subdominio).
- Rate limiting en memoria en login/registro/demo/recuperación de contraseña y en las
  rutas de IA de `coach.js`.
- Sin datos sensibles en frontend (tokens OAuth solo en la base de datos del backend).

**Para producción:**
1. `JWT_SECRET` como una cadena aleatoria de 64+ caracteres (obligatorio, no hay valor por defecto)
2. Usar HTTPS
3. Cambiar `NODE_ENV=production`
4. Ver `DEPLOY.md` para la lista completa de variables de entorno necesarias

---

## 📡 API completa

| Método | Endpoint | Auth | Descripción |
|---|---|---|---|
| POST | /api/auth/register | ❌ | Crear cuenta |
| POST | /api/auth/login | ❌ | Login |
| POST | /api/auth/demo | ❌ | Demo login |
| GET | /api/auth/verify | ✅ | Verificar JWT + perfil completo |
| PUT | /api/auth/profile | ✅ | Actualizar perfil atleta |
| GET | /api/activities | ✅ | Listar actividades (con filtros) |
| POST | /api/activities | ✅ | Crear/actualizar actividad |
| POST | /api/activities/batch | ✅ | Sync batch (Strava/Garmin) |
| DELETE | /api/activities/:id | ✅ | Eliminar actividad |
| GET | /api/analytics/pmc | ✅ | CTL/ATL/TSB últimos N días |
| GET | /api/analytics/summary | ✅ | Estadísticas totales |
| GET | /api/analytics/zones | ✅ | Distribución por zonas Coggan |
| GET | /api/analytics/records | ✅ | Récords personales |
| GET | /api/analytics/weekly | ✅ | Resumen últimas 12 semanas |
| GET | /api/providers/strava/connect | ✅ | URL OAuth Strava (state firmado con HMAC) |
| POST | /api/providers/strava/callback | ✅ | Intercambio de token |
| POST | /api/providers/strava/sync | ✅ | Sincronizar actividades |
| GET | /api/providers/status | ✅ | Estado conexiones (Strava/Garmin/Google Fit) |
| GET | /api/body/weight | ✅ | Historial de peso |
| POST | /api/body/weight | ✅ | Guardar peso |
| DELETE | /api/body/weight/:date | ✅ | Eliminar entrada |
| GET | /api/auth/verify-email | ❌ | Confirma el email desde el enlace del correo |
| POST | /api/auth/resend-verification | ❌ | Reenvía el email de confirmación |
| DELETE | /api/auth/account | ✅ | Borra la cuenta y todos sus datos, en cascada e inmediato |
| GET/POST | /api/coach/* | ✅ (+Premium¹) | Coach IA: análisis, biomecánica, nutrición, estrategia de carrera |
| GET/POST/PATCH/DELETE | /api/garage/* | ✅ | Mi Garaje: bicis, componentes, mantenimiento |
| GET/POST/PATCH/DELETE | /api/group-rides/* | ✅ | Salidas grupales, chat, invitaciones |
| POST | /api/payments/create-checkout | ✅ | Checkout de Stripe (preparado, no activo) |
| POST | /api/payments/webhook | ❌ | Webhook de Stripe, body crudo (preparado, no activo) |
| GET/POST | /api/feedback | ✅ | Feedback de usuarios |
| GET | /api/health | ❌ | Health check |
| GET | /api/version | ❌ | Commit SHA desplegado (usado para verificar despliegues) |

¹ Las rutas de IA de `coach.js` exigen suscripción Premium solo si `PREMIUM_ENFORCEMENT=true` — hoy esa variable no está definida en ningún entorno, así que no bloquean a nadie todavía (ver `DEPLOY.md`).

---

## 🧪 Prueba rápida con cURL

```bash
# Registrar
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"jose@test.com","password":"test123","name":"José"}'

# Login (guarda el token)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jose@test.com","password":"test123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Actualizar perfil con FTP
curl -X PUT http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ftp":280,"weight":68,"age":38,"goal":"ftp","weekly_hours":10}'

# Ver estadísticas
curl http://localhost:3000/api/analytics/summary \
  -H "Authorization: Bearer $TOKEN"

# PMC
curl http://localhost:3000/api/analytics/pmc?days=30 \
  -H "Authorization: Bearer $TOKEN"
```

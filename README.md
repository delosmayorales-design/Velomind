# 🚴 VeloMind — Entrenador Personal de Ciclismo con IA

Plataforma de entrenamiento ciclista de alto rendimiento que utiliza **IA (Gemini/Claude)** y datos reales de **Strava/Garmin** para generar planes de entrenamiento, nutrición y análisis biomecánico.

---

## 🏗️ Arquitectura

```
AppCoach/
├── backend/                    # Node.js + Express + SQLite
│   ├── server.js               # Punto de entrada
│   ├── db.js                   # SQLite (sql.js, sin compilación nativa)
│   ├── .env                    # Variables de entorno (NO subir a git)
│   ├── .env.example            # Plantilla
│   ├── middleware/
│   │   └── authMiddleware.js   # Validación JWT
│   ├── routes/
│   │   ├── auth.js             # Registro, login, perfil
│   │   ├── activities.js       # CRUD actividades + batch sync
│   │   ├── analytics.js        # PMC, zonas, récords, semanal
│   │   ├── providers.js        # Strava OAuth + sync real
│   │   └── body.js             # Registro de peso corporal
│   └── services/
│       └── pmc.js              # CTL/ATL/TSB (fórmula TrainingPeaks)
│
└── cyclocoach/                 # Frontend HTML/CSS/JS
    ├── login.html              # Login/registro con JWT
    ├── index.html              # Onboarding — crear perfil de atleta
    ├── dashboard.html          # Dashboard PMC + métricas
    ├── activities.html         # Importar GPX/TCX/CSV + sync Strava
    ├── analytics.html          # Análisis avanzado de rendimiento
    ├── training-plan.html      # Plan de entrenamiento personalizado
    ├── nutrition.html          # Plan de nutrición por objetivo
    ├── body-weight.html        # Seguimiento peso + W/kg
    ├── integrations.html       # Conectar Strava/Garmin
    ├── js/
    │   ├── auth.js             # Módulo JWT (habla con backend)
    │   ├── backend-sync.js     # Sincronización frontend ↔ backend
    │   └── app.js              # Motor: AppState, PMC, planes, parsers
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
# El archivo .env ya tiene valores de desarrollo por defecto
# Para producción, edita .env y cambia JWT_SECRET
```

### 3. Iniciar backend

```bash
node server.js
# ó en desarrollo con auto-reload:
node --watch server.js
```

Verás:
```
🚴 CycloCoach Pro Backend v2.0
🚀 http://localhost:3000
✅ SQLite listo: ./database.db
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
         POST /api/auth/register  →  bcryptjs hash + JWT
         POST /api/auth/login     →  verificar hash + JWT
         GET  /api/auth/verify    →  validar JWT en cada página
         PUT  /api/auth/profile   →  guardar perfil de atleta

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

SQLite con `sql.js` (sin compilación nativa — funciona en cualquier Node.js):

| Tabla | Descripción |
|---|---|
| `users` | Usuarios con perfil de atleta completo (FTP, peso, objetivo...) |
| `activities` | Actividades con métricas de potencia, HR, TSS calculado |
| `weight_log` | Historial de peso y composición corporal |
| `pmc` | PMC calculado (CTL/ATL/TSB) persistido por día |
| `training_plans` | Planes semanales guardados |
| `nutrition_plans` | Planes de nutrición guardados |

---

## 🔐 Seguridad

- Passwords: **bcryptjs** (10 rounds, sin dependencias nativas)
- Tokens: **JWT** con expiración de 7 días
- CORS: solo orígenes configurados en `.env`
- Sin datos sensibles en frontend (tokens OAuth en DB del backend)

**Para producción:**
1. Cambiar `JWT_SECRET` por una cadena aleatoria de 64+ caracteres
2. Usar HTTPS
3. Cambiar `NODE_ENV=production`
4. Considerar migrar a PostgreSQL para alta concurrencia

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
| GET | /api/providers/strava/connect | ✅ | URL OAuth Strava |
| POST | /api/providers/strava/callback | ✅ | Intercambio de token |
| POST | /api/providers/strava/sync | ✅ | Sincronizar actividades |
| GET | /api/providers/status | ✅ | Estado conexiones |
| GET | /api/body/weight | ✅ | Historial de peso |
| POST | /api/body/weight | ✅ | Guardar peso |
| DELETE | /api/body/weight/:date | ✅ | Eliminar entrada |
| GET | /api/health | ❌ | Health check |

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

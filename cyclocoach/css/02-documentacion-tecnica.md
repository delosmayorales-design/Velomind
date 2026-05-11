# Documentación Técnica — VeloMind

Este documento detalla la arquitectura, el stack y el modelo de datos para facilitar el mantenimiento y escalabilidad de VeloMind.

---

## 1. Arquitectura General

VeloMind es una aplicación web clásica con arquitectura Cliente-Servidor separada:
- **Frontend:** Vanilla JS, HTML5, CSS3. Preparado como PWA (Progressive Web App).
- **Backend:** Node.js con Express. Provee la API REST.
- **Base de Datos:** Supabase (PostgreSQL) para persistencia.

---

## 2. Stack Tecnológico

- **Backend:**
  - `express`: Framework HTTP.
  - `supabase-js`: Cliente ORM/Query Builder para interactuar con la base de datos PostgreSQL.
  - `bcryptjs`: Hashing de contraseñas.
  - `jsonwebtoken` (implícito en middleware auth): Gestión de sesiones seguras.
  - `multer`: Gestión de subida de archivos temporales (fotos de perfil, parseo de vídeos/GPX).

- **Frontend:**
  - Javascript puro (ES6+) con patrón de módulos (IFFF).
  - `Chart.js`: Para el renderizado del PMC y métricas.
  - CSS Custom Properties (Variables) para el sistema de diseño (Apex Dark) y soporte de Light/Dark mode.

- **IA Integrada (Módulo Coach):**
  - Funciona mediante un proxy en el backend que abstrae los SDKs de `Anthropic`, `OpenAI`, `Google Gemini` y `Groq`.
  - Permite fallback de modelos (si Gemini falla, se usa Claude o Groq).

---

## 3. Estructura de Directorios

```text
AppCoach/
├── backend/
│   ├── routes/              # Controladores (auth.js, activities.js, coach.js, providers.js)
│   ├── services/            # Lógica de negocio (pmc.js, ai.js)
│   ├── middleware/          # authMiddleware.js (Validación JWT)
│   ├── db.js                # Instancia del cliente de Supabase
│   └── server.js            # Punto de entrada Express
└── cyclocoach/              # Frontend
    ├── css/style.css        # Sistema de diseño global
    ├── js/
    │   ├── auth.js          # Gestión JWT local
    │   ├── backend-sync.js  # Capa de red para consumo de la API REST
    │   └── app.js           # Lógica pesada cliente (Generación de planes, parser GPX)
    └── *.html               # Vistas (Dashboard, Plan, Analytics, Integraciones)
```

---

## 4. Flujo de Autenticación y Seguridad

1. **Registro/Login (`/api/auth`):** El usuario envía credenciales, `bcrypt` comprueba/hashea la clave en Supabase.
2. **JWT:** Se firma un token con `JWT_SECRET`. Se devuelve al frontend.
3. **Almacenamiento Cliente:** El frontend guarda el token en `localStorage` (como `velomind_token`).
4. **Peticiones Autorizadas:** El módulo `Auth` intercepta las llamadas a `backend-sync.js` e inyecta la cabecera `Authorization: Bearer <token>`.
5. **Middleware (`requireAuth`):** Express valida la firma del token antes de exponer los endpoints privados.

---

## 5. Motor de IA y Biomecánica (`coach.js`)

- **Plan Semanal:** Combina lógica determinista (cálculo de carga en base a TSS esperado, fase de la temporada, adherencia previa) con generación generativa (Prompt Engineering) para redactar descripciones precisas.
- **Recálculo Diario (`/today-adaptation`):** Prompt especializado que aplica constraints duros (ej. "NO añadir VO2Max si ayer hubo exceso de TSS").
- **Biomecánica (`/biomechanics-video`):** Usa `Google Gemini File API` para subir vídeos temporales. Se aplica un prompt de diagnóstico de pedaleo (estabilidad de cadera, recorrido de rodilla, técnica de tobillo).

---

## 6. Sincronización de Actividades (`providers.js`)

### Strava OAuth2
- Usa el flujo `authorization_code`.
- Los tokens (`strava_token`, `strava_refresh`) se guardan en la tabla `users`.
- El proceso de sincronización usa paginación incremental (`?after=TIMESTAMP`). Calcula la Potencia Normalizada (NP) y el TSS al vuelo en base al FTP actual del usuario si no viene pre-calculado.
- Se mapea el `gear_id` de Strava al id local del garaje para sumar kilómetros automáticamente.

---

## 7. Modelo de Datos Principal (Supabase)

- `users`: Perfil fisiológico, contraseñas, tokens OAuth.
- `activities`: Entrenamientos normalizados. Campos clave: `date`, `duration`, `distance`, `np`, `tss`, `if_value`, `source`.
- `pmc`: Tabla persistida diariamente con pre-cálculos de `ctl`, `atl`, `tsb` para mejorar tiempos de carga del dashboard.
- `bikes` y `bike_components`: Control de flota y mantenimientos.

---

## 8. Limitaciones Conocidas y Trabajo Futuro

1. **Límites de API de Strava:** El webhook de Strava (si se implementara en el futuro) tiene límites de llamadas. La sincronización actual es _Pull-based_ (el usuario o el login dispara la consulta). Cuidado con el límite de 100 req / 15 min de Strava.
2. **Parser en Cliente:** El parseo de archivos FIT/GPX se realiza actualmente en el frontend (`app.js`) usando librerías CDN para descargar trabajo del backend. Esto consume memoria local en el dispositivo del usuario al subir archivos grandes.
3. **Memoria Temporal:** El backend usa `multer` en la ruta `/tmp/` para procesar vídeos en `coach.js`. Esto prohíbe usar entornos puramente Serverless estrictos de solo lectura para esa funcionalidad específica.
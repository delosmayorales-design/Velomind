# 🎯 Sistema Dinámico de Adaptación de Planes de Entrenamiento
## AppCoach - Recalculator v1.0

---

## 📋 Descripción General

Se ha implementado un **sistema completo de recalculate dinámico** que detecta cambios en tu entrenamiento real vs planificado y adapta automáticamente tu plan de la semana.

### Características Principales
✅ **Detección automática de desviaciones**: Cuando tu TSS real difiere del plan
✅ **Recálculate inteligente**: Redistribuye entrenamientos respetando caps fisiológicos
✅ **Histórico completo**: Guardar todas las versiones de tu plan
✅ **Deshacer cambios**: Revierte a versión anterior si no te gusta la adaptación
✅ **Reporte semanal**: Visualiza todas las adaptaciones y su impacto

---

## 🔄 Cómo Funciona

### 1. **Triggers de Recalculation**

El sistema recalcula tu plan automáticamente cuando:

```
┌─────────────────────────────────────┐
│  EVENTOS QUE DISPARAN RECALC        │
├─────────────────────────────────────┤
│ ➕ Nueva actividad insertada        │
│ ✏️  Actividad modificada (TSS/NP)   │
│ 🔄 Manual: Botón "Regenerar"        │
│ 🛑 Fatiga crítica: TSB < -30        │
│ ⚠️  TSS exceeds: >+40 en un día      │
│ 📉 Sesión faltante: >50 TSS         │
│ 📊 Desviación total: >50 TSS        │
└─────────────────────────────────────┘
```

### 2. **Lógica de Decisión**

```javascript
¿Debo recalcular?

1. ¿Se pasó +40 TSS en algún día?         → SÍ, recalcula
2. ¿Faltó sesión importante (>50 TSS)?    → SÍ, recalcula
3. ¿Desviación total > ±50 TSS?           → SÍ, recalcula
4. ¿Sobreentrenamiento (TSB < -30)?       → SÍ, recalcula
5. ¿Todo dentro de toleras?               → NO, continúa plan
```

### 3. **Algoritmo de Redistribución**

Cuando se detecta una desviación, el sistema:

```
1. Calcula TSS actual vs planificado
   Semana planificada: 400 TSS
   Semana real hasta hoy: 480 TSS
   Delta: +80 TSS

2. Proyecta sesiones futuras
   Lunes (hecho): 150 TSS real
   Martes (hecho): 100 TSS real
   Miércoles-Domingo (futuro): 150 TSS cada uno

3. Redistribuye inteligentemente
   - Respeta MAX_TSS_PER_TYPE (long=185, threshold=115, etc)
   - Reduce 70% si TSB < -30 (fatiga crítica)
   - Mantiene distribución de fases (base/build/peak)

4. Guarda histórico
   - Versión anterior: almacenada para poder deshacer
   - Razón del cambio: guardada para auditoría
   - Estado del atleta: CTL/ATL/TSB en momento del cambio
```

---

## 📊 Dashboard - Interfaz Visual

### Tarjeta "Cambios Automáticos"

Aparece en el dashboard cuando hay adaptaciones:

```
┌─────────────────────────────────────┐
│ ⏰ Cambios automáticos              │
├─────────────────────────────────────┤
│ ➕ activity_inserted — Hace 2h       │
│   TSS: 380 → 420 (4 sesiones mod)  │
│                                     │
│ ✏️  activity_modified — Hace 4h      │
│   TSS: 420 → 450 (3 sesiones mod)  │
│                                     │
│ 📊 auto_recalculation — Hace 1h     │
│   TSS: 450 → 410 (2 sesiones mod)  │
│                                     │
│ [Ver todo (2 más) →]  [📊 Reporte] │
└─────────────────────────────────────┘
```

### Modal "Ver todo"

Muestra todas las adaptaciones con opción de **Deshacer**:

```
┌────────────────────────────────────────────┐
│ 🔄 Adaptaciones automáticas               │
├────────────────────────────────────────────┤
│ ➕ activity_inserted — Hoy 14:30          │
│ TSS: 380 → 420 | 4 sesiones modificadas  │
│ Razón: Se detectó actividad de 120 TSS  │
│                                [↶ Deshacer]│
│                                            │
│ ✏️  activity_modified — Hace 4h           │
│ TSS: 420 → 450 | 3 sesiones modificadas  │
│ Razón: Aumento de intensidad detectado   │
│                                [↶ Deshacer]│
│                                            │
│ 💡 Tip: Deshacer revierte a la versión   │
│ anterior. Usa si el cambio no te parece. │
└────────────────────────────────────────────┘
```

### Reporte Semanal (📊)

Estadísticas completas de la semana:

```
┌──────────────────────────────────────────┐
│ 📊 Reporte semanal                       │
├──────────────────────────────────────────┤
│ Resumen:                                 │
│   • 8 entrenamientos completados        │
│   • 2,340 TSS acumulados                │
│   • 18.5 horas en bici                  │
│   • 3 cambios automáticos               │
│                                          │
│ Cambios realizados:                      │
│   ✓ 2 Aprobados                         │
│   ⏳ 1 Pendiente                         │
│   ✗ 0 Rechazados                        │
│                                          │
│ Cambios significativos:                  │
│   ⚠️ TSS: 380 → 420 (+40)               │
│                                          │
│ Consejo del entrenador:                  │
│ "Excelente adherencia — tu semana       │
│  coincide con el plan. Continúa así."   │
└──────────────────────────────────────────┘
```

---

## ⏮️ Deshacer un Cambio

### Paso a Paso

1. **Ve al dashboard** → Sección "Cambios automáticos"
2. **Haz clic en "Ver todo →"** → Abre modal de adaptaciones
3. **Busca el cambio que quieres deshacer**
4. **Haz clic en "↶ Deshacer"** → Se revierte a versión anterior
5. **Confirma en la notificación** → Plan restaurado ✓

### Qué Sucede al Deshacer

```
ANTES:                    DESPUÉS:
Plan v2                   Plan v1
(Modificado)         →    (Original)

Miércoles: 150 TSS        Miércoles: 120 TSS
Jueves: 100 TSS           Jueves: 130 TSS
Viernes: 200 TSS          Viernes: 200 TSS
────────────              ────────────
Total: 450 TSS            Total: 450 TSS

✓ El cambio se revierte   ✓ Todos recuperan su distribución original
```

---

## 🗂️ Histórico de Planes

### Acceder al Histórico

1. Abre **Training Plan** (plan de entrenamiento)
2. Haz clic en **"Ver historial →"** (botón en la parte superior)
3. Se muestra timeline de todas las versiones

```
Timeline de Versiones:
┌─────────────────────┐
│ Lunes 10:30         │ ← Versión actual
│ Plan v5 (activo)    │
│ auto_recalculation  │
├─────────────────────┤
│ Lunes 09:15         │
│ Plan v4             │
│ activity_modified   │
├─────────────────────┤
│ Domingo 18:45       │
│ Plan v3             │
│ manual_regenerate   │
├─────────────────────┤
│ Viernes 14:20       │
│ Plan v2             │
│ activity_inserted   │
├─────────────────────┤
│ Viernes 08:00       │ ← Versión original
│ Plan v1 (inicial)   │
│ initial_generation  │
└─────────────────────┘
```

### Comparar Versiones

En el histórico puedes ver:
- **Sesiones iniciales propuestas** para cada versión
- **Razón del cambio** (qué disparó la recalculation)
- **Estado del atleta** en ese momento (CTL/ATL/TSB)
- **Delta de cambios** (qué sesiones se modificaron)

---

## 📊 Métricas y Umbrales

### Cuándo el Sistema Actúa

| Evento | Umbral | Acción |
|--------|--------|--------|
| **TSS Exceeding** | >+40 en 1 día | Recalculate |
| **TSS Missing** | >50 TSS en sesión faltante | Recalculate |
| **Total Delta** | >±50 TSS toda la semana | Recalculate |
| **Fatiga Crítica** | TSB < -30 | Reduce 70% próximas sesiones |
| **Sobreentrenamiento** | Varios indicadores | Aplica restricciones |

### Caps Respetados

El sistema nunca genera sesiones que excedan estos máximos (en TSS):

```
Long:        185 TSS
Endurance:   140 TSS
Threshold:   115 TSS
Tempo:       115 TSS
VO2Max:      115 TSS
Sprint:      100 TSS
Recovery:     45 TSS
```

---

## 🔧 Arquitectura Técnica

### Componentes Backend

1. **PlanRecalculator.js** (`backend/services/`)
   - Detecta desviaciones
   - Decide si recalcular
   - Redistribuye sesiones
   - Guarda histórico

2. **routes/plans.js** (endpoints)
   - `POST /plans/training/regenerate` - Regenerar plan
   - `GET /plans/training/history` - Ver histórico
   - `GET /plans/training/adaptations` - Ver adaptaciones
   - `POST /plans/training/adaptations/:id/revert` - Deshacer cambio
   - `GET /plans/training/weekly-report` - Reporte semanal

3. **routes/activities.js** (triggers)
   - `POST /activities` - Triggeriza recalculation
   - `PATCH /activities/:id` - Triggeriza recalculation si cambia TSS

4. **migrations/** (BD)
   - `create_training_plans_history.sql` - Guarda versiones de planes
   - `training_sessions_initial` - Archiva sesiones propuestas
   - `plan_adaptations` - Log de todas las adaptaciones

### Componentes Frontend

1. **dashboard.html**
   - Tarjeta "Cambios automáticos"
   - Función `loadAndRenderAdaptations()`
   - Botón "Ver todo" y "📊 Reporte"

2. **training-plan.html**
   - `viewPlanHistory()` - Modal con timeline
   - `viewPlanAdaptations()` - Modal con cambios
   - `viewWeeklyReport()` - Estadísticas semanales
   - `revertAdaptation()` - Deshacer cambio
   - Helpers: `formatDateShort()`, `getTriggerEmoji()`

---

## 📝 Datos Almacenados

### Tabla: `training_plans_history`

Guarda cada versión de tu plan:

```sql
{
  id: UUID
  user_id: UUID
  week_start: DATE
  phase: VARCHAR (base/build/peak/race/recovery)
  tss_target_initial: INTEGER (TSS objetivo inicial)
  ftp_at_creation: FLOAT (FTP al momento de crear)
  sessions: JSONB (arreglo de sesiones)
  reason: VARCHAR (initial_generation | auto_recalculation | manual_regenerate)
  adaptation_reason: VARCHAR (exceeded_target | missed_sessions | significant_deviation)
  athlete_state: JSONB {ctl, atl, tsb, actual_tss_week_so_far}
  adjustment_delta: JSONB {sessions_modified, total_delta, by_day}
  created_at: TIMESTAMP
}
```

### Tabla: `training_sessions_initial`

Archivo de sesiones propuestas originalmente:

```sql
{
  id: UUID
  plan_history_id: UUID
  day_of_week: INTEGER (0-6)
  type: VARCHAR (long | threshold | recovery | etc)
  name: VARCHAR (description)
  duration_min: INTEGER
  tss_planned: FLOAT
  if_target: FLOAT
  intervals: JSONB
  created_at: TIMESTAMP
}
```

### Tabla: `plan_adaptations`

Log de cada adaptación realizada:

```sql
{
  id: UUID
  user_id: UUID
  week_start: DATE
  trigger_type: VARCHAR (activity_inserted | activity_modified | tss_exceeded | etc)
  reason: TEXT
  tss_total_before: FLOAT
  tss_total_after: FLOAT
  sessions_affected: INTEGER
  auto_generated: BOOLEAN
  approved_by_user: BOOLEAN (NULL | TRUE | FALSE)
  created_at: TIMESTAMP
}
```

---

## ✅ Checklist de Implementación

Completado:

- ✅ Lógica de detección de desviaciones
- ✅ Algoritmo de redistribución de TSS
- ✅ Sistema de triggers en activities.js
- ✅ Endpoint de regeneración manual
- ✅ Histórico en BD (3 tablas)
- ✅ UI en dashboard (tarjeta de adaptaciones)
- ✅ Modal de adaptaciones con botón Deshacer
- ✅ Función revertAdaptation en backend
- ✅ Reporte semanal completo
- ✅ Helpers para formateo y emojis

Próximos (opcional):

- ⏳ Notificaciones push cuando hay cambios significativos
- ⏳ Sugerencias basadas en IA
- ⏳ Exportar reporte a PDF/email
- ⏳ Comparativa multi-semana de adaptaciones

---

## 🎓 Ejemplo Real de Uso

### Escenario: Ciclo 3:1 con Adaptación

**Semana planificada:**
```
Lunes:     Long ride - 180 TSS
Martes:    Threshold - 100 TSS
Miércoles: Recovery - 40 TSS
Jueves:    VO2Max - 110 TSS
Viernes:   Recovery - 40 TSS
Sábado:    Group ride - 150 TSS
Domingo:   Rest - 0 TSS
───────────────────────
Total:     620 TSS
```

**Lo que realmente sucede:**
```
Lunes:     Long ride - 200 TSS (más duro de lo esperado)
Martes:    Sick, no entrenamiento - 0 TSS
Miércoles: Long ride - 150 TSS (compensación)
Jueves:    (sin hacer aún)
Viernes:   (sin hacer aún)
Sábado:    (sin hacer aún)
Domingo:   (sin hacer aún)
```

**Sistema detecta:**
```
✓ Martes: Faltó sesión de 100 TSS
✓ Miércoles: Se agregó 150 TSS no planeados
✓ Lunes: Exceso de +20 TSS
  → Delta total: -100 TSS acumulados en 3 días

¿Debo recalcular? 
→ SÍ: Faltó sesión importante (100 TSS > 50 umbral)
```

**Plan recalculado automáticamente:**
```
Jueves:    VO2Max - 120 TSS (aumenta para compensar)
Viernes:   Threshold - 95 TSS (ajusta)
Sábado:    Group ride - 180 TSS (ajusta)
───────────────────────────
Total semana restante: ~400 TSS

✓ Sistema rediribuye equitativamente
✓ Mantiene estructura (peak day en sábado)
✓ Respeta caps (ninguno > 185 TSS)
✓ Guarda versión anterior (puedes deshacer)
```

**Dashboard muestra:**
```
📊 Cambios automáticos
─────────────────────
➕ activity_inserted — Hace 30min
   TSS: 620 → 620 (Martes compensado)
   [↶ Deshacer] 

Consejo: "Semana con ajustes por actividad
extra. Sistema redistribuyó equitativamente."
```

---

## ❓ Preguntas Frecuentes

**P: ¿Qué pasa si rechazó un cambio y luego hay otro trigger?**
R: El sistema analiza el estado actual del plan. Si nuevamente se supera un umbral, recalculará de nuevo (cascada de adaptaciones).

**P: ¿Puedo deshacerlo múltiples veces?**
R: Sí, cada versión queda guardada. Puedes deshacer hasta la versión inicial del plan.

**P: ¿El sistema tiene en cuenta mis lesiones/días de descanso?**
R: Actualmente usa TSS real. Si tomaste un día de descanso voluntario, el sistema lo ve como "sesión faltante" y compensa.

**P: ¿Afecta a semanas pasadas?**
R: No, solo recalcula sesiones futuras (desde hoy en adelante).

**P: ¿Cómo desactivar el auto-recalculate?**
R: Actualmente siempre está activo. Puedes usar "↶ Deshacer" si no te gusta un cambio específico.

---

## 📞 Soporte

Si algo no funciona:

1. Revisa la consola (F12 → Console) por errores
2. Verifica que las migraciones SQL estén aplicadas en Supabase
3. Asegúrate de que tus actividades tengan valores TSS/NP correctos
4. Revisa que el backend tiene imports del PlanRecalculator

---

**Versión:** 1.0 | **Fecha:** 2024 | **Estado:** Production Ready ✅

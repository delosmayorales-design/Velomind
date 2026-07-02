-- Tabla para historizar planes (cada vez que se modifica, se crea nuevo registro)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS training_plans_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  
  -- Metadata del plan
  phase TEXT,
  tss_target_initial INT,           -- TSS objetivo calculado inicialmente
  tss_target_recalc INT,             -- TSS objetivo después de recalcular
  ftp_at_creation INT,
  
  -- Sesiones del plan
  sessions JSONB NOT NULL,           -- Array de sesiones generadas
  
  -- Razon del cambio
  reason TEXT,                       -- 'initial_generation', 'auto_recalculation', 'manual_regenerate', 'adaptation'
  adaptation_reason TEXT,            -- Detalles: "user_exceeded_tss_by_30", "missed_session", etc
  
  -- Contexto del recalc
  athlete_state JSONB,               -- {ctl, atl, tsb, actual_tss_week_so_far}
  adjustment_delta JSONB,            -- {sessions_modified: 3, tss_changed: [-30, 45, 0, ...], total_delta: +15}
  
  -- Control
  advice JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_training_plans_history_user_id FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_training_plans_history_user_week ON training_plans_history(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_training_plans_history_created ON training_plans_history(created_at DESC);

-- Tabla para registrar las sesiones INICIALES del plan (antes de cambios)
CREATE TABLE IF NOT EXISTS training_sessions_initial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_history_id UUID NOT NULL REFERENCES training_plans_history(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  
  -- Identificacion de sesión
  day_of_week INT,                  -- 0=Mon, 6=Sun
  day_name TEXT,                    -- 'Lunes', 'Martes', etc
  session_index INT,                -- 0-6 (posición en semana)
  
  -- Plan esperado
  type TEXT,                        -- 'threshold', 'long', 'endurance', 'recovery', 'vo2max', etc
  name TEXT,
  duration_min INT,
  tss_planned INT,
  if_target FLOAT,
  wattage_target INT,
  
  -- Datos para rastreo
  intervals JSONB,                 -- Estructura de intervalos
  description TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_training_sessions_initial_plan_history FOREIGN KEY (plan_history_id) REFERENCES training_plans_history(id)
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_initial_plan ON training_sessions_initial(plan_history_id, session_index);
CREATE INDEX IF NOT EXISTS idx_training_sessions_initial_user_week ON training_sessions_initial(user_id, week_start);

-- Tabla para registrar las ADAPTACIONES realizadas
CREATE TABLE IF NOT EXISTS plan_adaptations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  
  -- Qué pasó
  trigger_type TEXT NOT NULL,       -- 'activity_inserted', 'activity_modified', 'manual_regenerate', 'tss_exceeded', 'tss_missed', 'fatigue_threshold'
  trigger_details TEXT,             -- 'User completed 120 TSS on Monday (planned 85)', etc
  
  -- Qué cambió
  sessions_affected INT,            -- Cuantas sesiones se modificaron
  tss_adjustments JSONB,            -- {day: delta_tss, ...}
  reason TEXT,                      -- Explicación legible: "User exceeded target by 35 TSS -> reduced remaining days"
  
  -- Antes y después
  tss_total_before INT,
  tss_total_after INT,
  ctl_before FLOAT,
  ctl_after FLOAT,
  tsb_before FLOAT,
  tsb_after FLOAT,
  
  -- Control
  auto_generated BOOLEAN DEFAULT TRUE,  -- Si fue automático o manual
  approved_by_user BOOLEAN DEFAULT NULL,-- Usuario confirma o rechaza la adaptación
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_adaptations_user_week ON plan_adaptations(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_plan_adaptations_created ON plan_adaptations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_adaptations_trigger ON plan_adaptations(trigger_type);

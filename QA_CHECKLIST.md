# QA Checklist (Strava + Carga Manual + Planes)

## 1) Integración Strava (real)
- Ir a `cyclocoach/integrations.html`.
- Pulsar **Conectar con Strava**.
- Completar OAuth y volver a la app.
- Verificar estado **Conectado** en tarjeta Strava.

## 2) Sincronización de actividades
- En Integraciones, pulsar **Sincronizar ahora**.
- Verificar log con mensaje de actividades importadas.
- Ir a `cyclocoach/activities.html`.
- Confirmar que aparecen actividades con `source = Strava`.

## 3) Carga manual de tracks
- En Actividades, subir un archivo `GPX`, `TCX` o `CSV`.
- Confirmar que se guarda y aparece en tabla.
- Confirmar cálculo de `TSS` y actualización de métricas.

## 4) Plan de entrenamiento por objetivo
- Ir a `cyclocoach/training-plan.html`.
- Cambiar objetivo (ej. `ftp`, `vo2max`, `gran_fondo`, `perdida_peso`).
- Pulsar **Aplicar y regenerar plan**.
- Verificar que cambia el contenido semanal y se guarda perfil.

## 5) Nutrición por objetivo y carga
- Ir a `cyclocoach/nutrition.html`.
- Activar/desactivar **Día de entreno**.
- Cambiar objetivo y pulsar **Recalcular plan**.
- Verificar ajuste de kcal/macros/hidratación.

## 6) Persistencia básica
- Recargar navegador.
- Verificar que perfil, actividades y planes siguen consistentes.
- Verificar que no aparece modo demo en flujo Strava.

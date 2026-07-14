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

## 7) Verificación de email
- Registrar una cuenta nueva con un email real.
- Confirmar que llega el correo de confirmación y que el login queda bloqueado
  (`EMAIL_NOT_VERIFIED`) hasta hacer clic en el enlace.
- Probar "Reenviar email" desde el mensaje de error de login.
- Confirmar que una cuenta ya existente (creada antes de esta migración) puede
  seguir iniciando sesión sin problema (quedó verificada automáticamente).

## 8) Pagos y gating Premium (preparado, no activo)
- Confirmar que `PREMIUM_ENFORCEMENT` NO está seteado (o está en `false`) en producción
  y que, aun así, todas las funciones de IA (`/api/coach/*`) responden con normalidad
  a cualquier usuario logueado — el flag apagado no debe bloquear a nadie.
- Si se activa `PREMIUM_ENFORCEMENT=true` en un entorno de prueba: confirmar que un
  usuario sin `subscription_tier: 'premium'` recibe 403 `PREMIUM_REQUIRED` en esas rutas.

## 9) Salidas grupales
- Crear una salida, unirse desde otra cuenta, comentar y confirmar que llega la
  notificación push a los demás participantes.
- Crear una salida **privada** y confirmar que una cuenta que no es creadora ni
  participante recibe 404 al pedir el detalle (no debe ver punto de encuentro,
  coordenadas ni participantes).

## 10) Mi Garaje
- Añadir una bici, rellenar/cambiar un componente con una fecha pasada (ej. "hace 5
  días") y confirmar que el contador de vida útil ancla ahí, no en hoy.
- Confirmar que el historial del componente muestra el cambio después de recargar.

## 11) Borrado de cuenta
- Eliminar una cuenta de prueba y confirmar que actividades, peso, bicis, componentes
  y planes desaparecen de inmediato (no hay período de gracia — ver `privacidad.html`).

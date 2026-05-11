# Manual de Usuario — VeloMind

Bienvenido a VeloMind (CycloCoach Pro), tu entrenador personal de ciclismo impulsado por Inteligencia Artificial y datos reales de rendimiento. Este manual te guiará paso a paso para sacar el máximo provecho de la plataforma.

---

## 1. Primeros Pasos

### Crear cuenta e iniciar sesión
Para comenzar, accede a la pantalla de **Login / Registro**. 
- Si eres nuevo, selecciona "Crear Cuenta" e ingresa tu email y contraseña.
- Si deseas probar la plataforma sin registrarte, puedes usar el botón de **"Demo"** para acceder con datos generados automáticamente.

### Configurar tu Perfil de Atleta
La IA necesita conocerte para generar planes precisos. Ve a tu Perfil y configura:
- **FTP (Umbral de Potencia Funcional):** Crucial para el cálculo de zonas y carga (TSS).
- **Peso Corporal:** Permite calcular tu relación W/kg.
- **Objetivo Principal:** Elige entre Resistencia, Mejora de FTP, VO₂ Max, Gran Fondo o Pérdida de Peso.
- **Disponibilidad:** Configura tus horas semanales y días de entrenamiento.

---

## 2. Conectar Dispositivos (Integraciones)

VeloMind se sincroniza automáticamente con tus plataformas favoritas. Ve a la sección **Integraciones**:
- **Strava:** Haz clic en "Conectar Strava". Serás redirigido para autorizar a VeloMind. Una vez conectado, tus actividades ciclísticas se importarán automáticamente.
- **Garmin:** Haz clic en "Conectar Garmin Connect" para importar tus rodadas directamente desde tu ciclocomputador o reloj.

*Nota: Si no conectas ninguna plataforma, puedes subir tus archivos `.fit`, `.gpx`, `.tcx` o `.csv` manualmente desde la pestaña Actividades.*

---

## 3. Entendiendo tus Métricas (Dashboard)

El Dashboard es tu centro de mando. Aquí verás tu **Gráfica PMC (Performance Management Chart)**:
- **CTL (Línea Azul - Fitness):** Representa tu forma física acumulada a largo plazo (42 días).
- **ATL (Línea Roja - Fatiga):** Representa tu cansancio reciente (últimos 7 días).
- **TSB (Línea Verde Punteada - Estado de Forma):** Es la diferencia entre tu Fitness y tu Fatiga (CTL - ATL). 
  - *TSB Positivo:* Estás fresco.
  - *TSB Negativo:* Estás acumulando carga de entrenamiento.
  - *TSB muy negativo (<-30):* Riesgo de sobreentrenamiento.

---

## 4. El Entrenador de Inteligencia Artificial

VeloMind utiliza IA avanzada (Gemini, Claude, etc.) para actuar como tu Head Coach.

### Plan de Entrenamiento Semanal
En la sección **Plan**, la IA generará una semana de entrenamientos basada en tu FTP, TSB actual y objetivo.
- Si estás muy fatigado, la IA te prescribirá una semana de **descarga**.
- Puedes adaptar una sesión específica usando el botón **Adaptar Hoy** (ej. "Hoy llueve y solo tengo 45 min para rodillo").

### Análisis y Recomendaciones
En la pestaña de métricas, la IA puede analizar tus últimas semanas y detectar si estás polarizando bien tu entrenamiento o si pasas mucho tiempo en la "zona gris" (Z3), dándote consejos técnicos reales.

---

## 5. Garaje y Mantenimiento

Añade tus bicicletas en la sección de **Garaje**.
- A medida que sumas kilómetros con tus rodadas importadas, VeloMind actualizará el **Odómetro** de tu bicicleta.
- Puedes añadir componentes (cadena, cubiertas, pastillas de freno) y configurar alertas de desgaste para saber cuándo reemplazarlos.

---

## 6. Nutrición y Composición Corporal

### Control de Peso
Registra tu peso, % de grasa y % de músculo. VeloMind recalculará automáticamente tu W/kg.

### Nutrición Inteligente
Ve a la sección **Nutrición**. La IA tomará tu gasto calórico diario estimado (BMR + TSS de entrenamiento) y te generará:
- Menús diarios adaptados a tu dieta.
- Macros exactos (Carbohidratos, Proteína, Grasa).
- Estrategias de alimentación intra-entreno (g de carbos por hora según la rodada).

---

## 7. Preguntas Frecuentes (FAQ)

**¿Qué pasa si mi potenciómetro marca picos irreales?**
VeloMind filtra automáticamente los picos absurdos de potencia (>2500W) al importar archivos o sincronizar con Strava para que tu TSS no se dispare.

**¿Por qué mi TSB bajó de golpe?**
Probablemente hiciste una ruta muy larga o muy intensa que subió tu Fatiga (ATL) de forma repentina. Es normal; la recuperación hará que el TSB vuelva a subir en los próximos días.

**¿Puedo re-sincronizar mis actividades antiguas?**
Sí, puedes volver a forzar la sincronización en la sección de Integraciones. El sistema está diseñado para no duplicar actividades ya existentes.
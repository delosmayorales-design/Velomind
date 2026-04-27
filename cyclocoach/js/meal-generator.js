/* VeloMind — Local Meal Generator
 * Genera menús diarios variados sin API externa.
 * Comida española/mediterránea real, escalada a los macros del atleta.
 */
const LocalMenuGenerator = (() => {
  'use strict';

  // ── Combos de desayuno ─────────────────────────────────────────
  // ref: ~480 kcal, adaptables a cualquier perfil
  const DESAYUNOS = [
    {
      name: 'Porridge de avena',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Avena (cocinada)', amount: '80g' },
        { food: 'Plátano',          amount: '1 ud (120g)' },
        { food: 'Yogur natural',    amount: '125g' },
        { food: 'Miel',             amount: '10g' },
      ],
      ref: { kcal: 510, carbs: 92, prot: 16, fat: 10 },
    },
    {
      name: 'Tostadas con jamón y tomate',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Pan integral',         amount: '80g' },
        { food: 'Jamón serrano',        amount: '40g' },
        { food: 'Tomate',               amount: '1 ud (100g)' },
        { food: 'Aceite de oliva',      amount: '1 cda (10ml)' },
        { food: 'Café con leche',       amount: '200ml' },
      ],
      ref: { kcal: 495, carbs: 48, prot: 27, fat: 22 },
    },
    {
      name: 'Tortilla con pan y zumo',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Huevos',               amount: '2 uds (120g)' },
        { food: 'Pan blanco',           amount: '60g' },
        { food: 'Tomate',               amount: '100g' },
        { food: 'Aceite de oliva',      amount: '8ml' },
        { food: 'Zumo de naranja',      amount: '200ml' },
      ],
      ref: { kcal: 530, carbs: 60, prot: 23, fat: 23 },
    },
    {
      name: 'Batido de avena y plátano',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Leche semidesnatada',  amount: '250ml' },
        { food: 'Plátano',             amount: '1 ud (120g)' },
        { food: 'Avena',               amount: '40g' },
        { food: 'Cacao puro',          amount: '10g' },
        { food: 'Tostada integral',    amount: '30g' },
      ],
      ref: { kcal: 505, carbs: 90, prot: 20, fat: 10 },
    },
    {
      name: 'Yogur con granola y fresas',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Yogur griego',         amount: '200g' },
        { food: 'Granola',              amount: '50g' },
        { food: 'Fresas',               amount: '100g' },
        { food: 'Miel',                 amount: '10g' },
      ],
      ref: { kcal: 395, carbs: 55, prot: 16, fat: 15 },
    },
    {
      name: 'Tostadas con mantequilla de cacahuete',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Pan integral',              amount: '70g' },
        { food: 'Mantequilla de cacahuete',  amount: '20g' },
        { food: 'Plátano',                   amount: '100g' },
        { food: 'Leche semidesnatada',       amount: '200ml' },
      ],
      ref: { kcal: 472, carbs: 66, prot: 19, fat: 16 },
    },
    {
      name: 'Tostadas con queso y fruta',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Pan de molde integral',  amount: '80g' },
        { food: 'Queso fresco',           amount: '80g' },
        { food: 'Mermelada',              amount: '20g' },
        { food: 'Manzana',                amount: '1 ud (150g)' },
        { food: 'Café solo',              amount: '1 taza' },
      ],
      ref: { kcal: 450, carbs: 72, prot: 18, fat: 9 },
    },
    {
      name: 'Arroz con leche y fruta',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Arroz blanco cocido',   amount: '150g' },
        { food: 'Leche semidesnatada',   amount: '300ml' },
        { food: 'Azúcar',                amount: '10g' },
        { food: 'Kiwi',                  amount: '2 uds (150g)' },
      ],
      ref: { kcal: 490, carbs: 95, prot: 16, fat: 5 },
    },
    {
      name: 'Salmón ahumado con tostadas',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Salmón ahumado',        amount: '80g' },
        { food: 'Pan de centeno',        amount: '70g' },
        { food: 'Queso fresco',          amount: '50g' },
        { food: 'Zumo de naranja',       amount: '200ml' },
      ],
      ref: { kcal: 460, carbs: 48, prot: 32, fat: 16 },
    },
  ];

  // ── Combos de comida ───────────────────────────────────────────
  // ref: ~640 kcal
  const COMIDAS = [
    {
      name: 'Arroz con pollo al horno',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Arroz blanco cocido',   amount: '200g' },
        { food: 'Pechuga de pollo',      amount: '150g' },
        { food: 'Pimiento rojo',         amount: '80g' },
        { food: 'Tomate',                amount: '100g' },
        { food: 'Aceite de oliva',       amount: '1 cda (10ml)' },
      ],
      ref: { kcal: 635, carbs: 65, prot: 54, fat: 17 },
    },
    {
      name: 'Pasta con atún y tomate',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Pasta cocida',          amount: '220g' },
        { food: 'Atún en agua',          amount: '120g' },
        { food: 'Salsa de tomate',       amount: '80g' },
        { food: 'Aceite de oliva',       amount: '8ml' },
        { food: 'Pan blanco',            amount: '40g' },
      ],
      ref: { kcal: 600, carbs: 82, prot: 48, fat: 12 },
    },
    {
      name: 'Lentejas estofadas',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Lentejas cocidas',      amount: '250g' },
        { food: 'Patata',                amount: '150g' },
        { food: 'Zanahoria',             amount: '80g' },
        { food: 'Aceite de oliva',       amount: '1 cda (10ml)' },
        { food: 'Pan integral',          amount: '40g' },
      ],
      ref: { kcal: 640, carbs: 106, prot: 30, fat: 13 },
    },
    {
      name: 'Salmón con arroz integral y espinacas',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Salmón a la plancha',   amount: '150g' },
        { food: 'Arroz integral cocido', amount: '180g' },
        { food: 'Espinacas salteadas',   amount: '100g' },
        { food: 'Aceite de oliva',       amount: '1 cda (10ml)' },
      ],
      ref: { kcal: 675, carbs: 58, prot: 38, fat: 32 },
    },
    {
      name: 'Merluza al horno con patata',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Merluza',               amount: '200g' },
        { food: 'Patata al horno',       amount: '200g' },
        { food: 'Brócoli',               amount: '150g' },
        { food: 'Aceite de oliva',       amount: '15ml' },
        { food: 'Pan blanco',            amount: '40g' },
      ],
      ref: { kcal: 620, carbs: 73, prot: 44, fat: 19 },
    },
    {
      name: 'Pavo al horno con boniato',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Pechuga de pavo',       amount: '180g' },
        { food: 'Boniato asado',         amount: '200g' },
        { food: 'Judías verdes',         amount: '150g' },
        { food: 'Aceite de oliva',       amount: '1 cda (10ml)' },
      ],
      ref: { kcal: 570, carbs: 72, prot: 60, fat: 12 },
    },
    {
      name: 'Garbanzos con espinacas y huevo',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Garbanzos cocidos',     amount: '200g' },
        { food: 'Espinacas',             amount: '100g' },
        { food: 'Huevo duro',            amount: '2 uds' },
        { food: 'Aceite de oliva',       amount: '10ml' },
        { food: 'Pan integral',          amount: '40g' },
      ],
      ref: { kcal: 650, carbs: 70, prot: 36, fat: 24 },
    },
    {
      name: 'Pollo con pasta y verduras',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Pechuga de pollo',      amount: '130g' },
        { food: 'Pasta cocida',          amount: '180g' },
        { food: 'Calabacín',             amount: '100g' },
        { food: 'Tomate',                amount: '80g' },
        { food: 'Aceite de oliva',       amount: '10ml' },
      ],
      ref: { kcal: 625, carbs: 64, prot: 52, fat: 18 },
    },
    {
      name: 'Ensalada de atún con quinoa',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Quinoa cocida',         amount: '150g' },
        { food: 'Atún en agua',          amount: '120g' },
        { food: 'Tomate y lechuga',      amount: '150g' },
        { food: 'Aguacate',              amount: '½ ud (80g)' },
        { food: 'Aceite de oliva',       amount: '8ml' },
      ],
      ref: { kcal: 580, carbs: 42, prot: 40, fat: 28 },
    },
  ];

  // ── Combos de cena ─────────────────────────────────────────────
  // ref: ~470 kcal, más proteína, menos CH
  const CENAS = [
    {
      name: 'Tortilla francesa con ensalada',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Huevos',                amount: '3 uds' },
        { food: 'Pan integral',          amount: '50g' },
        { food: 'Tomate y lechuga',      amount: '150g' },
        { food: 'Aceite de oliva',       amount: '10ml' },
      ],
      ref: { kcal: 510, carbs: 29, prot: 29, fat: 32 },
    },
    {
      name: 'Pollo a la plancha con verduras',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Pechuga de pollo',      amount: '150g' },
        { food: 'Calabacín a la plancha',amount: '150g' },
        { food: 'Tomate',                amount: '100g' },
        { food: 'Pan integral',          amount: '40g' },
        { food: 'Aceite de oliva',       amount: '10ml' },
      ],
      ref: { kcal: 478, carbs: 26, prot: 53, fat: 17 },
    },
    {
      name: 'Salmón con brócoli al vapor',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Salmón a la plancha',   amount: '150g' },
        { food: 'Brócoli al vapor',      amount: '200g' },
        { food: 'Pan blanco',            amount: '30g' },
        { food: 'Aceite de oliva',       amount: '8ml' },
      ],
      ref: { kcal: 490, carbs: 26, prot: 38, fat: 29 },
    },
    {
      name: 'Ensalada de atún con huevo duro',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Atún en agua',          amount: '100g' },
        { food: 'Huevo duro',            amount: '2 uds' },
        { food: 'Lechuga y tomate',      amount: '180g' },
        { food: 'Pan integral',          amount: '50g' },
        { food: 'Aceite de oliva',       amount: '10ml' },
      ],
      ref: { kcal: 545, carbs: 29, prot: 50, fat: 26 },
    },
    {
      name: 'Merluza al vapor con espinacas',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Merluza',               amount: '200g' },
        { food: 'Espinacas salteadas',   amount: '150g' },
        { food: 'Zanahoria',             amount: '100g' },
        { food: 'Pan blanco',            amount: '40g' },
        { food: 'Aceite de oliva',       amount: '10ml' },
      ],
      ref: { kcal: 430, carbs: 38, prot: 42, fat: 14 },
    },
    {
      name: 'Pavo con pasta integral y brócoli',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Pechuga de pavo',       amount: '150g' },
        { food: 'Pasta integral cocida', amount: '150g' },
        { food: 'Brócoli',               amount: '100g' },
        { food: 'Aceite de oliva',       amount: '8ml' },
      ],
      ref: { kcal: 495, carbs: 56, prot: 53, fat: 10 },
    },
    {
      name: 'Revuelto de claras con champiñones',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Claras de huevo',       amount: '200g (6 claras)' },
        { food: 'Champiñones',           amount: '150g' },
        { food: 'Jamón serrano',         amount: '40g' },
        { food: 'Pan integral',          amount: '50g' },
        { food: 'Aceite de oliva',       amount: '8ml' },
      ],
      ref: { kcal: 430, carbs: 28, prot: 44, fat: 16 },
    },
    {
      name: 'Crema de verduras con pechuga',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Crema de calabaza y puerro', amount: '300ml' },
        { food: 'Pechuga de pollo',           amount: '130g' },
        { food: 'Pan integral',               amount: '40g' },
        { food: 'Aceite de oliva',            amount: '8ml' },
      ],
      ref: { kcal: 450, carbs: 36, prot: 46, fat: 12 },
    },
    {
      name: 'Tortilla de pavo y queso',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Huevos',                amount: '2 uds' },
        { food: 'Pechuga de pavo',       amount: '80g' },
        { food: 'Queso fresco',          amount: '50g' },
        { food: 'Pan integral',          amount: '50g' },
        { food: 'Tomate',                amount: '100g' },
      ],
      ref: { kcal: 460, carbs: 33, prot: 40, fat: 18 },
    },
  ];

  // ── Snacks ─────────────────────────────────────────────────────
  // ref: ~180 kcal
  const SNACKS = [
    {
      name: 'Plátano y nueces',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Plátano',   amount: '1 ud (100g)' },
        { food: 'Nueces',    amount: '20g' },
      ],
      ref: { kcal: 220, carbs: 26, prot: 4, fat: 13 },
    },
    {
      name: 'Yogur con miel y almendras',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Yogur natural', amount: '125g' },
        { food: 'Miel',          amount: '10g' },
        { food: 'Almendras',     amount: '15g' },
      ],
      ref: { kcal: 190, carbs: 17, prot: 8, fat: 11 },
    },
    {
      name: 'Tostada con queso fresco',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Pan integral',  amount: '40g' },
        { food: 'Queso fresco',  amount: '60g' },
      ],
      ref: { kcal: 158, carbs: 18, prot: 10, fat: 4 },
    },
    {
      name: 'Manzana con almendras',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Manzana',    amount: '1 ud (150g)' },
        { food: 'Almendras',  amount: '20g' },
      ],
      ref: { kcal: 194, carbs: 25, prot: 5, fat: 10 },
    },
    {
      name: 'Tostada con mantequilla de cacahuete',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Pan integral',             amount: '40g' },
        { food: 'Mantequilla de cacahuete', amount: '15g' },
      ],
      ref: { kcal: 187, carbs: 20, prot: 7, fat: 9 },
    },
    {
      name: 'Requesón con fresas',
      pref: ['normal', 'come de todo'],
      items: [
        { food: 'Requesón', amount: '150g' },
        { food: 'Fresas',   amount: '100g' },
      ],
      ref: { kcal: 137, carbs: 11, prot: 19, fat: 3 },
    },
    {
      name: 'Barrita de cereales y fruta',
      pref: ['muy selectivo', 'normal', 'come de todo'],
      items: [
        { food: 'Barrita de cereales', amount: '1 ud (40g)' },
        { food: 'Naranja',             amount: '1 ud (150g)' },
      ],
      ref: { kcal: 185, carbs: 38, prot: 4, fat: 3 },
    },
  ];

  // ── Filtro por preferencias y exclusiones ──────────────────────
  function filterPool(pool, pref, dislikes) {
    const dis = (dislikes || '').toLowerCase().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    return pool.filter(c => {
      if (!c.pref.includes(pref)) return false;
      if (!dis.length) return true;
      const foods = c.items.map(i => i.food.toLowerCase()).join(' ');
      return !dis.some(d => d.length > 2 && foods.includes(d));
    });
  }

  // ── Escalar cantidades y macros ────────────────────────────────
  function scaleCombo(combo, targetKcal) {
    const factor = targetKcal / combo.ref.kcal;
    const scaleAmt = (amt, f) => {
      const match = amt.match(/^([\d.]+)(.*)/);
      if (!match) return amt;
      const n = Math.round(parseFloat(match[1]) * f / 5) * 5;
      return `${n}${match[2]}`;
    };
    return {
      items: combo.items.map(it => {
        // No escalar cantidades fijas (uds, tazas, cdas)
        if (/ud|cda|taza/i.test(it.amount)) return it;
        return { food: it.food, amount: scaleAmt(it.amount, factor) };
      }),
      macros: {
        kcal:   Math.round(combo.ref.kcal   * factor),
        carbs:  Math.round(combo.ref.carbs  * factor),
        prot:   Math.round(combo.ref.prot   * factor),
        fat:    Math.round(combo.ref.fat    * factor),
      },
    };
  }

  // ── Generador principal ────────────────────────────────────────
  function generate({ calories, carbs, protein, fat, preferences, dislikes, sessionType, tss }) {
    const pref    = preferences || 'normal';
    const sessTSS = tss || 0;

    // Distribución de calorías según tipo de sesión
    // Días de carga: más carbos en desayuno y mediodía
    const isHard    = ['threshold', 'vo2max', 'sprint'].includes(sessionType);
    const isRest    = !sessionType || sessionType === 'recovery';
    const isMed     = ['endurance', 'long', 'tempo', 'strength'].includes(sessionType);

    // Reparto calórico del día
    const dist = isHard
      ? { desayuno: 0.28, comida: 0.38, cena: 0.20, snack: 0.14 }
      : isRest
      ? { desayuno: 0.25, comida: 0.35, cena: 0.25, snack: 0.15 }
      : { desayuno: 0.26, comida: 0.36, cena: 0.22, snack: 0.16 };

    const kcalD = Math.round(calories * dist.desayuno);
    const kcalC = Math.round(calories * dist.comida);
    const kcalN = Math.round(calories * dist.cena);
    const kcalS = Math.round(calories * dist.snack / 2); // 2 snacks

    // Filtrar pools
    const poolD = filterPool(DESAYUNOS, pref, dislikes);
    const poolC = filterPool(COMIDAS,   pref, dislikes);
    const poolN = filterPool(CENAS,     pref, dislikes);
    const poolS = filterPool(SNACKS,    pref, dislikes);

    // Fallback si filtro deja pool vacío
    const safePool = (p, full) => p.length >= 3 ? p : full;
    const pD = safePool(poolD, DESAYUNOS);
    const pC = safePool(poolC, COMIDAS);
    const pN = safePool(poolN, CENAS);
    const pS = safePool(poolS, SNACKS);

    // Generar 3 menús con combos diferentes
    const menus = [0, 1, 2].map(i => {
      const d = pD[i % pD.length];
      const c = pC[i % pC.length];
      const n = pN[i % pN.length];
      const s1 = pS[i % pS.length];
      const s2 = pS[(i + Math.ceil(pS.length / 2)) % pS.length];

      const sd = scaleCombo(d, kcalD);
      const sc = scaleCombo(c, kcalC);
      const sn = scaleCombo(n, kcalN);
      const ss1 = scaleCombo(s1, kcalS);
      const ss2 = scaleCombo(s2, kcalS);

      const totals = {
        calories: sd.macros.kcal + sc.macros.kcal + sn.macros.kcal + ss1.macros.kcal + ss2.macros.kcal,
        carbs:    sd.macros.carbs + sc.macros.carbs + sn.macros.carbs + ss1.macros.carbs + ss2.macros.carbs,
        protein:  sd.macros.prot  + sc.macros.prot  + sn.macros.prot  + ss1.macros.prot  + ss2.macros.prot,
        fat:      sd.macros.fat   + sc.macros.fat   + sn.macros.fat   + ss1.macros.fat   + ss2.macros.fat,
      };

      // Etiqueta del menú: varía por tipo de sesión
      const labels = isHard
        ? [`Menú ${i+1} · Alta carga`, `Menú ${i+1} · Pre-umbral`, `Menú ${i+1} · Máxima energía`]
        : isRest
        ? [`Menú ${i+1} · Recuperación`, `Menú ${i+1} · Descanso activo`, `Menú ${i+1} · Ligero`]
        : [`Menú ${i+1} · Rendimiento`, `Menú ${i+1} · Equilibrado`, `Menú ${i+1} · Base aeróbica`];

      return {
        name: labels[i],
        meals: {
          desayuno: sd.items,
          comida:   sc.items,
          cena:     sn.items,
          snacks:   [...ss1.items, ...ss2.items],
        },
        totals,
      };
    });

    return { menus };
  }

  return { generate };
})();

window.LocalMenuGenerator = LocalMenuGenerator;

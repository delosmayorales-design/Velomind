const { ZONES, calcIF, calcTSS, calcVI, getZone, getTSBStatus, calcHRTSS } = require('../../utils/training');

describe('calcIF', () => {
  test('calcula el IF redondeado a 2 decimales', () => {
    expect(calcIF(250, 300)).toBeCloseTo(0.83, 2);
  });
  test('devuelve 0 si falta np o ftp', () => {
    expect(calcIF(0, 300)).toBe(0);
    expect(calcIF(250, 0)).toBe(0);
    expect(calcIF(null, 300)).toBe(0);
  });
});

describe('calcTSS', () => {
  test('una hora exacta al FTP da 100 TSS', () => {
    // durationSec=3600, np=ftp -> IF=1 -> TSS = (3600*ftp*1)/(ftp*3600)*100 = 100
    expect(calcTSS(250, 3600, 250)).toBe(100);
  });
  test('devuelve 0 si falta cualquier parámetro', () => {
    expect(calcTSS(0, 3600, 250)).toBe(0);
    expect(calcTSS(250, 0, 250)).toBe(0);
    expect(calcTSS(250, 3600, 0)).toBe(0);
  });
});

describe('calcVI', () => {
  test('VI = np/avgPower redondeado a 2 decimales', () => {
    expect(calcVI(220, 200)).toBeCloseTo(1.1, 2);
  });
  test('devuelve 0 si avgPower es 0 o negativo', () => {
    expect(calcVI(220, 0)).toBe(0);
    expect(calcVI(220, -5)).toBe(0);
  });
});

describe('getZone', () => {
  test('devuelve null si falta potencia o ftp', () => {
    expect(getZone(0, 250)).toBeNull();
    expect(getZone(200, 0)).toBeNull();
  });
  test('clasifica correctamente en cada zona Coggan por su punto medio', () => {
    const ftp = 250;
    const midpoints = {
      1: 0.30, 2: 0.65, 3: 0.83, 4: 0.98, 5: 1.13, 6: 1.35,
    };
    Object.entries(midpoints).forEach(([zoneId, pct]) => {
      expect(getZone(ftp * pct, ftp).id).toBe(Number(zoneId));
    });
  });
  test('el mínimo de cada zona (2-7) es inclusivo', () => {
    const ftp = 100;
    expect(getZone(56, ftp).id).toBe(2);
    expect(getZone(76, ftp).id).toBe(3);
    expect(getZone(91, ftp).id).toBe(4); // umbral (Z4)
    expect(getZone(106, ftp).id).toBe(5);
    expect(getZone(121, ftp).id).toBe(6);
    expect(getZone(151, ftp).id).toBe(7);
  });
  test('potencias muy por encima de Z6 caen en la última zona definida', () => {
    expect(getZone(1000, 100).id).toBe(ZONES[ZONES.length - 1].id);
  });
});

describe('calcHRTSS', () => {
  test('sin FC de reposo, usa %LTHR simple (comportamiento previo, sin regresión)', () => {
    // avgHR=109, lthr=161 -> IF=0.677 -> mismo resultado que el cálculo antiguo avgHR/lthr
    const { ifValue, tss } = calcHRTSS(4560, 109, 161);
    expect(ifValue).toBeCloseTo(0.68, 1);
    expect(tss).toBeGreaterThan(50);
  });
  test('con FC de reposo, usa Reserva Cardíaca (Karvonen) y da un IF/TSS menor para esfuerzos suaves', () => {
    // Caso real reportado: MTB suave, avgHR=109, lthr=161, reposo=50
    // %HRR = (109-50)/(161-50) = 0.53 -> bastante menor que %LTHR simple (0.68)
    const conReposo = calcHRTSS(4560, 109, 161, 50);
    const sinReposo = calcHRTSS(4560, 109, 161, null);
    expect(conReposo.ifValue).toBeLessThan(sinReposo.ifValue);
    expect(conReposo.tss).toBeLessThan(sinReposo.tss);
  });
  test('devuelve 0 si falta cualquier parámetro', () => {
    expect(calcHRTSS(0, 109, 161).tss).toBe(0);
    expect(calcHRTSS(3600, 0, 161).tss).toBe(0);
    expect(calcHRTSS(3600, 109, 0).tss).toBe(0);
  });
  test('ignora una FC de reposo inválida (>=lthr o >=avgHR) y cae al %LTHR simple', () => {
    const invalidoAlto = calcHRTSS(3600, 109, 161, 161);
    const invalidoMayorQueAvg = calcHRTSS(3600, 109, 161, 120);
    const sinReposo = calcHRTSS(3600, 109, 161, null);
    expect(invalidoAlto).toEqual(sinReposo);
    expect(invalidoMayorQueAvg).toEqual(sinReposo);
  });
});

describe('getTSBStatus', () => {
  test('clasifica el estado de forma según rangos de TSB', () => {
    expect(getTSBStatus(30).label).toBe('Muy fresco');
    expect(getTSBStatus(10).label).toBe('Fresco');
    expect(getTSBStatus(0).label).toBe('En forma');
    expect(getTSBStatus(-15).label).toBe('Cansado');
    expect(getTSBStatus(-25).label).toBe('Fatigado');
    expect(getTSBStatus(-40).label).toBe('Sobreentrenado');
  });
  test('cada estado trae un nivel de riesgo coherente con la gravedad', () => {
    expect(getTSBStatus(30).risk).toBe('bajo');
    expect(getTSBStatus(-40).risk).toBe('muy alto');
  });
});

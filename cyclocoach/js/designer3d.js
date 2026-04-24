/**
 * js/designer3d.js — VeloMind
 * Motor 3D y evaluador IA para el diseñador de equipaciones.
 * Depende de Three.js (cargar vía CDN en el HTML).
 */

const Designer3D = (() => {
  let scene, camera, renderer, controls, model;
  const materials = {};

  // ─── 1. EVALUADOR IA ──────────────────────────────────────────
  function calculateBrightness(hex) {
    const color = hex.replace('#', '');
    const r = parseInt(color.substr(0, 2), 16);
    const g = parseInt(color.substr(2, 2), 16);
    const b = parseInt(color.substr(4, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  function evaluateDesign(config) {
    const brightness = calculateBrightness(config.baseColor || '#ffffff');
    const isDark = brightness < 120;
    
    let thermal = 'Media';
    let aero = config.fit === 'aero' ? 'Alta (Ahorro ~12W)' : 'Baja (Prioridad confort)';
    const advice = [];

    if (config.season === 'summer') {
      thermal = isDark ? 'Baja' : 'Alta';
      if (isDark) advice.push("⚠️ Los colores oscuros absorben calor. No es ideal para >25ºC.");
      else advice.push("✅ Color claro ideal para reflejar el sol en verano.");
    } else {
      thermal = isDark ? 'Alta' : 'Media';
      if (isDark) advice.push("✅ Color oscuro ideal para retener temperatura en invierno.");
    }

    if (config.sidePanels === 'mesh') advice.push("✅ Paneles de malla mejoran la transpirabilidad lateral.");

    // Actualizar UI
    const thermalEl = document.getElementById('ai-thermal');
    const aeroEl = document.getElementById('ai-aero');
    const adviceEl = document.getElementById('ai-advice');
    
    if (thermalEl) thermalEl.innerHTML = `🌡️ Optimización Térmica: <strong>${thermal}</strong>`;
    if (aeroEl) aeroEl.innerHTML = `🌬️ Aerodinámica: <strong>${aero}</strong>`;
    if (adviceEl) adviceEl.innerHTML = advice.map(a => `<li>${a}</li>`).join('');
  }

  // ─── 2. MOTOR 3D ──────────────────────────────────────────────
  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    scene = new THREE.Scene();
    
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 1.5, 4);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Iluminación profesional (luces de estudio)
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(3, 5, 4);
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xaaccff, 0.5); // Tono frío para sombras
    fillLight.position.set(-3, 2, -4);
    scene.add(fillLight);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 5;

    // Usar directamente el maniquí 3D profesional generado por código
    createDummyModel();

    animate();
  }

  function createDummyModel() {
    // Genera un maniquí de diseño 3D compuesto y profesional
    const mannequin = new THREE.Group();
    
    // Material del maillot (tela mate profesional)
    materials.jersey = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, 
      roughness: 0.8,
      metalness: 0.1
    });

    // Material del culotte (licra oscura)
    materials.bibs = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.7,
      metalness: 0.15
    });

    // Material de contraste (cuello/piel sintética oscura)
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.5,
      metalness: 0.1
    });

    // 1. Torso (Pecho y abdomen)
    const torsoGeo = new THREE.CapsuleGeometry(0.35, 0.6, 4, 32);
    const torso = new THREE.Mesh(torsoGeo, materials.jersey);
    torso.position.y = 1.1;
    torso.scale.z = 0.65; // Aplanar para simular un pecho humano
    mannequin.add(torso);

    // 2. Cuello
    const neckGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.2, 32);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 1.65;
    mannequin.add(neck);

    // 3. Hombros y Mangas Cortas
    const shoulderGeo = new THREE.SphereGeometry(0.18, 32, 16);
    const sleeveGeo = new THREE.CapsuleGeometry(0.14, 0.25, 4, 32);
    
    // Brazo Izquierdo
    const leftShoulder = new THREE.Mesh(shoulderGeo, materials.jersey);
    leftShoulder.position.set(-0.38, 1.4, 0);
    const leftSleeve = new THREE.Mesh(sleeveGeo, materials.jersey);
    leftSleeve.position.set(-0.46, 1.15, 0);
    leftSleeve.rotation.z = Math.PI / 8;
    mannequin.add(leftShoulder, leftSleeve);

    // Brazo Derecho
    const rightShoulder = new THREE.Mesh(shoulderGeo, materials.jersey);
    rightShoulder.position.set(0.38, 1.4, 0);
    const rightSleeve = new THREE.Mesh(sleeveGeo, materials.jersey);
    rightSleeve.position.set(0.46, 1.15, 0);
    rightSleeve.rotation.z = -Math.PI / 8;
    mannequin.add(rightShoulder, rightSleeve);

    // 4. Cadera / Base del culotte
    const pelvisGeo = new THREE.CapsuleGeometry(0.35, 0.25, 4, 32);
    const pelvis = new THREE.Mesh(pelvisGeo, materials.bibs);
    pelvis.position.y = 0.65;
    pelvis.scale.z = 0.7;
    mannequin.add(pelvis);

    // 5. Muslos (Parte superior del culotte)
    const legGeo = new THREE.CapsuleGeometry(0.17, 0.35, 4, 32);
    
    const leftLeg = new THREE.Mesh(legGeo, materials.bibs);
    leftLeg.position.set(-0.18, 0.3, 0);
    mannequin.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, materials.bibs);
    rightLeg.position.set(0.18, 0.3, 0);
    mannequin.add(rightLeg);

    mannequin.position.y = -0.5; // Centrar el maniquí en la cámara
    scene.add(mannequin);
  }

  function updateDesign(config) {
    if (materials.jersey) materials.jersey.color.set(config.baseColor || '#ffffff');
    if (materials.bibs && config.bibsColor) materials.bibs.color.set(config.bibsColor);
    evaluateDesign(config);
  }

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  return { init, updateDesign };
})();
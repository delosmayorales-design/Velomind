import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Renderiza el ciclista 3D, aplica materiales de tela y controla las animaciones.
 * Requiere: npm install three @react-three/fiber @react-three/drei
 */
export default function CyclistModel({ designConfig, viewMode, onZoomZone }) {
  const group = useRef();
  const skeletonRef = useRef(); // Referencia para extraer ángulos biomecánicos
  const controlsRef = useRef();
  
  // Carga del modelo GLTF (debe estar en la carpeta public de tu frontend)
  const { nodes, materials, animations } = useGLTF('/models/cyclist_road.glb');
  const { actions } = useAnimations(animations, group);

  // 1. Control de Animaciones (Pedaleo y Postura)
  useEffect(() => {
    if (actions && actions['Pedaling']) {
      actions['Pedaling'].play();
      // Si el usuario elige modo rendimiento/aero, pedalea más rápido
      actions['Pedaling'].timeScale = designConfig.fit === 'aero' ? 1.15 : 0.9;
    }
  }, [actions, designConfig.fit]);

  // 2. Mapeo de Materiales en Tiempo Real
  useEffect(() => {
    // Función auxiliar para aplicar colores a las partes separadas del nuevo modelo
    const applyMaterialColor = (matName, colorHex, roughness = 0.85) => {
      if (materials[matName]) {
        materials[matName].color.set(colorHex);
        materials[matName].roughness = roughness;
        materials[matName].metalness = 0.1; // Tela no metálica
        materials[matName].needsUpdate = true;
      }
    };

    // Aplicar a las mallas especificadas en el diseño 3D
    applyMaterialColor('Torso', designConfig.baseColor || '#ffffff');
    applyMaterialColor('Sleeves', designConfig.sleeveColor || designConfig.baseColor || '#ffffff');
    applyMaterialColor('Legs', designConfig.bibColor || '#1a1a1a', 0.9);

    // Paneles de ventilación laterales opcionales
    if (materials.SidePanels) {
      materials.SidePanels.color.set(designConfig.panelColor || designConfig.baseColor || '#ffffff');
      materials.SidePanels.transparent = designConfig.sidePanels === 'mesh';
      materials.SidePanels.opacity = designConfig.sidePanels === 'mesh' ? 0.8 : 1.0;
      materials.SidePanels.needsUpdate = true;
    }
  }, [designConfig, materials]);

  // 3. Transiciones de Cámara (Frente / Espalda)
  useFrame(() => {
    if (!controlsRef.current) return;
    
    let targetAngle = 0;
    if (viewMode === 'back') targetAngle = Math.PI;
    else if (viewMode === 'side') targetAngle = Math.PI / 2;

    // Interpolación suave (Lerp) para girar la cámara al cambiar la vista en la UI
    controlsRef.current.setAzimuthalAngle(
      THREE.MathUtils.lerp(controlsRef.current.getAzimuthalAngle(), targetAngle, 0.05)
    );
  });

  // 4. Extracción de datos biomecánicos (Opcional - Goal: Biomechanical angle analysis)
  useFrame(() => {
    // Una vez que el modelo esté riggeado (Mixamo), los nodos del esqueleto estarán disponibles.
    // Aquí podrías leer sus posiciones mundiales para pintar ángulos o validarlos.
    /*
    if (nodes.mixamorigRightUpLeg && nodes.mixamorigRightLeg && nodes.mixamorigRightFoot) {
      const hip = new THREE.Vector3().setFromMatrixPosition(nodes.mixamorigRightUpLeg.matrixWorld);
      const knee = new THREE.Vector3().setFromMatrixPosition(nodes.mixamorigRightLeg.matrixWorld);
      const ankle = new THREE.Vector3().setFromMatrixPosition(nodes.mixamorigRightFoot.matrixWorld);
      
      // Calcular la extensión de la rodilla en tiempo real mientras pedalea
      // ...
    }
    */
  });

  return (
    <group ref={group} dispose={null}>
      {/* Iluminación tipo estudio realista */}
      <Environment preset="studio" />
      <ambientLight intensity={0.6} />
      <spotLight position={[5, 10, 5]} angle={0.2} penumbra={1} intensity={1.5} castShadow />
      <spotLight position={[-5, 5, -5]} angle={0.3} penumbra={1} intensity={0.5} />

      {/* Malla principal del ciclista */}
      <primitive 
        object={nodes.Scene} 
        ref={skeletonRef}
        onClick={(e) => {
          e.stopPropagation();
          // Detectar la zona clickeada para hacer zoom en la UI
          if (onZoomZone) onZoomZone(e.object.name);
        }}
      />

      {/* Sombra realista bajo la bicicleta */}
      <ContactShadows resolution={1024} scale={15} blur={1.5} opacity={0.6} far={5} color="#000000" position={[0, 0, 0]} />
      
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={2} maxDistance={6} />
    </group>
  );
}

useGLTF.preload('/models/cyclist_road.glb');
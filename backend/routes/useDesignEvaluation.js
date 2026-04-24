import { useState, useEffect } from 'react';
import { evaluateDesign } from '../services/designAnalyzer';

/**
 * Hook personalizado para evaluar el diseño en tiempo real sin bloquear el hilo de UI.
 */
export function useDesignEvaluation(designConfig) {
  const [evaluation, setEvaluation] = useState({
    thermal: 'Media',
    aero: 'Media',
    breathability: 'Media',
    advice: []
  });

  useEffect(() => {
    // Debounce ligero para no recalcular en medio de un drag del color picker
    const timer = setTimeout(() => {
      setEvaluation(evaluateDesign(designConfig));
    }, 150);
    return () => clearTimeout(timer);
  }, [designConfig]);

  return evaluation;
}
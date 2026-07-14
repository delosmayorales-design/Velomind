// jsdom no implementa varias Web APIs que app.js toca al cargar (son scripts sueltos
// pensados para un navegador real, no para un entorno de test) -- se stubbean lo mínimo
// necesario para que el archivo se pueda `require()` sin explotar en el top-level.
window.matchMedia = window.matchMedia || function (query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  };
};

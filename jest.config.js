// Config raíz de Jest: dos "proyectos" con entornos distintos porque el backend
// (Node/Express) y la lógica de cálculo del frontend (scripts sueltos que tocan el DOM
// al cargar, sin build step) necesitan runtimes distintos para poder cargarse en tests.
module.exports = {
  projects: [
    {
      displayName: 'backend',
      testEnvironment: 'node',
      rootDir: 'backend',
      testMatch: ['<rootDir>/tests/**/*.test.js'],
      setupFiles: ['<rootDir>/tests/setupEnv.js'],
    },
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      rootDir: 'cyclocoach',
      testMatch: ['<rootDir>/tests/**/*.test.js'],
      setupFiles: ['<rootDir>/tests/setupDom.js'],
    },
  ],
};

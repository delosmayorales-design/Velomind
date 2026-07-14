// Variables de entorno mínimas para que los módulos del backend puedan cargarse en
// tests sin depender de credenciales reales. middleware/auth.js llama a process.exit(1)
// si falta JWT_SECRET (a propósito, ver fix de seguridad), así que hace falta seteatla
// ANTES de que cualquier test requiera ese módulo (directa o transitivamente).
process.env.JWT_SECRET = 'test-secret-solo-para-jest-no-usar-en-produccion';
process.env.NODE_ENV = 'test';

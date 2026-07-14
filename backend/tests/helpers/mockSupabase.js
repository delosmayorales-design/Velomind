// Mock del cliente de Supabase para tests: imita la API encadenable real
// (.from().select().eq()...single()/maybeSingle(), y es "thenable" para los casos en
// los que el código hace await directo sin terminal explícito) sin tocar ninguna base
// de datos. Se usa con jest.mock('../db', () => require('.../mockSupabase')).
//
// Cada test configura, por tabla, la cola de respuestas que debe devolver la próxima
// llamada con __queueResponse(table, {data, error, ...}) -- útil cuando un mismo
// endpoint hace varias queries seguidas contra la misma tabla. Si la cola tiene más de
// un elemento se van consumiendo en orden; si solo queda uno, se reutiliza (para no
// tener que declarar una respuesta por cada GET incidental repetido).

let queues = {};
let calls = [];

function reset() {
  queues = {};
  calls = [];
}

function queueResponse(table, response) {
  queues[table] = queues[table] || [];
  queues[table].push(response);
}

function nextResponse(table) {
  const q = queues[table];
  if (!q || q.length === 0) return { data: null, error: null };
  return q.length > 1 ? q.shift() : q[0];
}

function getCalls(table, method) {
  return calls.filter(c => c.table === table && (!method || c.method === method));
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
  }
  _record(method, args) {
    calls.push({ table: this.table, method, args });
    return this;
  }
  select(...a)  { return this._record('select', a); }
  insert(...a)  { return this._record('insert', a); }
  update(...a)  { return this._record('update', a); }
  delete(...a)  { return this._record('delete', a); }
  upsert(...a)  { return this._record('upsert', a); }
  eq(...a)      { return this._record('eq', a); }
  neq(...a)     { return this._record('neq', a); }
  gte(...a)     { return this._record('gte', a); }
  lte(...a)     { return this._record('lte', a); }
  in(...a)      { return this._record('in', a); }
  not(...a)     { return this._record('not', a); }
  ilike(...a)   { return this._record('ilike', a); }
  order(...a)   { return this._record('order', a); }
  limit(...a)   { return this._record('limit', a); }
  single()      { return Promise.resolve(nextResponse(this.table)); }
  maybeSingle() { return Promise.resolve(nextResponse(this.table)); }
  then(resolve, reject) { return Promise.resolve(nextResponse(this.table)).then(resolve, reject); }
  catch(fn)     { return Promise.resolve(nextResponse(this.table)).catch(fn); }
}

function from(table) {
  return new QueryBuilder(table);
}

const storage = {
  from: () => ({
    upload: async () => ({ data: {}, error: null }),
    getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/avatar.png' } }),
  }),
  createBucket: async () => ({ data: {}, error: null }),
};

module.exports = {
  from,
  storage,
  __queueResponse: queueResponse,
  __reset: reset,
  __getCalls: getCalls,
};

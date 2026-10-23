import { busquedaParaVolver, stateDeListado } from '@/modules/clientes/matriz.navegacion';

describe('busquedaParaVolver', () => {
  it('conserva la query string tal como vino, incluidos filtros que el listado todavía no lee', () => {
    const search = '?estado=INACTIVO&q=muni&matrizConfigurada=false';

    expect(busquedaParaVolver(stateDeListado(search))).toBe(search);
  });

  it('sin state, o con state vacío, vuelve al listado sin búsqueda', () => {
    expect(busquedaParaVolver(undefined)).toBe('');
    expect(busquedaParaVolver(null)).toBe('');
    expect(busquedaParaVolver({})).toBe('');
    expect(busquedaParaVolver(stateDeListado(''))).toBe('');
  });

  it('rechaza una URL, un path o un fragmento: no son una búsqueda del listado', () => {
    expect(busquedaParaVolver({ busquedaClientes: 'https://evil.test/robar' })).toBe('');
    expect(busquedaParaVolver({ busquedaClientes: '/clientes/otro' })).toBe('');
    expect(busquedaParaVolver({ busquedaClientes: '?q=1#https://evil.test' })).toBe('');
    expect(busquedaParaVolver({ busquedaClientes: '?a=1\\b' })).toBe('');
    expect(busquedaParaVolver({ cliente: { id: 'x' } })).toBe('');
    expect(busquedaParaVolver({ busquedaClientes: `?${'a'.repeat(2100)}` })).toBe('');
  });
});

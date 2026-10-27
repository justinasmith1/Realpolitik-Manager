import {
  busquedaParaVolver,
  destinoDeVuelta,
  stateDeListado,
  stateDeRequisitos,
} from '@/modules/clientes/matriz.navegacion';

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

describe('destinoDeVuelta', () => {
  it('desde Requisitos vuelve a /clientes/matrices con la misma query string', () => {
    expect(destinoDeVuelta(stateDeRequisitos('?matrizConfigurada=false'))).toEqual({
      origen: 'requisitos',
      pathname: '/clientes/matrices',
      search: '?matrizConfigurada=false',
    });
  });

  it('desde Requisitos sin búsqueda vuelve a /clientes/matrices sin query', () => {
    expect(destinoDeVuelta(stateDeRequisitos(''))).toEqual({
      origen: 'requisitos',
      pathname: '/clientes/matrices',
      search: '',
    });
  });

  it('desde Clientes conserva el comportamiento actual: /clientes con su búsqueda', () => {
    expect(destinoDeVuelta(stateDeListado('?estado=INACTIVO&q=muni'))).toEqual({
      origen: 'clientes',
      pathname: '/clientes',
      search: '?estado=INACTIVO&q=muni',
    });
  });

  it.each([
    ['sin state', undefined],
    ['con null', null],
    ['con un state vacío', {}],
    ['con un origen desconocido', { origen: 'otro', busqueda: '?a=1' }],
    ['con un origen que no es string', { origen: ['requisitos'], busqueda: '?a=1' }],
    ['con un state que no es objeto', 'requisitos'],
  ])('%s vuelve a /clientes sin búsqueda', (_caso, state) => {
    expect(destinoDeVuelta(state)).toEqual({
      origen: 'clientes',
      pathname: '/clientes',
      search: '',
    });
  });

  it.each([
    ['una URL absoluta', 'https://x.com'],
    ['una URL sin esquema', '//x.com'],
    ['un path', '/clientes/otro'],
    ['una búsqueda con fragmento', '?q=1#https://x.com'],
    ['una barra invertida', '?a=1\b'],
    ['un valor que no es string', { valor: '?a=1' }],
    ['un largo excesivo', `?${'a'.repeat(2100)}`],
  ])(
    'con origen requisitos y %s el destino sigue siendo la ruta fija, sin query',
    (_c, busqueda) => {
      const destino = destinoDeVuelta({ origen: 'requisitos', busqueda });

      expect(destino).toEqual({ origen: 'requisitos', pathname: '/clientes/matrices', search: '' });
    },
  );

  it('el pathname nunca sale de lo que trae el state, ni con claves de ruta', () => {
    const destino = destinoDeVuelta({
      origen: 'requisitos',
      busqueda: '?a=1',
      pathname: 'https://x.com',
      to: '//x.com',
    });

    expect(destino.pathname).toBe('/clientes/matrices');
    expect(destino.search).toBe('?a=1');
  });
});

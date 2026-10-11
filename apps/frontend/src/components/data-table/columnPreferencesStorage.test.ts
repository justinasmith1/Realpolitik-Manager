import type { ColumnPreferencesScope } from '@/components/data-table/columnPreferences';
import {
  columnPreferencesKey,
  createLocalStorageColumnPreferencesStorage,
  parseColumnPreferences,
} from '@/components/data-table/columnPreferencesStorage';

const clientes: ColumnPreferencesScope = { tableId: 'clientes', ownerKey: 'anonymous' };
const CLAVE = 'realpolitik-manager:table-columns:v1:clientes:anonymous';

/** Web Storage cuyas operaciones fallan, como con el almacenamiento lleno o bloqueado. */
const storageQueFalla = {
  getItem: () => {
    throw new DOMException('Bloqueado', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('Sin espacio', 'QuotaExceededError');
  },
  removeItem: () => {
    throw new DOMException('Bloqueado', 'SecurityError');
  },
};

describe('columnPreferencesKey', () => {
  it('incluye namespace, feature, versión, tabla y dueño', () => {
    expect(columnPreferencesKey(clientes)).toBe(CLAVE);
  });

  it('un ":" en la tabla o el dueño no genera la misma clave para dos preferencias', () => {
    const a = columnPreferencesKey({ tableId: 'x:y', ownerKey: 'z' });
    const b = columnPreferencesKey({ tableId: 'x', ownerKey: 'y:z' });

    expect(a).not.toBe(b);
    expect(a.split(':')).toHaveLength(5);
  });
});

describe('parseColumnPreferences', () => {
  it('sin nada guardado devuelve null', () => {
    expect(parseColumnPreferences(null)).toBeNull();
  });

  it('devuelve los ids en el orden guardado', () => {
    expect(parseColumnPreferences('{"version":1,"ids":["email","cuit","canal"]}')).toEqual([
      'email',
      'cuit',
      'canal',
    ]);
  });

  it('`ids: []` es una preferencia, no un dato inválido', () => {
    expect(parseColumnPreferences('{"version":1,"ids":[]}')).toEqual([]);
  });

  it.each(['', '{', 'no es json', '{"version":1,"ids":["a"]'])(
    'JSON corrupto (%j) da null',
    (raw) => {
      expect(parseColumnPreferences(raw)).toBeNull();
    },
  );

  it.each([
    ['null', 'null'],
    ['un número', '1'],
    ['un string', '"cuit"'],
    ['un array suelto', '["cuit","email"]'],
    ['un objeto vacío', '{}'],
    ['sin ids', '{"version":1}'],
    ['ids que no es array', '{"version":1,"ids":"cuit"}'],
    ['ids con valores que no son texto', '{"version":1,"ids":["cuit",2]}'],
    ['ids null', '{"version":1,"ids":null}'],
  ])('forma incorrecta (%s) da null', (_caso, raw) => {
    expect(parseColumnPreferences(raw)).toBeNull();
  });

  it.each([
    ['otra versión', '{"version":2,"ids":["cuit"]}'],
    ['versión como texto', '{"version":"1","ids":["cuit"]}'],
    ['sin versión', '{"ids":["cuit"]}'],
  ])('%s da null', (_caso, raw) => {
    expect(parseColumnPreferences(raw)).toBeNull();
  });

  it('no valida los ids contra la tabla: eso lo hace quien conoce las columnas', () => {
    expect(parseColumnPreferences('{"version":1,"ids":["quitada","cuit","cuit"]}')).toEqual([
      'quitada',
      'cuit',
      'cuit',
    ]);
  });
});

describe('createLocalStorageColumnPreferencesStorage', () => {
  const storage = createLocalStorageColumnPreferencesStorage();

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('sin preferencia guardada devuelve null', () => {
    expect(storage.load(clientes)).toBeNull();
  });

  it('guarda solo la versión y los ids, en orden, bajo la clave versionada', () => {
    storage.save(clientes, ['email', 'cuit', 'canal']);

    expect(window.localStorage.getItem(CLAVE)).toBe('{"version":1,"ids":["email","cuit","canal"]}');
    expect(window.localStorage).toHaveLength(1);
  });

  it('lee lo que guardó, incluida una preferencia vacía', () => {
    storage.save(clientes, ['periodicidad', 'cuit']);
    expect(storage.load(clientes)).toEqual(['periodicidad', 'cuit']);

    storage.save(clientes, []);
    expect(storage.load(clientes)).toEqual([]);
  });

  it('con datos inválidos guardados devuelve null', () => {
    window.localStorage.setItem(CLAVE, '{corrupto');

    expect(storage.load(clientes)).toBeNull();
  });

  it('remove borra la clave en vez de guardar otro valor', () => {
    storage.save(clientes, ['cuit']);

    storage.remove(clientes);

    expect(window.localStorage.getItem(CLAVE)).toBeNull();
    expect(window.localStorage).toHaveLength(0);
  });

  it('cada dueño tiene su propia preferencia', () => {
    const usuarioA = { ...clientes, ownerKey: 'usuario-a' };
    const usuarioB = { ...clientes, ownerKey: 'usuario-b' };
    storage.save(usuarioA, ['cuit']);
    storage.save(usuarioB, ['email', 'canal']);

    expect(storage.load(usuarioA)).toEqual(['cuit']);
    expect(storage.load(usuarioB)).toEqual(['email', 'canal']);
    expect(storage.load(clientes)).toBeNull();

    storage.remove(usuarioA);
    expect(storage.load(usuarioB)).toEqual(['email', 'canal']);
  });

  it('cada tabla tiene su propia preferencia', () => {
    const otraTabla = { ...clientes, tableId: 'campanias' };
    storage.save(clientes, ['cuit']);

    expect(storage.load(otraTabla)).toBeNull();

    storage.save(otraTabla, ['nombre']);
    expect(storage.load(clientes)).toEqual(['cuit']);
  });

  it('si leer falla devuelve null', () => {
    const conFallo = createLocalStorageColumnPreferencesStorage(() => storageQueFalla);

    expect(conFallo.load(clientes)).toBeNull();
  });

  it('si escribir o borrar falla no lanza', () => {
    const conFallo = createLocalStorageColumnPreferencesStorage(() => storageQueFalla);

    expect(() => conFallo.save(clientes, ['cuit'])).not.toThrow();
    expect(() => conFallo.remove(clientes)).not.toThrow();
  });

  it('si el acceso mismo a localStorage falla, ninguna operación lanza', () => {
    const bloqueado = createLocalStorageColumnPreferencesStorage(() => {
      throw new DOMException('El acceso a localStorage está bloqueado', 'SecurityError');
    });

    expect(bloqueado.load(clientes)).toBeNull();
    expect(() => bloqueado.save(clientes, ['cuit'])).not.toThrow();
    expect(() => bloqueado.remove(clientes)).not.toThrow();
  });
});

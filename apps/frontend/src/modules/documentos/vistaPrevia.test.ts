import { admiteVistaPrevia, claseDeVistaPrevia } from '@/modules/documentos/vistaPrevia';

describe('vista previa de documentos (HU3.11)', () => {
  it.each([
    ['application/pdf', 'pdf'],
    ['image/jpeg', 'imagen'],
    ['image/png', 'imagen'],
  ])('%s se puede ver en el navegador', (tipoContenido, clase) => {
    expect(admiteVistaPrevia(tipoContenido)).toBe(true);
    expect(claseDeVistaPrevia(tipoContenido)).toBe(clase);
  });

  it('un DOCX no se puede ver: solo se descarga', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(admiteVistaPrevia(docx)).toBe(false);
    expect(claseDeVistaPrevia(docx)).toBeNull();
  });

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream', '', 'APPLICATION/PDF'])(
    'un formato que no es de los admitidos (%s) nunca se muestra',
    (tipoContenido) => {
      expect(admiteVistaPrevia(tipoContenido)).toBe(false);
    },
  );
});

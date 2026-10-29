/**
 * El botón que abre la hoja "Editar cliente" desde los paneles de la pantalla del cliente
 * (indicaciones de armado, observaciones internas). A la vista todos dicen lo mismo; el nombre
 * accesible lo contiene y suma de qué es el panel, para que un lector de pantalla los distinga.
 */
export const TEXTO_EDITAR_EN_LA_FICHA = 'Editar en la ficha del cliente';

/** Nombre accesible del botón: el texto visible, seguido del contexto ("…: observaciones internas"). */
export const nombreAccesibleEditarEnLaFicha = (contexto: string) =>
  `${TEXTO_EDITAR_EN_LA_FICHA}: ${contexto}`;

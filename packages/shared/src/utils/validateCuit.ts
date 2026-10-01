/**
 * Valida un CUIT/CUIL argentino usando el algoritmo del Módulo 11.
 *
 * Formato esperado: "XX-XXXXXXXX-X" (con guiones) o "XXXXXXXXXXX" (sin guiones).
 * Los tipos de CUIT válidos en Argentina son:
 *   - 20, 23, 24, 27  → personas físicas
 *   - 30, 33, 34       → personas jurídicas
 *   - 50, 55           → uso especial
 *
 * @param cuit - El CUIT a validar. Puede incluir guiones.
 * @returns `true` si el CUIT es válido, `false` en caso contrario.
 */
export function validateCuit(cuit: string): boolean {
  // 1. Normalizar: quitar guiones y espacios
  const normalized = cuit.replace(/[-\s]/g, '');

  // 2. Verificar que tenga exactamente 11 dígitos
  if (!/^\d{11}$/.test(normalized)) {
    return false;
  }

  // 3. Verificar prefijo válido
  const prefix = Number(normalized.slice(0, 2));
  const validPrefixes = [20, 23, 24, 27, 30, 33, 34, 50, 55];
  if (!validPrefixes.includes(prefix)) {
    return false;
  }

  // 4. Aplicar el algoritmo del Módulo 11
  //    Serie de multiplicadores definida por AFIP
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

  const digits = normalized.split('').map(Number);
  const verifier = digits[10]; // último dígito es el verificador

  const sum = multipliers.reduce((acc, mult, idx) => {
    // digits[idx] está garantizado a existir porque normalized tiene 11 dígitos
    // y los multiplicadores tienen 10 elementos (índices 0-9)
    return acc + mult * (digits[idx] ?? 0);
  }, 0);

  const remainder = sum % 11;

  // Reglas del Módulo 11:
  // - Si el resto es 0 → dígito verificador = 0
  // - Si el resto es 1 → el CUIT es inválido (no debería existir)
  // - En cualquier otro caso → dígito verificador = 11 - resto
  if (remainder === 0) {
    return verifier === 0;
  }

  if (remainder === 1) {
    return false;
  }

  return verifier === 11 - remainder;
}

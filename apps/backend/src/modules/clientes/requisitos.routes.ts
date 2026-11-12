import { CargaMasivaRequisitoSchema } from '@realpolitik/shared';

import { validate } from '../../middleware/validate';
import { autorizar, crearRouter } from '../auth/autorizacion';

import { cargarRequisitosMasivoController } from './requisitos.controller';

/** Operaciones sobre requisitos que no cuelgan de un cliente concreto (contrato 4.3). */
export const requisitosRouter = crearRouter();

requisitosRouter.post(
  '/masivo',
  autorizar('requisitos:editar'),
  validate({ body: CargaMasivaRequisitoSchema }),
  cargarRequisitosMasivoController,
);

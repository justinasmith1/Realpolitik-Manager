import { CargaMasivaRequisitoSchema } from '@realpolitik/shared';
import { Router } from 'express';

import { validate } from '../../middleware/validate';

import { cargarRequisitosMasivoController } from './requisitos.controller';

/** Operaciones sobre requisitos que no cuelgan de un cliente concreto (contrato 4.3). */
export const requisitosRouter = Router();

requisitosRouter.post(
  '/masivo',
  validate({ body: CargaMasivaRequisitoSchema }),
  cargarRequisitosMasivoController,
);

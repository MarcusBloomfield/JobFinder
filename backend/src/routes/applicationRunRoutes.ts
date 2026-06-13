import express from 'express';
import * as applicationRunController from '../controllers/applicationRunController';

const router = express.Router();

router.get('/', applicationRunController.getApplicationRuns);
router.get('/:id', applicationRunController.getApplicationRun);
router.post('/:id/cancel', applicationRunController.cancelApplicationRun);

export default router;

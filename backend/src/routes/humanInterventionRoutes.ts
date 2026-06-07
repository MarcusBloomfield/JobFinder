import express from 'express';
import * as humanInterventionController from '../controllers/humanInterventionController';

const router = express.Router();

router.get('/pending', humanInterventionController.getPendingInterventions);
router.get('/:id/screenshot', humanInterventionController.getInterventionScreenshot);
router.get('/:id', humanInterventionController.getIntervention);
router.post('/:id/continue', humanInterventionController.continueIntervention);
router.post('/:id/skip', humanInterventionController.skipIntervention);
router.post('/:id/fail', humanInterventionController.failIntervention);

export default router;

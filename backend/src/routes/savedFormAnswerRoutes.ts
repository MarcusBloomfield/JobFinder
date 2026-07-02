import express from 'express';
import * as savedFormAnswerController from '../controllers/savedFormAnswerController';

const router = express.Router();

router.get('/', savedFormAnswerController.listSavedFormAnswers);
router.post('/', savedFormAnswerController.createSavedFormAnswer);
router.put('/:id', savedFormAnswerController.updateSavedFormAnswer);
router.delete('/:id', savedFormAnswerController.deleteSavedFormAnswer);

export default router;

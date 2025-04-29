import express from 'express';
import * as openaiController from '../controllers/openaiController';

const router = express.Router();

// Generate search terms from resume
router.post('/generate-search-terms', openaiController.generateSearchTerms);

// Evaluate job match
router.post('/evaluate-job-match', openaiController.evaluateJobMatch);

export default router; 
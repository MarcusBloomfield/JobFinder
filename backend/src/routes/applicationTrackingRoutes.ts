import express from 'express';
import * as applicationTrackingController from '../controllers/applicationTrackingController';

const router = express.Router();

router.get('/history', applicationTrackingController.getApplicationHistory);
router.get('/summary', applicationTrackingController.getApplicationSummary);
router.post('/statuses', applicationTrackingController.getApplicationStatusesForJobs);
router.post('/:applicationId/enrich', applicationTrackingController.enrichTrackedApplicationFromListing);
router.patch('/:applicationId/job-details', applicationTrackingController.updateTrackedApplicationJobDetails);

export default router;

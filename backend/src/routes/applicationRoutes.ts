import express from 'express';
import * as applicationController from '../controllers/applicationController';

const router = express.Router();

router.post('/job', applicationController.applyToJob);
router.post('/login/seek', applicationController.openSeekLoginBrowser);
router.post('/login/:platform', applicationController.openJobSiteLoginBrowser);
router.post('/profile/fill', applicationController.fillApplicationProfile);

export default router;

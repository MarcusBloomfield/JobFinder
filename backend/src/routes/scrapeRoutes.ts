import express from 'express';
import * as scrapeController from '../controllers/scrapeController';

const router = express.Router();

// Scrape jobs from a specific job site
router.post('/site', scrapeController.scrapeJobSite);

// Scrape jobs from multiple job sites
router.post('/jobs', scrapeController.scrapeJobs);

export default router; 
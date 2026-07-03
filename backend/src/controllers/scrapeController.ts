import { Request, Response } from 'express';
import * as scrapeService from '../services/scrapeService';
import { JobSearchSite, SUPPORTED_JOB_SEARCH_SITES } from '../services/scrapeService';

const validSites: readonly JobSearchSite[] = SUPPORTED_JOB_SEARCH_SITES;

const isJobSearchSite = (site: unknown): site is JobSearchSite =>
  typeof site === 'string' && validSites.includes(site as JobSearchSite);

/**
 * Scrape jobs from a specific job site
 * @route POST /api/scrape/site
 */
export const scrapeJobSite = async (req: Request, res: Response) => {
  try {
    const { site, searchTerms, pageLimit, location, maxJobs } = req.body;
    
    if (!site || !searchTerms) {
      return res.status(400).json({ 
        error: true, 
        message: 'Missing required parameters: site, searchTerms' 
      });
    }
    
    if (!isJobSearchSite(site)) {
      return res.status(400).json({ 
        error: true, 
        message: `Invalid site parameter. Must be one of: ${validSites.join(', ')}` 
      });
    }
    
    // Convert pageLimit to number if it's provided
    const limit = pageLimit ? parseInt(pageLimit, 10) : 1;
    const requestedMaxJobs = maxJobs ? parseInt(maxJobs, 10) : undefined;
    
    // Default location to Perth, WA if not provided
    const locationToUse = location || 'Perth, WA';
    
    // Call the scrape service
    const jobs = await scrapeService.scrapeJobSite(site, searchTerms, locationToUse, limit, requestedMaxJobs);
    
    res.status(200).json({
      error: false,
      message: `Successfully scraped ${jobs.length} jobs from ${site} in ${locationToUse}`,
      data: jobs
    });
  } catch (error) {
    console.error('Error in scrapeJobSite controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

/**
 * Scrape jobs from multiple job sites
 * @route POST /api/scrape/jobs
 */
export const scrapeJobs = async (req: Request, res: Response) => {
  try {
    const { searchTerms, sites, pageLimit, location, maxJobs } = req.body;
    
    if (!searchTerms || !Array.isArray(searchTerms)) {
      return res.status(400).json({ 
        error: true, 
        message: 'Missing or invalid searchTerms parameter. Must be an array of strings.' 
      });
    }
    
    let sitesToSearch: JobSearchSite[] = [...validSites];
    
    if (sites && Array.isArray(sites)) {
      const invalidSites = sites.filter(site => !isJobSearchSite(site));
      if (invalidSites.length > 0) {
        return res.status(400).json({ 
          error: true, 
          message: `Invalid site parameters: ${invalidSites.join(', ')}. Valid options: ${validSites.join(', ')}` 
        });
      }
      sitesToSearch = sites;
    } else {
      // Default to all valid sites if not specified
      sitesToSearch = [...validSites];
    }
    
    // Convert pageLimit to number if it's provided
    const limit = pageLimit ? parseInt(pageLimit, 10) : 1;
    const requestedMaxJobs = maxJobs ? parseInt(maxJobs, 10) : undefined;
    
    // Default location to Perth, WA if not provided
    const locationToUse = location || 'Perth, WA';
    
    // Call the scrape service
    const jobs = await scrapeService.scrapeJobs(searchTerms, sitesToSearch, limit, locationToUse, requestedMaxJobs);
    
    res.status(200).json({
      error: false,
      message: `Successfully scraped ${jobs.length} jobs in ${locationToUse}`,
      data: jobs
    });
  } catch (error) {
    console.error('Error in scrapeJobs controller:', error);
    res.status(500).json({
      error: true,
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
}; 

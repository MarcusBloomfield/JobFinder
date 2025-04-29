import puppeteer, { Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import { Job } from '../models/Job';
import { v4 as uuidv4 } from 'uuid';

interface ScrapeConfig {
  searchUrl: string;
  titleSelector: string;
  companySelector: string;
  descriptionSelector: string;
  linkSelector: string;
  locationSelector?: string;
  salarySelector?: string;
  datePostedSelector?: string;
}

const siteConfigs: Record<string, ScrapeConfig> = {
  seek: {
    searchUrl: 'https://www.seek.com.au/jobs?keywords=',
    titleSelector: '[data-automation="jobTitle"]',
    companySelector: '[data-automation="jobCompany"]',
    descriptionSelector: '[data-automation="jobDescription"]',
    linkSelector: '[data-automation="jobTitle"]',
    locationSelector: '[data-automation="jobLocation"]',
    salarySelector: '[data-automation="jobSalary"]',
    datePostedSelector: '[data-automation="jobListingDate"]'
  },
  indeed: {
    searchUrl: 'https://www.indeed.com/jobs?q=',
    titleSelector: '.jobTitle',
    companySelector: '.companyName',
    descriptionSelector: '.job-snippet',
    linkSelector: '.jcs-JobTitle',
    locationSelector: '.companyLocation',
    datePostedSelector: '.date'
  },
  linkedin: {
    searchUrl: 'https://www.linkedin.com/jobs/search/?keywords=',
    titleSelector: '.job-card-list__title',
    companySelector: '.job-card-container__company-name',
    descriptionSelector: '.job-card-list__description',
    linkSelector: '.job-card-list__title',
    locationSelector: '.job-card-container__metadata-item',
    datePostedSelector: '.job-card-container__posted-date'
  }
};

/**
 * Scrape jobs from a specific job site
 */
export const scrapeJobSite = async (
  site: 'seek' | 'indeed' | 'linkedin',
  searchTerms: string,
  pageLimit: number = 1
): Promise<Job[]> => {
  console.log(`Scraping ${site} with search terms: ${searchTerms}`);
  
  const config = siteConfigs[site];
  if (!config) {
    throw new Error(`Scraping configuration not found for site: ${site}`);
  }
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const jobs: Job[] = [];
  
  try {
    const page = await browser.newPage();
    
    // Set user agent to avoid being detected as a bot
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    
    // Navigate to search URL with search terms
    const searchUrl = `${config.searchUrl}${encodeURIComponent(searchTerms)}`;
    console.log(`Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    
    // Extract job listings
    for (let i = 0; i < pageLimit; i++) {
      console.log(`Scraping page ${i + 1}`);
      
      // Extract job data
      const pageJobs = await extractJobsFromPage(page, config, site);
      jobs.push(...pageJobs);
      
      // Check if there's a next page
      const hasNextPage = await hasNextPageButton(page, site);
      if (i < pageLimit - 1 && hasNextPage) {
        await clickNextPage(page, site);
        await page.waitForNetworkIdle({ idleTime: 2000 });
      } else {
        break;
      }
    }
  } catch (error) {
    console.error(`Error scraping ${site}:`, error);
  } finally {
    await browser.close();
  }
  
  console.log(`Found ${jobs.length} jobs on ${site}`);
  return jobs;
};

/**
 * Extract jobs from the current page
 */
const extractJobsFromPage = async (
  page: Page,
  config: ScrapeConfig,
  site: string
): Promise<Job[]> => {
  const content = await page.content();
  const $ = cheerio.load(content);
  const jobs: Job[] = [];
  
  // Use different extraction strategies based on the site
  if (site === 'seek') {
    $(config.titleSelector).each((index, element) => {
      const title = $(element).text().trim();
      const url = 'https://www.seek.com.au' + $(element).attr('href');
      const company = $(element).closest('[data-automation="jobCard"]').find(config.companySelector).text().trim();
      const description = $(element).closest('[data-automation="jobCard"]').find('[data-automation="jobShortDescription"]').text().trim();
      const location = $(element).closest('[data-automation="jobCard"]').find(config.locationSelector || '').text().trim();
      const salary = $(element).closest('[data-automation="jobCard"]').find(config.salarySelector || '').text().trim();
      const datePosted = $(element).closest('[data-automation="jobCard"]').find(config.datePostedSelector || '').text().trim();
      
      jobs.push({
        id: uuidv4(),
        title,
        company,
        description,
        url,
        location,
        salary,
        datePosted
      });
    });
  } else if (site === 'indeed') {
    $(config.titleSelector).each((index, element) => {
      const title = $(element).text().trim();
      const url = 'https://www.indeed.com' + $(element).closest('a').attr('href');
      const company = $(element).closest('.job_seen_beacon').find(config.companySelector).text().trim();
      const description = $(element).closest('.job_seen_beacon').find(config.descriptionSelector).text().trim();
      const location = $(element).closest('.job_seen_beacon').find(config.locationSelector || '').text().trim();
      const datePosted = $(element).closest('.job_seen_beacon').find(config.datePostedSelector || '').text().trim();
      
      jobs.push({
        id: uuidv4(),
        title,
        company,
        description,
        url,
        location,
        datePosted
      });
    });
  } else if (site === 'linkedin') {
    $(config.titleSelector).each((index, element) => {
      const title = $(element).text().trim();
      const url = $(element).attr('href') || '';
      const company = $(element).closest('.job-card-container').find(config.companySelector).text().trim();
      const description = $(element).closest('.job-card-container').find(config.descriptionSelector).text().trim();
      const location = $(element).closest('.job-card-container').find(config.locationSelector || '').text().trim();
      const datePosted = $(element).closest('.job-card-container').find(config.datePostedSelector || '').text().trim();
      
      jobs.push({
        id: uuidv4(),
        title,
        company,
        description,
        url,
        location,
        datePosted
      });
    });
  }
  
  return jobs;
};

/**
 * Check if there's a next page button
 */
const hasNextPageButton = async (page: Page, site: string): Promise<boolean> => {
  if (site === 'seek') {
    return await page.evaluate(() => {
      return document.querySelector('[data-automation="pagination-next"]') !== null;
    });
  } else if (site === 'indeed') {
    return await page.evaluate(() => {
      return document.querySelector('[data-testid="pagination-page-next"]') !== null;
    });
  } else if (site === 'linkedin') {
    return await page.evaluate(() => {
      return document.querySelector('.artdeco-pagination__button--next:not(.artdeco-pagination__button--disabled)') !== null;
    });
  }
  return false;
};

/**
 * Click the next page button
 */
const clickNextPage = async (page: Page, site: string): Promise<void> => {
  if (site === 'seek') {
    await page.click('[data-automation="pagination-next"]');
  } else if (site === 'indeed') {
    await page.click('[data-testid="pagination-page-next"]');
  } else if (site === 'linkedin') {
    await page.click('.artdeco-pagination__button--next');
  }
};

/**
 * Scrape jobs from multiple sites
 */
export const scrapeJobs = async (
  searchTerms: string[],
  sites: ('seek' | 'indeed' | 'linkedin')[] = ['seek', 'indeed'],
  pageLimit: number = 1
): Promise<Job[]> => {
  console.log('Scraping jobs with search terms:', searchTerms);
  let allJobs: Job[] = [];
  
  for (const term of searchTerms) {
    for (const site of sites) {
      try {
        const jobs = await scrapeJobSite(site, term, pageLimit);
        allJobs.push(...jobs);
      } catch (error) {
        console.error(`Error scraping ${site} for term "${term}":`, error);
      }
    }
  }
  
  // Remove duplicates based on title+company
  const uniqueJobs = Array.from(
    new Map(allJobs.map(job => [`${job.title}-${job.company}`, job])).values()
  );
  
  return uniqueJobs;
}; 
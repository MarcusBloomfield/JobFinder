import puppeteer, { Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import { Job } from '../models/Job';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a random delay between min and max milliseconds
 */
const randomDelay = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Create a delay using promises
 */
const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Add random human-like scrolling behavior
 */
const randomScrolling = async (page: Page): Promise<void> => {
  const scrollCount = randomDelay(2, 6); // Random number of scroll actions
  
  console.log(`Performing ${scrollCount} random scrolls`);
  
  for (let i = 0; i < scrollCount; i++) {
    // Random scroll distance
    const scrollDistance = randomDelay(100, 800);
    
    await page.evaluate((distance) => {
      window.scrollBy(0, distance);
    }, scrollDistance);
    
    // Random pause between scrolls
    const scrollPause = randomDelay(300, 1200);
    console.log(`Scroll pause: ${scrollPause}ms`);
    await delay(scrollPause);
  }
};

/**
 * Simulate human-like mouse movement
 */
const simulateHumanMouseMovement = async (page: Page): Promise<void> => {
  const moveCount = randomDelay(1, 4);
  console.log(`Performing ${moveCount} random mouse movements`);
  
  for (let i = 0; i < moveCount; i++) {
    const x = randomDelay(100, 800);
    const y = randomDelay(100, 600);
    
    await page.mouse.move(x, y);
    
    const movePause = randomDelay(100, 500);
    await delay(movePause);
  }
};

interface ScrapeConfig {
  searchUrl: string;
  titleSelector: string;
  companySelector: string;
  descriptionSelector: string;
  linkSelector: string;
  locationSelector?: string;
  salarySelector?: string;
  datePostedSelector?: string;
  locationParam?: string;
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
    datePostedSelector: '[data-automation="jobListingDate"]',
    locationParam: '&where='
  },
  indeed: {
    searchUrl: 'https://www.indeed.com/jobs?q=',
    titleSelector: '.jobTitle',
    companySelector: '.companyName',
    descriptionSelector: '.job-snippet',
    linkSelector: '.jcs-JobTitle',
    locationSelector: '.companyLocation',
    datePostedSelector: '.date',
    locationParam: '&l='
  },
  linkedin: {
    searchUrl: 'https://www.linkedin.com/jobs/search/?keywords=',
    titleSelector: '.job-card-list__title',
    companySelector: '.job-card-container__company-name',
    descriptionSelector: '.job-card-list__description',
    linkSelector: '.job-card-list__title',
    locationSelector: '.job-card-container__metadata-item',
    datePostedSelector: '.job-card-container__posted-date',
    locationParam: '&location='
  }
};

/**
 * Scrape jobs from a specific job site
 */
export const scrapeJobSite = async (
  site: 'seek' | 'indeed' | 'linkedin',
  searchTerms: string,
  location: string = 'Perth, WA',
  pageLimit: number = 1
): Promise<Job[]> => {
  console.log(`Scraping ${site} with search terms: ${searchTerms} in location: ${location}`);
  
  const config = siteConfigs[site];
  if (!config) {
    throw new Error(`Scraping configuration not found for site: ${site}`);
  }
  
  // Add initial random delay before launching browser
  const initialDelay = randomDelay(1500, 5000);
  console.log(`Initial delay before launching browser: ${initialDelay}ms`);
  await delay(initialDelay);
  
  // Launch browser with additional randomized options
  const slowMo = randomDelay(10, 50); // Random slowdown of browser operations
  console.log(`Browser slowMo: ${slowMo}ms`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: slowMo
  });
  
  const jobs: Job[] = [];
  
  try {
    const page = await browser.newPage();
    
    // Randomize viewport size within reasonable dimensions
    const width = randomDelay(1200, 1600);
    const height = randomDelay(800, 1000);
    console.log(`Setting viewport: ${width}x${height}`);
    await page.setViewport({ width, height });
    
    // Set user agent to avoid being detected as a bot - use a variety of user agents
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    console.log(`Using user agent: ${randomUserAgent}`);
    await page.setUserAgent(randomUserAgent);
    
    // Add random delay before navigation
    const preNavigationDelay = randomDelay(1000, 3000);
    console.log(`Pre-navigation delay: ${preNavigationDelay}ms`);
    await delay(preNavigationDelay);
    
    // Set a throttled network speed occasionally to mimic slower connections
    if (Math.random() > 0.7) {
      console.log('Throttling network speed to simulate slower connection');
      // Apply throttling to mimic various network conditions
      const networkPresets = [
        { downloadSpeed: 1000000, uploadSpeed: 500000, latency: 50 }, // Fast 3G
        { downloadSpeed: 500000, uploadSpeed: 250000, latency: 100 },  // Slow 3G
        { downloadSpeed: 5000000, uploadSpeed: 2500000, latency: 20 }  // Decent DSL
      ];
      const randomNetwork = networkPresets[Math.floor(Math.random() * networkPresets.length)];
      
      // @ts-ignore - TypeScript might not recognize this client property
      const client = await page.target().createCDPSession();
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: randomNetwork.downloadSpeed,
        uploadThroughput: randomNetwork.uploadSpeed,
        latency: randomNetwork.latency
      });
    }
    
    // Navigate to search URL with search terms and location
    let searchUrl = `${config.searchUrl}${encodeURIComponent(searchTerms)}`;
    
    // Add location parameter if available in the config
    if (config.locationParam && location) {
      searchUrl += `${config.locationParam}${encodeURIComponent(location)}`;
    }
    
    console.log(`Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Add random delay after page load
    const postNavigationDelay = randomDelay(2000, 5000);
    console.log(`Post-navigation delay: ${postNavigationDelay}ms`);
    await delay(postNavigationDelay);
    
    // Simulate human-like scrolling before extraction
    await randomScrolling(page);
    
    // Occasionally hover over random elements to appear more human-like
    await simulateHumanMouseMovement(page);
    
    // Extract job listings
    for (let i = 0; i < pageLimit; i++) {
      console.log(`Scraping page ${i + 1}`);
      
      // Random delay before extracting data from page
      const preExtractionDelay = randomDelay(800, 2500);
      console.log(`Pre-extraction delay: ${preExtractionDelay}ms`);
      await delay(preExtractionDelay);
      
      // Simulate more human-like scrolling behavior
      await randomScrolling(page);
      
      // Hover over some job listings randomly
      await page.evaluate(() => {
        const jobElements = document.querySelectorAll('a, button, div[role="button"]');
        const randomIndex = Math.floor(Math.random() * jobElements.length);
        if (jobElements[randomIndex]) {
          // Simulate user hovering over elements
          const mouseoverEvent = new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
            view: window
          });
          jobElements[randomIndex].dispatchEvent(mouseoverEvent);
        }
      });
      
      // Extract job data
      const pageJobs = await extractJobsFromPage(page, config, site);
      jobs.push(...pageJobs);
      
      // Check if there's a next page
      const checkDelay = randomDelay(500, 1500);
      console.log(`Delay before checking for next page: ${checkDelay}ms`);
      await delay(checkDelay);
      
      const hasNextPage = await hasNextPageButton(page, site);
      if (i < pageLimit - 1 && hasNextPage) {
        // Random delay before clicking next page
        const preClickDelay = randomDelay(1500, 3500);
        console.log(`Pre-click delay before next page: ${preClickDelay}ms`);
        await delay(preClickDelay);
        
        // Simulate mouse movement before clicking
        await simulateHumanMouseMovement(page);
        
        await clickNextPage(page, site);
        await page.waitForNetworkIdle({ idleTime: randomDelay(1500, 3000) });
        
        // Random delay after page transition
        const postClickDelay = randomDelay(3000, 6000);
        console.log(`Post-click delay after next page: ${postClickDelay}ms`);
        await delay(postClickDelay);
        
        // Another round of random scrolling on the new page
        await randomScrolling(page);
      } else {
        break;
      }
    }
  } catch (error) {
    console.error(`Error scraping ${site}:`, error);
  } finally {
    // Random delay before closing browser
    const closingDelay = randomDelay(1000, 3000);
    console.log(`Delay before closing browser: ${closingDelay}ms`);
    await delay(closingDelay);
    
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
  // Random delay before extracting content
  const contentDelay = randomDelay(500, 1800);
  console.log(`Delay before extracting content: ${contentDelay}ms`);
  await delay(contentDelay);
  
  const content = await page.content();
  const $ = cheerio.load(content);
  const jobs: Job[] = [];
  
  // Use different extraction strategies based on the site
  if (site === 'seek') {
    const jobElements = $(config.titleSelector);
    console.log(`Found ${jobElements.length} job elements on page`);
    
    // Process each job with small random delays in between
    for (let i = 0; i < jobElements.length; i++) {
      const element = jobElements[i];
      
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
      
      // Add small random delay between processing jobs
      if (i < jobElements.length - 1) {
        const processingDelay = randomDelay(30, 150);
        // Don't log these small delays to avoid cluttering the console
        await delay(processingDelay);
      }
    }
  } else if (site === 'indeed') {
    const jobElements = $(config.titleSelector);
    console.log(`Found ${jobElements.length} job elements on page`);
    
    for (let i = 0; i < jobElements.length; i++) {
      const element = jobElements[i];
      
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
      
      // Add small random delay between processing jobs
      if (i < jobElements.length - 1) {
        const processingDelay = randomDelay(30, 150);
        await delay(processingDelay);
      }
    }
  } else if (site === 'linkedin') {
    const jobElements = $(config.titleSelector);
    console.log(`Found ${jobElements.length} job elements on page`);
    
    for (let i = 0; i < jobElements.length; i++) {
      const element = jobElements[i];
      
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
      
      // Add small random delay between processing jobs
      if (i < jobElements.length - 1) {
        const processingDelay = randomDelay(30, 150);
        await delay(processingDelay);
      }
    }
  }
  
  return jobs;
};

/**
 * Check if there's a next page button
 */
const hasNextPageButton = async (page: Page, site: string): Promise<boolean> => {
  // Add a small delay before checking for next page button
  const buttonCheckDelay = randomDelay(300, 1200);
  console.log(`Delay before checking next page button: ${buttonCheckDelay}ms`);
  await delay(buttonCheckDelay);
  
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
  // Add delay before clicking to mimic human behavior
  const preClickDelay = randomDelay(300, 900);
  console.log(`Small delay before click action: ${preClickDelay}ms`);
  await delay(preClickDelay);
  
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
  pageLimit: number = 1,
  location: string = 'Perth, WA'
): Promise<Job[]> => {
  console.log(`Scraping jobs with search terms: ${searchTerms} in location: ${location}`);
  let allJobs: Job[] = [];
  
  // Shuffle the order of sites and terms to appear less predictable
  const shuffledSites = [...sites].sort(() => Math.random() - 0.5);
  const shuffledTerms = [...searchTerms].sort(() => Math.random() - 0.5);
  
  console.log(`Scraping in randomized order: Terms: ${shuffledTerms.join(', ')}, Sites: ${shuffledSites.join(', ')}`);
  
  // Initial delay before starting the whole scraping process
  const initialProcessDelay = randomDelay(2000, 5000);
  console.log(`Initial delay before starting scraping process: ${initialProcessDelay}ms`);
  await delay(initialProcessDelay);
  
  for (const term of shuffledTerms) {
    // Delay between searching different terms
    const termDelay = randomDelay(3000, 8000);
    console.log(`Delay before searching new term "${term}": ${termDelay}ms`);
    await delay(termDelay);
    
    for (const site of shuffledSites) {
      try {
        // Add random delay between scraping different sites
        const siteSwitchDelay = randomDelay(3500, 7000);
        console.log(`Delay before scraping ${site} for term "${term}": ${siteSwitchDelay}ms`);
        await delay(siteSwitchDelay);
        
        const jobs = await scrapeJobSite(site, term, location, pageLimit);
        
        // Small delay after getting results before processing them
        const postResultDelay = randomDelay(500, 1500);
        console.log(`Delay after receiving results: ${postResultDelay}ms`);
        await delay(postResultDelay);
        
        allJobs.push(...jobs);
      } catch (error) {
        console.error(`Error scraping ${site} for term "${term}":`, error);
        
        // Add delay after error before trying next site
        const errorRecoveryDelay = randomDelay(5000, 10000);
        console.log(`Error recovery delay: ${errorRecoveryDelay}ms`);
        await delay(errorRecoveryDelay);
      }
    }
  }
  
  // Delay before deduplication process
  const preDedupDelay = randomDelay(1000, 2000);
  console.log(`Delay before deduplication: ${preDedupDelay}ms`);
  await delay(preDedupDelay);
  
  // Remove duplicates based on title+company
  const uniqueJobs = Array.from(
    new Map(allJobs.map(job => [`${job.title}-${job.company}`, job])).values()
  );
  
  console.log(`Found ${allJobs.length} total jobs, ${uniqueJobs.length} unique jobs after deduplication`);
  
  return uniqueJobs;
}; 
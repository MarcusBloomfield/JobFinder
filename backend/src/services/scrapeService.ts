import { Browser, BrowserContext, chromium, Page } from 'playwright';
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

const shouldRunHeadless = (): boolean => {
  const configured = process.env.PLAYWRIGHT_HEADLESS?.toLowerCase();

  if (configured === 'true') {
    return true;
  }

  if (configured === 'false') {
    return false;
  }

  return process.env.NODE_ENV === 'production';
};

const getSlowMo = (headless: boolean): number => {
  const configured = Number(process.env.PLAYWRIGHT_SLOWMO_MS);
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }

  return headless ? randomDelay(10, 50) : 250;
};

const getBrowserChannel = (): 'chrome' | 'msedge' | undefined => {
  const configured = process.env.PLAYWRIGHT_BROWSER_CHANNEL?.toLowerCase();

  if (configured === 'chrome' || configured === 'msedge') {
    return configured;
  }

  if (process.platform === 'win32') {
    return 'chrome';
  }

  return undefined;
};

const getUserDataDir = (): string | undefined => {
  const configured = process.env.PLAYWRIGHT_USER_DATA_DIR?.trim();
  return configured ? configured : undefined;
};

const getDefaultViewport = () => {
  const width = randomDelay(1200, 1600);
  const height = randomDelay(800, 1000);
  console.log(`Setting viewport: ${width}x${height}`);

  return { width, height };
};

interface BrowserSession {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
}

const dedupeJobs = (jobs: Job[]): Job[] => {
  return Array.from(
    new Map(jobs.map(job => [`${job.title}-${job.company}`, job])).values()
  );
};

const launchBrowserSession = async (
  headless: boolean,
  slowMo: number,
  userAgent: string
): Promise<BrowserSession> => {
  const channel = getBrowserChannel();
  const userDataDir = getUserDataDir();
  const viewport = getDefaultViewport();

  console.log(`Browser channel: ${channel ?? 'playwright-chromium'}`);
  if (userDataDir) {
    console.log(`Using persistent browser profile: ${userDataDir}`);
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel,
      headless,
      slowMo,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      viewport,
      userAgent
    });

    let page = context.pages()[0];
    if (!page) {
      page = await context.newPage();
    }

    return { context, page };
  }

  const browser = await chromium.launch({
    channel,
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo
  });

  const context = await browser.newContext({
    userAgent,
    viewport
  });
  const page = await context.newPage();

  return { browser, context, page };
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

/**
 * Occasionally throttle network speed to mimic slower connections.
 * Playwright exposes this through a Chromium CDP session.
 */
const maybeThrottleNetwork = async (page: Page): Promise<void> => {
  if (Math.random() <= 0.7) {
    return;
  }

  console.log('Throttling network speed to simulate slower connection');

  const networkPresets = [
    { downloadSpeed: 1000000, uploadSpeed: 500000, latency: 50 }, // Fast 3G
    { downloadSpeed: 500000, uploadSpeed: 250000, latency: 100 }, // Slow 3G
    { downloadSpeed: 5000000, uploadSpeed: 2500000, latency: 20 } // Decent DSL
  ];
  const randomNetwork = networkPresets[Math.floor(Math.random() * networkPresets.length)];

  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: randomNetwork.downloadSpeed,
    uploadThroughput: randomNetwork.uploadSpeed,
    latency: randomNetwork.latency
  });
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
  }
};

/**
 * Scrape jobs from a specific job site
 */
export const scrapeJobSite = async (
  site: 'seek',
  searchTerms: string,
  location: string = 'Perth, WA',
  pageLimit: number = 1,
  maxJobs?: number
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
  
  // Run headed in local development so the browser is visible during scraping.
  const headless = shouldRunHeadless();
  const slowMo = getSlowMo(headless);
  console.log(`Launching browser in ${headless ? 'headless' : 'headed'} mode`);
  console.log(`Browser slowMo: ${slowMo}ms`);
  
  const jobs: Job[] = [];
  let session: BrowserSession | undefined;
  
  try {
    // Set user agent to avoid being detected as a bot - use a variety of user agents
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    console.log(`Using user agent: ${randomUserAgent}`);
    session = await launchBrowserSession(headless, slowMo, randomUserAgent);
    const { page } = session;
    
    // Add random delay before navigation
    const preNavigationDelay = randomDelay(1000, 3000);
    console.log(`Pre-navigation delay: ${preNavigationDelay}ms`);
    await delay(preNavigationDelay);
    
    await maybeThrottleNetwork(page);
    
    // Navigate to search URL with search terms and location
    let searchUrl = `${config.searchUrl}${encodeURIComponent(searchTerms)}`;
    
    // Add location parameter if available in the config
    if (config.locationParam && location) {
      searchUrl += `${config.locationParam}${encodeURIComponent(location)}`;
    }
    
    console.log(`Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    
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

      if (typeof maxJobs === 'number' && dedupeJobs(jobs).length >= maxJobs) {
        console.log(`Reached requested max job count (${maxJobs}) on ${site}`);
        break;
      }
      
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
        await page.waitForLoadState('networkidle');
        
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

    if (session?.browser) {
      await session.browser.close();
    } else if (session?.context) {
      await session.context.close();
    }
  }
  
  const uniqueJobs = dedupeJobs(jobs);
  const limitedJobs = typeof maxJobs === 'number' ? uniqueJobs.slice(0, maxJobs) : uniqueJobs;
  console.log(`Found ${jobs.length} jobs on ${site}, returning ${limitedJobs.length} unique jobs`);
  return limitedJobs;
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
  
  return await page.evaluate(() => {
    return document.querySelector('[data-automation="pagination-next"]') !== null;
  });
};

/**
 * Click the next page button
 */
const clickNextPage = async (page: Page, site: string): Promise<void> => {
  // Add delay before clicking to mimic human behavior
  const preClickDelay = randomDelay(300, 900);
  console.log(`Small delay before click action: ${preClickDelay}ms`);
  await delay(preClickDelay);
  
  await page.click('[data-automation="pagination-next"]');
};

/**
 * Scrape jobs from multiple sites
 */
export const scrapeJobs = async (
  searchTerms: string[],
  sites: ('seek')[] = ['seek'],
  pageLimit: number = 1,
  location: string = 'Perth, WA',
  maxJobs?: number
): Promise<Job[]> => {
  console.log(`Scraping jobs with search terms: ${searchTerms} in location: ${location}`);
  
  // Shuffle the order of sites and terms to appear less predictable
  const shuffledSites = [...sites].sort(() => Math.random() - 0.5);
  const shuffledTerms = [...searchTerms].sort(() => Math.random() - 0.5);
  
  console.log(`Scraping in randomized order - Terms: ${shuffledTerms.join(', ')}, Sites: ${shuffledSites.join(', ')}`);
  
  // Initial delay before starting the whole scraping process
  const initialProcessDelay = randomDelay(2000, 5000);
  console.log(`Initial delay before starting scraping process: ${initialProcessDelay}ms`);
  await delay(initialProcessDelay);
  
  const allJobs: Job[] = [];

  outerLoop:
  for (const term of shuffledTerms) {
    for (const site of shuffledSites) {
      console.log(`Scraping "${term}" on ${site}`);
      try {
        const jobs = await scrapeJobSite(
          site,
          term,
          location,
          pageLimit,
          typeof maxJobs === 'number'
            ? Math.max(1, maxJobs - dedupeJobs(allJobs).length)
            : undefined
        );
        console.log(`Completed scraping ${site} for term "${term}": found ${jobs.length} jobs`);
        allJobs.push(...jobs);
        if (typeof maxJobs === 'number' && dedupeJobs(allJobs).length >= maxJobs) {
          console.log(`Reached requested total max job count (${maxJobs})`);
          break outerLoop;
        }
      } catch (error) {
        console.error(`Error scraping ${site} for term "${term}":`, error);
      }
    }
  }
  
  // Delay before deduplication process
  const preDedupDelay = randomDelay(1000, 2000);
  console.log(`Delay before deduplication: ${preDedupDelay}ms`);
  await delay(preDedupDelay);
  
  // Remove duplicates based on title+company
  const uniqueJobs = dedupeJobs(allJobs);
  const limitedJobs = typeof maxJobs === 'number' ? uniqueJobs.slice(0, maxJobs) : uniqueJobs;
  
  console.log(`Found ${allJobs.length} total jobs, ${uniqueJobs.length} unique jobs after deduplication, returning ${limitedJobs.length}`);
  
  return limitedJobs;
}; 

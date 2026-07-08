import { BrowserContext, chromium, Page } from 'playwright';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { Job } from '../models/Job';
import { v4 as uuidv4 } from 'uuid';

export const SUPPORTED_JOB_SEARCH_SITES = ['seek'] as const;
export type JobSearchSite = typeof SUPPORTED_JOB_SEARCH_SITES[number];

const PLAYWRIGHT_DIR = path.resolve(__dirname, '../../.playwright');
const DEFAULT_JOB_SEARCH_PROFILE_DIR = 'job-search-profile';
const SITE_PROFILE_DIRS: Record<JobSearchSite, string> = {
  seek: 'seek-profile'
};

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

const getUserDataDir = (site?: JobSearchSite): string => {
  const configured = process.env.PLAYWRIGHT_USER_DATA_DIR?.trim();
  if (configured && !site) {
    return configured;
  }

  if (!site) {
    return path.join(PLAYWRIGHT_DIR, DEFAULT_JOB_SEARCH_PROFILE_DIR);
  }

  if (configured && site === 'seek') {
    return configured;
  }

  return path.join(PLAYWRIGHT_DIR, SITE_PROFILE_DIRS[site]);
};

const inferJobSearchSiteFromUrl = (jobUrl: string): JobSearchSite | undefined => {
  try {
    const hostname = new URL(jobUrl).hostname.toLowerCase();

    if (hostname.endsWith('seek.com.au')) {
      return 'seek';
    }

  } catch {
    return undefined;
  }

  return undefined;
};

const getDefaultViewport = () => {
  const width = randomDelay(1200, 1600);
  const height = randomDelay(800, 1000);
  console.log(`Setting viewport: ${width}x${height}`);

  return { width, height };
};

interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

interface ScrapedJobListingDetails {
  title?: string;
  company?: string;
  description?: string;
  location?: string;
  salary?: string;
  datePosted?: string;
  suburbOrPostcode?: string;
}

const dedupeJobs = (jobs: Job[]): Job[] => {
  return Array.from(
    new Map(jobs.map(job => [`${job.title}-${job.company}`, job])).values()
  );
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeMultilineText = (value: string): string =>
  value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const getRandomUserAgent = (): string => {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
  ];

  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

const getFirstText = (root: any, selectors: string[]): string => {
  for (const selector of selectors) {
    const text = normalizeWhitespace(root.find(selector).first().text());
    if (text) {
      return text;
    }
  }

  return '';
};

const getFirstMultilineText = (root: any, selectors: string[]): string => {
  for (const selector of selectors) {
    const text = normalizeMultilineText(root.find(selector).first().text());
    if (text) {
      return text;
    }
  }

  return '';
};

const decodeHtmlToText = (value: string): string =>
  normalizeMultilineText(cheerio.load(`<div>${value}</div>`).text());

const inferSuburbOrPostcode = (value?: string): string => {
  const normalized = normalizeWhitespace(value || '');
  if (!normalized) {
    return '';
  }

  const postcodeMatch = normalized.match(/\b\d{4}\b/);
  if (postcodeMatch) {
    return postcodeMatch[0];
  }

  return normalized.split(',')[0]?.trim() || normalized;
};

const findJobPostingNode = (value: unknown): Record<string, any> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPostingNode(item);
      if (found) {
        return found;
      }
    }

    return null;
  }

  const candidate = value as Record<string, any>;
  const type = candidate['@type'];
  if (
    type === 'JobPosting' ||
    (Array.isArray(type) && type.includes('JobPosting'))
  ) {
    return candidate;
  }

  for (const nestedValue of Object.values(candidate)) {
    const found = findJobPostingNode(nestedValue);
    if (found) {
      return found;
    }
  }

  return null;
};

const parseJobPostingJsonLd = ($: cheerio.CheerioAPI): ScrapedJobListingDetails => {
  const parsedDetails: ScrapedJobListingDetails = {};

  $('script[type="application/ld+json"]').each((_, element) => {
    if (parsedDetails.description && parsedDetails.company && parsedDetails.location) {
      return;
    }

    const raw = $(element).contents().text().trim();
    if (!raw) {
      return;
    }

    try {
      const jobPosting = findJobPostingNode(JSON.parse(raw));
      if (!jobPosting) {
        return;
      }

      const jobLocation = Array.isArray(jobPosting.jobLocation)
        ? jobPosting.jobLocation[0]
        : jobPosting.jobLocation;
      const address = jobLocation?.address || jobLocation;
      const addressLocality = normalizeWhitespace(address?.addressLocality || '');
      const addressRegion = normalizeWhitespace(address?.addressRegion || '');
      const postalCode = normalizeWhitespace(address?.postalCode || '');
      const locationParts = [addressLocality, addressRegion].filter(Boolean);
      const location =
        locationParts.length > 0
          ? `${locationParts.join(', ')}${postalCode ? ` ${postalCode}` : ''}`.trim()
          : '';

      parsedDetails.title = normalizeWhitespace(jobPosting.title || '');
      parsedDetails.company = normalizeWhitespace(jobPosting.hiringOrganization?.name || '');
      parsedDetails.description = decodeHtmlToText(jobPosting.description || '');
      parsedDetails.location = location;
      parsedDetails.suburbOrPostcode = postalCode || addressLocality;
      parsedDetails.datePosted = normalizeWhitespace(jobPosting.datePosted || '');

      const baseSalary = jobPosting.baseSalary?.value || jobPosting.baseSalary;
      if (typeof baseSalary?.value === 'number') {
        parsedDetails.salary = normalizeWhitespace(
          `${jobPosting.baseSalary?.currency || ''} ${baseSalary.value}`.trim()
        );
      } else if (typeof baseSalary?.minValue === 'number' || typeof baseSalary?.maxValue === 'number') {
        const minimum = typeof baseSalary?.minValue === 'number' ? baseSalary.minValue : '';
        const maximum = typeof baseSalary?.maxValue === 'number' ? baseSalary.maxValue : '';
        parsedDetails.salary = normalizeWhitespace(
          `${jobPosting.baseSalary?.currency || ''} ${minimum}${minimum && maximum ? ' - ' : ''}${maximum}`.trim()
        );
      }
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  });

  return parsedDetails;
};

const mergeScrapedDetails = (
  primary: ScrapedJobListingDetails,
  fallback: ScrapedJobListingDetails
): ScrapedJobListingDetails => ({
  title: primary.title || fallback.title,
  company: primary.company || fallback.company,
  description:
    (primary.description && primary.description.length >= (fallback.description || '').length
      ? primary.description
      : fallback.description) || primary.description,
  location: primary.location || fallback.location,
  salary: primary.salary || fallback.salary,
  datePosted: primary.datePosted || fallback.datePosted,
  suburbOrPostcode: primary.suburbOrPostcode || fallback.suburbOrPostcode
});

const getClosestJobCard = ($: cheerio.CheerioAPI, element: any): any => {
  const selectors = [
    '[data-automation="jobCard"]',
    '[data-testid="slider_item"]',
    '.job_seen_beacon',
    '.base-card',
    '.job-search-card',
    'article',
    'li',
    '[data-testid="job-card"]'
  ];

  for (const selector of selectors) {
    const candidate = $(element).closest(selector).first();
    if (candidate.length > 0) {
      return candidate;
    }
  }

  return $(element).parent();
};

const launchBrowserSession = async (
  headless: boolean,
  slowMo: number,
  userAgent: string,
  site?: JobSearchSite
): Promise<BrowserSession> => {
  const channel = getBrowserChannel();
  const userDataDir = getUserDataDir(site);
  const viewport = getDefaultViewport();

  console.log(`Browser channel: ${channel ?? 'playwright-chromium'}`);
  console.log(`Using persistent browser profile: ${userDataDir}`);
  fs.mkdirSync(userDataDir, { recursive: true });

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
  baseUrl: string;
}

const siteConfigs: Record<JobSearchSite, ScrapeConfig> = {
  seek: {
    searchUrl: 'https://www.seek.com.au/jobs?keywords=',
    titleSelector: '[data-automation="jobTitle"]',
    companySelector: '[data-automation="jobCompany"]',
    descriptionSelector: '[data-automation="jobDescription"]',
    linkSelector: '[data-automation="jobTitle"]',
    locationSelector: '[data-automation="jobLocation"]',
    salarySelector: '[data-automation="jobSalary"]',
    datePostedSelector: '[data-automation="jobListingDate"]',
    locationParam: '&where=',
    baseUrl: 'https://www.seek.com.au'
  }
};

export const buildSearchUrl = (
  site: JobSearchSite,
  searchTerms: string,
  location: string = 'Perth, WA'
): string => {
  const config = siteConfigs[site];
  let searchUrl = `${config.searchUrl}${encodeURIComponent(searchTerms)}`;

  if (config.locationParam && location) {
    searchUrl += `${config.locationParam}${encodeURIComponent(location)}`;
  }

  return searchUrl;
};

/**
 * Scrape jobs from a specific job site
 */
export const scrapeJobSite = async (
  site: JobSearchSite,
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
    const randomUserAgent = getRandomUserAgent();
    console.log(`Using user agent: ${randomUserAgent}`);
    session = await launchBrowserSession(headless, slowMo, randomUserAgent, site);
    const { page } = session;
    
    // Add random delay before navigation
    const preNavigationDelay = randomDelay(1000, 3000);
    console.log(`Pre-navigation delay: ${preNavigationDelay}ms`);
    await delay(preNavigationDelay);
    
    await maybeThrottleNetwork(page);
    
    const searchUrl = buildSearchUrl(site, searchTerms, location);
    
    console.log(`Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    
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
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
        
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

    if (session?.context) {
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
  site: JobSearchSite
): Promise<Job[]> => {
  // Random delay before extracting content
  const contentDelay = randomDelay(500, 1800);
  console.log(`Delay before extracting content: ${contentDelay}ms`);
  await delay(contentDelay);
  
  const content = await page.content();
  const $ = cheerio.load(content);
  const jobs: Job[] = [];
  
  const jobElements = $(config.titleSelector);
  console.log(`Found ${jobElements.length} ${site} job elements on page`);

  for (let i = 0; i < jobElements.length; i++) {
    const element = jobElements[i];
    const jobCard = getClosestJobCard($, element);
    const linkElement = $(element).is('a') ? $(element) : jobCard.find(config.linkSelector).first();
    const title = normalizeWhitespace($(element).text() || linkElement.text());
    const href = linkElement.attr('href') || $(element).attr('href');
    const url = href ? new URL(href, config.baseUrl).toString() : '';
    const company = getFirstText(jobCard, [
      config.companySelector,
      '[data-automation="advertiser-name"]',
      '[data-testid="job-card-company"]'
    ]);
    const description = getFirstMultilineText(jobCard, [
      config.descriptionSelector,
      '[data-automation="jobShortDescription"]',
      '[data-testid="job-card-teaser"]'
    ]);
    const location = getFirstText(jobCard, [
      config.locationSelector || '',
      '[data-automation="job-detail-location"]',
      '[data-testid="job-card-location"]'
    ].filter(Boolean));
    const salary = getFirstText(jobCard, [config.salarySelector || ''].filter(Boolean));
    const datePosted = getFirstText(jobCard, [config.datePostedSelector || ''].filter(Boolean));

    if (!title || !url) {
      continue;
    }

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

    if (i < jobElements.length - 1) {
      await delay(randomDelay(30, 150));
    }
  }
  
  return jobs;
};

export const scrapeJobListingDetails = async (jobUrl: string): Promise<ScrapedJobListingDetails> => {
  if (!jobUrl.trim()) {
    return {};
  }

  const headless = shouldRunHeadless();
  const slowMo = getSlowMo(headless);
  const userAgent = getRandomUserAgent();
  let session: BrowserSession | undefined;

  try {
    session = await launchBrowserSession(
      headless,
      slowMo,
      userAgent,
      inferJobSearchSiteFromUrl(jobUrl)
    );
    const { page } = session;

    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await delay(1200);

    const content = await page.content();
    const $ = cheerio.load(content);
    const body = $('body');

    const jsonLdDetails = parseJobPostingJsonLd($);
    const domDetails: ScrapedJobListingDetails = {
      title: getFirstText(body, [
        '[data-automation="job-detail-title"]',
        '[data-testid="job-detail-title"]',
        'main h1',
        'h1'
      ]),
      company: getFirstText(body, [
        '[data-automation="advertiser-name"]',
        '[data-automation="jobCompany"]',
        '[data-testid="advertiser-name"]',
        'main a[href*="/companies/"]'
      ]),
      description: getFirstMultilineText(body, [
        '[data-automation="jobAdDetails"]',
        '[data-automation="jobDescription"]',
        '[data-testid="job-details"]',
        'main article'
      ]),
      location: getFirstText(body, [
        '[data-automation="job-detail-location"]',
        '[data-automation="jobLocation"]',
        '[data-testid="job-location"]'
      ]),
      salary: getFirstText(body, [
        '[data-automation="job-detail-salary"]',
        '[data-automation="jobSalary"]'
      ]),
      datePosted: getFirstText(body, [
        '[data-automation="job-detail-date"]',
        '[data-automation="jobListingDate"]'
      ])
    };
    domDetails.suburbOrPostcode = inferSuburbOrPostcode(domDetails.location);

    return mergeScrapedDetails(jsonLdDetails, domDetails);
  } catch (error) {
    console.error(`Error scraping job listing details for ${jobUrl}:`, error);
    return {};
  } finally {
    if (session?.context) {
      await session.context.close();
    }
  }
};

/**
 * Check if there's a next page button
 */
const hasNextPageButton = async (page: Page, site: string): Promise<boolean> => {
  // Add a small delay before checking for next page button
  const buttonCheckDelay = randomDelay(300, 1200);
  console.log(`Delay before checking next page button: ${buttonCheckDelay}ms`);
  await delay(buttonCheckDelay);
  
  const selector = getNextPageSelector(site);
  const nextButton = page.locator(selector).first();
  if ((await nextButton.count()) === 0) {
    return false;
  }

  return nextButton.isEnabled().catch(() => false);
};

/**
 * Click the next page button
 */
const clickNextPage = async (page: Page, site: string): Promise<void> => {
  // Add delay before clicking to mimic human behavior
  const preClickDelay = randomDelay(300, 900);
  console.log(`Small delay before click action: ${preClickDelay}ms`);
  await delay(preClickDelay);
  
  await page.locator(getNextPageSelector(site)).first().click({ timeout: 10000 });
};

const getNextPageSelector = (site: string): string => {
  switch (site) {
    case 'seek':
    default:
      return '[data-automation="pagination-next"]';
  }
};

/**
 * Scrape jobs from multiple sites
 */
export const scrapeJobs = async (
  searchTerms: string[],
  sites: JobSearchSite[] = ['seek'],
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

  for (const term of shuffledTerms) {
    const remainingJobs =
      typeof maxJobs === 'number' ? Math.max(1, maxJobs - dedupeJobs(allJobs).length) : undefined;
    console.log(`Scraping "${term}" across sites in parallel: ${shuffledSites.join(', ')}`);
    const siteResults = await Promise.all(
      shuffledSites.map(async site => {
        try {
          const jobs = await scrapeJobSite(site, term, location, pageLimit, remainingJobs);
          console.log(`Completed scraping ${site} for term "${term}": found ${jobs.length} jobs`);
          return jobs;
        } catch (error) {
          console.error(`Error scraping ${site} for term "${term}":`, error);
          return [];
        }
      })
    );
    allJobs.push(...siteResults.flat());
    if (typeof maxJobs === 'number' && dedupeJobs(allJobs).length >= maxJobs) {
      console.log(`Reached requested total max job count (${maxJobs})`);
      break;
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

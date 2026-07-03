import { Browser, BrowserContext, chromium, Page } from 'playwright';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { Job } from '../models/Job';
import { v4 as uuidv4 } from 'uuid';

export const SUPPORTED_JOB_SEARCH_SITES = ['seek', 'linkedin', 'employmenthero'] as const;
export type JobSearchSite = typeof SUPPORTED_JOB_SEARCH_SITES[number];

const PLAYWRIGHT_DIR = path.resolve(__dirname, '../../.playwright');
const JOB_SEARCH_HTML_DIR = path.join(PLAYWRIGHT_DIR, 'job-search-html');
const SITE_PROFILE_DIRS: Record<JobSearchSite, string> = {
  seek: 'seek-profile',
  linkedin: 'linkedin-profile',
  employmenthero: 'employmenthero-profile'
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

const getUserDataDir = (site?: JobSearchSite): string | undefined => {
  const configured = process.env.PLAYWRIGHT_USER_DATA_DIR?.trim();
  if (configured && !site) {
    return configured;
  }

  if (!site) {
    return undefined;
  }

  if (configured && site === 'seek') {
    return configured;
  }

  return path.join(PLAYWRIGHT_DIR, SITE_PROFILE_DIRS[site]);
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

const sanitizeSnapshotName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'search';

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

const saveEmploymentHeroHtmlSnapshot = async (
  page: Page,
  searchTerms: string,
  location: string
): Promise<void> => {
  try {
    fs.mkdirSync(JOB_SEARCH_HTML_DIR, { recursive: true });
    const html = await page.content();
    const label = sanitizeSnapshotName(`${searchTerms}-${location}`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const latestPath = path.join(JOB_SEARCH_HTML_DIR, 'employmenthero-latest.html');
    const timestampedPath = path.join(JOB_SEARCH_HTML_DIR, `employmenthero-${label}-${timestamp}.html`);

    fs.writeFileSync(latestPath, html, 'utf8');
    fs.writeFileSync(timestampedPath, html, 'utf8');
    console.log(`Saved Employment Hero job search HTML snapshot: ${timestampedPath}`);
  } catch (error) {
    console.warn(
      'Could not save Employment Hero job search HTML snapshot:',
      error instanceof Error ? error.message : error
    );
  }
};

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
  if (userDataDir) {
    console.log(`Using persistent browser profile: ${userDataDir}`);
    fs.mkdirSync(userDataDir, { recursive: true });
    try {
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
    } catch (error) {
      console.warn(
        `Could not open persistent ${site || 'job search'} profile; falling back to a temporary browser context:`,
        error instanceof Error ? error.message : error
      );
    }
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
  baseUrl: string;
  searchInputSelector?: string;
  appendSearchTermsToUrl?: boolean;
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
  },
  linkedin: {
    searchUrl: 'https://www.linkedin.com/jobs/search/?keywords=',
    titleSelector: '.base-search-card__title, .job-card-list__title, a.job-card-list__title',
    companySelector: '.base-search-card__subtitle, .job-card-container__primary-description',
    descriptionSelector: '.base-search-card__metadata, .job-search-card__snippet',
    linkSelector: 'a.base-card__full-link, a.job-card-list__title, a[href*="/jobs/view/"]',
    locationSelector: '.job-search-card__location, .job-card-container__metadata-item',
    salarySelector: '.job-search-card__salary-info',
    datePostedSelector: 'time, .job-search-card__listdate',
    locationParam: '&location=',
    baseUrl: 'https://www.linkedin.com'
  },
  employmenthero: {
    searchUrl: 'https://employmenthero.com/jobs/',
    titleSelector: [
      '.eh-job-item__title',
      '[data-wp-text*="title"]',
      '[class*="job"][class*="title"]',
      'a[href*="/jobs/position/"]',
      'a[href*="jobs.employmenthero.com/jobs/"]',
      'a[href*="swagapp.com/jobs/"]'
    ].join(', '),
    companySelector: '.eh-job-item__company',
    descriptionSelector: '.eh-job-item__description, .eh-job-item__details',
    linkSelector: [
      'a.eh-job-item',
      'a[href*="/jobs/position/"]',
      'a[href*="jobs.employmenthero.com/jobs/"]',
      'a[href*="swagapp.com/jobs/"]'
    ].join(', '),
    locationSelector: '.eh-job-item__location, [data-wp-text="context.item.location"]',
    salarySelector: '.eh-job-item__salary',
    datePostedSelector: '.eh-job-item__posted-date, .eh-job-item__date',
    baseUrl: 'https://employmenthero.com',
    searchInputSelector: '.nlp-search-input',
    appendSearchTermsToUrl: false
  }
};

export const buildSearchUrl = (
  site: JobSearchSite,
  searchTerms: string,
  location: string = 'Perth, WA'
): string => {
  const config = siteConfigs[site];
  let searchUrl =
    config.appendSearchTermsToUrl === false
      ? config.searchUrl
      : `${config.searchUrl}${encodeURIComponent(searchTerms)}`;

  if (config.appendSearchTermsToUrl !== false && config.locationParam && location) {
    searchUrl += `${config.locationParam}${encodeURIComponent(location)}`;
  }

  return searchUrl;
};

const getEmploymentHeroSearchText = (searchTerms: string, location: string): string =>
  [searchTerms, location].map(value => value.trim()).filter(Boolean).join(' in ');

const runEmploymentHeroSearch = async (
  page: Page,
  searchTerms: string,
  location: string
): Promise<void> => {
  const input = page
    .locator(
      [
        '.nlp-search-input',
        'input[type="search"]',
        'input[placeholder*="Search"]',
        'input[aria-label*="Search"]'
      ].join(', ')
    )
    .first();
  if ((await input.count()) === 0) {
    await saveEmploymentHeroHtmlSnapshot(page, searchTerms, location);
    return;
  }

  await input.fill(getEmploymentHeroSearchText(searchTerms, location));

  const searchButton = page
    .locator('.nlp-icon-right button[data-wp-on--click="actions.onClickSearch"], button:has-text("Search")')
    .first();
  if ((await searchButton.count()) > 0) {
    await searchButton.click({ timeout: 3000 }).catch(() => page.keyboard.press('Enter'));
  } else {
    await page.keyboard.press('Enter');
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await saveEmploymentHeroHtmlSnapshot(page, searchTerms, location);
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
    if (site === 'employmenthero') {
      await runEmploymentHeroSearch(page, searchTerms, location);
    }
    
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
  site: JobSearchSite
): Promise<Job[]> => {
  // Random delay before extracting content
  const contentDelay = randomDelay(500, 1800);
  console.log(`Delay before extracting content: ${contentDelay}ms`);
  await delay(contentDelay);
  
  const content = await page.content();
  const $ = cheerio.load(content);
  const jobs: Job[] = [];

  if (site === 'employmenthero') {
    const employmentHeroJobs = extractEmploymentHeroJobs($);
    if (employmentHeroJobs.length > 0) {
      return employmentHeroJobs;
    }
  }
  
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

const stripHtml = (value: string): string => normalizeMultilineText(cheerio.load(value).text());

const readEmploymentHeroString = (record: Record<string, any>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = normalizeWhitespace(String(value));
      if (normalized) {
        return normalized;
      }
    }

    if (value && typeof value === 'object') {
      const nestedName = readEmploymentHeroString(value as Record<string, any>, [
        'name',
        'title',
        'label',
        'city',
        'suburb',
        'state',
        'region',
        'postcode',
        'postalCode'
      ]);
      if (nestedName) {
        return nestedName;
      }
    }
  }

  return '';
};

const buildEmploymentHeroLocation = (record: Record<string, any>): string => {
  const location = record.location || record.job_location || record.address;
  if (typeof location === 'string') {
    return normalizeWhitespace(location);
  }

  if (location && typeof location === 'object') {
    const locationRecord = location as Record<string, any>;
    const parts = [
      locationRecord.city,
      locationRecord.suburb,
      locationRecord.addressLocality,
      locationRecord.state,
      locationRecord.region,
      locationRecord.addressRegion,
      locationRecord.postcode,
      locationRecord.postalCode
    ]
      .map(value => (typeof value === 'string' || typeof value === 'number' ? normalizeWhitespace(String(value)) : ''))
      .filter(Boolean);

    if (parts.length > 0) {
      return Array.from(new Set(parts)).join(', ');
    }
  }

  return readEmploymentHeroString(record, [
    'location_name',
    'city',
    'suburb',
    'state',
    'region',
    'remote_flexibility',
    'workplace_type'
  ]);
};

const toEmploymentHeroJobUrl = (rawUrl: string, record: Record<string, any>): string => {
  const url = normalizeWhitespace(rawUrl);
  if (url) {
    return new URL(url, 'https://employmenthero.com').toString();
  }

  const slug = readEmploymentHeroString(record, ['slug', 'job_slug']);
  if (slug) {
    return new URL(`/jobs/position/${slug}`, 'https://employmenthero.com').toString();
  }

  const id = readEmploymentHeroString(record, ['id', 'uuid', 'job_id']);
  if (id) {
    return new URL(`/jobs/position/${id}`, 'https://employmenthero.com').toString();
  }

  return '';
};

const createEmploymentHeroJobFromRecord = (record: Record<string, any>): Job | null => {
  const title = readEmploymentHeroString(record, ['title', 'job_title', 'position_title', 'name']);
  const url = toEmploymentHeroJobUrl(
    readEmploymentHeroString(record, [
      'jobUrl',
      'job_url',
      'url',
      'link',
      'permalink',
      'absolute_url',
      'application_url',
      'apply_url'
    ]),
    record
  );

  if (!title || !url) {
    return null;
  }

  return {
    id: uuidv4(),
    title,
    company: readEmploymentHeroString(record, [
      'organisation_name',
      'organization_name',
      'organisationName',
      'organizationName',
      'company_name',
      'companyName',
      'company',
      'employer'
    ]),
    description: stripHtml(
      readEmploymentHeroString(record, [
        'description',
        'short_description',
        'summary',
        'excerpt',
        'job_description'
      ])
    ),
    url,
    location: buildEmploymentHeroLocation(record),
    salary: readEmploymentHeroString(record, [
      'formatted_salary_range',
      'salary',
      'salary_range',
      'pay_range'
    ]),
    datePosted: readEmploymentHeroString(record, [
      'formatted_posted_date',
      'posted_at',
      'date_posted',
      'created_at',
      'published_at'
    ])
  };
};

const collectEmploymentHeroJobRecords = (
  value: unknown,
  jobs: Job[],
  seen: Set<unknown> = new Set()
): void => {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach(item => collectEmploymentHeroJobRecords(item, jobs, seen));
    return;
  }

  const record = value as Record<string, any>;
  const job = createEmploymentHeroJobFromRecord(record);
  if (job) {
    jobs.push(job);
  }

  Object.values(record).forEach(nestedValue => collectEmploymentHeroJobRecords(nestedValue, jobs, seen));
};

const isEmploymentHeroJobHref = (href?: string, linkText: string = ''): boolean => {
  if (!href) {
    return false;
  }

  try {
    const url = new URL(href, 'https://employmenthero.com');
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase().replace(/\/+$/, '');

    const looksLikePostedJobCard = /\bposted\b/i.test(linkText);

    if (hostname.endsWith('swagapp.com')) {
      return pathname.includes('/jobs/') && looksLikePostedJobCard;
    }

    if (!hostname.endsWith('employmenthero.com')) {
      return false;
    }

    if (pathname === '/jobs') {
      return false;
    }

    return (
      pathname.startsWith('/jobs/position/') ||
      (hostname.startsWith('jobs.') && pathname.startsWith('/jobs/')) ||
      (pathname.startsWith('/jobs/') && looksLikePostedJobCard)
    );
  } catch {
    return false;
  }
};

const getEmploymentHeroCardText = ($: cheerio.CheerioAPI, card: any, selectors: string[]): string => {
  const values: string[] = [];

  selectors.forEach(selector => {
    card.find(selector).each((_, element) => {
      const text = normalizeWhitespace($(element).text());
      if (text && !values.includes(text)) {
        values.push(text);
      }
    });
  });

  return values[0] || '';
};

const extractEmploymentHeroJobs = ($: cheerio.CheerioAPI): Job[] => {
  const jobs: Job[] = [];

  $('[data-wp-context]').each((_, element) => {
    const rawContext = $(element).attr('data-wp-context');
    if (!rawContext) {
      return;
    }

    try {
      collectEmploymentHeroJobRecords(JSON.parse(rawContext), jobs);
    } catch {
      // Fall back to DOM selectors below.
    }
  });

  if (jobs.length > 0) {
    return jobs;
  }

  $('a[href]').each((_, element) => {
    const card = $(element);
    const href = card.attr('href');
    const title = normalizeWhitespace(card.find('.eh-job-item__title').first().text() || card.text());
    if (!isEmploymentHeroJobHref(href, title)) {
      return;
    }

    const parentCard = card.closest(
      'article, li, [data-wp-context], [data-testid*="job"], [class*="job"], [class*="Job"]'
    );
    const jobCard = parentCard.length > 0 ? parentCard : card;
    if (!title || !href) {
      return;
    }

    jobs.push({
      id: uuidv4(),
      title: getEmploymentHeroCardText($, jobCard, [
        '.eh-job-item__title',
        '[data-wp-text*="title"]',
        '[class*="title"]',
        'h1',
        'h2',
        'h3'
      ]) || title,
      company: getEmploymentHeroCardText($, jobCard, [
        '.eh-job-item__company',
        '[data-wp-text*="company"]',
        '[data-wp-text*="organisation"]',
        '[data-wp-text*="organization"]',
        '[class*="company"]',
        '[class*="organisation"]',
        '[class*="organization"]'
      ]),
      description: normalizeMultilineText(
        jobCard.find('.eh-job-item__description, .eh-job-item__details, [class*="description"]').first().text()
      ),
      url: new URL(href, 'https://employmenthero.com').toString(),
      location: getEmploymentHeroCardText($, jobCard, [
        '.eh-job-item__location',
        '[data-wp-text*="location"]',
        '[class*="location"]'
      ]),
      salary: getEmploymentHeroCardText($, jobCard, [
        '.eh-job-item__salary',
        '[data-wp-text*="salary"]',
        '[class*="salary"]'
      ]),
      datePosted: getEmploymentHeroCardText($, jobCard, [
        '.eh-job-item__posted-date',
        '.eh-job-item__date',
        '[data-wp-text*="posted"]',
        'time',
        '[class*="posted"]',
        '[class*="date"]'
      ])
    });
  });

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
    session = await launchBrowserSession(headless, slowMo, userAgent);
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
    if (session?.browser) {
      await session.browser.close();
    } else if (session?.context) {
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
    case 'linkedin':
      return [
        'button[aria-label="View next page"]',
        'button[aria-label="Next"]',
        'a[aria-label="Next"]'
      ].join(', ');
    case 'employmenthero':
      return [
        'button[aria-label="Next page"]',
        'button[aria-label="Next"]',
        '.eh-pagination button:last-child'
      ].join(', ');
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

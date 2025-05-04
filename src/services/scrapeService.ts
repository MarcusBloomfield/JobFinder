import axios from 'axios';
import type { Browser, Page } from 'puppeteer';
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
  },
  glassdoor: {
    searchUrl: 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword=',
    titleSelector: '.jobLink',
    companySelector: '.employer-name',
    descriptionSelector: '.jobDescriptionContent',
    linkSelector: '.jobLink',
    locationSelector: '.location',
    salarySelector: '.salary',
    datePostedSelector: '.jobDate'
  },
  monster: {
    searchUrl: 'https://www.monster.com/jobs/search/?q=',
    titleSelector: '.title',
    companySelector: '.company',
    descriptionSelector: '.summary',
    linkSelector: '.title a',
    locationSelector: '.location',
    datePostedSelector: '.meta time'
  },
  ziprecruiter: {
    searchUrl: 'https://www.ziprecruiter.com/jobs/search?q=',
    titleSelector: '.job_title',
    companySelector: '.hiring_company',
    descriptionSelector: '.job_description',
    linkSelector: '.job_link',
    locationSelector: '.location',
    salarySelector: '.salary',
    datePostedSelector: '.posted_date'
  },
  simplyhired: {
    searchUrl: 'https://www.simplyhired.com/search?q=',
    titleSelector: '.card-title',
    companySelector: '.company',
    descriptionSelector: '.card-description',
    linkSelector: '.card-link',
    locationSelector: '.location',
    salarySelector: '.salary',
    datePostedSelector: '.date-posted'
  },
  dice: {
    searchUrl: 'https://www.dice.com/jobs?q=',
    titleSelector: '.card-title-link',
    companySelector: '.card-company',
    descriptionSelector: '.card-description',
    linkSelector: '.card-title-link',
    locationSelector: '.location',
    datePostedSelector: '.posted-date'
  }
  // More job sites can be added here with their specific selectors
};

// API endpoint
const API_URL = 'http://localhost:5000/api';

// Mock job data for fallback/development
const mockJobs = [
  {
    id: '1',
    title: 'Frontend Developer',
    company: 'Tech Solutions Inc.',
    description: 'We are looking for a talented Frontend Developer proficient in React, TypeScript, and modern web development practices.',
    url: 'https://example.com/job/1',
    location: 'Sydney, Australia',
    salary: '$90,000 - $120,000',
    datePosted: '2 days ago'
  },
  {
    id: '2',
    title: 'Web Developer',
    company: 'Digital Creations',
    description: 'Join our team as a Web Developer to build responsive and user-friendly websites and applications.',
    url: 'https://example.com/job/2',
    location: 'Melbourne, Australia',
    salary: '$85,000 - $105,000',
    datePosted: '1 week ago'
  },
  {
    id: '3',
    title: 'React Developer',
    company: 'WebApps Ltd',
    description: 'Experienced React developer needed to join our growing team. Strong TypeScript skills required.',
    url: 'https://example.com/job/3',
    location: 'Remote',
    datePosted: '3 days ago'
  }
];

// Generate mock jobs based on search terms
const generateMockJobs = (searchTerms: string, location: string = 'Perth, WA'): Job[] => {
  return mockJobs.map(job => ({
    ...job,
    id: uuidv4(),
    title: searchTerms.includes('React') ? 
      job.title.replace('Web', 'React') : 
      searchTerms.includes('TypeScript') ? 
        job.title.replace('Developer', 'TypeScript Developer') : 
        job.title,
    location: location // Override with the requested location
  }));
};

/**
 * Scrape jobs from a specific job site
 */
export const scrapeJobSite = async (
  site: 'seek' | 'indeed' | 'linkedin',
  searchTerms: string,
  pageLimit: number = 1,
  location: string = 'Perth, WA'
): Promise<Job[]> => {
  console.log(`Scraping ${site} with search terms: ${searchTerms} in location: ${location}`);
  
  try {
    const response = await axios.post(`${API_URL}/scrape/site`, {
      site,
      searchTerms,
      pageLimit,
      location
    });
    
    if (response.data && response.data.data) {
      return response.data.data;
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error(`Error scraping ${site}:`, error);
    
    // Fallback to mock data when backend fails
    console.log(`[FALLBACK] Using mock data for ${site}`);
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate delay
    return generateMockJobs(searchTerms, location);
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
  
  try {
    const response = await axios.post(`${API_URL}/scrape/jobs`, {
      searchTerms,
      sites,
      pageLimit,
      location
    });
    
    if (response.data && response.data.data) {
      return response.data.data;
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('Error scraping jobs:', error);
    
    // Fallback to mock data when backend fails
    console.log('[FALLBACK] Using mock data for jobs');
    
    let allJobs: Job[] = [];
    
    // Generate mock jobs for each search term
    for (const term of searchTerms) {
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
      allJobs = [...allJobs, ...generateMockJobs(term, location)];
    }
    
    // Remove duplicates based on title+company
    const uniqueJobs = Array.from(
      new Map(allJobs.map(job => [`${job.title}-${job.company}`, job])).values()
    );
    
    return uniqueJobs;
  }
}; 
import assert from 'assert';
import { buildSearchUrl, SUPPORTED_JOB_SEARCH_SITES } from './services/scrapeService';

const sites = [...SUPPORTED_JOB_SEARCH_SITES].sort();
assert.deepStrictEqual(sites, ['employmenthero', 'linkedin', 'seek']);

assert.strictEqual(
  buildSearchUrl('seek', 'software engineer', 'Perth, WA'),
  'https://www.seek.com.au/jobs?keywords=software%20engineer&where=Perth%2C%20WA'
);

assert.strictEqual(
  buildSearchUrl('linkedin', 'software engineer', 'Perth, WA'),
  'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=Perth%2C%20WA'
);

assert.strictEqual(
  buildSearchUrl('employmenthero', 'software engineer', 'Perth, WA'),
  'https://employmenthero.com/jobs/'
);

console.log('Job search site smoke passed for Seek, LinkedIn, and Employment Hero.');

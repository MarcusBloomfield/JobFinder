import assert from 'assert';
import { buildSearchUrl, SUPPORTED_JOB_SEARCH_SITES } from './services/scrapeService';

const sites = [...SUPPORTED_JOB_SEARCH_SITES].sort();
assert.deepStrictEqual(sites, ['seek']);

assert.strictEqual(
  buildSearchUrl('seek', 'software engineer', 'Perth, WA'),
  'https://www.seek.com.au/jobs?keywords=software%20engineer&where=Perth%2C%20WA'
);

console.log('Job search site smoke passed for Seek.');

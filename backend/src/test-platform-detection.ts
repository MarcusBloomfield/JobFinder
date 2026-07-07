import { ApplicationPlatform, detectPlatform } from './services/applicationPlatformService';

const cases: Array<{ url: string; expected: ApplicationPlatform }> = [
  { url: 'https://www.seek.com.au/job/123', expected: 'seek' },
  { url: 'https://www.linkedin.com/jobs/view/123', expected: 'linkedin' },
  { url: 'https://au.linkedin.com/jobs/search/?keywords=developer', expected: 'linkedin' },
  { url: 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/123', expected: 'linkedin' },
  { url: 'https://www.linkedin.com/feed/', expected: 'generic' },
  { url: 'https://jobs.swagapp.com/jobs/123', expected: 'employmenthero' },
  { url: 'https://employmenthero.com/jobs/123', expected: 'employmenthero' },
  { url: 'https://boards.greenhouse.io/acme/jobs/123', expected: 'greenhouse' },
  { url: 'https://jobs.lever.co/acme/123', expected: 'lever' },
  { url: 'https://acme.wd3.myworkdayjobs.com/en-US/careers/job/123', expected: 'workday' },
  { url: 'https://jobs.smartrecruiters.com/Acme/123', expected: 'smartrecruiters' },
  { url: 'https://acme.bamboohr.com/careers/123', expected: 'bamboohr' },
  { url: 'https://jobs.ashbyhq.com/acme/123', expected: 'ashby' },
  { url: 'https://secure.dc2.pageuppeople.com/apply/123', expected: 'pageup' },
  { url: 'https://career10.successfactors.com/career?company=acme', expected: 'successfactors' },
  { url: 'https://acme.taleo.net/careersection/jobdetail.ftl?job=123', expected: 'taleo' },
  { url: 'https://example.com/jobs/123', expected: 'generic' },
  { url: 'https://apply.example.com/application/software-engineer', expected: 'generic' },
  { url: 'company.example.net/apply', expected: 'generic' }
];

const failures = cases
  .map(testCase => ({
    ...testCase,
    actual: detectPlatform(testCase.url)
  }))
  .filter(result => result.actual !== result.expected);

if (failures.length > 0) {
  failures.forEach(failure => {
    console.error(`${failure.url}: expected ${failure.expected}, got ${failure.actual}`);
  });
  process.exitCode = 1;
} else {
  console.log(`Platform detection smoke passed for ${cases.length} URL(s).`);
}

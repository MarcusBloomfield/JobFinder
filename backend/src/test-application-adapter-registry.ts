import {
  getApplicationAdapterForPlatform,
  getApplicationAdapterForUrl,
  getRegisteredApplicationAdapters,
  KNOWN_APPLICATION_PLATFORMS,
  PLATFORM_ADAPTER_IDS
} from './services/applicationAdapters/adapterRegistry';

const failures: string[] = [];

KNOWN_APPLICATION_PLATFORMS.forEach(platform => {
  const adapter = getApplicationAdapterForPlatform(platform);
  const expectedAdapterId = PLATFORM_ADAPTER_IDS[platform];

  if (adapter.id !== expectedAdapterId) {
    failures.push(`${platform}: expected ${expectedAdapterId}, got ${adapter.id}`);
  }
});

const seekUrlAdapter = getApplicationAdapterForUrl('https://www.seek.com.au/job/123');
if (seekUrlAdapter.id !== 'seek') {
  failures.push(`seek URL: expected seek, got ${seekUrlAdapter.id}`);
}

const linkedInUrlAdapter = getApplicationAdapterForUrl('https://www.linkedin.com/jobs/view/123');
if (linkedInUrlAdapter.id !== 'linkedin') {
  failures.push(`LinkedIn URL: expected linkedin, got ${linkedInUrlAdapter.id}`);
}
const linkedInGuestUrlAdapter = getApplicationAdapterForUrl(
  'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/123'
);
if (linkedInGuestUrlAdapter.id !== 'linkedin') {
  failures.push(`LinkedIn guest URL: expected linkedin, got ${linkedInGuestUrlAdapter.id}`);
}
if (linkedInUrlAdapter.canAutoSubmit) {
  failures.push('linkedin adapter: expected canAutoSubmit=false for final-review handoff');
}

const registeredLinkedInAdapter = getRegisteredApplicationAdapters().find(
  adapter => adapter.id === 'linkedin'
);
if (!registeredLinkedInAdapter || registeredLinkedInAdapter.platform !== 'linkedin') {
  failures.push('registered adapters: expected LinkedIn adapter registration');
}

const employmentHeroUrlAdapter = getApplicationAdapterForUrl('https://jobs.swagapp.com/jobs/123');
if (employmentHeroUrlAdapter.id !== 'employmenthero') {
  failures.push(`Employment Hero URL: expected employmenthero, got ${employmentHeroUrlAdapter.id}`);
}
if (employmentHeroUrlAdapter.canAutoSubmit) {
  failures.push('employmenthero adapter: expected canAutoSubmit=false for final-review handoff');
}

const registeredEmploymentHeroAdapter = getRegisteredApplicationAdapters().find(
  adapter => adapter.id === 'employmenthero'
);
if (!registeredEmploymentHeroAdapter || registeredEmploymentHeroAdapter.platform !== 'employmenthero') {
  failures.push('registered adapters: expected Employment Hero adapter registration');
}

const greenhouseUrlAdapter = getApplicationAdapterForUrl('https://boards.greenhouse.io/acme/jobs/123');
if (greenhouseUrlAdapter.id !== 'generic') {
  failures.push(`greenhouse URL: expected generic, got ${greenhouseUrlAdapter.id}`);
}

if (failures.length > 0) {
  failures.forEach(failure => console.error(failure));
  process.exitCode = 1;
} else {
  console.log(`Application adapter registry smoke passed for ${KNOWN_APPLICATION_PLATFORMS.length} platform(s).`);
}

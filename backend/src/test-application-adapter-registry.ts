import {
  getApplicationAdapterForPlatform,
  getApplicationAdapterForUrl,
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
if (linkedInUrlAdapter.id !== 'generic') {
  failures.push(`LinkedIn URL: expected generic, got ${linkedInUrlAdapter.id}`);
}

const greenhouseUrlAdapter = getApplicationAdapterForUrl('https://boards.greenhouse.io/acme/jobs/123');
if (greenhouseUrlAdapter.id !== 'generic') {
  failures.push(`greenhouse URL: expected generic, got ${greenhouseUrlAdapter.id}`);
}

const customUrlAdapter = getApplicationAdapterForUrl('https://apply.example.com/application/123');
if (customUrlAdapter.id !== 'generic') {
  failures.push(`custom URL: expected generic, got ${customUrlAdapter.id}`);
}
if (!customUrlAdapter.canAutoSubmit) {
  failures.push('generic adapter: expected canAutoSubmit=true for fully-auto unblocked custom flows');
}

if (failures.length > 0) {
  failures.forEach(failure => console.error(failure));
  process.exitCode = 1;
} else {
  console.log(`Application adapter registry smoke passed for ${KNOWN_APPLICATION_PLATFORMS.length} platform(s).`);
}

import { createGenericFormAdapter } from './genericAdapter';

// Indeed Apply is a site-specific safe form flow. It uses the shared form engine
// with an isolated Indeed browser profile and Indeed-labeled handoff metadata.
export const indeedAdapter = createGenericFormAdapter({
  id: 'indeed',
  displayName: 'Indeed',
  platform: 'indeed',
  supportedPlatforms: ['indeed'],
  profileDirName: 'indeed-profile',
  stepLimitLabel: 'Indeed adapter',
  failureMessage: 'Indeed adapter failed.',
  coverLetterManualMessage:
    'Cover-letter upload was detected and requires manual handling in Indeed adapter V1.',
  forceFinalReview: true
});

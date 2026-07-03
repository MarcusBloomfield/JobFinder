import { createGenericFormAdapter } from './genericAdapter';

// LinkedIn jobs require a logged-in browser session for most Easy Apply flows.
// Keep it isolated and stop for human review before any final submission.
export const linkedInAdapter = createGenericFormAdapter({
  id: 'linkedin',
  displayName: 'LinkedIn',
  platform: 'linkedin',
  supportedPlatforms: ['linkedin'],
  profileDirName: 'linkedin-profile',
  stepLimitLabel: 'LinkedIn adapter',
  failureMessage: 'LinkedIn adapter failed.',
  coverLetterManualMessage:
    'Cover-letter upload was detected and requires manual handling in LinkedIn adapter V1.',
  forceFinalReview: true
});

import { createGenericFormAdapter } from './genericAdapter';

// Employment Hero uses varied employer-hosted forms. Keep it on the shared
// safe form engine with an isolated profile and a final-review handoff.
export const employmentHeroAdapter = createGenericFormAdapter({
  id: 'employmenthero',
  displayName: 'Employment Hero',
  platform: 'employmenthero',
  supportedPlatforms: ['employmenthero'],
  profileDirName: 'employmenthero-profile',
  stepLimitLabel: 'Employment Hero adapter',
  failureMessage: 'Employment Hero adapter failed.',
  coverLetterManualMessage:
    'Cover-letter upload was detected and requires manual handling in Employment Hero adapter V1.',
  forceFinalReview: true
});

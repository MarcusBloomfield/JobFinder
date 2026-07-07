import { ApplicationProfile } from './models/ApplicationProfile';
import { detectPlatform } from './services/applicationPlatformService';
import {
  getApplicationAdapterForPlatform,
  getApplicationAdapterForUrl
} from './services/applicationAdapters/adapterRegistry';
import {
  classifyGenericApplicationBlocker,
  classifyGenericApplicationStepForValidation
} from './services/applicationAdapters/genericAdapter';
import { ApplicationAdapterStatus } from './services/applicationAdapters/types';
import { ExtractedFormControl, FormExtractionResult } from './services/formExtractionService';
import { mapExtractedFormControls } from './services/formMappingService';
import {
  mapAdapterResultStatus,
  mapOrchestrationStatus
} from './services/applicationAgentService';

const failures: string[] = [];

const assertEqual = (label: string, actual: unknown, expected: unknown): void => {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

const selectorHint = (selector: string) => ({
  kind: 'css' as const,
  selector,
  confidence: 'high' as const,
  unique: true,
  reason: 'generic fully-auto smoke fixture'
});

const control = (
  index: number,
  overrides: Partial<ExtractedFormControl>
): ExtractedFormControl => ({
  index,
  tag: 'input',
  type: 'text',
  name: `field_${index}`,
  id: `field_${index}`,
  placeholder: '',
  ariaLabel: '',
  labelText: '',
  parentText: '',
  nearbyText: '',
  options: [],
  required: false,
  disabled: false,
  visible: true,
  currentValue: '',
  selectorHints: [selectorHint(`#field_${index}`)],
  ...overrides
});

const profile: ApplicationProfile = {
  fullName: 'Alex Smith',
  email: 'alex@example.com',
  phone: '+61 400 000 000',
  currentLocation: 'Perth, WA',
  homeAddress: '12 Example Street, Perth WA',
  maxAutoApplyDistanceKm: '',
  linkedinUrl: 'https://www.linkedin.com/in/alex-smith',
  portfolioUrl: 'https://alex.example.com',
  githubUrl: 'https://github.com/alexsmith',
  noticePeriod: '2 weeks',
  availability: 'Weekdays',
  professionalSummary: 'Operations-focused software developer.',
  skillsDetails: 'TypeScript, React, Node.js',
  previousJobsDetails: 'Software developer at Example Co.',
  educationDetails: 'Bachelor of Computer Science',
  workRightsStatus: 'australian_citizen_or_permanent_resident',
  workRightsDetails: 'Australian citizen',
  driversLicenceStatus: 'full',
  carAccessStatus: 'regular_access',
  salaryExpectationAnnual: '120000',
  employerQuestionNotes: '',
  coverLetterExamples: []
};

const sampleExtraction: FormExtractionResult = {
  url: 'https://apply.example.com/jobs/123',
  title: 'Example custom application',
  extractedAt: new Date(0).toISOString(),
  controls: [
    control(0, { labelText: 'First name', name: 'first_name' }),
    control(1, { labelText: 'Last name', name: 'last_name' }),
    control(2, { type: 'email', labelText: 'Email address', name: 'email' }),
    control(3, { type: 'tel', labelText: 'Mobile phone', name: 'phone' }),
    control(4, { labelText: 'LinkedIn profile', name: 'linkedin' }),
    control(5, { tag: 'textarea', type: 'textarea', labelText: 'Relevant skills', name: 'skills' }),
    control(6, { type: 'file', labelText: 'Resume / CV', name: 'resume' }),
    control(7, { labelText: 'Expected salary', name: 'salary' }),
    control(8, { labelText: 'Do you have work rights in Australia?', name: 'work_rights' }),
    control(9, { type: 'file', labelText: 'Upload identity document', name: 'identity_doc' })
  ]
};

const run = async (): Promise<void> => {
  [
    'https://apply.example.com/jobs/123',
    'https://careers.example.org/application/software-engineer',
    'company.example.net/apply'
  ].forEach(url => {
    assertEqual(`generic detectPlatform ${url}`, detectPlatform(url), 'generic');
    assertEqual(`generic registry ${url}`, getApplicationAdapterForUrl(url).id, 'generic');
  });

  assertEqual('generic adapter can auto-submit when final review is disabled', getApplicationAdapterForPlatform('generic').canAutoSubmit, true);

  const mapping = await mapExtractedFormControls(sampleExtraction, profile, { allowOpenAI: false });
  assertEqual('safe first name maps', mapping.decisions[0]?.fieldKey, 'firstName');
  assertEqual('safe last name maps', mapping.decisions[1]?.fieldKey, 'lastName');
  assertEqual('safe email maps', mapping.decisions[2]?.fieldKey, 'email');
  assertEqual('safe phone maps', mapping.decisions[3]?.fieldKey, 'phone');
  assertEqual('safe LinkedIn maps', mapping.decisions[4]?.fieldKey, 'linkedinUrl');
  assertEqual('safe skills maps', mapping.decisions[5]?.fieldKey, 'skillsDetails');
  assertEqual('resume upload maps', mapping.decisions[6]?.action, 'upload_resume');
  assertEqual('salary pauses', mapping.decisions[7]?.humanReviewCategory, 'salary');
  assertEqual('work rights pauses', mapping.decisions[8]?.humanReviewCategory, 'work_rights');
  assertEqual('unknown upload pauses', mapping.decisions[9]?.humanReviewCategory, 'uncertain');

  assertEqual(
    'captcha blocker pauses',
    classifyGenericApplicationBlocker({ visibleText: 'Please complete this reCAPTCHA before continuing.' })?.reason,
    'captcha'
  );
  assertEqual(
    'login blocker pauses',
    classifyGenericApplicationBlocker({ visibleText: 'Sign in to apply for this job.' })?.reason,
    'manual_review'
  );
  assertEqual(
    'signup blocker pauses',
    classifyGenericApplicationBlocker({ url: 'https://apply.example.com/register?job=123' })?.reason,
    'manual_review'
  );
  assertEqual(
    'mfa blocker pauses',
    classifyGenericApplicationBlocker({ visibleText: 'Enter the verification code sent to your email.' })?.reason,
    'mfa'
  );
  assertEqual(
    'normal application form does not pause',
    classifyGenericApplicationBlocker({
      visibleText: 'Apply for this role',
      controls: [{ type: 'text', labelText: 'First name' }],
      buttons: [{ text: 'Next', disabled: false }]
    })?.reason || null,
    null
  );

  assertEqual(
    'multi-step next button navigates',
    classifyGenericApplicationStepForValidation({
      visibleText: 'Application details',
      buttons: [{ text: 'Next', disabled: false }]
    }).action,
    'navigate_next'
  );
  assertEqual(
    'final submit auto-clicks without review',
    classifyGenericApplicationStepForValidation({
      visibleText: 'Review your application',
      buttons: [{ text: 'Submit application', disabled: false }],
      requireFinalReview: false
    }).action,
    'submit_final'
  );
  assertEqual(
    'final submit pauses with review enabled',
    classifyGenericApplicationStepForValidation({
      visibleText: 'Review your application',
      buttons: [{ text: 'Submit application', disabled: false }],
      requireFinalReview: true
    }).action,
    'pause_for_final_review'
  );
  assertEqual(
    'successful submission detected',
    classifyGenericApplicationStepForValidation({
      visibleText: 'Thank you for applying. Your application has been submitted.'
    }).action,
    'submitted_detected'
  );

  const expectedStatuses: Array<{
    adapterStatus: ApplicationAdapterStatus;
    resultStatus: string;
    orchestrationStatus: string;
  }> = [
    { adapterStatus: 'submitted', resultStatus: 'applied', orchestrationStatus: 'applied' },
    { adapterStatus: 'waiting_for_user', resultStatus: 'review_required', orchestrationStatus: 'needs_human' },
    { adapterStatus: 'ready_for_review', resultStatus: 'review_required', orchestrationStatus: 'ready_for_review' },
    { adapterStatus: 'skipped', resultStatus: 'skipped', orchestrationStatus: 'skipped' },
    { adapterStatus: 'failed', resultStatus: 'failed', orchestrationStatus: 'failed' }
  ];

  expectedStatuses.forEach(testCase => {
    assertEqual(
      `${testCase.adapterStatus} result status`,
      mapAdapterResultStatus(testCase.adapterStatus),
      testCase.resultStatus
    );
    assertEqual(
      `${testCase.adapterStatus} orchestration status`,
      mapOrchestrationStatus(testCase.adapterStatus),
      testCase.orchestrationStatus
    );
  });

  if (failures.length > 0) {
    failures.forEach(failure => console.error(failure));
    process.exitCode = 1;
    return;
  }

  console.log('Generic fully-auto flow smoke passed.');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

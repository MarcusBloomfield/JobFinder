import { ApplicationProfile } from './models/ApplicationProfile';
import { FormExtractionResult } from './services/formExtractionService';
import { mapExtractedFormControls } from './services/formMappingService';

const profile: ApplicationProfile = {
  fullName: 'Alex Smith',
  email: 'alex@example.com',
  phone: '+61 400 000 000',
  currentLocation: 'Perth, WA',
  homeAddress: 'Perth, WA',
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

const extraction: FormExtractionResult = {
  url: 'https://example.com/apply',
  title: 'Apply',
  extractedAt: new Date().toISOString(),
  controls: [
    {
      index: 0,
      tag: 'input',
      type: 'text',
      name: 'candidate_name',
      labelText: 'Full name',
      options: [],
      required: true,
      disabled: false,
      visible: true,
      selectorHints: [{ kind: 'name', selector: 'input[name="candidate_name"]', confidence: 'high', unique: true, reason: 'test' }]
    },
    {
      index: 1,
      tag: 'input',
      type: 'email',
      name: 'email',
      labelText: 'Email address',
      options: [],
      required: true,
      disabled: false,
      visible: true,
      selectorHints: [{ kind: 'name', selector: 'input[name="email"]', confidence: 'high', unique: true, reason: 'test' }]
    },
    {
      index: 2,
      tag: 'input',
      type: 'file',
      name: 'resume',
      labelText: 'Resume / CV',
      options: [],
      required: true,
      disabled: false,
      visible: true,
      selectorHints: [{ kind: 'name', selector: 'input[name="resume"]', confidence: 'high', unique: true, reason: 'test' }]
    },
    {
      index: 3,
      tag: 'select',
      type: 'select-one',
      name: 'work_rights',
      labelText: 'Do you have work rights in Australia?',
      options: [
        { label: 'Choose', value: '', selected: true, disabled: false },
        { label: 'Yes', value: 'yes', selected: false, disabled: false }
      ],
      required: true,
      disabled: false,
      visible: true,
      selectorHints: [{ kind: 'name', selector: 'select[name="work_rights"]', confidence: 'high', unique: true, reason: 'test' }]
    },
    {
      index: 4,
      tag: 'input',
      type: 'text',
      name: 'salary',
      labelText: 'Expected salary',
      options: [],
      required: false,
      disabled: false,
      visible: true,
      selectorHints: [{ kind: 'name', selector: 'input[name="salary"]', confidence: 'high', unique: true, reason: 'test' }]
    },
    {
      index: 5,
      tag: 'textarea',
      type: 'textarea',
      name: 'skills',
      labelText: 'Relevant skills',
      options: [],
      required: false,
      disabled: false,
      visible: true,
      selectorHints: [{ kind: 'name', selector: 'textarea[name="skills"]', confidence: 'high', unique: true, reason: 'test' }]
    }
  ]
};

const run = async (): Promise<void> => {
  const result = await mapExtractedFormControls(extraction, profile);
  const failures = [
    result.decisions[0]?.status !== 'MAP' || result.decisions[0]?.fieldKey !== 'fullName'
      ? 'full name was not mapped'
      : '',
    result.decisions[1]?.status !== 'MAP' || result.decisions[1]?.fieldKey !== 'email'
      ? 'email was not mapped'
      : '',
    result.decisions[2]?.action !== 'upload_resume' ? 'resume upload was not mapped' : '',
    result.decisions[3]?.status !== 'NEEDS_HUMAN' ||
    result.decisions[3]?.humanReviewCategory !== 'work_rights'
      ? 'work rights was not sent to human review'
      : '',
    result.decisions[4]?.status !== 'NEEDS_HUMAN' ||
    result.decisions[4]?.humanReviewCategory !== 'salary'
      ? 'salary was not sent to human review'
      : '',
    result.decisions[5]?.status !== 'MAP' || result.decisions[5]?.fieldKey !== 'skillsDetails'
      ? 'skills was not mapped'
      : ''
  ].filter(Boolean);

  if (failures.length > 0) {
    failures.forEach(failure => console.error(failure));
    process.exitCode = 1;
    return;
  }

  console.log(`Form mapping smoke passed for ${result.decisions.length} control(s).`);
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDatabasePath = path.join(
  os.tmpdir(),
  `jobfinder-saved-form-answers-${process.pid}-${Date.now()}.sqlite`
);

process.env.APPLICATION_TRACKING_DB_PATH = tempDatabasePath;

const run = async (): Promise<void> => {
  const savedFormAnswerService = await import('./services/savedFormAnswerService');
  const { mapExtractedFormControls } = await import('./services/formMappingService');
  const { initializeSavedFormAnswers, createSavedFormAnswer, listSavedFormAnswers } =
    savedFormAnswerService;

  initializeSavedFormAnswers();

  createSavedFormAnswer({
    question: 'What suburb are you based in?',
    answer: 'Perth, WA 6000',
    controlKind: 'text',
    safetyCategory: 'safe',
    explicitlyApproved: true,
    allowAutoReuse: true
  });

  createSavedFormAnswer({
    question: 'Do you have the right to work in Australia?',
    answer: 'Yes',
    controlKind: 'select',
    safetyCategory: 'work_rights',
    explicitlyApproved: true,
    allowAutoReuse: true
  });

  const savedAnswers = listSavedFormAnswers();
  const unsafeAnswer = savedAnswers.find(answer => answer.safetyCategory === 'work_rights');
  if (!unsafeAnswer || unsafeAnswer.allowAutoReuse) {
    throw new Error('Sensitive answers must not be auto-reused unless classified safe.');
  }

  const result = await mapExtractedFormControls(
    {
      url: 'https://example.com/apply',
      title: 'Apply',
      extractedAt: new Date().toISOString(),
      controls: [
        {
          index: 0,
          tag: 'input',
          type: 'text',
          name: 'suburb',
          labelText: 'What suburb are you based in?',
          options: [],
          required: true,
          disabled: false,
          visible: true,
          selectorHints: [
            {
              kind: 'name',
              selector: 'input[name="suburb"]',
              confidence: 'high',
              unique: true,
              reason: 'test'
            }
          ]
        },
        {
          index: 1,
          tag: 'select',
          type: 'select-one',
          name: 'work_rights',
          labelText: 'Do you have the right to work in Australia?',
          options: [
            { label: 'Choose', value: '', selected: true, disabled: false },
            { label: 'Yes', value: 'yes', selected: false, disabled: false },
            { label: 'No', value: 'no', selected: false, disabled: false }
          ],
          required: true,
          disabled: false,
          visible: true,
          selectorHints: [
            {
              kind: 'name',
              selector: 'select[name="work_rights"]',
              confidence: 'high',
              unique: true,
              reason: 'test'
            }
          ]
        }
      ]
    },
    {
      fullName: '',
      email: '',
      phone: '',
      currentLocation: 'Perth, WA 6000',
      homeAddress: '',
      maxAutoApplyDistanceKm: '',
      linkedinUrl: '',
      portfolioUrl: '',
      githubUrl: '',
      noticePeriod: '',
      availability: '',
      professionalSummary: '',
      skillsDetails: '',
      previousJobsDetails: '',
      educationDetails: '',
      workRightsStatus: '',
      workRightsDetails: '',
      driversLicenceStatus: '',
      carAccessStatus: '',
      salaryExpectationAnnual: '',
      employerQuestionNotes: '',
      coverLetterExamples: []
    }
  );

  const suburbDecision = result.decisions[0];
  const workRightsDecision = result.decisions[1];

  if (
    suburbDecision?.status !== 'MAP' ||
    suburbDecision.source !== 'saved_answer' ||
    suburbDecision.value !== 'Perth, WA 6000'
  ) {
    throw new Error('Approved safe saved answers should map with high confidence.');
  }

  if (
    workRightsDecision?.status !== 'NEEDS_HUMAN' ||
    workRightsDecision.humanReviewCategory !== 'work_rights'
  ) {
    throw new Error('Sensitive saved answers must still require human review.');
  }

  console.log(`Saved form answers smoke passed with ${result.decisions.length} control(s).`);
};

run()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.rmSync(tempDatabasePath, { force: true });
    } catch {
      // The sqlite handle can still be open when the process exits.
    }
  });

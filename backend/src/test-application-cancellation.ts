import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfinder-cancel-test-'));
process.env.APPLICATION_TRACKING_DB_PATH = path.join(tempDir, 'jobfinder.sqlite');

const failures: string[] = [];

const assertEqual = (label: string, actual: unknown, expected: unknown): void => {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

const {
  createApplicationRun,
  getApplicationRunById,
  markApplicationRunSubmitted
} = require('./services/applicationRunTrackingService') as typeof import('./services/applicationRunTrackingService');
const {
  createTrackedApplication,
  finalizeTrackedApplication,
  getTrackedApplicationById
} = require('./services/applicationTrackingService') as typeof import('./services/applicationTrackingService');
const {
  createHumanIntervention,
  getHumanInterventionById
} = require('./services/humanInterventionService') as typeof import('./services/humanInterventionService');
const {
  requestApplicationRunCancellation,
  isApplicationRunCancellationRequested
} = require('./services/applicationRunCancellationService') as typeof import('./services/applicationRunCancellationService');

const job: import('./models/Job').Job = {
  id: 'cancel-job',
  title: 'Frontend Engineer',
  company: 'Example Co',
  location: 'Perth',
  description: 'Build application interfaces.',
  url: 'https://apply.example.com/frontend',
  matchScore: 88
};

const resume: import('./models/Resume').Resume = {
  id: 'resume-1',
  fileName: 'resume.pdf',
  fileType: 'pdf',
  content: 'Frontend engineer resume',
  skills: ['React'],
  experience: [],
  education: [],
  uploadedAt: new Date().toISOString(),
  storedFileName: 'resume.pdf'
};

void (async () => {
  try {
    const application = createTrackedApplication(job, resume, undefined, 'manual');
    const run = createApplicationRun({
      applicationId: application.id,
      platform: 'generic',
      currentUrl: job.url
    });
    const intervention = createHumanIntervention({
      applicationId: application.id,
      applicationRunId: run.id,
      reason: 'manual_review',
      title: 'Example Co - Frontend Engineer',
      message: 'Waiting for user.'
    });

    const cancelled = await requestApplicationRunCancellation(run.id);
    assertEqual('cancelled run status', cancelled?.status, 'skipped');
    assertEqual('cancelled run error', cancelled?.errorMessage, 'Cancelled by user.');
    assertEqual('cancelled run flag', isApplicationRunCancellationRequested(run.id), true);
    assertEqual(
      'intervention resolved',
      getHumanInterventionById(intervention.id)?.status,
      'skipped'
    );
    assertEqual(
      'tracked application skipped',
      getTrackedApplicationById(application.id)?.status,
      'skipped'
    );

    markApplicationRunSubmitted(run.id, {
      currentStep: 99,
      currentUrl: 'https://apply.example.com/submitted'
    });
    const afterLateSubmit = getApplicationRunById(run.id);
    assertEqual('late submit cannot overwrite cancel', afterLateSubmit?.status, 'skipped');
    assertEqual('late submit cannot change step', afterLateSubmit?.currentStep, 0);

    finalizeTrackedApplication(application.id, {
      status: 'applied',
      message: 'Late adapter result.',
      logs: [],
      finalUrl: 'https://apply.example.com/submitted',
      steps: 99,
      artifacts: [],
      applicationSnapshot: {
        resumeId: resume.id,
        resumeFileName: resume.fileName,
        resumeContent: resume.content,
        resumeIsTailored: false,
        coverLetterUsed: false
      }
    });
    assertEqual(
      'late finalization cannot overwrite skipped application',
      getTrackedApplicationById(application.id)?.status,
      'skipped'
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // node:sqlite keeps the test database handle open until process exit.
  }

  if (failures.length > 0) {
    failures.forEach(failure => console.error(failure));
    process.exitCode = 1;
  } else {
    console.log('Application cancellation smoke passed.');
  }
})();

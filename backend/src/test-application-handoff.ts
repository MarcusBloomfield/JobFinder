import {
  getGenericHandoffUrl,
  getResultPlatform,
  isGenericHandoffAllowed
} from './services/applicationAgentService';
import { ApplicationPlatform } from './services/applicationPlatformService';
import { ApplicationResult } from './services/applicationAdapters/types';

const failures: string[] = [];

const baseResult: ApplicationResult = {
  status: 'skipped',
  message: 'handoff',
  logs: [],
  finalUrl: 'https://fallback.example/apply',
  steps: 1,
  artifacts: []
};

const assertEqual = (label: string, actual: unknown, expected: unknown): void => {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
};

assertEqual(
  'handoff metadata URL',
  getGenericHandoffUrl({
    ...baseResult,
    metadata: {
      handoffToGenericAdapter: true,
      handoffUrl: 'https://apply.example.com/form'
    }
  }),
  'https://apply.example.com/form'
);

assertEqual(
  'handoff fallback finalUrl',
  getGenericHandoffUrl({
    ...baseResult,
    metadata: {
      handoffToGenericAdapter: true
    }
  }),
  'https://fallback.example/apply'
);

assertEqual(
  'handoff rejects non-http URL',
  getGenericHandoffUrl({
    ...baseResult,
    metadata: {
      handoffToGenericAdapter: true,
      handoffUrl: 'mailto:jobs@example.com'
    }
  }),
  undefined
);

assertEqual(
  'handoff disabled without metadata flag',
  getGenericHandoffUrl({
    ...baseResult,
    metadata: {
      handoffUrl: 'https://apply.example.com/form'
    }
  }),
  undefined
);

const seekOnly = new Set<ApplicationPlatform>(['seek']);
const seekAndGeneric = new Set<ApplicationPlatform>(['seek', 'generic']);
const seekAndGreenhouse = new Set<ApplicationPlatform>(['seek', 'greenhouse']);

assertEqual('handoff allowed when unrestricted', isGenericHandoffAllowed(null, 'generic'), true);
assertEqual('handoff blocked by seek-only allowlist', isGenericHandoffAllowed(seekOnly, 'generic'), false);
assertEqual(
  'handoff allowed by generic allowlist',
  isGenericHandoffAllowed(seekAndGeneric, 'generic'),
  true
);
assertEqual(
  'known ATS handoff allowed by target allowlist',
  isGenericHandoffAllowed(seekAndGreenhouse, 'greenhouse'),
  true
);

assertEqual(
  'generic handoff reports generic platform after adapter run',
  getResultPlatform({
    ...baseResult,
    metadata: {
      platform: 'generic'
    }
  }, 'seek'),
  'generic'
);

assertEqual(
  'blocked known ATS handoff reports target platform',
  getResultPlatform({
    ...baseResult,
    metadata: {
      handoffBlocked: true,
      handoffPlatform: 'greenhouse'
    }
  }, 'seek'),
  'greenhouse'
);

assertEqual(
  'unknown metadata platform falls back to origin platform',
  getResultPlatform({
    ...baseResult,
    metadata: {
      platform: 'unknown-platform'
    }
  }, 'seek'),
  'seek'
);

if (failures.length > 0) {
  failures.forEach(failure => console.error(failure));
  process.exitCode = 1;
} else {
  console.log('Application handoff smoke passed.');
}

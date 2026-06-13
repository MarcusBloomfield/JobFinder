import {
  ApplicationPlatform,
  detectPlatform
} from '../applicationPlatformService';
import {
  ApplicationAdapter,
  ApplicationContext,
  ApplicationResult
} from './types';
import { seekAdapter } from './seekAdapter';

export const KNOWN_APPLICATION_PLATFORMS: ApplicationPlatform[] = [
  'seek',
  'indeed',
  'greenhouse',
  'lever',
  'workday',
  'smartrecruiters',
  'bamboohr',
  'ashby',
  'pageup',
  'successfactors',
  'taleo',
  'generic'
];

export type ApplicationAdapterId = 'seek' | 'generic';

export const genericAdapter: ApplicationAdapter = {
  id: 'generic',
  displayName: 'Generic application flow',
  platform: 'generic',
  supportedPlatforms: [
    'indeed',
    'greenhouse',
    'lever',
    'workday',
    'smartrecruiters',
    'bamboohr',
    'ashby',
    'pageup',
    'successfactors',
    'taleo',
    'generic'
  ],
  canAutoSubmit: false,
  apply: async (context: ApplicationContext): Promise<ApplicationResult> => ({
    status: 'ready_for_review',
    message:
      `${context.platform} applications are routed to the generic adapter until a platform-specific adapter exists.`,
    logs: [
      `Generic adapter selected for ${context.platform}.`,
      'No platform-specific automation has been registered yet.'
    ],
    finalUrl: context.job.url,
    steps: 0,
    artifacts: [],
    metadata: {
      platform: context.platform,
      adapterId: 'generic'
    }
  })
};

const ADAPTERS_BY_ID: Record<ApplicationAdapterId, ApplicationAdapter> = {
  seek: seekAdapter,
  generic: genericAdapter
};

export const PLATFORM_ADAPTER_IDS: Record<ApplicationPlatform, ApplicationAdapterId> = {
  seek: 'seek',
  indeed: 'generic',
  greenhouse: 'generic',
  lever: 'generic',
  workday: 'generic',
  smartrecruiters: 'generic',
  bamboohr: 'generic',
  ashby: 'generic',
  pageup: 'generic',
  successfactors: 'generic',
  taleo: 'generic',
  generic: 'generic'
};

export const getRegisteredApplicationAdapters = (): ApplicationAdapter[] => [
  seekAdapter,
  genericAdapter
];

export const isKnownApplicationPlatform = (
  platform: string
): platform is ApplicationPlatform =>
  KNOWN_APPLICATION_PLATFORMS.includes(platform as ApplicationPlatform);

export const getApplicationAdapterForPlatform = (
  platform: ApplicationPlatform
): ApplicationAdapter => ADAPTERS_BY_ID[PLATFORM_ADAPTER_IDS[platform]];

export const getApplicationAdapterForUrl = (url?: string | null): ApplicationAdapter =>
  getApplicationAdapterForPlatform(detectPlatform(url));

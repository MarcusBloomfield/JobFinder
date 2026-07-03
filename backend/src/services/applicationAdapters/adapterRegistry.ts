import {
  ApplicationPlatform,
  detectPlatform
} from '../applicationPlatformService';
import {
  ApplicationAdapter
} from './types';
import { seekAdapter } from './seekAdapter';
import { indeedAdapter } from './indeedAdapter';
import { genericAdapter } from './genericAdapter';

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

export type ApplicationAdapterId = 'seek' | 'indeed' | 'generic';

const ADAPTERS_BY_ID: Record<ApplicationAdapterId, ApplicationAdapter> = {
  seek: seekAdapter,
  indeed: indeedAdapter,
  generic: genericAdapter
};

export const PLATFORM_ADAPTER_IDS: Record<ApplicationPlatform, ApplicationAdapterId> = {
  seek: 'seek',
  indeed: 'indeed',
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
  indeedAdapter,
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

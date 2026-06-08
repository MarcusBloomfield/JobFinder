import { ApplicationProfile } from '../models/ApplicationProfile';
import { Job } from '../models/Job';

interface Coordinates {
  lat: number;
  lon: number;
}

export interface AutoApplyDistanceCheck {
  enabled: boolean;
  allowed: boolean;
  distanceKm?: number;
  maxDistanceKm?: number;
  message: string;
}

const LOCATION_COORDINATES: Record<string, Coordinates> = {
  '6000': { lat: -31.9523, lon: 115.8613 },
  '6003': { lat: -31.9463, lon: 115.8573 },
  '6004': { lat: -31.9587, lon: 115.8786 },
  '6005': { lat: -31.9486, lon: 115.8397 },
  '6007': { lat: -31.9367, lon: 115.8414 },
  '6008': { lat: -31.9485, lon: 115.8231 },
  '6010': { lat: -31.9815, lon: 115.7799 },
  '6017': { lat: -31.9004, lon: 115.8105 },
  '6018': { lat: -31.8938, lon: 115.7954 },
  '6019': { lat: -31.8958, lon: 115.7643 },
  '6027': { lat: -31.7445, lon: 115.7662 },
  '6056': { lat: -31.8895, lon: 116.0011 },
  '6065': { lat: -31.7529, lon: 115.8033 },
  '6069': { lat: -31.7839, lon: 115.9694 },
  '6076': { lat: -31.9736, lon: 116.0580 },
  '6100': { lat: -31.9762, lon: 115.9009 },
  '6102': { lat: -32.0022, lon: 115.9244 },
  '6104': { lat: -31.9638, lon: 115.9346 },
  '6106': { lat: -31.9931, lon: 115.9491 },
  '6107': { lat: -32.0151, lon: 115.9553 },
  '6110': { lat: -32.0737, lon: 116.0020 },
  '6112': { lat: -32.1536, lon: 116.0150 },
  '6151': { lat: -31.9800, lon: 115.8630 },
  '6152': { lat: -31.9916, lon: 115.8639 },
  '6153': { lat: -32.0169, lon: 115.8350 },
  '6154': { lat: -32.0397, lon: 115.8364 },
  '6155': { lat: -32.0522, lon: 115.8819 },
  '6160': { lat: -32.0569, lon: 115.7439 },
  '6164': { lat: -32.1265, lon: 115.8535 },
  '6167': { lat: -32.2480, lon: 115.7631 },
  '6168': { lat: -32.2810, lon: 115.7270 },
  '6210': { lat: -32.5360, lon: 115.7420 },
  perth: { lat: -31.9523, lon: 115.8613 },
  'perth wa': { lat: -31.9523, lon: 115.8613 },
  northbridge: { lat: -31.9463, lon: 115.8573 },
  'east perth': { lat: -31.9587, lon: 115.8786 },
  'west perth': { lat: -31.9486, lon: 115.8397 },
  leederville: { lat: -31.9367, lon: 115.8414 },
  subiaco: { lat: -31.9485, lon: 115.8231 },
  claremont: { lat: -31.9815, lon: 115.7799 },
  fremantle: { lat: -32.0569, lon: 115.7439 },
  'osborne park': { lat: -31.9004, lon: 115.8105 },
  innaloo: { lat: -31.8938, lon: 115.7954 },
  scarborough: { lat: -31.8958, lon: 115.7643 },
  joondalup: { lat: -31.7445, lon: 115.7662 },
  wanneroo: { lat: -31.7529, lon: 115.8033 },
  ellenbrook: { lat: -31.7839, lon: 115.9694 },
  midland: { lat: -31.8895, lon: 116.0011 },
  belmont: { lat: -31.9638, lon: 115.9346 },
  welshpool: { lat: -31.9931, lon: 115.9491 },
  cannington: { lat: -32.0151, lon: 115.9553 },
  bentley: { lat: -32.0022, lon: 115.9244 },
  'victoria park': { lat: -31.9762, lon: 115.9009 },
  como: { lat: -31.9916, lon: 115.8639 },
  'south perth': { lat: -31.9800, lon: 115.8630 },
  applecross: { lat: -32.0169, lon: 115.8350 },
  booragoon: { lat: -32.0397, lon: 115.8364 },
  willetton: { lat: -32.0522, lon: 115.8819 },
  'canning vale': { lat: -32.0571, lon: 115.9181 },
  cockburn: { lat: -32.1265, lon: 115.8535 },
  kwinana: { lat: -32.2480, lon: 115.7631 },
  rockingham: { lat: -32.2810, lon: 115.7270 },
  mandurah: { lat: -32.5360, lon: 115.7420 },
  armadale: { lat: -32.1536, lon: 116.0150 },
  gosnells: { lat: -32.0737, lon: 116.0020 },
  kalamunda: { lat: -31.9736, lon: 116.0580 },
  sydney: { lat: -33.8688, lon: 151.2093 },
  melbourne: { lat: -37.8136, lon: 144.9631 },
  brisbane: { lat: -27.4698, lon: 153.0251 },
  adelaide: { lat: -34.9285, lon: 138.6007 },
  hobart: { lat: -42.8821, lon: 147.3272 },
  darwin: { lat: -12.4634, lon: 130.8456 },
  canberra: { lat: -35.2802, lon: 149.1310 }
};

const REMOTE_LOCATION_PATTERN = /\b(remote|work from home|wfh|anywhere)\b/i;

const parseMaxDistanceKm = (value: string): number | undefined => {
  const parsed = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const normalizeLocationKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\baustralia\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findCoordinates = (value: string): Coordinates | undefined => {
  const coordinateMatch = value.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lon = Number(coordinateMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }

  const postcodeMatch = value.match(/\b(\d{4})\b/);
  if (postcodeMatch && LOCATION_COORDINATES[postcodeMatch[1]]) {
    return LOCATION_COORDINATES[postcodeMatch[1]];
  }

  const normalized = normalizeLocationKey(value);
  const matchedKey = Object.keys(LOCATION_COORDINATES)
    .filter(key => !/^\d+$/.test(key))
    .sort((left, right) => right.length - left.length)
    .find(key => normalized.includes(key));

  return matchedKey ? LOCATION_COORDINATES[matchedKey] : undefined;
};

const getDistanceKm = (from: Coordinates, to: Coordinates): number => {
  const earthRadiusKm = 6371;
  const latDelta = ((to.lat - from.lat) * Math.PI) / 180;
  const lonDelta = ((to.lon - from.lon) * Math.PI) / 180;
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lonDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const checkAutoApplyDistance = (
  job: Pick<Job, 'location'>,
  applicationProfile: ApplicationProfile
): AutoApplyDistanceCheck => {
  const maxDistanceKm = parseMaxDistanceKm(applicationProfile.maxAutoApplyDistanceKm);
  if (!maxDistanceKm) {
    return { enabled: false, allowed: true, message: 'Auto-apply distance limit is disabled.' };
  }

  const homeLocation = applicationProfile.homeAddress || applicationProfile.currentLocation;
  if (!homeLocation.trim()) {
    return {
      enabled: true,
      allowed: false,
      maxDistanceKm,
      message: 'Skipped auto-apply because no home address is set for distance checking.'
    };
  }

  if (!job.location?.trim()) {
    return {
      enabled: true,
      allowed: false,
      maxDistanceKm,
      message: 'Skipped auto-apply because the job has no location to check.'
    };
  }

  if (REMOTE_LOCATION_PATTERN.test(job.location)) {
    return {
      enabled: true,
      allowed: true,
      maxDistanceKm,
      message: 'Remote job allowed by distance checker.'
    };
  }

  const homeCoordinates = findCoordinates(homeLocation);
  const jobCoordinates = findCoordinates(job.location);
  if (!homeCoordinates || !jobCoordinates) {
    return {
      enabled: true,
      allowed: false,
      maxDistanceKm,
      message: `Skipped auto-apply because distance could not be checked for "${job.location}".`
    };
  }

  const distanceKm = Math.round(getDistanceKm(homeCoordinates, jobCoordinates) * 10) / 10;
  const allowed = distanceKm <= maxDistanceKm;

  return {
    enabled: true,
    allowed,
    distanceKm,
    maxDistanceKm,
    message: allowed
      ? `Distance check passed: ${distanceKm} km from home.`
      : `Skipped auto-apply: ${distanceKm} km from home exceeds ${maxDistanceKm} km limit.`
  };
};

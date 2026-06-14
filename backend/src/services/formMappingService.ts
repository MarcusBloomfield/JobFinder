import OpenAI from 'openai';
import { ApplicationProfile } from '../models/ApplicationProfile';
import {
  ExtractedFormControl,
  FormExtractionResult,
  FormSelectorHint
} from './formExtractionService';

export const FORM_MAPPING_SERVICE_VERSION = '1.0';

export type FormMappingStatus = 'MAP' | 'NEEDS_HUMAN' | 'SKIP';
export type FormMappingSource = 'deterministic' | 'openai';

export type FormMappedFieldKey =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'currentLocation'
  | 'homeAddress'
  | 'linkedinUrl'
  | 'portfolioUrl'
  | 'githubUrl'
  | 'professionalSummary'
  | 'skillsDetails'
  | 'previousJobsDetails'
  | 'resumeUpload'
  | 'coverLetterUpload'
  | 'coverLetterText';

export type FormMappingAction =
  | 'fill'
  | 'select'
  | 'upload_resume'
  | 'upload_cover_letter'
  | 'needs_human'
  | 'skip';

export type FormHumanReviewCategory =
  | 'legal'
  | 'work_rights'
  | 'salary'
  | 'demographic'
  | 'availability'
  | 'certification'
  | 'degree'
  | 'clearance'
  | 'reference'
  | 'uncertain'
  | 'unsupported';

export interface FormMappingDecision {
  controlIndex: number;
  status: FormMappingStatus;
  action: FormMappingAction;
  source: FormMappingSource;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  fieldKey?: FormMappedFieldKey;
  value?: string;
  selectorHint?: FormSelectorHint;
  humanReviewCategory?: FormHumanReviewCategory;
}

export interface FormMappingOptions {
  allowOpenAI?: boolean;
  coverLetterText?: string;
  maxOpenAIControls?: number;
}

export interface FormMappingResult {
  url: string;
  title: string;
  mappedAt: string;
  serviceVersion: string;
  decisions: FormMappingDecision[];
  needsHuman: FormMappingDecision[];
  mapped: FormMappingDecision[];
  skipped: FormMappingDecision[];
  metadata: {
    deterministicCount: number;
    openAICount: number;
    needsHumanCount: number;
  };
}

interface SafeFieldDefinition {
  key: FormMappedFieldKey;
  value: (profile: ApplicationProfile, options: FormMappingOptions) => string;
}

const FORM_MAPPING_MODEL = process.env.FORM_MAPPING_MODEL || 'gpt-5.4-mini';
const FORM_MAPPING_TIMEOUT_MS = Number(process.env.FORM_MAPPING_TIMEOUT_MS || 12000);
const FORM_MAPPING_MIN_CALL_INTERVAL_MS = Number(
  process.env.FORM_MAPPING_MIN_CALL_INTERVAL_MS || 60
);

const MAX_OPENAI_CONTROLS = 20;
const MAX_CONTEXT_CHARS = 260;

let openaiClient: OpenAI | null = null;
let openAICallChain: Promise<void> = Promise.resolve();
let lastOpenAICallAt = 0;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const compactText = (value: string | undefined, maxLength = MAX_CONTEXT_CHARS): string =>
  (value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const normalizeForMatching = (value: string | undefined): string =>
  compactText(value, 1000).toLowerCase();

const hasAny = (text: string, patterns: RegExp[]): boolean => patterns.some(pattern => pattern.test(text));

const getOpenAIClient = (): OpenAI | null => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`OpenAI form mapping exceeded timeout (${ms}ms)`)), ms);
    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });

const runThrottled = async <T>(fn: () => Promise<T>): Promise<T> => {
  const scheduled = openAICallChain.then(async () => {
    const waitMs = Math.max(0, lastOpenAICallAt + FORM_MAPPING_MIN_CALL_INTERVAL_MS - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastOpenAICallAt = Date.now();
  });

  openAICallChain = scheduled.then(() => undefined, () => undefined);
  await scheduled;
  return fn();
};

const splitName = (fullName: string): { firstName: string; lastName: string } => {
  const parts = compactText(fullName, 300).split(' ').filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : ''
  };
};

const SAFE_FIELD_DEFINITIONS: SafeFieldDefinition[] = [
  { key: 'fullName', value: profile => profile.fullName },
  { key: 'firstName', value: profile => splitName(profile.fullName).firstName },
  { key: 'lastName', value: profile => splitName(profile.fullName).lastName },
  { key: 'email', value: profile => profile.email },
  { key: 'phone', value: profile => profile.phone },
  { key: 'currentLocation', value: profile => profile.currentLocation },
  { key: 'homeAddress', value: profile => profile.homeAddress },
  { key: 'linkedinUrl', value: profile => profile.linkedinUrl },
  { key: 'portfolioUrl', value: profile => profile.portfolioUrl },
  { key: 'githubUrl', value: profile => profile.githubUrl },
  { key: 'professionalSummary', value: profile => profile.professionalSummary },
  { key: 'skillsDetails', value: profile => profile.skillsDetails },
  { key: 'previousJobsDetails', value: profile => profile.previousJobsDetails },
  { key: 'coverLetterText', value: (_profile, options) => options.coverLetterText || '' }
];

const SAFE_FIELD_KEYS = SAFE_FIELD_DEFINITIONS.map(definition => definition.key);

const HUMAN_REVIEW_RULES: Array<{ category: FormHumanReviewCategory; patterns: RegExp[] }> = [
  {
    category: 'legal',
    patterns: [
      /\blegal\b/,
      /\bdeclaration\b/,
      /\bdeclare\b/,
      /\bconsent\b/,
      /\bterms\b/,
      /\bagree\b/,
      /\bcriminal\b/,
      /\bconviction\b/,
      /\bbackground check\b/,
      /\bpolice check\b/
    ]
  },
  {
    category: 'work_rights',
    patterns: [
      /\bwork rights?\b/,
      /\bright to work\b/,
      /\bvisa\b/,
      /\bsponsorship\b/,
      /\bsponsor\b/,
      /\bcitizen(ship)?\b/,
      /\bpermanent resident\b/
    ]
  },
  {
    category: 'salary',
    patterns: [/\bsalary\b/, /\bcompensation\b/, /\bexpected pay\b/, /\bpay expectation\b/, /\brate\b/]
  },
  {
    category: 'demographic',
    patterns: [
      /\bgender\b/,
      /\brace\b/,
      /\bethnicity\b/,
      /\bdisability\b/,
      /\bveteran\b/,
      /\bindigenous\b/,
      /\baboriginal\b/,
      /\bdate of birth\b/,
      /\bdob\b/,
      /\bage\b/
    ]
  },
  {
    category: 'availability',
    patterns: [
      /\bavailability\b/,
      /\bavailable\b/,
      /\bstart date\b/,
      /\bnotice period\b/,
      /\bwhen can you start\b/,
      /\bshift\b/,
      /\broster\b/,
      /\brelocat(e|ion)\b/
    ]
  },
  {
    category: 'certification',
    patterns: [/\bcertification\b/, /\bcertificate\b/, /\blicen[cs]e\b/, /\baccreditation\b/]
  },
  {
    category: 'degree',
    patterns: [/\bdegree\b/, /\bdiploma\b/, /\bbachelor\b/, /\bmasters?\b/, /\bphd\b/, /\beducation\b/]
  },
  {
    category: 'clearance',
    patterns: [/\bclearance\b/, /\bsecurity clearance\b/, /\bbaseline\b/, /\bnv1\b/, /\bnv2\b/]
  },
  {
    category: 'reference',
    patterns: [/\breference\b/, /\breferee\b/, /\bformer manager\b/]
  }
];

const MARKETING_PATTERNS = [
  /\bnewsletter\b/,
  /\bmarketing\b/,
  /\bjob alerts?\b/,
  /\bsubscribe\b/,
  /\bpromotional\b/
];

const getControlText = (control: ExtractedFormControl): string =>
  [
    control.id,
    control.name,
    control.type,
    control.placeholder,
    control.ariaLabel,
    control.labelText,
    control.parentText,
    control.nearbyText,
    control.options.map(option => `${option.label} ${option.value}`).join(' ')
  ]
    .map(value => compactText(value, 500))
    .filter(Boolean)
    .join(' ');

const chooseSelectorHint = (control: ExtractedFormControl): FormSelectorHint | undefined =>
  control.selectorHints.find(hint => hint.unique && hint.confidence === 'high') ||
  control.selectorHints.find(hint => hint.unique) ||
  control.selectorHints[0];

const getSafeValue = (
  fieldKey: FormMappedFieldKey,
  profile: ApplicationProfile,
  options: FormMappingOptions
): string => {
  if (fieldKey === 'resumeUpload' || fieldKey === 'coverLetterUpload') {
    return '';
  }

  return compactText(
    SAFE_FIELD_DEFINITIONS.find(definition => definition.key === fieldKey)?.value(profile, options),
    4000
  );
};

const buildDecision = (
  control: ExtractedFormControl,
  input: Omit<FormMappingDecision, 'controlIndex' | 'selectorHint'>
): FormMappingDecision => ({
  controlIndex: control.index,
  selectorHint: chooseSelectorHint(control),
  ...input
});

const needsHumanDecision = (
  control: ExtractedFormControl,
  category: FormHumanReviewCategory,
  reason: string,
  source: FormMappingSource = 'deterministic'
): FormMappingDecision =>
  buildDecision(control, {
    status: 'NEEDS_HUMAN',
    action: 'needs_human',
    source,
    confidence: category === 'uncertain' ? 'low' : 'high',
    humanReviewCategory: category,
    reason
  });

const skipDecision = (
  control: ExtractedFormControl,
  reason: string,
  confidence: FormMappingDecision['confidence'] = 'medium'
): FormMappingDecision =>
  buildDecision(control, {
    status: 'SKIP',
    action: 'skip',
    source: 'deterministic',
    confidence,
    reason
  });

const mapDecision = (
  control: ExtractedFormControl,
  fieldKey: FormMappedFieldKey,
  action: FormMappingAction,
  value: string,
  reason: string,
  confidence: FormMappingDecision['confidence'],
  source: FormMappingSource = 'deterministic'
): FormMappingDecision =>
  buildDecision(control, {
    status: 'MAP',
    action,
    source,
    confidence,
    fieldKey,
    value,
    reason
  });

const optionMatchesValue = (control: ExtractedFormControl, value: string): boolean => {
  const normalizedValue = normalizeForMatching(value);
  if (!normalizedValue) {
    return false;
  }

  return control.options.some(option => {
    const label = normalizeForMatching(option.label);
    const optionValue = normalizeForMatching(option.value);
    return label === normalizedValue || optionValue === normalizedValue;
  });
};

const actionForControl = (
  control: ExtractedFormControl,
  value: string
): FormMappingAction | undefined => {
  if (control.tag === 'select') {
    return optionMatchesValue(control, value) ? 'select' : undefined;
  }

  if (control.tag === 'textarea' || control.tag === 'input') {
    return 'fill';
  }

  return undefined;
};

const findHumanReviewCategory = (text: string): FormHumanReviewCategory | undefined =>
  HUMAN_REVIEW_RULES.find(rule => hasAny(text, rule.patterns))?.category;

const hasValue = (value: string): boolean => compactText(value, 4000).length > 0;

const buildSafeMapping = (
  control: ExtractedFormControl,
  fieldKey: FormMappedFieldKey,
  profile: ApplicationProfile,
  options: FormMappingOptions,
  reason: string,
  confidence: FormMappingDecision['confidence'],
  source: FormMappingSource = 'deterministic'
): FormMappingDecision | undefined => {
  if (fieldKey === 'resumeUpload') {
    return mapDecision(control, fieldKey, 'upload_resume', '', reason, confidence, source);
  }

  if (fieldKey === 'coverLetterUpload') {
    return mapDecision(control, fieldKey, 'upload_cover_letter', '', reason, confidence, source);
  }

  const value = getSafeValue(fieldKey, profile, options);
  if (!hasValue(value)) {
    return undefined;
  }

  const action = actionForControl(control, value);
  if (!action) {
    return undefined;
  }

  return mapDecision(control, fieldKey, action, value, reason, confidence, source);
};

const deterministicMapControl = (
  control: ExtractedFormControl,
  profile: ApplicationProfile,
  options: FormMappingOptions
): FormMappingDecision | undefined => {
  const text = normalizeForMatching(getControlText(control));

  if (!control.visible || control.disabled) {
    return skipDecision(control, 'Hidden or disabled controls are not safe to fill automatically.', 'high');
  }

  if (control.tag === 'button') {
    return skipDecision(control, 'Buttons are navigation or submission controls, not fillable application fields.', 'high');
  }

  const humanCategory = findHumanReviewCategory(text);
  if (humanCategory) {
    return needsHumanDecision(
      control,
      humanCategory,
      `Field matched ${humanCategory.replace(/_/g, ' ')} safety rules.`
    );
  }

  if (control.type === 'password') {
    return needsHumanDecision(control, 'unsupported', 'Password fields require human handling.');
  }

  if ((control.type === 'checkbox' || control.type === 'radio') && hasAny(text, MARKETING_PATTERNS)) {
    return skipDecision(control, 'Optional marketing or alert preference was left unchanged.', 'medium');
  }

  if (control.type === 'checkbox' || control.type === 'radio') {
    return needsHumanDecision(control, 'uncertain', 'Checkbox and radio fields can carry declarations or preferences.');
  }

  if (/\b(company|employer|organisation|organization|business) name\b|\bcurrent employer\b/.test(text)) {
    return needsHumanDecision(control, 'uncertain', 'Employer or company identity fields need human review.');
  }

  if (/\byears? of experience\b|\bhow many years\b/.test(text)) {
    return needsHumanDecision(control, 'uncertain', 'Numeric experience fields need human review.');
  }

  if (control.type === 'file') {
    if (/\b(resume|cv|curriculum vitae)\b/.test(text)) {
      return buildSafeMapping(
        control,
        'resumeUpload',
        profile,
        options,
        'File input explicitly asks for a resume or CV.',
        'high'
      );
    }

    if (/\bcover\s*letter\b|\bmotivation letter\b/.test(text)) {
      return buildSafeMapping(
        control,
        'coverLetterUpload',
        profile,
        options,
        'File input explicitly asks for a cover letter.',
        'high'
      );
    }

    return needsHumanDecision(control, 'uncertain', 'Upload field purpose is not clear enough to fill safely.');
  }

  const deterministicRules: Array<{
    key: FormMappedFieldKey;
    patterns: RegExp[];
    confidence: FormMappingDecision['confidence'];
    reason: string;
  }> = [
    {
      key: 'email',
      patterns: [/\bemail\b/, /\be-mail\b/],
      confidence: control.type === 'email' ? 'high' : 'medium',
      reason: 'Field asks for email.'
    },
    {
      key: 'phone',
      patterns: [/\bphone\b/, /\bmobile\b/, /\btelephone\b/, /\bcontact number\b/],
      confidence: control.type === 'tel' ? 'high' : 'medium',
      reason: 'Field asks for phone number.'
    },
    {
      key: 'firstName',
      patterns: [/\bfirst name\b/, /\bgiven name\b/],
      confidence: 'high',
      reason: 'Field asks for first name.'
    },
    {
      key: 'lastName',
      patterns: [/\blast name\b/, /\bfamily name\b/, /\bsurname\b/],
      confidence: 'high',
      reason: 'Field asks for last name.'
    },
    {
      key: 'fullName',
      patterns: [/\bfull name\b/, /\bpreferred name\b/, /\bname\b/],
      confidence: 'medium',
      reason: 'Field asks for name.'
    },
    {
      key: 'linkedinUrl',
      patterns: [/\blinkedin\b/],
      confidence: 'high',
      reason: 'Field asks for LinkedIn URL.'
    },
    {
      key: 'githubUrl',
      patterns: [/\bgithub\b/, /\bgit hub\b/],
      confidence: 'high',
      reason: 'Field asks for GitHub URL.'
    },
    {
      key: 'portfolioUrl',
      patterns: [/\bportfolio\b/, /\bwebsite\b/, /\bpersonal site\b/],
      confidence: 'medium',
      reason: 'Field asks for portfolio or website URL.'
    },
    {
      key: 'currentLocation',
      patterns: [/\bcurrent location\b/, /\blocation\b/, /\bsuburb\b/, /\bcity\b/],
      confidence: 'medium',
      reason: 'Field asks for current location.'
    },
    {
      key: 'homeAddress',
      patterns: [/\bhome address\b/, /\bresidential address\b/, /\bstreet address\b/, /\baddress line\b/],
      confidence: 'medium',
      reason: 'Field asks for address already stored in profile.'
    },
    {
      key: 'professionalSummary',
      patterns: [/\bsummary\b/, /\bprofile\b/, /\babout yourself\b/, /\babout you\b/],
      confidence: 'medium',
      reason: 'Field asks for a profile-supported summary.'
    },
    {
      key: 'skillsDetails',
      patterns: [/\bskills?\b/, /\btechnologies\b/, /\btechnical experience\b/],
      confidence: 'medium',
      reason: 'Field asks for profile-supported skills.'
    },
    {
      key: 'previousJobsDetails',
      patterns: [/\bwork history\b/, /\bemployment history\b/, /\bprevious jobs?\b/, /\bexperience\b/],
      confidence: 'medium',
      reason: 'Field asks for profile-supported work experience.'
    },
    {
      key: 'coverLetterText',
      patterns: [/\bcover\s*letter\b/, /\bmotivation letter\b/],
      confidence: 'medium',
      reason: 'Field asks for prepared cover letter text.'
    }
  ];

  const matchingRule = deterministicRules.find(rule => hasAny(text, rule.patterns));
  if (matchingRule) {
    if (
      ['professionalSummary', 'skillsDetails', 'previousJobsDetails', 'coverLetterText'].includes(
        matchingRule.key
      ) &&
      control.tag !== 'textarea'
    ) {
      return needsHumanDecision(control, 'uncertain', 'Free-text profile facts are only mapped to textarea fields.');
    }

    const decision = buildSafeMapping(
      control,
      matchingRule.key,
      profile,
      options,
      matchingRule.reason,
      matchingRule.confidence
    );

    if (decision) {
      return decision;
    }
  }

  return undefined;
};

const isEligibleForOpenAIFallback = (control: ExtractedFormControl): boolean => {
  const text = normalizeForMatching(getControlText(control));
  return (
    control.visible &&
    !control.disabled &&
    control.tag !== 'button' &&
    control.type !== 'password' &&
    control.type !== 'file' &&
    control.type !== 'checkbox' &&
    control.type !== 'radio' &&
    !findHumanReviewCategory(text)
  );
};

const buildUnavailableDecision = (control: ExtractedFormControl): FormMappingDecision =>
  needsHumanDecision(control, 'uncertain', 'No deterministic safe mapping was found.');

const validateOpenAIDecisions = (
  raw: unknown,
  controlsByIndex: Map<number, ExtractedFormControl>,
  profile: ApplicationProfile,
  options: FormMappingOptions
): FormMappingDecision[] => {
  const object = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const decisions = Array.isArray(object.decisions) ? object.decisions : [];

  return decisions
    .map(decision => {
      const item = decision && typeof decision === 'object' ? (decision as Record<string, unknown>) : {};
      const controlIndex = typeof item.controlIndex === 'number' ? Math.floor(item.controlIndex) : NaN;
      const control = controlsByIndex.get(controlIndex);
      if (!control || !isEligibleForOpenAIFallback(control)) {
        return undefined;
      }

      const status = item.status === 'MAP' ? 'MAP' : 'NEEDS_HUMAN';
      const reason = compactText(
        typeof item.reason === 'string' ? item.reason : 'OpenAI fallback could not safely map field.',
        300
      );

      if (status !== 'MAP') {
        return needsHumanDecision(
          control,
          'uncertain',
          reason || 'OpenAI fallback requested human review.',
          'openai'
        );
      }

      const fieldKey = typeof item.fieldKey === 'string' ? (item.fieldKey as FormMappedFieldKey) : undefined;
      if (!fieldKey || !SAFE_FIELD_KEYS.includes(fieldKey)) {
        return needsHumanDecision(control, 'uncertain', 'OpenAI returned an unsupported field key.', 'openai');
      }

      return (
        buildSafeMapping(
          control,
          fieldKey,
          profile,
          options,
          reason || 'OpenAI matched field to an allowed profile key.',
          'low',
          'openai'
        ) || needsHumanDecision(control, 'uncertain', 'OpenAI mapped to a field with no available value.', 'openai')
      );
    })
    .filter((decision): decision is FormMappingDecision => Boolean(decision));
};

const mapWithOpenAI = async (
  controls: ExtractedFormControl[],
  profile: ApplicationProfile,
  options: FormMappingOptions
): Promise<FormMappingDecision[]> => {
  if (!options.allowOpenAI || controls.length === 0) {
    return [];
  }

  const client = getOpenAIClient();
  if (!client) {
    return controls.map(control =>
      needsHumanDecision(control, 'uncertain', 'OpenAI fallback unavailable because OPENAI_API_KEY is not set.')
    );
  }

  const limitedControls = controls.slice(0, Math.max(1, options.maxOpenAIControls || MAX_OPENAI_CONTROLS));
  const controlsByIndex = new Map(limitedControls.map(control => [control.index, control]));
  const availableFieldKeys = SAFE_FIELD_DEFINITIONS
    .filter(definition => hasValue(definition.value(profile, options)))
    .map(definition => definition.key);

  const response = await runThrottled(() =>
    withTimeout(
      client.chat.completions.create({
        model: FORM_MAPPING_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Map job application form controls to safe applicant profile field keys. Return only JSON. ' +
              'You must not answer legal, work rights, salary, demographic, availability, certification, degree, clearance, reference, checkbox, radio, password, or uncertain fields. ' +
              'For MAP decisions, choose only one allowed fieldKey from availableFieldKeys. Do not invent values; values are filled by local code after validation. ' +
              'If uncertain, return NEEDS_HUMAN.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              availableFieldKeys,
              allowedOutput: {
                decisions: [
                  {
                    controlIndex: 'number',
                    status: 'MAP or NEEDS_HUMAN',
                    fieldKey: 'required only when status is MAP',
                    reason: 'short reason'
                  }
                ]
              },
              controls: limitedControls.map(control => ({
                controlIndex: control.index,
                tag: control.tag,
                type: control.type,
                name: compactText(control.name),
                id: compactText(control.id),
                placeholder: compactText(control.placeholder),
                ariaLabel: compactText(control.ariaLabel),
                labelText: compactText(control.labelText),
                parentText: compactText(control.parentText),
                nearbyText: compactText(control.nearbyText),
                required: control.required,
                options: control.options.slice(0, 20).map(option => ({
                  label: compactText(option.label, 100),
                  value: compactText(option.value, 100)
                }))
              }))
            })
          }
        ]
      }),
      FORM_MAPPING_TIMEOUT_MS
    )
  );

  const content = response.choices[0]?.message.content;
  if (!content) {
    return limitedControls.map(control =>
      needsHumanDecision(control, 'uncertain', 'OpenAI fallback returned an empty response.', 'openai')
    );
  }

  try {
    return validateOpenAIDecisions(JSON.parse(content), controlsByIndex, profile, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parsing error';
    return limitedControls.map(control =>
      needsHumanDecision(
        control,
        'uncertain',
        `OpenAI fallback returned invalid JSON: ${compactText(message, 200)}`,
        'openai'
      )
    );
  }
};

export const mapExtractedFormControls = async (
  extraction: FormExtractionResult,
  applicationProfile: ApplicationProfile,
  options: FormMappingOptions = {}
): Promise<FormMappingResult> => {
  const deterministicDecisions = new Map<number, FormMappingDecision>();
  const openAICandidates: ExtractedFormControl[] = [];

  extraction.controls.forEach(control => {
    const decision = deterministicMapControl(control, applicationProfile, options);
    if (decision) {
      deterministicDecisions.set(control.index, decision);
      return;
    }

    if (isEligibleForOpenAIFallback(control)) {
      openAICandidates.push(control);
    } else {
      deterministicDecisions.set(control.index, buildUnavailableDecision(control));
    }
  });

  const openAIDecisions = await mapWithOpenAI(openAICandidates, applicationProfile, options);
  const openAIDecisionsByIndex = new Map(openAIDecisions.map(decision => [decision.controlIndex, decision]));

  const decisions = extraction.controls.map(control => {
    const existingDecision = deterministicDecisions.get(control.index);
    if (existingDecision) {
      return existingDecision;
    }

    return openAIDecisionsByIndex.get(control.index) || buildUnavailableDecision(control);
  });

  const mapped = decisions.filter(decision => decision.status === 'MAP');
  const needsHuman = decisions.filter(decision => decision.status === 'NEEDS_HUMAN');
  const skipped = decisions.filter(decision => decision.status === 'SKIP');

  return {
    url: extraction.url,
    title: extraction.title,
    mappedAt: new Date().toISOString(),
    serviceVersion: FORM_MAPPING_SERVICE_VERSION,
    decisions,
    mapped,
    needsHuman,
    skipped,
    metadata: {
      deterministicCount: decisions.filter(decision => decision.source === 'deterministic').length,
      openAICount: decisions.filter(decision => decision.source === 'openai').length,
      needsHumanCount: needsHuman.length
    }
  };
};

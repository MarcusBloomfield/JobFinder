import { classifyGenericApplicationBlocker } from './services/applicationAdapters/genericAdapter';

const failures: string[] = [];

const cases: Array<{
  label: string;
  input: Parameters<typeof classifyGenericApplicationBlocker>[0];
  expected: 'captcha' | 'mfa' | 'manual_review' | null;
}> = [
  {
    label: 'captcha text',
    input: { visibleText: 'Please complete the reCAPTCHA to continue' },
    expected: 'captcha'
  },
  {
    label: 'bot challenge text',
    input: { visibleText: 'Checking your browser before accessing this application' },
    expected: 'captcha'
  },
  {
    label: 'email verification text',
    input: { visibleText: 'Enter the verification code sent to your email' },
    expected: 'mfa'
  },
  {
    label: 'mfa text',
    input: { visibleText: 'Multi-factor authentication required' },
    expected: 'mfa'
  },
  {
    label: 'signup button',
    input: { buttons: [{ text: 'Create an account', disabled: false }] },
    expected: 'manual_review'
  },
  {
    label: 'header sign-in with normal application form',
    input: {
      visibleText: 'Apply for this role Sign in',
      controls: [
        { type: 'text', labelText: 'First name' },
        { type: 'email', labelText: 'Email address' }
      ],
      buttons: [
        { text: 'Sign in', disabled: false },
        { text: 'Next', disabled: false }
      ]
    },
    expected: null
  },
  {
    label: 'optional create account button with normal application form',
    input: {
      visibleText: 'Apply for this role',
      controls: [
        { type: 'text', labelText: 'First name' },
        { type: 'email', labelText: 'Email address' }
      ],
      buttons: [
        { text: 'Create account', disabled: false },
        { text: 'Next', disabled: false }
      ]
    },
    expected: null
  },
  {
    label: 'create account text with application fields',
    input: {
      visibleText: 'Create your account to continue',
      controls: [
        { type: 'text', labelText: 'First name' },
        { type: 'email', labelText: 'Email address' }
      ],
      buttons: [{ text: 'Next', disabled: false }]
    },
    expected: 'manual_review'
  },
  {
    label: 'register url',
    input: { url: 'https://apply.example.com/register?job=123' },
    expected: 'manual_review'
  },
  {
    label: 'password field',
    input: { controls: [{ type: 'password', labelText: 'Password' }] },
    expected: 'manual_review'
  },
  {
    label: 'account security prompt',
    input: { controls: [{ type: 'text', labelText: 'Security question answer' }] },
    expected: 'manual_review'
  },
  {
    label: 'normal application form',
    input: {
      visibleText: 'Apply for this role',
      controls: [{ type: 'text', labelText: 'First name' }],
      buttons: [{ text: 'Next', disabled: false }]
    },
    expected: null
  }
];

for (const testCase of cases) {
  const actual = classifyGenericApplicationBlocker(testCase.input)?.reason || null;
  if (actual !== testCase.expected) {
    failures.push(`${testCase.label}: expected ${testCase.expected}, got ${actual}`);
  }
}

if (failures.length > 0) {
  failures.forEach(failure => console.error(failure));
  process.exitCode = 1;
} else {
  console.log('Generic blocker smoke passed.');
}

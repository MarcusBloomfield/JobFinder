import { chromium } from 'playwright';
import { extractVisibleFormControls } from './services/formExtractionService';

const run = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <form>
        <label for="full-name">Full name</label>
        <input id="full-name" name="fullName" placeholder="Your name" required value="Alex Smith" />
        <label>
          Cover letter
          <textarea name="coverLetter" aria-label="Cover letter text"></textarea>
        </label>
        <label for="work-rights">Work rights</label>
        <select id="work-rights" name="workRights" required>
          <option value="">Choose</option>
          <option value="citizen" selected>Citizen</option>
        </select>
        <input type="hidden" name="csrf" value="token" />
        <input name="disabledField" disabled value="skip me" />
      </form>
    `);

    const result = await extractVisibleFormControls(page);
    const names = result.controls.map(control => control.name);

    const failures = [
      result.controls.length !== 3 ? `expected 3 visible enabled controls, got ${result.controls.length}` : '',
      !names.includes('fullName') ? 'missing fullName input' : '',
      !names.includes('coverLetter') ? 'missing coverLetter textarea' : '',
      !names.includes('workRights') ? 'missing workRights select' : '',
      names.includes('csrf') ? 'hidden input was included by default' : '',
      names.includes('disabledField') ? 'disabled input was included by default' : ''
    ].filter(Boolean);

    const fullName = result.controls.find(control => control.name === 'fullName');
    if (!fullName?.required || fullName.currentValue !== 'Alex Smith') {
      failures.push('fullName required/value metadata is wrong');
    }

    if (!fullName?.selectorHints.some(hint => hint.selector === '#full-name' && hint.unique)) {
      failures.push('fullName unique id selector hint missing');
    }

    const workRights = result.controls.find(control => control.name === 'workRights');
    if (workRights?.options.length !== 2 || workRights.options[1]?.selected !== true) {
      failures.push('select option metadata is wrong');
    }

    if (failures.length > 0) {
      failures.forEach(failure => console.error(failure));
      process.exitCode = 1;
    } else {
      console.log(`Form extraction smoke passed for ${result.controls.length} control(s).`);
    }
  } finally {
    await browser.close();
  }
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

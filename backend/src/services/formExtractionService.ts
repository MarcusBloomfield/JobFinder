import { Page } from 'playwright';

export const FORM_EXTRACTION_SERVICE_VERSION = '1.0';

export type FormControlTag = 'input' | 'textarea' | 'select' | 'button';

export type FormSelectorHintKind =
  | 'css'
  | 'label'
  | 'placeholder'
  | 'aria-label'
  | 'name'
  | 'id';

export type FormSelectorConfidence = 'high' | 'medium' | 'low';

export interface FormSelectorHint {
  kind: FormSelectorHintKind;
  selector?: string;
  value?: string;
  confidence: FormSelectorConfidence;
  unique: boolean;
  reason: string;
}

export interface ExtractedFormOption {
  label: string;
  value: string;
  selected: boolean;
  disabled: boolean;
}

export interface ExtractedFormControl {
  index: number;
  tag: FormControlTag;
  type?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  labelText?: string;
  parentText?: string;
  nearbyText?: string;
  options: ExtractedFormOption[];
  required: boolean;
  currentValue?: string;
  checked?: boolean;
  disabled: boolean;
  visible: boolean;
  selectorHints: FormSelectorHint[];
}

export interface FormExtractionResult {
  url: string;
  title: string;
  extractedAt: string;
  controls: ExtractedFormControl[];
}

export interface FormExtractionOptions {
  includeHidden?: boolean;
  includeDisabled?: boolean;
  maxControls?: number;
  maxTextLength?: number;
}

const DEFAULT_MAX_CONTROLS = 150;
const DEFAULT_MAX_TEXT_LENGTH = 240;

export const extractVisibleFormControls = async (
  page: Page,
  options: FormExtractionOptions = {}
): Promise<FormExtractionResult> => {
  const normalizedOptions = {
    includeHidden: Boolean(options.includeHidden),
    includeDisabled: Boolean(options.includeDisabled),
    maxControls: Math.max(1, Math.floor(options.maxControls || DEFAULT_MAX_CONTROLS)),
    maxTextLength: Math.max(40, Math.floor(options.maxTextLength || DEFAULT_MAX_TEXT_LENGTH))
  };

  return page.evaluate((pageOptions): FormExtractionResult => {
    const clean = (value?: string | null, maxLength = pageOptions.maxTextLength): string | undefined => {
      if (!value) {
        return undefined;
      }

      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) {
        return undefined;
      }

      return normalized.length > maxLength
        ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`
        : normalized;
    };

    const cssEscape = (value: string): string => {
      const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
      if (css?.escape) {
        return css.escape(value);
      }

      return value.replace(/["\\#.:,[\]= >+~*|^$()]/g, '\\$&');
    };

    const cssString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

    const isVisible = (element: Element): boolean => {
      if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'hidden') {
        return false;
      }

      const style = window.getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    };

    const isDisabled = (element: Element): boolean =>
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
        ? element.disabled
        : element.getAttribute('aria-disabled') === 'true';

    const textFrom = (element?: Element | null): string | undefined => {
      if (!element) {
        return undefined;
      }

      return clean((element as HTMLElement).innerText || element.textContent || '');
    };

    const directSiblingText = (element: Element, direction: 'previous' | 'next'): string | undefined => {
      let sibling: ChildNode | null =
        direction === 'previous' ? element.previousSibling : element.nextSibling;
      const parts: string[] = [];

      while (sibling && parts.length < 3) {
        if (sibling.nodeType === Node.TEXT_NODE) {
          const text = clean(sibling.textContent);
          if (text) {
            parts.push(text);
          }
        } else if (sibling instanceof HTMLElement) {
          const text = textFrom(sibling);
          if (text) {
            parts.push(text);
          }
        }

        sibling = direction === 'previous' ? sibling.previousSibling : sibling.nextSibling;
      }

      return clean(parts.join(' '));
    };

    const getLabelText = (element: Element): string | undefined => {
      const labeledControl = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const labelParts: string[] = [];

      if ('labels' in labeledControl && labeledControl.labels) {
        Array.from(labeledControl.labels).forEach(label => {
          const text = textFrom(label);
          if (text) {
            labelParts.push(text);
          }
        });
      }

      const elementId = element.getAttribute('id');
      if (elementId) {
        const matchingLabel = document.querySelector(`label[for="${cssEscape(elementId)}"]`);
        const text = textFrom(matchingLabel);
        if (text) {
          labelParts.push(text);
        }
      }

      const wrappingLabel = element.closest('label');
      const wrappedText = textFrom(wrappingLabel);
      if (wrappedText) {
        labelParts.push(wrappedText);
      }

      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        labelledBy.split(/\s+/).forEach(id => {
          const text = textFrom(document.getElementById(id));
          if (text) {
            labelParts.push(text);
          }
        });
      }

      return clean(Array.from(new Set(labelParts)).join(' '));
    };

    const getParentText = (element: Element): string | undefined => {
      const parent =
        element.closest('[role="group"], fieldset, label, li, tr, .form-group, .field, .question') ||
        element.parentElement;

      return textFrom(parent);
    };

    const getNearbyText = (element: Element): string | undefined => {
      const parts = [
        textFrom(element.closest('fieldset')?.querySelector('legend')),
        directSiblingText(element, 'previous'),
        directSiblingText(element, 'next'),
        getParentText(element)
      ].filter((value): value is string => Boolean(value));

      return clean(Array.from(new Set(parts)).join(' '));
    };

    const selectorCount = (selector: string): number => {
      try {
        return document.querySelectorAll(selector).length;
      } catch {
        return 0;
      }
    };

    const addCssHint = (
      hints: FormSelectorHint[],
      selector: string,
      confidence: FormSelectorConfidence,
      reason: string,
      kind: FormSelectorHintKind = 'css',
      value?: string
    ): void => {
      const count = selectorCount(selector);
      if (count !== 1) {
        return;
      }

      hints.push({
        kind,
        selector,
        value,
        confidence,
        unique: true,
        reason
      });
    };

    const buildCssPath = (element: Element): string => {
      const parts: string[] = [];
      let current: Element | null = element;

      while (current && current !== document.body && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();
        const id = current.getAttribute('id');
        if (id && selectorCount(`#${cssEscape(id)}`) === 1) {
          parts.unshift(`#${cssEscape(id)}`);
          break;
        }

        let nth = 1;
        let previous = current.previousElementSibling;
        while (previous) {
          if (previous.tagName === current.tagName) {
            nth += 1;
          }
          previous = previous.previousElementSibling;
        }

        parts.unshift(`${tag}:nth-of-type(${nth})`);
        current = current.parentElement;
      }

      return parts.join(' > ');
    };

    const buildSelectorHints = (
      element: Element,
      labelText?: string,
      ariaLabel?: string,
      placeholder?: string | null,
      name?: string | null,
      id?: string | null
    ): FormSelectorHint[] => {
      const tag = element.tagName.toLowerCase();
      const hints: FormSelectorHint[] = [];

      ['data-testid', 'data-test', 'data-qa', 'data-cy'].forEach(attribute => {
        const value = element.getAttribute(attribute);
        if (value) {
          addCssHint(
            hints,
            `${tag}[${attribute}=${cssString(value)}]`,
            'high',
            `${attribute} is intended to be stable.`
          );
        }
      });

      if (id) {
        addCssHint(hints, `#${cssEscape(id)}`, 'high', 'Element id is unique.', 'id', id);
      }

      if (name) {
        addCssHint(
          hints,
          `${tag}[name=${cssString(name)}]`,
          'high',
          'Element name is unique.',
          'name',
          name
        );
      }

      if (ariaLabel) {
        addCssHint(
          hints,
          `${tag}[aria-label=${cssString(ariaLabel)}]`,
          'medium',
          'Aria label is unique.',
          'aria-label',
          ariaLabel
        );
      }

      if (placeholder) {
        addCssHint(
          hints,
          `${tag}[placeholder=${cssString(placeholder)}]`,
          'medium',
          'Placeholder is unique.',
          'placeholder',
          placeholder
        );
      }

      if (labelText) {
        hints.push({
          kind: 'label',
          value: labelText,
          confidence: 'medium',
          unique: false,
          reason: 'Visible label text can be used with Playwright getByLabel after rechecking uniqueness.'
        });
      }

      const path = buildCssPath(element);
      if (path) {
        addCssHint(hints, path, 'low', 'DOM path is a fallback selector for the current page.');
      }

      const seen = new Set<string>();
      return hints.filter(hint => {
        const key = `${hint.kind}:${hint.selector || hint.value || ''}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    };

    const getOptions = (element: Element): ExtractedFormOption[] => {
      if (!(element instanceof HTMLSelectElement)) {
        return [];
      }

      return Array.from(element.options).map(option => ({
        label: clean(option.label || option.textContent || option.value) || option.value,
        value: option.value,
        selected: option.selected,
        disabled: option.disabled
      }));
    };

    const getCurrentValue = (element: Element): string | undefined => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') {
          return element.value ? '__redacted_password_present__' : undefined;
        }

        return clean(element.value, 1000);
      }

      return undefined;
    };

    const candidates = Array.from(
      document.querySelectorAll('input, textarea, select, button')
    ) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>;

    const controls = candidates
      .map((element, index): ExtractedFormControl | null => {
        const visible = isVisible(element);
        const disabled = isDisabled(element);

        if ((!pageOptions.includeHidden && !visible) || (!pageOptions.includeDisabled && disabled)) {
          return null;
        }

        const tag = element.tagName.toLowerCase() as FormControlTag;
        const type =
          element instanceof HTMLInputElement ||
          element instanceof HTMLButtonElement ||
          element instanceof HTMLSelectElement
            ? clean(element.type.toLowerCase(), 80)
            : tag === 'textarea'
              ? 'textarea'
              : undefined;
        const id = clean(element.getAttribute('id'), 160);
        const name = clean(element.getAttribute('name'), 160);
        const placeholder =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? clean(element.placeholder, pageOptions.maxTextLength)
            : undefined;
        const ariaLabel = clean(element.getAttribute('aria-label'), pageOptions.maxTextLength);
        const labelText = getLabelText(element);
        const parentText = getParentText(element);
        const nearbyText = getNearbyText(element);
        const required =
          element.hasAttribute('required') ||
          element.getAttribute('aria-required') === 'true' ||
          (element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
            ? element.required
            : false);
        const checked =
          element instanceof HTMLInputElement &&
          ['checkbox', 'radio'].includes(element.type.toLowerCase())
            ? element.checked
            : undefined;

        return {
          index,
          tag,
          type,
          id,
          name,
          placeholder,
          ariaLabel,
          labelText,
          parentText,
          nearbyText,
          options: getOptions(element),
          required,
          currentValue: getCurrentValue(element),
          checked,
          disabled,
          visible,
          selectorHints: buildSelectorHints(
            element,
            labelText,
            ariaLabel,
            placeholder,
            name,
            id
          )
        };
      })
      .filter((control): control is ExtractedFormControl => Boolean(control))
      .slice(0, pageOptions.maxControls);

    return {
      url: window.location.href,
      title: document.title,
      extractedAt: new Date().toISOString(),
      controls
    };
  }, normalizedOptions);
};

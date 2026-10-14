import type { ComponentProps, SVGProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Field, fieldClass, IconInput } from '@webapp/components/auth/field';

// A stand-in for a lucide icon: the field only needs a component that takes the SVG props.
const Mail = ((props: SVGProps<SVGSVGElement>) => <svg {...props} />) as ComponentProps<
  typeof IconInput
>['icon'];

describe('auth Field and IconInput', () => {
  it('links the label to the input and shows no error by default', () => {
    const html = renderToStaticMarkup(
      <Field id="email" label="Email">
        <IconInput icon={Mail} id="email" />
      </Field>,
    );
    expect(html).toContain('<label for="email"');
    expect(html).toContain('id="email"');
    expect(html).not.toContain('text-neg');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it('marks an invalid input and renders the error text', () => {
    const html = renderToStaticMarkup(
      <Field id="email" label="Email" error="Invalid">
        <IconInput icon={Mail} id="email" invalid />
      </Field>,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('shadow-[inset_0_0_0_1px_var(--neg)]');
    expect(html).toContain('Invalid');
  });

  it('renders the icon hidden from assistive technology', () => {
    expect(renderToStaticMarkup(<IconInput icon={Mail} id="x" />)).toMatch(
      /<svg[^>]*aria-hidden="true"/,
    );
  });

  it('puts the aside content next to the label', () => {
    const html = renderToStaticMarkup(
      <Field id="p" label="Password" aside={<a href="/recuperar">Forgot</a>}>
        <IconInput icon={Mail} id="p" />
      </Field>,
    );
    expect(html).toContain('justify-between');
    expect(html).toContain('Forgot');
  });

  it('fieldClass adds the red outline only when invalid', () => {
    expect(fieldClass()).not.toContain('border-neg');
    expect(fieldClass(true)).toContain('border-neg');
  });
});

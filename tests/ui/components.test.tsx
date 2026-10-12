import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Button,
  Card,
  Chip,
  EmptyState,
  Modal,
  ProgressBar,
  ProgressRing,
  Segmented,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
  useToast,
} from '@nestvault/ui';

describe('base components', () => {
  it('Button defaults to type="button" so it never submits a form by accident', () => {
    const html = renderToStaticMarkup(<Button>x</Button>);
    expect(html).toContain('type="button"');
  });

  it('Button renders the primary variant with the accent tokens', () => {
    const html = renderToStaticMarkup(<Button variant="primary">x</Button>);
    expect(html).toContain('bg-accent');
  });

  it('Chip renders an optional colour dot', () => {
    const html = renderToStaticMarkup(<Chip dotColor="#F2913D">x</Chip>);
    expect(html).toContain('background:#F2913D');
  });

  it('ProgressBar clamps to 0–100 and exposes the value to assistive technology', () => {
    const over = renderToStaticMarkup(<ProgressBar label="goal" value={140} />);
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain('width:100%');
    const under = renderToStaticMarkup(<ProgressBar label="goal" value={-5} />);
    expect(under).toContain('aria-valuenow="0"');
    const nan = renderToStaticMarkup(<ProgressBar label="goal" value={Number.NaN} />);
    expect(nan).toContain('aria-valuenow="0"');
  });

  it('ProgressRing exposes its label and value', () => {
    const html = renderToStaticMarkup(<ProgressRing label="goal" value={64} />);
    expect(html).toContain('aria-label="goal"');
    expect(html).toContain('aria-valuenow="64"');
  });

  it('Table headers are column scoped and numeric cells align right', () => {
    const html = renderToStaticMarkup(
      <Table>
        <thead>
          <tr>
            <Th numeric>v</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td numeric>1</Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(html).toContain('scope="col"');
    expect(html).toContain('text-right');
  });

  it('Card and EmptyState render their content', () => {
    const html = renderToStaticMarkup(
      <Card>
        <EmptyState title="t" description="d" />
      </Card>,
    );
    expect(html).toContain('<b');
    expect(html).toContain('d');
  });
});

describe('interactive components', () => {
  it('Segmented marks the selected option with aria-pressed', () => {
    const html = renderToStaticMarkup(
      <Segmented
        label="period"
        value="b"
        onChange={() => undefined}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    expect(html).toContain('role="group"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('Tabs expose the tab roles and only render the active panel', () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">first</TabsContent>
        <TabsContent value="two">second</TabsContent>
      </Tabs>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('first');
    expect(html).not.toContain('second');
  });

  it('Modal renders nothing while closed', () => {
    const html = renderToStaticMarkup(
      <Modal open={false} onOpenChange={() => undefined} title="Title" closeLabel="Close" />,
    );
    expect(html).toBe('');
  });

  it('useToast refuses to run outside ToastProvider', () => {
    function Probe() {
      useToast();
      return null;
    }
    expect(() => renderToStaticMarkup(<Probe />)).toThrow('ToastProvider');
  });
});

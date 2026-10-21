import { formatMoney } from '@nestvault/ui';

import { toneClass, withPlus } from '@webapp/lib/portfolios-view';

/**
 * A value in its own currency with the EUR equivalent under it when the currency is not EUR.
 * `signed` colours gains and losses and puts a plus on gains.
 */
export function NativeMoney({
  native,
  eur,
  currency,
  signed = false,
}: {
  native: string;
  eur: string;
  currency: string;
  signed?: boolean;
}) {
  const text = formatMoney(native, currency);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={signed ? toneClass(native) : undefined}>
        {signed ? withPlus(text, native) : text}
      </span>
      {currency !== 'EUR' && (
        <small className="text-xs text-fg-3">
          {`(${signed ? withPlus(formatMoney(eur), eur) : formatMoney(eur)})`}
        </small>
      )}
    </span>
  );
}

/** A EUR amount coloured by its sign, with a plus on gains. */
export function SignedMoney({ value, currency = 'EUR' }: { value: string; currency?: string }) {
  return <span className={toneClass(value)}>{withPlus(formatMoney(value, currency), value)}</span>;
}

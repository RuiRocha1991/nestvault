import { formatMoney } from '@nestvault/ui';

import { toneClass, withPlus } from '@webapp/lib/portfolios-view';

/**
 * A value in its own currency with the equivalent in the display currency under it when the two
 * differ. `signed` colours gains and losses and puts a plus on gains.
 */
export function NativeMoney({
  native,
  converted,
  currency,
  displayCurrency,
  signed = false,
}: {
  native: string;
  /** The same amount in `displayCurrency`. */
  converted: string;
  currency: string;
  displayCurrency: string;
  signed?: boolean;
}) {
  const text = formatMoney(native, currency);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={signed ? toneClass(native) : undefined}>
        {signed ? withPlus(text, native) : text}
      </span>
      {currency !== displayCurrency && (
        <small className="text-xs text-fg-3">
          {`(${signed ? withPlus(formatMoney(converted, displayCurrency), converted) : formatMoney(converted, displayCurrency)})`}
        </small>
      )}
    </span>
  );
}

/** An amount coloured by its sign, with a plus on gains. */
export function SignedMoney({ value, currency }: { value: string; currency: string }) {
  return <span className={toneClass(value)}>{withPlus(formatMoney(value, currency), value)}</span>;
}

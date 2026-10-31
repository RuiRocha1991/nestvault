/** `yyyy-mm-dd` of an instant in the household's time zone (Europe/Lisbon). */
export const lisbonDay = (instant: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

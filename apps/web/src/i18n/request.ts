import { getRequestConfig } from 'next-intl/server';

import messages from '../../messages/pt-PT.json';

// The app has one locale for now: no locale in the URL, messages in messages/pt-PT.json.
export default getRequestConfig(() => ({
  locale: 'pt-PT',
  messages,
}));

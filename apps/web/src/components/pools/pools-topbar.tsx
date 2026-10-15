import Link from 'next/link';

import { Brand } from '@webapp/components/brand';
import { SignOutButton } from '@webapp/components/sign-out-button';

/** The minimal top bar of the screens outside a pool: logo, the user and "Terminar sessão". */
export function PoolsTopbar({ userName }: { userName: string }) {
  return (
    <header className="flex items-center justify-between gap-3 px-6 py-5 sm:px-11">
      <Link href="/pools" className="no-underline">
        <Brand variant="auth" />
      </Link>
      <div className="flex items-center gap-2">
        <span className="flex h-10 items-center gap-2 rounded-md border border-line-2 bg-panel px-3 text-md font-medium">
          <span
            aria-hidden
            className="grid size-[22px] place-items-center rounded-full bg-grad-warm text-xs font-bold text-white"
          >
            {userName.trim().charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[160px] truncate">{userName}</span>
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}

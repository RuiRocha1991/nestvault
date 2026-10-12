'use client';

import * as RadixTabs from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';

import { cn } from '../cn';

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('mb-4 flex gap-5 overflow-x-auto border-b border-line', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'whitespace-nowrap border-b-2 border-transparent pb-3 pt-2 text-md font-semibold text-fg-3',
        'hover:text-fg data-[state=active]:border-accent-2 data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = RadixTabs.Content;

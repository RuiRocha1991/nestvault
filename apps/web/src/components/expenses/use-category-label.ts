'use client';

import { useTranslations } from 'next-intl';

import { categoryMessageKey } from '@webapp/lib/category-name';
import type { CategoryView } from '@webapp/lib/expenses-types';

/**
 * The display name of a category: a global one comes from the messages by its stable key (so it is
 * translated for everybody), a pool's own one is the name its members typed.
 */
export function useCategoryLabel() {
  const t = useTranslations('categories');
  return (category: Pick<CategoryView, 'systemKey' | 'name'>): string => {
    if (category.systemKey === null) return category.name ?? '';
    const key = categoryMessageKey(category.systemKey);
    return t.has(key) ? t(key) : (category.name ?? category.systemKey);
  };
}

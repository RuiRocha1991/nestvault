'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger, formatPct } from '@nestvault/ui';
import { useTranslations } from 'next-intl';

import { EventsTab } from '@webapp/components/real-estate/events-tab';
import { InstallmentsTab } from '@webapp/components/real-estate/installments-tab';
import { SaleSimulatorTab } from '@webapp/components/real-estate/sale-simulator-tab';
import { SummaryTab } from '@webapp/components/real-estate/summary-tab';
import { WorksTab } from '@webapp/components/real-estate/works-tab';
import { camelKey, propertyFigures } from '@webapp/lib/real-estate-view';
import type { PropertyPageData } from '@webapp/server/real-estate';

const TABS = ['summary', 'installments', 'events', 'works', 'sale'] as const;

/** The property page (mockups 28 to 32): a header and five tabs. */
export function PropertyScreen({ data, today }: { data: PropertyPageData; today: string }) {
  const t = useTranslations('realEstate.property');
  const tType = useTranslations('realEstate.propertyType');
  const { property, bundles, works, holders, costs } = data;
  const bundle = bundles[0];
  const figures = propertyFigures(property, bundles, works);
  const owners = property.holders
    .map((h) => {
      const name = holders.find((holder) => holder.id === h.holderId)?.name ?? '';
      return `${name} ${formatPct(h.sharePct, { digits: 0 })}`;
    })
    .join(' · ');

  return (
    <>
      <p className="-mt-3 mb-4 text-sm text-fg-3">
        {`${tType(camelKey(property.type))} · ${t('holders')} ${owners}`}
        {!!property.address && ` · ${property.address}`}
      </p>
      <Tabs defaultValue="summary">
        <TabsList aria-label={t('tabsLabel')}>
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="summary">
          <SummaryTab figures={figures} bundle={bundle} />
          {costs.length > 0 && <CostsNote count={costs.length} />}
        </TabsContent>
        <TabsContent value="installments">
          <InstallmentsTab bundle={bundle} today={today} />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab bundle={bundle} />
        </TabsContent>
        <TabsContent value="works">
          <WorksTab works={works} propertyId={property.id} />
        </TabsContent>
        <TabsContent value="sale">
          <SaleSimulatorTab property={property} figures={figures} bundle={bundle} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function CostsNote({ count }: { count: number }) {
  const t = useTranslations('realEstate.property');
  return <p className="mt-3 text-xs text-fg-3">{t('costsNote', { count })}</p>;
}

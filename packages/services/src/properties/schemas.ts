import {
  PROPERTY_TYPES,
  VALUATION_SOURCES,
  type PropertyHolderRow,
  type PropertyRow,
  type PropertyValuationRow,
} from '@nestvault/db';
import { acquisitionCostsTotal, dec, latestValuation, loanAmount } from '@nestvault/domain';
import { z } from 'zod';

export const PROPERTY_HOLDERS_MAX = 10;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const Name = z.string().trim().min(1).max(80).regex(NO_CONTROL);
const Address = z.string().trim().min(1).max(200).regex(NO_CONTROL);

/** A decimal string with up to 4 decimals (the column is numeric(18,4)); never a JS float. */
const Amount = z.string().refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value));
const PositiveAmount = Amount.refine((value) => dec(value).gt(0));
/** A percentage 0-100 with up to 4 decimals, as a decimal string. */
const Percent = z
  .string()
  .refine((value) => /^\d{1,3}(\.\d{1,4})?$/.test(value) && dec(value).lte(100));
/** An ownership share: more than 0 and at most 100. */
const Share = Percent.refine((value) => dec(value).gt(0));

export const PropertyType = z.enum(PROPERTY_TYPES);
export const ValuationSource = z.enum(VALUATION_SOURCES);

/** The itemized acquisition costs; what is left out is 0. */
export const CostsInput = z
  .object({
    deed: Amount,
    imt: Amount,
    stampDuty: Amount,
    registration: Amount,
    bankFees: Amount,
  })
  .partial()
  .strict();
export type CostsInput = z.input<typeof CostsInput>;

export const HolderShareInput = z.object({ holderId: z.uuid(), sharePct: Share }).strict();
export type HolderShareInput = z.input<typeof HolderShareInput>;

const Holders = z.array(HolderShareInput).min(1).max(PROPERTY_HOLDERS_MAX);

/** Only client-editable fields (`.strict()`: `poolId`, `id` and the rest answer 400). */
export const CreatePropertyInput = z
  .object({
    name: Name,
    type: PropertyType,
    address: Address.nullable().optional(),
    purchaseDate: z.iso.date(),
    purchasePrice: PositiveAmount,
    downPayment: Amount.optional(),
    costs: CostsInput.optional(),
    sellingCostPct: Percent.nullable().optional(),
    includeInNetWorth: z.boolean().optional(),
    holders: Holders,
  })
  .strict();
export type CreatePropertyInput = z.input<typeof CreatePropertyInput>;

export const UpdatePropertyInput = z
  .object({
    name: Name,
    type: PropertyType,
    address: Address.nullable(),
    purchaseDate: z.iso.date(),
    purchasePrice: PositiveAmount,
    downPayment: Amount,
    costs: CostsInput,
    sellingCostPct: Percent.nullable(),
    includeInNetWorth: z.boolean(),
    holders: Holders,
  })
  .partial()
  .strict();
export type UpdatePropertyInput = z.input<typeof UpdatePropertyInput>;

export const CreateValuationInput = z
  .object({
    date: z.iso.date(),
    value: PositiveAmount,
    source: ValuationSource.optional(),
  })
  .strict();
export type CreateValuationInput = z.input<typeof CreateValuationInput>;

const Decimal = z.string();

export const ValuationDto = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  date: z.iso.date(),
  value: Decimal,
  source: ValuationSource,
});
export type ValuationDto = z.infer<typeof ValuationDto>;

export const ValuationListDto = z.object({ valuations: z.array(ValuationDto) });
export type ValuationListDto = z.infer<typeof ValuationListDto>;

export const PropertyDto = z.object({
  id: z.uuid(),
  name: z.string(),
  type: PropertyType,
  address: z.string().nullable(),
  purchaseDate: z.iso.date(),
  purchasePrice: Decimal,
  downPayment: Decimal,
  /** Itemized acquisition costs and their sum. */
  costs: z.object({
    deed: Decimal,
    imt: Decimal,
    stampDuty: Decimal,
    registration: Decimal,
    bankFees: Decimal,
    total: Decimal,
  }),
  /** Price minus the down payment: what the bank lends. */
  loanAmount: Decimal,
  sellingCostPct: Decimal.nullable(),
  includeInNetWorth: z.boolean(),
  holders: z.array(z.object({ holderId: z.uuid(), sharePct: Decimal })),
  /** The newest valuation, the one net worth uses; `null` until one is added. */
  latestValuation: ValuationDto.nullable(),
});
export type PropertyDto = z.infer<typeof PropertyDto>;

export const PropertyListDto = z.object({ properties: z.array(PropertyDto) });
export type PropertyListDto = z.infer<typeof PropertyListDto>;

export const toValuationDto = (row: PropertyValuationRow): ValuationDto => ({
  id: row.id,
  propertyId: row.propertyId,
  date: row.date,
  value: row.value,
  source: ValuationSource.parse(row.source),
});

export function toPropertyDto(
  row: PropertyRow,
  holders: readonly PropertyHolderRow[],
  valuations: readonly PropertyValuationRow[],
): PropertyDto {
  const costs = {
    deed: row.deedCost,
    imt: row.imt,
    stampDuty: row.stampDuty,
    registration: row.registrationCost,
    bankFees: row.bankFees,
  };
  const newest = latestValuation(valuations);
  return {
    id: row.id,
    name: row.name,
    type: PropertyType.parse(row.type),
    address: row.address,
    purchaseDate: row.purchaseDate,
    purchasePrice: row.purchasePrice,
    downPayment: row.downPayment,
    costs: { ...costs, total: acquisitionCostsTotal(costs) },
    loanAmount: loanAmount(row.purchasePrice, row.downPayment),
    sellingCostPct: row.sellingCostPct,
    includeInNetWorth: row.includeInNetWorth,
    holders: holders.map((holder) => ({ holderId: holder.holderId, sharePct: holder.sharePct })),
    latestValuation: newest ? toValuationDto(newest) : null,
  };
}

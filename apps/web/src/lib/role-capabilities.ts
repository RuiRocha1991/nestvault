/** The things a role lets a person do, as the change-role dialog lists them (mockup modal-75). */
export const CAPABILITIES = [
  'viewData',
  'movements',
  'imports',
  'structure',
  'categories',
  'people',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** The permission that grants each capability; a role has it when its permission set does. */
const PERMISSION_OF: Readonly<Record<Capability, string>> = {
  viewData: 'pool.read',
  movements: 'transactions.write',
  imports: 'imports.run',
  structure: 'accounts.write',
  categories: 'categories.write',
  people: 'members.manage',
};

/** The capabilities a permission set grants, in the order the dialog lists them. */
export function capabilitiesOf(permissions: Iterable<string>): Capability[] {
  const held = new Set(permissions);
  return CAPABILITIES.filter((capability) => held.has(PERMISSION_OF[capability]));
}

/** What a person keeps, loses and gains when they move from one role's capabilities to another's. */
export function diffCapabilities(from: readonly Capability[], to: readonly Capability[]) {
  return {
    keep: from.filter((capability) => to.includes(capability)),
    lose: from.filter((capability) => !to.includes(capability)),
    gain: to.filter((capability) => !from.includes(capability)),
  };
}

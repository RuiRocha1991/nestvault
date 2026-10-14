import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Pools (households) live in nestvault_identity (PRD 01); the financial data of a pool lives in
// nestvault_app and only shares the pool id. Ids are UUID v7 generated in application code.
export const pools = pgTable('pools', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

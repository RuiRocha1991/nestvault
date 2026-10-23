# Shipped import specs

Every `*.json` in this folder is an `ImportSpec` (schema: `schemas/import-spec.schema.json`) and is
registered as a parser at start-up. A spec that does not validate stops the service from starting.
Specs describe structure only (header names, formats) and must never contain personal data.

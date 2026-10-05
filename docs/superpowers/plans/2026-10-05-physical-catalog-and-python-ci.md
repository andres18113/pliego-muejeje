# Physical catalog and Python CI implementation

Scope: import the supplied 180-book physical academic catalog, preserve prior catalog data and concurrent changes, and repair Python test/CI assumptions. No frontend, migrations, application deployment, commit, or push.

1. Capture concurrent file hashes/diff, prior registry/manifests and full ADMIN catalog snapshot. Validate inventory, source hashes, categories, ISBN policy and identity collisions.
2. Prepare physical staging with original cover provenance, explicit SIMULATED/DEMO metadata and work resolution. Use the existing allocator against a copy of the current registry; preserve every prior assignment and the reserved SKU.
3. Normalize new covers through the official pipeline; append manifest records while preserving the previous normalized records and objects.
4. Publish only the new normalized objects using the existing R2 sync and immutable CDN conventions. Import physical editions through existing ADMIN REST commands. Record source provenance, inventory simulation and import receipts.
5. Independently fix Python dependency setup and identity-based tests. Isolate synthetic digital fixtures, retain physical seed rejection of specialized digital staging, and protect historical records and prior SKU assignments.
6. Validate all new details, categories, search, physical filters, stock/availability and cart behavior. Compare every previous edition, work, manifest record, assignment and concurrent file hash. Run focused and global Python suites; preserve complete verification logs.

The root agent owns publication and final integration. Independent agents own new physical preparation files and Python tests/CI respectively.

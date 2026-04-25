# System Design

## Architecture

Phase 1 is a client-side React/Vite TypeScript app with local persistence. The code is organized around domain models, validation schemas, and services so a backend can replace local storage later.

## Modules

- `src/models`: Tenant-aware TypeScript models and Zod schemas.
- `src/services/profileService.ts`: Profile draft normalization, validation, and persistence.
- `src/services/resumeService.ts`: Resume upload record creation and parser placeholder.
- `src/services/auditLog.ts`: Sanitized audit events for important actions.
- `src/services/jobIngestion.ts`: Phase 2 connector interfaces and Greenhouse/Lever placeholders.
- `src/services/matchEngine.ts`: Phase 3 scoring interface placeholder.
- `src/services/browserApplicationAssistant.ts`: Phase 5 browser assistant placeholder with explicit approval requirement.
- `prisma/schema.prisma`: PostgreSQL-ready model reference.

## Data Protection

Audit metadata is intentionally narrow. Resume content, profile details, credentials, and application answers must not be logged. Future backend implementation should enforce tenant isolation at query and authorization layers.

## Human Approval Gate

The browser application assistant boundary accepts an `approvedByUser` flag and rejects unapproved requests. Future implementation must keep final submit behind an explicit user approval step.

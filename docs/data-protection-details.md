# AI Art Studio Data Protection Details

Last updated: 2026-05-03

Use this document as the source of truth for Shopify's Protected Customer Data application.

## Purpose Limitation

AI Art Studio processes the minimum customer personal data required to:

- Generate and save customer-created artwork.
- Maintain Studio Credit and free generation balances.
- Troubleshoot merchant support issues and comply with Shopify privacy webhooks.

The app does not sell customer personal data, use customer data for unrelated advertising, or use personal data for automated decisions with legal or similarly significant effects.

## Personal Data Categories

The app may process:

- Shopify shop domain and app installation details.
- Shopify customer ID.
- Customer email address when provided for OTP or Shopify customer identity resolution.
- Artwork prompts and generated design metadata.
- Credit balances, credit ledger entries, and free generation usage.

The app does not need customer names, full postal addresses, or phone numbers for Studio Credits. If an orders/paid webhook payload contains those fields, the app ignores them unless required for fulfillment.

## Retention

Customer records are retained only while needed to provide the app, support merchants, comply with legal obligations, or resolve disputes.

Deletion is supported through Shopify privacy webhooks:

- `customers/redact`: deletes the matching customer's app data.
- `shop/redact`: deletes or disconnects shop-specific app data after uninstall.
- `customers/data_request`: acknowledges and prepares an export of matching customer records.

## Security

- Transport security: application endpoints use HTTPS.
- Storage security: production data is stored in managed PostgreSQL and object storage with encryption at rest provided by the infrastructure provider.
- Backups: managed database backups are encrypted at rest by the hosting provider.
- Access control: production access is limited to authorized operators who need access for operations or incident response.
- Secrets: production secrets are stored in deployment platform environment variables and are not committed to source control.
- Incident response: see `docs/security-incident-response.md`.

## Environment Separation

Development and testing should use development stores and development database credentials. Production customer data should not be copied into development environments unless required for an incident and approved by the app operator.

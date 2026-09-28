# Sub-processors — DRAFT

The providers Aperture uses to run the service. Update this list, and notify customers, before adding one.

| Sub-processor                                                   | Purpose                                     | Data                                              | Location         |
| --------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- | ---------------- |
| [Hosting provider, e.g. Hetzner / AWS me-central-1]             | Servers, database, backups                  | All service data                                  | [Region]         |
| [Object storage, e.g. Backblaze B2 / Supabase Storage]          | Encrypted database backups; generated media | Backups (encrypted); media                        | [Region]         |
| Vercel                                                          | Web application hosting                     | Request metadata                                  | Global edge / US |
| Cloudflare                                                      | DNS, TLS, WAF                               | Request metadata                                  | Global           |
| Resend                                                          | Transactional email                         | Recipient email, email content                    | US               |
| Stripe                                                          | Aperture's own billing                      | Billing contact, payment details (held by Stripe) | US / EU          |
| Grafana Labs (Grafana Cloud)                                    | Metrics and alerting                        | Service metrics (no personal data)                | [Region]         |
| Better Stack                                                    | Uptime monitoring and status page           | None / endpoint status                            | EU               |
| Slack (if the Customer installs the app)                        | Approval notifications                      | Approver names, request summaries                 | US               |
| Solana RPC providers, e.g. Helius (if crypto payments are used) | Reading and sending transactions            | Public blockchain addresses                       | US               |

Customer-connected services (AI providers, the Customer's card issuer, x402 facilitators) act on the Customer's instructions, under the Customer's own agreements with them.

# @aperture/crypto

Primitives for the tamper-evident audit log (plan/architecture §15).

| Export                      | What it does                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canonicalJson`             | RFC 8785 JSON Canonicalization Scheme (via the `canonicalize` library). Refuses anything that isn't plain JSON — bigints, Dates, `undefined` — so money and times must be encoded explicitly. |
| `chainHash`, `GENESIS_HASH` | `hash = SHA-256(prev_hash ‖ JCS(body))`.                                                                                                                                                      |
| `verifyChain`               | Checks sequence, links, and hashes of an exported chain or a segment of it; reports the first broken `seq`. A chain starting at genesis must start at seq 1.                                  |
| `merkleRoot`                | RFC 6962-style Merkle root (domain-separated leaves and nodes) for daily anchoring.                                                                                                           |

INV-15 (any single change to any stored event is detected) is property-tested.

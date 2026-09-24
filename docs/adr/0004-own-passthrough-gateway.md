# 0004 — Own passthrough gateway

- Status: Accepted (2026-09-24)

## Context

LiteLLM, Portkey, and Bifrost already provide virtual keys and budgets. Aperture's value is the org-wide, multi-rail ledger, policies, and mandates, which none of them have. LiteLLM is written in Python, and its PyPI package was compromised on 24 March 2026.

## Decision

Write a thin TypeScript passthrough gateway (OpenAI-compatible, Anthropic-native, Gemini-native, Hugging Face router) that runs estimate → reserve → forward → settle. No cross-provider model translation; OpenRouter covers "any model through one API".

## Consequences

- Small, auditable code on the hot path; we own its latency and correctness.
- Each provider's request and usage format needs a parser and recorded fixtures; weekly contract tests catch format changes.

# Agent Note: Onboarding registers a dormant provider before storing its key

Status: implemented

## Problem

The shared credential-only editor can display a dormant pi-ai provider from the configurable directory even when that provider has no settings profile. Credential storage alone cannot activate it: pi-ai registers routes from its profiles, and a derived credential reference is not consumed until the profile names it. The onboarding dialog therefore remains open after a successful secret write.

## Decision

The credential-only editor uses the ordinary editor's minimal settings operations. When a pi-ai profile has no effective `apiKeyEnv`, submitting a key first records its derived reference, then writes the secret through `credentials.set`. Existing references and unrelated settings stay unchanged. The editor adopts the committed revision and user subtree before the credential write, so a credential failure retries without repeating a successful settings mutation. A refused settings mutation prevents the secret write.

This narrows the no-settings-write rule in [shared-modal onboarding](../feature/2026-08-13-shared-modal-product-onboarding.md) and [native Greeneek credential setup](../feature/2026-07-30-greeneek-onboarding-credential-setup.md). Their shared readiness, modal ownership, and write-only credential decisions remain active. A native Greeneek adapter still has to be mounted by composition; the browser does not install it.

## Alternatives considered

**Complete onboarding immediately after storing the key.** Rejected because dismissing the dialog does not register a route or make the saved key usable.

**Register every catalog provider eagerly.** Rejected because dormant catalog entries are configuration choices, not active routes. Registration belongs to the adapter's accepted settings profiles.

**Write a replacement provider object or store the secret in settings.** Rejected because field-level operations preserve unseen settings, and only the credential service owns secret storage.

## Consequences

Onboarding adds only the non-secret credential reference needed for activation. The editor retains its existing settings conflict and credential retry behavior. Component regression coverage observes the absent settings write before the fix and verifies write ordering, conflict/refusal, and credential-only retry after a refreshed namespace. Browser coverage separates the shipped dormant-provider path from the explicitly mounted native-adapter path and checks persistence, reload, and absence of the entered key from settings, DOM, ARIA, and console output.

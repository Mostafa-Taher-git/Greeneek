---
description: "The deep-agent package group: proactive domain engine, durable store, effects, policy, sources, and Host runtime."
kind: "package-group"
---

# deep-agent

This group contains the Deep-agent subsystem: an independent proactive agent with its own Router session, Worker sessions, domain model, event engine, persistence, effects, sources, and management panel. See the [Deep-agent subsystem reference](../../docs/subsystems/deep-agent.md) for the `ctx.deepAgent` service API and the domain vocabulary.

## Domain port attribution

The domain model, event pipeline, policy vocabulary, worker lifecycle rules, and prompt structure are adapted from the reference superagent prototype at `https://github.com/deepseek-ai/dsh-superagent-prototype`. rebrand:keep — provenance URL required by attribution. That repository is licensed under the MIT License:

Copyright (c) 2026 DeepSeek Harness Team — rebrand:keep — verbatim MIT copyright notice from the reference license.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The reference is a research prototype, not an official product. Components ported near-verbatim include the pure domain vocabulary and deterministic id derivation; host glue, persistence, execution, and UI are independently implemented against Greeneek's service contracts.

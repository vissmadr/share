---
name: Somnus project vision
description: Somnus is a Slack-based leave management chatbot (like TIMEOFF.GURU) — core vision and constraints
type: project
---

Somnus is a new application, a Slack chatbot for employee leave management (inspired by TIMEOFF.GURU).

**Core flow:** Employees interact via Slack DMs with a bot to request time off. The bot uses AI (Anthropic/OpenAI API) to understand natural language requests and execute backend logic.

**Key components identified by user:**
1. SQL backend with employee data (remaining days, team, birthday, etc.)
2. AI integration via provider API (Anthropic or OpenAI) for natural language understanding
3. Tool/MCP layer for AI to query and update the database securely

**Why:** Greenfield project, user is in early brainstorming/spec phase.

**How to apply:** Focus on architecture decisions and spec writing, not implementation yet.

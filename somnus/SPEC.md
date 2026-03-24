# Somnus — Specification

Slack-based leave management system. Employees request time off by chatting with a Slack bot. Team leads approve/reject via Slack DM. HR views a calendar frontend.

## Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Runtime  | Node.js + TypeScript                |
| Slack    | @slack/bolt                         |
| AI       | @anthropic-ai/sdk (Claude tool use) |
| Database | MariaDB + Knex.js                   |
| Frontend | SolidJS + TypeScript                |

Single MariaDB instance for everything.

## Architecture

```
                         ┌──────────────────┐
                         │     MariaDB      │
                         └────────▲─────────┘
                                  │
                         ┌────────┴─────────┐
                         │   Backend API     │
                         │   (Node + TS)     │
                         └──▲────▲────▲─────┘
                            │    │    │
              ┌─────────────┘    │    └─────────────┐
              │                  │                   │
   ┌──────────┴───┐   ┌────────┴────────┐   ┌─────┴──────┐
   │  Slack Bot    │   │  AI Layer       │   │  Frontend  │
   │ (@slack/bolt) │◄─►│ (Claude tools)  │   │ (SolidJS)  │
   └──────────┬────┘   └─────────────────┘   └────────────┘
              │                                     │
     Employee & Lead DMs                    HR calendar view
```

### Flow: Employee Requests Leave

1. Employee sends DM to bot: "I want to take next week off"
2. Slack Bolt receives the message event
3. Message is sent to Claude API with tool definitions and the employee's Slack ID
4. Claude converses with the employee (may ask about replacement, leave type, etc.)
5. Claude calls `create_leave_request` tool → inserts row with status `pending`
6. Bot sends a DM to the team lead: "Joe requested paid vacation Mon Mar 30 – Fri Apr 3 (5 days). Approve or reject?"
7. Team lead replies "approve" or "reject [reason]"
8. Status updated in DB, employee gets notified by the bot

## Roles

| Role      | Interface        | Capabilities                                           |
|-----------|------------------|--------------------------------------------------------|
| Employee  | Slack DM         | Request leave, check balance, see own requests, cancel |
| Team Lead | Slack DM         | All employee capabilities + approve/reject team requests |
| HR        | Frontend (web)   | View calendar of all employees and holidays (read-only for now) |
| Admin     | Direct DB access | Add/remove employees, manage balances, manage holidays, manage teams |

## Database

### Data Ownership

- **System tables** (admin-only, manual edits): `teams`, `employees`, `leave_balances`, `leave_types`, `holidays`
- **Application tables** (written by the system): `leave_requests`

The application only reads system tables. It only writes to `leave_requests`.

### `teams`

| Column | Type         | Notes                    |
|--------|--------------|--------------------------|
| id     | INT PK AUTO  |                          |
| name   | VARCHAR(100) | e.g. "Backend", "Design" |

### `employees`

| Column   | Type         | Notes                              |
|----------|--------------|------------------------------------|
| id       | INT PK AUTO  |                                    |
| slack_id | VARCHAR(50)  | Unique. Maps Slack user → employee |
| name     | VARCHAR(100) |                                    |
| team_id  | INT FK       | → teams.id                         |
| role     | ENUM         | employee, lead                     |
| birthday | DATE         | Nullable                           |

### `leave_types`

| Column | Type         | Notes |
|--------|--------------|-------|
| id     | INT PK AUTO  |       |
| name   | VARCHAR(100) |       |

Seeded defaults:
- Paid vacation
- Unpaid leave
- Sick leave
- Maternity leave
- Paternity leave
- Bereavement leave

### `leave_balances`

| Column        | Type        | Notes                    |
|---------------|-------------|--------------------------|
| id            | INT PK AUTO |                          |
| employee_id   | INT FK      | → employees.id           |
| leave_type_id | INT FK      | → leave_types.id         |
| year          | INT         | e.g. 2026                |
| total_days    | INT         | Allocated for this year  |
| used_days     | INT         | Default 0                |

Admin manages balances manually. Unused days roll over (admin adds them to next year's total).

### `holidays`

| Column | Type         | Notes                 |
|--------|--------------|-----------------------|
| id     | INT PK AUTO  |                       |
| date   | DATE         |                       |
| name   | VARCHAR(100) | e.g. "Liberation Day" |

Bulgarian public holidays. Managed by admin. Used for business day calculations and displayed on the HR calendar.

### `leave_requests`

| Column         | Type         | Notes                                  |
|----------------|--------------|----------------------------------------|
| id             | INT PK AUTO  |                                        |
| employee_id    | INT FK       | → employees.id                         |
| leave_type_id  | INT FK       | → leave_types.id                       |
| start_date     | DATE         |                                        |
| end_date       | DATE         |                                        |
| status         | ENUM         | pending, approved, rejected, cancelled |
| replacement_id | INT FK       | → employees.id. Nullable               |
| reject_reason  | TEXT         | Nullable. Filled by lead on rejection  |
| created_at     | DATETIME     | Default now                            |

## AI Tools

Defined for Claude's tool use API. Each maps to a backend function. The employee is identified by the Slack ID passed as context.

### `get_my_info`
Returns the employee's profile and leave balances.
- **Returns:** `{ name, team_name, role, balances: [{ leave_type, total_days, used_days, remaining }] }`

### `check_availability`
Checks if a given employee has overlapping leave for a date range.
- **Params:** `employee_id`, `start_date`, `end_date`
- **Returns:** `{ available: bool, conflicts: [{ start_date, end_date, leave_type }] }`

### `get_team_members`
Lists members of the employee's team (for choosing a replacement).
- **Returns:** `[{ id, name, role }]`

### `get_team_schedule`
Shows who on the team is out for a given period. Answers "who's out this week?"
- **Params:** `start_date`, `end_date`
- **Returns:** `[{ employee_name, start_date, end_date, leave_type, status }]`

### `create_leave_request`
Creates a leave request with status `pending`.
- **Params:** `leave_type`, `start_date`, `end_date`, `replacement_id` (optional)
- **Validation:**
  - `start_date` must be today or later
  - `end_date` >= `start_date`
  - Employee must have enough remaining days (for leave types that consume balance)
  - If `replacement_id` provided, must be same team and available for the date range
- **Returns:** `{ request_id, business_days_count }` or `{ error, reason }`
- **Side effect:** Sends approval DM to team lead

### `get_my_requests`
Returns the employee's leave requests.
- **Params:** `status` (optional filter)
- **Returns:** `[{ id, start_date, end_date, leave_type, status, replacement_name, created_at }]`

### `cancel_leave_request`
Cancels a pending or approved request.
- **Params:** `request_id`
- **Validation:** Must belong to the employee. Cannot cancel past leave.
- **Returns:** `{ success: bool }` or `{ error, reason }`
- **Side effect:** If was approved, restores days to balance. Notifies lead.

## Business Rules

Enforced in the tool layer, not by the AI:

1. Leave days are counted as business days (Mon–Fri, excluding rows in `holidays` table).
2. Cannot request leave in the past.
3. Cannot request leave exceeding remaining balance (for leave types that consume balance).
4. Replacement must be on the same team.
5. Replacement must not have overlapping approved/pending leave for the date range.
6. Replacement is optional — "nobody" is valid.
7. Approving a request deducts days from the employee's balance.
8. Cancelling an approved request restores the days.
9. Full days only, no half days.
10. All leave types consume balance for now (sick leave rules TBD).

## Team Lead Approval

When a leave request is created:
1. Bot sends a Slack DM to the team lead with the request details.
2. Lead replies "approve" or "reject [reason]".
3. Bot updates request status and notifies the employee.

The lead's reply is parsed with simple string matching, not through the AI layer.

## Frontend (HR)

SolidJS + TypeScript. Read-only for now. Accessed via SSH tunnel.

### Views
- **Monthly calendar** — all employees' approved/pending leave overlaid on the month. Holidays marked.

### API Endpoints
- `GET /api/leave-requests?month=YYYY-MM&status=approved,pending`
- `GET /api/holidays?year=YYYY`
- `GET /api/employees`

### Authentication
SSH tunnel to the server. No application-level auth for now.

## Slack Integration

- 1:1 DMs only, no group DMs or channels.
- Bot identifies employee by Slack user ID, looks up `employees.slack_id`.
- If a Slack user is not in the `employees` table, the bot responds that they are not registered and to contact the admin.

## Early Testing

CLI test harness before wiring up Slack:

1. Seed MariaDB with sample teams, employees, balances, holidays.
2. CLI script (`src/test-harness.ts`) that:
   - Takes a Slack ID argument to simulate a specific employee
   - Reads messages from stdin
   - Sends them to Claude API with tools
   - Executes tool calls against MariaDB
   - Prints conversation to stdout and logs to file
3. Iterate on AI prompts, tool definitions, and business logic without Slack.

## Project Phases

### Phase 1 — Foundation
- Database schema + Knex migrations
- Tool functions with business rule validation
- Claude API integration with tool definitions
- CLI test harness
- Seed data script

### Phase 2 — Slack Integration
- Slack Bolt app, receive DM events
- Wire messages → AI layer → responses
- Team lead approval flow via Slack DM
- Employee notifications (approved/rejected)

### Phase 3 — Frontend
- SolidJS app with monthly calendar view
- Backend API endpoints
- Display holidays and leave requests

### Phase 4 — Future
- HR can manage employees and balances from frontend
- Additional leave types
- Half-day support
- Proactive notifications ("your leave starts tomorrow")
- Year-end balance rollover automation
- Sick leave rules per Bulgarian labor law

# E2E Tests

This folder contains Playwright-based end-to-end tests for collaboration and sync behavior.

## What they cover

- **Action tests** (`actions/`): verifies each UI action can be generated/executed.
- **Infrastructure tests** (`infrastructure/`): verifies core building blocks (agent setup, lifecycle helpers, convergence utilities).
- **Runner tests** (`runner/`): verifies the synchronous tick loop and phase behavior.
- **Recorder tests** (`recorder/`): verifies failure artifact capture.
- **Stress test** (`stress/mainStress.test.ts`): full multi-agent collaborative run with convergence checks.

## How to run

From `ui/`:

- Run all regular e2e tests:
  - `npm run e2e`
- Run a specific file:
  - `npx playwright test e2e/runner/TestRunner.test.ts`

The Playwright config starts the app/server web services for test runs.

## Stress test (opt-in)

The main stress test is disabled by default and runs only when enabled:

- `RUN_STRESS=1 npx playwright test e2e/stress/mainStress.test.ts`

Useful optional env vars:

- `E2E_SEED` (number): deterministic seed.
- `STRESS_AGENT_COUNT` (default `10`).
- `STRESS_DURATION_SCALE` (default `1`).
- `STRESS_CONVERGENCE_INTERVAL_MS` (default `10000`).
- `STRESS_PRE_CONVERGENCE_WAIT_MS` (default `150`).
- `STRESS_QUIESCENCE_MS` (default `1000`).
- `STRESS_LIVE_VIEW=1`: show browser and focus agent 0.
- `STRESS_LIVE_SLOWMO_MS` (number): slow down live mode actions.
- `STRESS_RECORD_AGENTS=1`: record video for all agents.
- `STRESS_RECORD_AGENT0=1`: legacy alias for enabling recording (still works).
- `STRESS_RECORDINGS_DIR` (default `e2e/recordings`).

## Failure artifacts

On stress failure, artifacts are written to:

- `e2e/failure-reports/<seed>-<timestamp>/`

This includes actions/commands logs, snapshots, final agent states, and metadata.

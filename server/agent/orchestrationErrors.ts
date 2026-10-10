/**
 * Typed orchestration errors for the agentic tool-calling loop.
 *
 * Compatibility: `runAgenticTurn` keeps returning a normal `AgenticTurn` (no throw), so existing
 * callers in run.ts / app.ts / autonomous.ts are unaffected. The stable string
 * `failureReason` ("step_budget_exhausted") is kept; the typed `orchestrationError` field is
 * additive. Use `StepBudgetExhaustedError` where an exception is wanted (e.g. strict callers).
 */

export const ORCHESTRATION_ERROR_CODES = ["STEP_BUDGET_EXHAUSTED"] as const;
export type OrchestrationErrorCode = (typeof ORCHESTRATION_ERROR_CODES)[number];

/** Plain, JSON-safe description attached to an AgenticTurn. */
export type OrchestrationErrorInfo = {
  code: OrchestrationErrorCode;
  maxSteps: number;
  stepsUsed: number;
  message: string;
};

export class OrchestrationError extends Error {
  readonly code: OrchestrationErrorCode;
  readonly maxSteps: number;
  readonly stepsUsed: number;

  constructor(code: OrchestrationErrorCode, maxSteps: number, stepsUsed: number, message: string) {
    super(message);
    this.name = "OrchestrationError";
    this.code = code;
    this.maxSteps = maxSteps;
    this.stepsUsed = stepsUsed;
  }

  toInfo(): OrchestrationErrorInfo {
    return { code: this.code, maxSteps: this.maxSteps, stepsUsed: this.stepsUsed, message: this.message };
  }
}

/** Raised/reported when the model keeps requesting tools past the deterministic step limit. */
export class StepBudgetExhaustedError extends OrchestrationError {
  constructor(maxSteps: number, stepsUsed: number) {
    super(
      "STEP_BUDGET_EXHAUSTED",
      maxSteps,
      stepsUsed,
      `Tool-calling step budget exhausted after ${stepsUsed} of ${maxSteps} steps`,
    );
    this.name = "StepBudgetExhaustedError";
  }
}

export function isOrchestrationError(value: unknown): value is OrchestrationError {
  return value instanceof OrchestrationError;
}

import type { Doc } from "../_generated/dataModel";
import {
  validateResearchTaskResult,
  type ResearchTaskSpec,
} from "./researchTasks";

export type SubagentResearchStatus =
  | "succeeded"
  | "insufficient_evidence"
  | "failed";

export interface SubagentResearchResult {
  taskKind: ResearchTaskSpec["kind"];
  status: SubagentResearchStatus;
  summary: string;
  evidenceCards: Array<Pick<Doc<"gtmEvidenceCards">, "source" | "url" | "snippet">>;
  completedChecklistItems: string[];
  costLedgerWritten: boolean;
  wantsToFinalizeStrategy?: boolean;
  missingEvidence?: string[];
}

export interface SubagentResearchAcceptance {
  accepted: boolean;
  nextStatus: "accepted" | "retry" | "escalate" | "park_channel";
  failures: string[];
}

export function validateSubagentResearchResult(input: {
  task: ResearchTaskSpec;
  result: SubagentResearchResult;
}): SubagentResearchAcceptance {
  const failures: string[] = [];
  if (input.result.taskKind !== input.task.kind) {
    failures.push("result task kind does not match task spec");
  }
  if (input.result.status === "succeeded" && !input.result.summary.trim()) {
    failures.push("successful result needs a summary");
  }
  if (
    input.result.wantsToFinalizeStrategy &&
    !input.task.outputSchema.mayFinalizeStrategy
  ) {
    failures.push("only channel judge may finalize strategy");
  }

  const taskGate = validateResearchTaskResult({
    task: input.task,
    evidenceCards: input.result.evidenceCards,
    costLedgerWritten: input.result.costLedgerWritten,
    completedChecklistItems: input.result.completedChecklistItems,
  });
  failures.push(...taskGate.failures);

  const accepted =
    input.result.status === "succeeded" &&
    failures.length === 0 &&
    taskGate.passed;
  return {
    accepted,
    nextStatus: accepted
      ? "accepted"
      : nextStatusFor(input.task, input.result, failures),
    failures,
  };
}

function nextStatusFor(
  task: ResearchTaskSpec,
  result: SubagentResearchResult,
  failures: ReadonlyArray<string>
): SubagentResearchAcceptance["nextStatus"] {
  if (result.status === "insufficient_evidence") return "park_channel";
  if (
    task.retryPolicy.escalation === "hard_research_model" &&
    failures.some((failure) =>
      task.retryPolicy.retryableFailures.some((retryable) =>
        failure.includes(retryable)
      )
    )
  ) {
    return "escalate";
  }
  if (task.retryPolicy.maxAttempts > 1) return "retry";
  return "park_channel";
}

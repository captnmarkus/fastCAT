import { CAT_API_BASE, LLM_API_BASE, authHeaders, httpError } from "../core";
import type {
  ChatMessage,
  GlobalGlossaryEntry,
  InboxItem,
  IssueSummary,
  ProjectBucketMeta,
  ProjectFilesResponse,
  QaIssue,
  Segment,
  SegmentIssue,
  SegmentSourceType,
  SegmentUpdateResponse,
  TermbaseConcordanceEntry,
  TermbaseMatchEntry
} from "../cat";
import type { SegmentState, SegmentStatus } from "../../types/app";

export { CAT_API_BASE, LLM_API_BASE, authHeaders, httpError };

export type {
  ChatMessage,
  GlobalGlossaryEntry,
  InboxItem,
  IssueSummary,
  ProjectBucketMeta,
  ProjectFilesResponse,
  QaIssue,
  Segment,
  SegmentIssue,
  SegmentSourceType,
  SegmentState,
  SegmentStatus,
  SegmentUpdateResponse,
  TermbaseConcordanceEntry,
  TermbaseMatchEntry
};

export type SegmentMutationParams = {
  tgt: string;
  tgtRuns?: any[];
  status?: string;
  state?: SegmentState;
  isLocked?: boolean;
  version: number;
  generatedByLlm?: boolean;
  qeScore?: number | null;
  forceReviewed?: boolean;
  markReviewed?: boolean;
  sourceType?: SegmentSourceType;
  sourceScore?: number | null;
  sourceMatchId?: string | null;
  originDetails?: Record<string, unknown> | null;
};

export function buildSegmentMutationBody(params: SegmentMutationParams) {
  return {
    tgt: params.tgt,
    ...(params.tgtRuns !== undefined ? { tgtRuns: params.tgtRuns } : {}),
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.state !== undefined ? { state: params.state } : {}),
    ...(params.isLocked !== undefined ? { isLocked: params.isLocked } : {}),
    version: params.version,
    ...(params.generatedByLlm !== undefined ? { generatedByLlm: params.generatedByLlm } : {}),
    ...(params.qeScore !== undefined ? { qeScore: params.qeScore } : {}),
    ...(params.forceReviewed ? { forceReviewed: true } : {}),
    ...(params.markReviewed ? { markReviewed: true } : {}),
    ...(params.sourceType !== undefined ? { sourceType: params.sourceType } : {}),
    ...(params.sourceScore !== undefined ? { sourceScore: params.sourceScore } : {}),
    ...(params.sourceMatchId !== undefined ? { sourceMatchId: params.sourceMatchId } : {}),
    ...(params.originDetails !== undefined ? { originDetails: params.originDetails } : {})
  };
}

export async function parseSegmentMutationResponse(response: Response): Promise<SegmentUpdateResponse> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `update segment ${response.status}`) as Error & {
      code?: string;
      currentVersion?: number;
    };
    if (payload?.code) error.code = payload.code;
    if (payload?.currentVersion != null) {
      error.currentVersion = payload.currentVersion;
    }
    throw error;
  }
  return payload as SegmentUpdateResponse;
}

export type SegmentCollectionOptions = {
  cursor?: number | null;
  limit?: number;
  signal?: AbortSignal;
  state?: string | string[];
  hasIssues?: boolean;
  severity?: "error" | "warning";
  search?: string;
};

export function buildSegmentCollectionQuery(opts?: SegmentCollectionOptions): string {
  const params = new URLSearchParams();
  if (opts?.cursor != null && Number.isFinite(Number(opts.cursor))) {
    params.set("cursor", String(opts.cursor));
  }
  if (opts?.limit != null && Number.isFinite(Number(opts.limit))) {
    params.set("limit", String(opts.limit));
  }
  if (opts?.state) {
    const value = Array.isArray(opts.state) ? opts.state.join(",") : String(opts.state);
    if (value) params.set("state", value);
  }
  if (opts?.hasIssues != null) params.set("hasIssues", opts.hasIssues ? "true" : "false");
  if (opts?.severity) params.set("severity", opts.severity);
  if (opts?.search) params.set("search", opts.search);
  return params.toString();
}

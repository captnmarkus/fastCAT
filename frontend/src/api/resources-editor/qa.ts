import { CAT_API_BASE, authHeaders, type QaIssue } from "./shared";

export async function getSegmentQaIssues(segmentId: number): Promise<QaIssue[]> {
  const response = await fetch(`${CAT_API_BASE}/segments/${segmentId}/qa`, {
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw new Error(`qa issues ${response.status}`);
  const data = await response.json();
  return data.issues || [];
}

export async function createSegmentQaIssue(params: {
  segmentId: number;
  issueType: string;
  severity: string;
  message: string;
}): Promise<QaIssue> {
  const response = await fetch(`${CAT_API_BASE}/segments/${params.segmentId}/qa`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      issueType: params.issueType,
      severity: params.severity,
      message: params.message
    })
  });
  if (!response.ok) throw new Error(`create qa ${response.status}`);
  const data = await response.json();
  return data.issue as QaIssue;
}

export async function resolveQaIssue(issueId: number) {
  const response = await fetch(`${CAT_API_BASE}/qa/${issueId}/resolve`, {
    method: "POST",
    headers: { ...authHeaders() }
  });
  if (!response.ok) throw new Error(`resolve qa ${response.status}`);
  return response.json();
}

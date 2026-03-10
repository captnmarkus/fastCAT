import Modal from "../../../components/Modal";
import { bulkActionLabel, bulkActionScopeText, skipReasonLabel } from "./modernEditorPageUtils";

export default function ModernEditorBulkApproveModals(props: any) {
  const {
    bulkApproveAckQa,
    bulkApproveDialog,
    bulkApproveSummary,
    onCloseDialog,
    onCloseSummary,
    onConfirmDialog,
    onOpenProblematicSegments,
    onOpenSkippedSegments,
    setBulkApproveAckQa
  } = props;

  const dialogReasonEntries = Object.entries(bulkApproveDialog?.estimate?.reasonsBreakdown ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const summaryReasonEntries = Object.entries(bulkApproveSummary?.summary.reasonsBreakdown ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  return (
    <>
      {bulkApproveDialog ? (
        <Modal
          title={bulkActionLabel(bulkApproveDialog.action)}
          onClose={onCloseDialog}
          closeDisabled={bulkApproveDialog.loading}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onCloseDialog}
                disabled={bulkApproveDialog.loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={onConfirmDialog}
                disabled={
                  bulkApproveDialog.loading ||
                  !bulkApproveDialog.estimate ||
                  (bulkApproveDialog.action === "all" &&
                    (bulkApproveDialog.estimate?.qaFlaggedEligible ?? 0) > 0 &&
                    !bulkApproveAckQa)
                }
              >
                {bulkApproveDialog.loading ? "Preparing..." : "Approve"}
              </button>
            </>
          }
        >
          <div className="small text-muted mb-2">{bulkActionScopeText(bulkApproveDialog.action)}</div>
          {bulkApproveDialog.error ? <div className="alert alert-warning py-2">{bulkApproveDialog.error}</div> : null}
          {bulkApproveDialog.estimate ? (
            <>
              <div className="mb-2">
                <div>Total in scope: {bulkApproveDialog.estimate.total}</div>
                <div>Eligible: {bulkApproveDialog.estimate.eligible}</div>
                <div>Skipped: {bulkApproveDialog.estimate.skipped}</div>
                <div>QA-flagged among eligible: {bulkApproveDialog.estimate.qaFlaggedEligible}</div>
              </div>
              {dialogReasonEntries.length > 0 ? (
                <details>
                  <summary>Skipped reasons</summary>
                  <div className="mt-2 small">
                    {dialogReasonEntries.map(([reason, count]) => (
                      <div key={`reason-${reason}`}>
                        {skipReasonLabel(reason)}: {count}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {bulkApproveDialog.action === "all" && bulkApproveDialog.estimate.qaFlaggedEligible > 0 ? (
                <label className="form-check mt-3">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={bulkApproveAckQa}
                    onChange={(event) => setBulkApproveAckQa(event.target.checked)}
                    disabled={bulkApproveDialog.loading}
                  />
                  <span className="form-check-label">
                    I understand that QA-flagged segments will be approved too.
                  </span>
                </label>
              ) : null}
            </>
          ) : null}
        </Modal>
      ) : null}

      {bulkApproveSummary ? (
        <Modal title={`${bulkActionLabel(bulkApproveSummary.action)} summary`} onClose={onCloseSummary}>
          <div>Approved: {bulkApproveSummary.summary.approved}</div>
          <div>Skipped: {bulkApproveSummary.summary.skipped}</div>
          <div>QA-flagged approved: {bulkApproveSummary.summary.qaFlaggedApproved}</div>
          {summaryReasonEntries.length > 0 ? (
            <details className="mt-2">
              <summary>Skipped reasons</summary>
              <div className="mt-2 small">
                {summaryReasonEntries.map(([reason, count]) => (
                  <div key={`summary-reason-${reason}`}>
                    {skipReasonLabel(reason)}: {count}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <div className="d-flex gap-2 mt-3 flex-wrap">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onOpenSkippedSegments}
              disabled={bulkApproveSummary.summary.skippedSegmentIds.length === 0}
            >
              Show skipped
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onOpenProblematicSegments}
              disabled={bulkApproveSummary.summary.problematicSegmentIds.length === 0}
            >
              Show problematic
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

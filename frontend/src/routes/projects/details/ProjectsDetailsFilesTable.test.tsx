import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ProjectsDetailsFilesTable from "./ProjectsDetailsFilesTable";
import { formatDateTimeShort } from "../shared/dates";

describe("ProjectsDetailsFilesTable", () => {
  it("shows completed output downloads and ready dates without expanding the file row", () => {
    const createdAt = "2026-03-07T10:15:00.000Z";
    const html = renderToStaticMarkup(
      <ProjectsDetailsFilesTable
        visibleFiles={[
          {
            fileId: 1,
            originalFilename: "guide.docx",
            type: "docx",
            status: "reviewed",
            segmentStats: { total: 2, draft: 0, underReview: 0, reviewed: 2 },
            tasks: [{ taskId: 10, targetLang: "fr-FR", assigneeId: "reviewer", status: "reviewed" }]
          }
        ]}
        isReviewer={false}
        isTaskAssignedToUser={() => true}
        deriveRollupStatus={() => "reviewed"}
        computeProgressPct={() => 100}
        statusToneClass={() => "bg-success text-white"}
        sourceByFileId={new Map([[1, { fileId: 1, sizeBytes: 1024 }]])}
        expandedFiles={{}}
        toggleFileExpanded={() => {}}
        canDownloadSource={true}
        handleDownloadSource={() => {}}
        handleDownloadOutput={() => {}}
        isProjectReady={true}
        bucketDownloading={null}
        resolveTaskMeta={() => ({ label: "French", flag: "fr" })}
        normalizeTaskStatus={(value: string) => value}
        formatTaskStatus={() => "REVIEWED"}
        rowImportKey={(fileId: number, lang: string) => `${fileId}:${lang}`}
        outputByFileLang={
          new Map([
            [
              "1:fr-FR",
              {
                fileId: 1,
                filename: "guide.fr.docx",
                lang: "fr-FR",
                contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                sizeBytes: 2048,
                createdAt
              }
            ]
          ])
        }
        isProjectOwner={true}
        rowImportState={{}}
        importingRowKey={null}
        openImportDialog={() => {}}
        nav={() => {}}
      />
    );

    expect(html).toContain("French");
    expect(html).toContain(`Ready ${formatDateTimeShort(createdAt)}`);
    expect(html).not.toContain("Expand to download");
  });
});

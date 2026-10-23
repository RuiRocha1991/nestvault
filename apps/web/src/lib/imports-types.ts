import type {
  CommitImportResultDto,
  ImportHistoryDto,
  ImportPreviewDto,
  ImportStartDto,
} from '@nestvault/services';

// The shapes the import screen receives. Client components import these names from here, never the
// services root (a lint rule keeps server code out of the browser bundle).
export type ImportPreview = ImportPreviewDto;
export type ImportStart = ImportStartDto;
export type ImportChooseParser = Extract<ImportStartDto, { status: 'choose-parser' }>;
export type ImportNeedsMapping = Extract<ImportStartDto, { status: 'needs-mapping' }>;
export type ImportCommitResult = CommitImportResultDto;
export type ImportHistory = ImportHistoryDto;
export type ImportHistoryItem = ImportHistoryDto['items'][number];

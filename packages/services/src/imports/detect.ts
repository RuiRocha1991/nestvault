import type { RememberedParser } from '@nestvault/db';

import { UnprocessableError, ValidationError } from '../errors';

import type { UploadKind } from './file-type';
import type {
  ImportSpecJson,
  MappingProposal,
  ParserCandidate,
  ParserClient,
  ParserResponse,
} from './parser-client';

/** A format is picked on its own only when it is this sure and clearly ahead of the next one. */
export const AUTO_CONFIDENCE = 0.7;
export const AUTO_GAP = 0.1;

export interface ParsedFile {
  outcome: 'parsed';
  response: ParserResponse;
  parser: ParserCandidate;
  /** The column mapping the file was read with (a user's, or the account's remembered one). */
  spec: ImportSpecJson | null;
  /** The account's remembered parser or mapping was used. */
  remembered: boolean;
}

export interface NeedsChoice {
  outcome: 'choose-parser';
  candidates: ParserCandidate[];
}

export interface NeedsMapping {
  outcome: 'needs-mapping';
  proposal: MappingProposal;
}

export type DetectOutcome = ParsedFile | NeedsChoice | NeedsMapping;

export interface DetectInput {
  bytes: Uint8Array;
  kind: UploadKind;
  /** A parser the user chose among the candidates. */
  parserId?: string | undefined;
  /** A column mapping the user confirmed. */
  spec?: ImportSpecJson | undefined;
  /** The parser and mapping of the target account's last import. */
  remembered?: RememberedParser | undefined;
}

const candidateOf = (response: ParserResponse, confidence: number): ParserCandidate => ({
  parser_id: response.meta.parser_id,
  kind: response.rows[0]?.kind ?? 'bank',
  version: response.meta.parser_version,
  confidence,
});

/** A refusal of the file itself (not of the parser being down) is worth trying something else for. */
const isFileRefusal = (error: unknown): boolean =>
  error instanceof UnprocessableError || error instanceof ValidationError;

/**
 * Decides how to read a file, in this order: the mapping or parser the user gave; the account's
 * remembered mapping or parser; the best detected parser when it is sure; else the user is asked
 * (several fit, or only a weak one) or, for a csv nobody recognises, a column mapping is proposed.
 */
export async function detectAndParse(
  parser: ParserClient,
  input: DetectInput,
): Promise<DetectOutcome> {
  const { bytes, kind } = input;

  if (input.spec) {
    const response = await parser.parseWithSpec(bytes, input.spec);
    return {
      outcome: 'parsed',
      response,
      parser: candidateOf(response, 1),
      spec: input.spec,
      remembered: false,
    };
  }
  if (input.parserId) {
    const response = await parser.parse(bytes, input.parserId);
    return {
      outcome: 'parsed',
      response,
      parser: candidateOf(response, 1),
      spec: null,
      remembered: false,
    };
  }

  if (input.remembered?.spec && typeof input.remembered.spec === 'object') {
    const spec = input.remembered.spec as ImportSpecJson;
    try {
      const response = await parser.parseWithSpec(bytes, spec);
      return {
        outcome: 'parsed',
        response,
        parser: candidateOf(response, 1),
        spec,
        remembered: true,
      };
    } catch (error) {
      if (!isFileRefusal(error)) throw error; // the format changed: fall through to detection
    }
  }

  const candidates = await parser.detect(bytes);
  const remembered = input.remembered;
  if (remembered && !remembered.spec) {
    const known = candidates.find((candidate) => candidate.parser_id === remembered.parserId);
    if (known) {
      const response = await parser.parse(bytes, known.parser_id);
      return { outcome: 'parsed', response, parser: known, spec: null, remembered: true };
    }
  }

  const [best, second] = [...candidates].sort((a, b) => b.confidence - a.confidence);
  if (!best) {
    if (kind === 'csv') {
      const proposal = await parser.propose(bytes).catch((error: unknown) => {
        if (isFileRefusal(error)) throw new UnprocessableError('No format matched this file.');
        throw error;
      });
      return { outcome: 'needs-mapping', proposal };
    }
    throw new UnprocessableError('No format matched this file.');
  }
  const sure =
    best.confidence >= AUTO_CONFIDENCE &&
    (!second || best.confidence - second.confidence >= AUTO_GAP);
  if (!sure) return { outcome: 'choose-parser', candidates };
  const response = await parser.parse(bytes, best.parser_id);
  return { outcome: 'parsed', response, parser: best, spec: null, remembered: false };
}

// Per-document history and save state (adopted H2, R1 H2/H3). Pure and immutable: every function returns
// a new state and never writes its input. History stores one transaction per entry, never a model
// snapshot; undo applies the exact inverse. Selection, view and caches are never entries.
import { applyTransaction, invertTransaction, pruneTransaction, transactionBytes, type Transaction, type TransactionProblem } from '../domain/transaction';
import type { MapModel } from '../domain/model';

/** R1 H3 default history budget per open document. */
export const DEFAULT_HISTORY_BUDGET = 64 * 1024 * 1024;

export interface HistoryEntry {
  readonly label: string;
  readonly tx: Transaction;
  readonly bytes: number;
  /** Content identities before and after the forward transaction. */
  readonly before: number;
  readonly after: number;
}
/** A visible record that undo depth was given up to stay within budget. Authored content is never dropped. */
export interface HistoryNotice { readonly code: 'history.dropped'; readonly revision: number; readonly entries: number; readonly bytes: number }
export interface DocumentState {
  readonly documentId: string;
  readonly model: MapModel;
  /** Increments on every recorded edit, undo, redo and revert. Never reused within a session. */
  readonly revision: number;
  /** Identity of the current content: undo and redo restore the identities they return to. */
  readonly contentId: number;
  readonly nextContentId: number;
  /** Undo stack, oldest first. */
  readonly past: readonly HistoryEntry[];
  /** Redo stack, next first. */
  readonly future: readonly HistoryEntry[];
  /** Accounted bytes of `past` and `future`; never above `budget` after an operation returns. */
  readonly bytes: number;
  readonly budget: number;
  readonly dropped: number;
  readonly notices: readonly HistoryNotice[];
  /** The content identity and digest last written, or null for a document never saved. */
  readonly saved: Readonly<{ contentId: number; digest: string }> | null;
  /** The digest on disk that the next save must replace (`baseDigest`, R1 H2), or null before the first save. */
  readonly baseDigest: string | null;
}

export type CommitResult =
  | { readonly outcome: 'recorded'; readonly state: DocumentState }
  | { readonly outcome: 'noop'; readonly state: DocumentState }
  | { readonly outcome: 'refused'; readonly state: DocumentState; readonly problem: TransactionProblem };

export interface OpenOptions { readonly savedDigest?: string | null; readonly budget?: number }

/** A document opened from disk (`savedDigest`) starts clean; a new one stays dirty until its first save. */
export function openDocument(model: MapModel, options: OpenOptions = {}): DocumentState {
  const budget = options.budget ?? DEFAULT_HISTORY_BUDGET;
  if (!Number.isSafeInteger(budget) || budget < 0) throw new RangeError('History budget must be a non-negative safe integer');
  const digest = options.savedDigest ?? null;
  return { documentId: model.id, model, revision: 0, contentId: 1, nextContentId: 2, past: [], future: [], bytes: 0, budget, dropped: 0,
    notices: [], saved: digest === null ? null : { contentId: 1, digest }, baseDigest: digest };
}

export const isDirty = (s: DocumentState): boolean => s.saved?.contentId !== s.contentId;
export const canUndo = (s: DocumentState): boolean => s.past.length > 0;
export const canRedo = (s: DocumentState): boolean => s.future.length > 0;

/** Drops the oldest undo entries, then the furthest redo entries, until the history fits its budget. */
function enforceBudget(s: DocumentState): DocumentState {
  if (s.bytes <= s.budget) return s;
  const past = [...s.past], future = [...s.future];
  let bytes = s.bytes, entries = 0, freed = 0;
  while (bytes > s.budget && (past.length || future.length)) {
    const gone = (past.length ? past.shift() : future.pop()) as HistoryEntry;
    bytes -= gone.bytes; freed += gone.bytes; entries++;
  }
  return { ...s, past, future, bytes, dropped: s.dropped + entries, notices: [...s.notices, { code: 'history.dropped', revision: s.revision, entries, bytes: freed }] };
}

/** Records one transaction as one entry and clears redo. A transaction that changes nothing records nothing. */
export function commit(s: DocumentState, tx: Transaction): CommitResult {
  const pruned = pruneTransaction(tx);
  if (pruned.ops.length === 0) return { outcome: 'noop', state: s };
  const applied = applyTransaction(s.model, pruned);
  if (!applied.ok) return { outcome: 'refused', state: s, problem: applied.problem };
  const entry: HistoryEntry = { label: pruned.label, tx: pruned, bytes: transactionBytes(pruned), before: s.contentId, after: s.nextContentId };
  const cleared = s.future.reduce((n, e) => n + e.bytes, 0);
  return { outcome: 'recorded', state: enforceBudget({ ...s, model: applied.model, revision: s.revision + 1, contentId: entry.after,
    nextContentId: s.nextContentId + 1, past: [...s.past, entry], future: [], bytes: s.bytes - cleared + entry.bytes }) };
}

const replay = (s: DocumentState, tx: Transaction): MapModel => {
  const applied = applyTransaction(s.model, tx);
  // Entries are exact inverses of states this history produced; a refusal means the state was forged.
  if (!applied.ok) throw new Error(`History replay refused: ${applied.problem.code} (${applied.problem.message})`);
  return applied.model;
};

export function undo(s: DocumentState): DocumentState {
  const entry = s.past.at(-1);
  if (!entry) return s;
  return { ...s, model: replay(s, invertTransaction(entry.tx)), revision: s.revision + 1, contentId: entry.before, past: s.past.slice(0, -1), future: [entry, ...s.future] };
}

export function redo(s: DocumentState): DocumentState {
  const entry = s.future[0];
  if (!entry) return s;
  return { ...s, model: replay(s, entry.tx), revision: s.revision + 1, contentId: entry.after, past: [...s.past, entry], future: s.future.slice(1) };
}

/** What a writer serializes and the base it must replace. The model is immutable, so no copy is taken. */
export interface SaveTicket { readonly documentId: string; readonly revision: number; readonly contentId: number; readonly model: MapModel; readonly baseDigest: string | null }
export const beginSave = (s: DocumentState): SaveTicket =>
  ({ documentId: s.documentId, revision: s.revision, contentId: s.contentId, model: s.model, baseDigest: s.baseDigest });

export type SaveResult = { readonly ok: true; readonly state: DocumentState } | { readonly ok: false; readonly state: DocumentState; readonly code: 'save.document' | 'save.stale-base'; readonly message: string };

/**
 * Records that `ticket`'s content was written with `digest`. Refused, changing nothing, when the ticket
 * belongs to another document or its base is no longer the document's base (another save completed
 * after it was issued). Edits made while saving keep the document dirty.
 */
export function completeSave(s: DocumentState, ticket: SaveTicket, digest: string): SaveResult {
  if (ticket.documentId !== s.documentId) return { ok: false, state: s, code: 'save.document', message: `Ticket for ${ticket.documentId} cannot save ${s.documentId}` };
  if (ticket.baseDigest !== s.baseDigest) return { ok: false, state: s, code: 'save.stale-base', message: `Ticket base ${ticket.baseDigest} is not the current base ${s.baseDigest}` };
  return { ok: true, state: { ...s, saved: { contentId: ticket.contentId, digest }, baseDigest: digest } };
}

/** Restores the last saved content with a fresh history (RigLab RL-049 semantics, R1 C). */
export function revert(s: DocumentState, savedModel: MapModel): DocumentState {
  if (!s.saved || s.baseDigest === null) throw new RangeError('A document never saved cannot revert');
  if (savedModel.id !== s.documentId) throw new RangeError('The saved model belongs to another document');
  return { ...openDocument(savedModel, { savedDigest: s.saved.digest, budget: s.budget }), revision: s.revision + 1,
    contentId: s.nextContentId, nextContentId: s.nextContentId + 1, saved: { contentId: s.nextContentId, digest: s.saved.digest } };
}

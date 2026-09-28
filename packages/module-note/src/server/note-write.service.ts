import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  canSeeNote,
  checkEditNote,
  checkPinNote,
  checkShareNote,
  isNoteVisibility,
  NOTE_REVISIONS_KEPT,
  type NoteBinAct,
  planNoteBinAct,
  shouldKeepRevision,
} from '../domain/access.js';
import { isNoteColor, type NoteSettings, normalizeNoteSettings, noteSettingsRefusal } from '../domain/appearance.js';
import type { NoteChange } from '../domain/events.js';
import { checkNoteVersion, notePreview, prepareNoteBody, prepareNoteTitle } from '../domain/notes.js';
import { moveInOrder, NOTE_ORDER_MAX, orderNotes } from '../domain/order.js';
import { prepareNoteTags } from '../domain/tags.js';
import { NOTE_LIMIT, NOTE_LIMIT_REGISTRY } from '../feature-keys.js';
import type { NoteRefusal } from '../types.js';
import { NoteWriteError, noteNotFound, refusalError } from './note.errors.js';
import { NoteEventPublisher } from './note.events.js';
import type { NoteRow, NoteTransaction, NoteUpdate, NoteWriteClient } from './note.repository.js';
import type { NoteScope } from './note.service.js';
import { NOTE_ACCESS_CHECK, NOTE_LIMIT_CHECKER, NOTE_PRISMA_WRITE } from './note.tokens.js';
import type { NoteAccessCheck } from './ports.js';

/**
 * How many times an act that is not a save — share, trash, restore, delete —
 * reads the note again after losing a race, before giving up. A save does NOT
 * retry: its version was chosen by the person, and landing it on text they
 * never saw is the overwrite the version exists to prevent.
 */
export const NOTE_ACT_ATTEMPTS = 3;

export interface CreateNoteInput {
  title?: string | null | undefined;
  body?: string | null | undefined;
  color?: string | null | undefined;
  tags?: readonly string[] | null | undefined;
  /** A string off the wire, checked by `isNoteVisibility`. */
  visibility?: string | null | undefined;
}

/** What a save changes. An absent field is left as it is. */
export interface EditNoteInput {
  title?: string | null | undefined;
  body?: string | null | undefined;
  color?: string | null | undefined;
  tags?: readonly string[] | null | undefined;
}

/** Thrown inside a transaction to roll it back when the compare-and-set lost. Never escapes. */
class LostRace extends Error {}

/**
 * Every write to a note.
 *
 * Each one: find the note BY ID AND SCOPE, ask the domain whether this person
 * may, then write CONDITIONALLY on the version that decision was made against,
 * then publish after the commit.
 */
@Injectable()
export class NoteWriteService {
  constructor(
    @Inject(NOTE_PRISMA_WRITE) private readonly prisma: NoteWriteClient,
    private readonly events: NoteEventPublisher,
    /** Unbound: the declared default cap — see `NOTE_LIMIT_CHECKER`. */
    @Optional() @Inject(NOTE_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    /** Unbound: you act on your own notes only. */
    @Optional() @Inject(NOTE_ACCESS_CHECK) private readonly access?: NoteAccessCheck,
  ) {}

  // ── creating ──────────────────────────────────────────────────────────────

  /**
   * A new note, private unless asked otherwise, in the author's default colour.
   *
   * ⚠ THE CAP IS COUNTED IN THE TRANSACTION THAT INSERTS, per person and
   * trashed notes included. Two tabs creating at once can still both pass the
   * count — the cap is a limit on hoarding, not a security boundary, and one
   * note over is not worth a lock.
   */
  async create(scope: NoteScope, actorId: string, input: CreateNoteInput): Promise<NoteRow> {
    const { title } = unwrap(prepareNoteTitle(input.title ?? ''));
    const { body } = unwrap(prepareNoteBody(input.body ?? ''));
    const { tags } = unwrap(prepareNoteTags(input.tags ?? []));
    const color = input.color ?? (await this.defaultColor(scope, actorId));
    if (!isNoteColor(color)) throw refusalError('invalid_color');
    const visibility = input.visibility ?? 'private';
    if (!isNoteVisibility(visibility)) throw refusalError('invalid_visibility');

    const note = await this.prisma.$transaction(async (tx) => {
      const current = await tx.note.count({ where: { ...scope, authorId: actorId } });
      const decision = await this.checkCap(scope, actorId, current);
      if (!decision.allowed) {
        throw new NoteWriteError('limit_reached', `You can keep ${decision.limit} notes here, counting the trash`, {
          limit: decision.limit,
        });
      }
      return tx.note.create({
        data: {
          ...scope,
          authorId: actorId,
          title,
          body,
          preview: notePreview(body),
          visibility,
          color,
          tags: [...tags],
          updatedById: actorId,
        },
      });
    });

    await this.events.noteChanged(note, 'created', actorId);
    return note;
  }

  // ── saving ────────────────────────────────────────────────────────────────

  /**
   * Save changes made from `expectedVersion`.
   *
   * ⚠ A STALE SAVE IS REFUSED with `NOTE_CONFLICT_MESSAGE`, which the app
   * matches to offer reload, overwrite or keep-a-copy. It is never retried here.
   */
  async update(
    scope: NoteScope,
    actorId: string,
    noteId: string,
    expectedVersion: number,
    input: EditNoteInput,
  ): Promise<NoteRow> {
    const note = await this.find(scope, noteId);
    const refusal = checkEditNote(note, actorId) ?? checkNoteVersion(expectedVersion, note.version);
    if (refusal) throw refusalError(refusal);
    return this.saveEdit(scope, actorId, note, prepareEdit(note, input));
  }

  /**
   * Put a revision's title and body back. An edit like any other: from a
   * version, keeping the text it replaces when that is somebody else's.
   */
  async restoreRevision(
    scope: NoteScope,
    actorId: string,
    noteId: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<NoteRow> {
    const note = await this.find(scope, noteId);
    const refusal = checkEditNote(note, actorId) ?? checkNoteVersion(expectedVersion, note.version);
    if (refusal) throw refusalError(refusal);

    const revision = await this.prisma.noteRevision.findFirst({ where: { ...scope, id: revisionId, noteId } });
    if (!revision) throw new NoteWriteError('not_found', 'That earlier version is no longer kept');
    // ⚠ ALWAYS keeps the text it replaces, whoever saved last: restoring over
    // your own latest edit must be undoable too, or "restore" is a delete.
    const data = prepareEdit(note, { title: revision.title, body: revision.body });
    return this.saveEdit(scope, actorId, note, data, { keepRevision: true });
  }

  // ── sharing ───────────────────────────────────────────────────────────────

  /** The author's alone. Unsharing takes the note from everybody else, their edits included. */
  async setVisibility(scope: NoteScope, actorId: string, noteId: string, visibility: string): Promise<NoteRow> {
    if (!isNoteVisibility(visibility)) throw refusalError('invalid_visibility');
    return this.act(scope, actorId, noteId, async (note) => {
      const refusal = checkShareNote(note, actorId);
      if (refusal) throw refusalError(refusal);
      if (note.visibility === visibility) return { note, change: null };
      // ⚠ `updatedById` is NOT moved: it names who wrote the text last, which is
      // what decides the next revision, and sharing writes no text.
      const saved = await this.writeIfUnchanged(scope, note, { visibility, version: { increment: 1 } });
      return { note: saved, change: visibility === 'workspace' ? 'shared' : 'unshared' };
    });
  }

  // ── the trash ─────────────────────────────────────────────────────────────

  async trash(scope: NoteScope, actorId: string, noteId: string): Promise<NoteRow> {
    return this.binAct(scope, actorId, noteId, 'trash');
  }

  async restore(scope: NoteScope, actorId: string, noteId: string): Promise<NoteRow> {
    return this.binAct(scope, actorId, noteId, 'restore');
  }

  /** Only from the trash, and not undoable: revisions and pins go with it. */
  async deleteForever(scope: NoteScope, actorId: string, noteId: string): Promise<void> {
    await this.binAct(scope, actorId, noteId, 'delete_forever');
  }

  // ── the person's own rows ─────────────────────────────────────────────────

  /**
   * Pin or unpin for THIS person. A pin on a note later unshared is left in
   * place and never shown (see `NotePin`), so unpinning one you can no longer
   * see is a no-op — and answers `not_found`, like every other act on it.
   */
  async setPinned(scope: NoteScope, actorId: string, noteId: string, pinned: boolean): Promise<void> {
    const note = await this.find(scope, noteId);
    const refusal = checkPinNote(note, actorId);
    if (refusal) throw refusalError(refusal);

    if (!pinned) {
      await this.prisma.notePin.deleteMany({ where: { userId: actorId, noteId } });
      return;
    }
    await this.prisma.notePin.upsert({
      where: { userId_noteId: { userId: actorId, noteId } },
      create: { ...scope, userId: actorId, noteId },
      update: {},
    });
  }

  /**
   * Move a note to just after another in THIS person's list — or to the top
   * when `afterNoteId` is null. Nobody else's list moves.
   *
   * The whole list as the person sees it is written back (`moveInOrder`), so
   * once they have arranged it, every note has its place; ids of notes they can
   * no longer see are dropped on the way.
   *
   * ⚠ Both notes must be ones they can see — `not_found` otherwise, as every act
   * answers — and a note in the trash has no place in the live list.
   */
  async moveNote(scope: NoteScope, actorId: string, noteId: string, afterNoteId: string | null): Promise<void> {
    const note = await this.find(scope, noteId);
    const refusal = checkPinNote(note, actorId) ?? (note.trashedAt ? 'in_trash' : null);
    if (refusal) throw refusalError(refusal);
    if (afterNoteId !== null) {
      const after = await this.find(scope, afterNoteId);
      if (!canSeeNote(after, actorId)) throw noteNotFound();
    }

    const where = { userId_workspaceId: { userId: actorId, workspaceId: scope.workspaceId } };
    const [rows, preference] = await Promise.all([
      this.prisma.note.findMany({
        where: { ...scope, trashedAt: null, AND: [{ OR: [{ authorId: actorId }, { visibility: 'workspace' }] }] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: NOTE_ORDER_MAX,
        omit: { body: true },
      }),
      this.prisma.notePreference.findUnique({ where }),
    ]);
    const current = orderNotes(rows, preference?.noteOrder ?? []).map((row) => row.id);
    const noteOrder = moveInOrder(current, noteId, afterNoteId);
    await this.prisma.notePreference.upsert({
      where,
      create: { ...scope, userId: actorId, noteOrder },
      update: { noteOrder },
    });
  }

  /** The whole row is replaced, so all three settings are required. */
  async setSettings(
    scope: NoteScope,
    actorId: string,
    input: Partial<Record<keyof NoteSettings, unknown>>,
  ): Promise<NoteSettings> {
    if (noteSettingsRefusal(input)) throw refusalError('invalid_settings');
    const settings = normalizeNoteSettings(input);
    const row = await this.prisma.notePreference.upsert({
      where: { userId_workspaceId: { userId: actorId, workspaceId: scope.workspaceId } },
      create: { ...scope, userId: actorId, ...settings },
      update: { ...settings },
    });
    return normalizeNoteSettings(row);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * ⚠ BY ID AND SCOPE, and `not_found` for a note that is missing or in another
   * workspace — the domain adds "somebody else's private note" to the same
   * answer. Nothing else in this service looks a note up.
   */
  private async find(scope: NoteScope, noteId: string, tx: NoteTransaction = this.prisma): Promise<NoteRow> {
    const note = await tx.note.findFirst({ where: { ...scope, id: noteId } });
    if (!note) throw noteNotFound();
    return note;
  }

  /**
   * Land an edit decided against `note.version`, keeping a revision when the
   * text being replaced is somebody else's shared work.
   */
  private async saveEdit(
    scope: NoteScope,
    actorId: string,
    note: NoteRow,
    data: NoteUpdate | null,
    options: { keepRevision?: boolean } = {},
  ): Promise<NoteRow> {
    // Nothing changed: no version bump, no event, no revision.
    if (!data) return note;
    const textChanges = data.title !== undefined || data.body !== undefined;

    let saved: NoteRow;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const keep = options.keepRevision ? note.visibility === 'workspace' : shouldKeepRevision(note, actorId);
        if (textChanges && keep) {
          await tx.noteRevision.create({
            data: { ...scope, noteId: note.id, title: note.title, body: note.body, editedById: note.updatedById },
          });
          await trimRevisions(tx, note.id);
        }
        const moved = await tx.note.updateMany({
          where: { ...scope, id: note.id, version: note.version },
          data: { ...data, ...(textChanges ? { updatedById: actorId } : {}) },
        });
        if (moved.count === 0) throw new LostRace();
        return this.find(scope, note.id, tx);
      });
    } catch (error) {
      // Somebody saved between our read and our write. Their save stands; so
      // does the rule that nobody overwrites what they have not seen.
      if (error instanceof LostRace) throw refusalError('conflict');
      throw error;
    }

    await this.events.noteChanged(saved, 'updated', actorId);
    return saved;
  }

  /**
   * Trash, restore or delete forever: the domain's plan, the host's answer on
   * `note:manage_all` when the plan needs it, then a conditional write.
   */
  private async binAct(scope: NoteScope, actorId: string, noteId: string, act: NoteBinAct): Promise<NoteRow> {
    return this.act(scope, actorId, noteId, async (note) => {
      const plan = planNoteBinAct(note, actorId, act);
      switch (plan.kind) {
        case 'refused':
          throw refusalError(plan.reason);
        case 'needs_manage_all': {
          // ⚠ Unbound means no — fail closed. Only ever asked about a SHARED
          // note the actor can already see, so the answer reveals nothing.
          const allowed =
            (await this.access?.holdsManageAll(scope.organizationId, scope.workspaceId, actorId)) ?? false;
          if (!allowed) throw refusalError('not_permitted');
          break;
        }
        case 'allowed':
          break;
      }

      if (act === 'delete_forever') {
        const gone = await this.prisma.note.deleteMany({ where: { ...scope, id: note.id, version: note.version } });
        if (gone.count === 0) throw new LostRace();
        return { note, change: 'deleted' };
      }
      const saved = await this.writeIfUnchanged(scope, note, {
        trashedAt: act === 'trash' ? new Date() : null,
        version: { increment: 1 },
      });
      return { note: saved, change: act === 'trash' ? 'trashed' : 'restored' };
    });
  }

  /**
   * Run a decision against a fresh read, and run it again if the note moved
   * before the write — up to `NOTE_ACT_ATTEMPTS`. Publishes after it lands.
   */
  private async act(
    scope: NoteScope,
    actorId: string,
    noteId: string,
    decide: (note: NoteRow) => Promise<{ note: NoteRow; change: NoteChange | null }>,
  ): Promise<NoteRow> {
    for (let attempt = 1; attempt <= NOTE_ACT_ATTEMPTS; attempt += 1) {
      const note = await this.find(scope, noteId);
      try {
        const outcome = await decide(note);
        if (outcome.change) await this.events.noteChanged(outcome.note, outcome.change, actorId);
        return outcome.note;
      } catch (error) {
        if (!(error instanceof LostRace)) throw error;
      }
    }
    throw new NoteWriteError('conflict', 'That note kept changing — try again in a moment');
  }

  private async writeIfUnchanged(scope: NoteScope, note: NoteRow, data: NoteUpdate): Promise<NoteRow> {
    const moved = await this.prisma.note.updateMany({ where: { ...scope, id: note.id, version: note.version }, data });
    if (moved.count === 0) throw new LostRace();
    return this.find(scope, note.id);
  }

  private async defaultColor(scope: NoteScope, actorId: string): Promise<string> {
    const row = await this.prisma.notePreference.findUnique({
      where: { userId_workspaceId: { userId: actorId, workspaceId: scope.workspaceId } },
    });
    return normalizeNoteSettings(row).defaultColor;
  }

  /**
   * ⚠ UNBOUND IS THE DECLARED DEFAULT, not module-kit's `NULL_LIMIT_CHECKER`,
   * which allows everything. An unset cap is a floor, never unlimited.
   */
  private async checkCap(scope: NoteScope, actorId: string, current: number): Promise<LimitDecision> {
    if (this.limits) {
      return this.limits.check({ actorId, key: NOTE_LIMIT.notes, current, ...scope });
    }
    const cap = NOTE_LIMIT_REGISTRY.find((spec) => spec.key === NOTE_LIMIT.notes)?.defaultValue ?? 0;
    return { allowed: current < cap, limit: cap, current, remaining: Math.max(cap - current, 0) };
  }
}

/**
 * The patch a save writes, or null when it changes nothing.
 *
 * ⚠ A field that normalises to what is already stored is NOT a change: an
 * autosave of unchanged text must not bump the version, or it would conflict
 * with somebody else's real edit for no reason.
 */
function prepareEdit(note: NoteRow, input: EditNoteInput): NoteUpdate | null {
  const data: NoteUpdate = { version: { increment: 1 } };
  let changed = false;

  if (input.title != null) {
    const { title } = unwrap(prepareNoteTitle(input.title));
    if (title !== note.title) {
      data.title = title;
      changed = true;
    }
  }
  if (input.body != null) {
    const { body } = unwrap(prepareNoteBody(input.body));
    if (body !== note.body) {
      data.body = body;
      data.preview = notePreview(body);
      changed = true;
    }
  }
  if (input.color != null) {
    if (!isNoteColor(input.color)) throw refusalError('invalid_color');
    if (input.color !== note.color) {
      data.color = input.color;
      changed = true;
    }
  }
  if (input.tags != null) {
    const { tags } = unwrap(prepareNoteTags(input.tags));
    if (tags.join('\n') !== note.tags.join('\n')) {
      data.tags = [...tags];
      changed = true;
    }
  }
  return changed ? data : null;
}

/** Drop everything past the newest `NOTE_REVISIONS_KEPT`, in the save's transaction. */
async function trimRevisions(tx: NoteTransaction, noteId: string): Promise<void> {
  const stale = await tx.noteRevision.findMany({
    where: { noteId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: NOTE_REVISIONS_KEPT,
  });
  if (stale.length > 0) await tx.noteRevision.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
}

function isRefused(result: object): result is { refused: NoteRefusal } {
  return 'refused' in result;
}

/** A `prepare*` result as its value, or its refusal thrown with that refusal's message. */
function unwrap<T extends object>(result: T | { refused: NoteRefusal }): T {
  if (isRefused(result)) throw refusalError(result.refused);
  return result;
}

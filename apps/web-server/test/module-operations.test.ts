import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_OPERATIONS } from '@kwtech/module-chat';
import { QUEUE_OPERATIONS } from '@kwtech/module-queuing-window';
import { buildSchema, type GraphQLSchema, parse, validate } from 'graphql';

/**
 * ⚠ EVERY DOCUMENT A MODULE SENDS MUST BE ONE THIS APP'S SCHEMA ANSWERS.
 *
 * A GraphQL document is the one part of a typed client that nothing typechecks.
 * The TypeScript compiler sees a template literal; the schema is emitted from
 * Nest decorators on the other side of a package boundary. Between them a
 * renamed field, a moved argument or a nullability change is not a build error
 * anywhere — it is a refusal at runtime, on a screen, found by whoever opens
 * that screen first.
 *
 * So the app validates its modules' operations against its own schema, with
 * `graphql`'s own validator rather than a hand-rolled comparison. This is the
 * CODE-FIRST counterpart of the codegen the frontend does (PLAN §6): the schema
 * is generated from the resolvers, and this is what keeps a hand-written client
 * honest about it.
 *
 * ## Why here, and not in `module-chat`
 *
 * Because the schema is the APP's. A module cannot know which other modules a
 * host composed, what the app renamed, or whether its operations were even
 * mounted — `chatWebModule({ enabled: false })` is a real configuration. The
 * question "does my schema answer what my modules ask" has exactly one place it
 * can be asked, and this is it.
 *
 * ## Adding the next module
 *
 * One line in `MODULE_OPERATIONS` below. The module exports its documents from
 * its framework-free root, as `module-chat` does — deliberately not from a
 * `/react` barrel, so validating a string never means resolving React.
 */

const SCHEMA_PATH = join(__dirname, '..', 'schema.graphql');

/**
 * Read from the EMITTED file rather than built by booting Nest.
 *
 * `autoSchemaFile` writes it at boot and it is committed, so this asserts
 * against the artefact the frontend's codegen reads and the one a reviewer sees
 * in a diff. Booting the app here would test a schema nobody else consumes —
 * and would need a database.
 */
let schema: GraphQLSchema;
beforeAll(() => {
  schema = buildSchema(readFileSync(SCHEMA_PATH, 'utf8'));
});

const MODULE_OPERATIONS: Record<string, Record<string, string>> = {
  chat: CHAT_OPERATIONS,
  queue: QUEUE_OPERATIONS,
};

describe('every module operation validates against the composed schema', () => {
  const cases = Object.entries(MODULE_OPERATIONS).flatMap(([module, operations]) =>
    Object.entries(operations).map(([name, document]) => [`${module}: ${name}`, document] as const),
  );

  it('has operations to check — a suite that found none would pass silently', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases)('%s', (_name, document) => {
    /*
     * Two failures, and they are worth telling apart: `parse` catches a
     * malformed document, `validate` catches one that is well-formed and asks
     * for something the schema does not have — a field that was renamed, an
     * argument that moved, a variable typed differently from the argument it
     * feeds.
     */
    const errors = validate(schema, parse(document));
    expect(errors.map((error) => error.message)).toEqual([]);
  });
});

describe('the schema still answers what the chat client depends on', () => {
  /**
   * A handful of named assertions beside the blanket one above, for the fields
   * whose ABSENCE would not be caught by validating a document — because a
   * client that stopped asking for them would validate perfectly and break the
   * screen.
   */
  it('⚠ a conversation says who is asking', () => {
    // Every message carries an `authorId` and nothing else says which of them
    // is yours. Without this the thread cannot align its own messages.
    expect(CHAT_OPERATIONS.chatConversations).toContain('myUserId');
  });

  it('⚠ the subscription takes a cursor to replay from', () => {
    // The socket closes when its authorization expires and the pub/sub has no
    // replay, so this argument is the whole of what stops a reconnection losing
    // mail.
    expect(CHAT_OPERATIONS.chatEvents).toContain('$since');
  });

  it('⚠ a send carries the id the server is idempotent on', () => {
    // Optimistic insert plus a flaky network plus a retry is two identical
    // messages without it.
    expect(CHAT_OPERATIONS.sendChatMessage).toContain('clientMessageId');
  });
});

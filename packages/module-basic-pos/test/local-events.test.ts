import { POS_OPERATIONS } from '../src/operations.js';
import type { PosEventView } from '../src/react/pos-client.js';
import { announcePosWrite, isPosWrite, onPosWrite, POS_WRITE_ECHOES } from '../src/react/pos-local-events.js';
import { OTHER_STORE, SCOPE } from './harness.js';

describe('POS_WRITE_ECHOES — every write refreshes the screens beside it (#50)', () => {
  const mutations = Object.entries(POS_OPERATIONS)
    .filter(([, document]) => document.trimStart().startsWith('mutation'))
    .map(([name]) => name);

  it('⚠ lists every mutation, so a new write cannot silently leave other tabs stale', () => {
    expect(mutations.filter((name) => !isPosWrite(name))).toEqual([]);
  });

  it('lists nothing that is not a mutation', () => {
    expect(Object.keys(POS_WRITE_ECHOES).filter((name) => !mutations.includes(name))).toEqual([]);
  });

  it('announces what the server publishes for the same write', () => {
    expect(POS_WRITE_ECHOES.savePosReferenceOptions).toEqual(['settings']);
    expect(POS_WRITE_ECHOES.holdPosOrder).toEqual(['order']);
    expect(POS_WRITE_ECHOES.importPosSetup).toEqual(['catalogue', 'settings']);
  });
});

describe('announcePosWrite / onPosWrite', () => {
  it('tells this page’s screens in the same store, with the order it answered', () => {
    const heard: PosEventView[] = [];
    const stop = onPosWrite(SCOPE, (event) => heard.push(event));
    announcePosWrite(SCOPE, 'holdPosOrder', 'order-1');
    announcePosWrite(SCOPE, 'savePosReferenceOptions', null);
    stop();
    expect(heard).toEqual([
      { kind: 'order', orderId: 'order-1', actorId: null },
      { kind: 'settings', orderId: null, actorId: null },
    ]);
  });

  it('⚠ never tells a screen of another store open on the same Apps page', () => {
    const heard: PosEventView[] = [];
    const stop = onPosWrite(OTHER_STORE, (event) => heard.push(event));
    announcePosWrite(SCOPE, 'savePosItem', null);
    stop();
    expect(heard).toEqual([]);
  });

  it('stops telling a screen that has gone', () => {
    const heard: PosEventView[] = [];
    onPosWrite(SCOPE, (event) => heard.push(event))();
    announcePosWrite(SCOPE, 'savePosItem', null);
    expect(heard).toEqual([]);
  });

  it('a screen that throws does not stop the next one hearing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const heard: PosEventView[] = [];
    const stopBroken = onPosWrite(SCOPE, () => {
      throw new Error('broken screen');
    });
    const stop = onPosWrite(SCOPE, (event) => heard.push(event));
    announcePosWrite(SCOPE, 'savePosCustomer', null);
    stopBroken();
    stop();
    warn.mockRestore();
    expect(heard.map((event) => event.kind)).toEqual(['customers']);
  });
});

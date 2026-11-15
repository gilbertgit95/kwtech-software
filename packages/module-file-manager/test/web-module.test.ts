import { FILE_FEATURE } from '../src/feature-keys.js';
import { fileMobileModule } from '../src/mobile/module.js';
import { fileWebModule } from '../src/react/module.js';

describe('the files web descriptor', () => {
  it('is a sub-app on the Apps page, with no route and no drawer entry', () => {
    const descriptor = fileWebModule();
    expect(descriptor.key).toBe('file');
    expect(descriptor.routes ?? []).toEqual([]);
    expect(descriptor.apps?.map((app) => [app.key, app.feature])).toEqual([['file', FILE_FEATURE.read]]);
  });

  it('offers the same app on phones, behind the same key', () => {
    expect(fileMobileModule().screens?.map((screen) => [screen.key, screen.feature])).toEqual([
      ['file', FILE_FEATURE.read],
    ]);
  });
});

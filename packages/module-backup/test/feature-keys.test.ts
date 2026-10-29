import { BACKUP_FEATURE, BACKUP_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { BACKUP_PROCESS_REGISTRY } from '../src/processes.js';

describe('the backup registry', () => {
  it('declares every key once, app level, in this module', () => {
    expect(BACKUP_FEATURE_REGISTRY.map((spec) => spec.key).sort()).toEqual(Object.values(BACKUP_FEATURE).sort());
    for (const spec of BACKUP_FEATURE_REGISTRY) {
      expect([spec.key, spec.module, spec.level]).toEqual([spec.key, 'backup', 'app']);
      expect(spec.key).toMatch(/^backup:[a-z_]+$/u);
    }
  });

  it('⚠ marks what takes data away or replaces it as privileged', () => {
    const privileged = BACKUP_FEATURE_REGISTRY.filter((spec) => spec.isPrivileged).map((spec) => spec.key);
    expect(privileged.sort()).toEqual([BACKUP_FEATURE.delete, BACKUP_FEATURE.download, BACKUP_FEATURE.restore].sort());
  });

  it('runs the daily backup at 21:00 every day by default, and only ever daily', () => {
    const [daily] = BACKUP_PROCESS_REGISTRY;
    expect(daily?.defaultSchedule).toEqual({ kind: 'daily', times: ['21:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(daily?.scheduleLimits.kinds).toEqual(['daily']);
    expect(daily?.serves).toBeNull();
  });
});

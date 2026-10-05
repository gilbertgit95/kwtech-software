import type { StudioKeymap } from '../domain/keymap.js';
import type { StudioClient, StudioScopeView } from './studio-client.js';

/** What every section of the studio is handed: where it is, how to reach the API, and what the viewer may do. */
export interface StudioAppState {
  scope: StudioScopeView;
  client: StudioClient;
  /** The workspace's time zone: every day and time in the history follows it. */
  timeZone: string;
  /** The workspace's shortcut keys: the defaults until its settings are read, and when it has none of its own. */
  keymap: StudioKeymap;
  can: {
    /** `studio:write`: keep layouts of their own. */
    write: boolean;
    /** `studio:manage_all`: change other people's shared layouts, read everybody's history. */
    manageAll: boolean;
    /** `studio:manage_settings`: change the workspace's shortcut keys. */
    manageSettings: boolean;
  };
}

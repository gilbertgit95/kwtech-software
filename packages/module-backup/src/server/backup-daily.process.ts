import type { ProcessHandler, ProcessRunContext, ProcessRunResult } from '@kwtech/module-kit';
import { Injectable } from '@nestjs/common';
import { BackupService } from './backup.service.js';

/** `backup.daily`: the evening's backup. The decisions are `BackupService.runDaily`; this joins it to the runner. */
@Injectable()
export class BackupDailyProcess implements ProcessHandler {
  constructor(private readonly backups: BackupService) {}

  run(context: ProcessRunContext): Promise<ProcessRunResult> {
    return this.backups.runDaily(context);
  }
}

/**
 * The shapes the domain decides over. Plain data, no framework, so the server
 * half, the web half and the print agent hold the same rules.
 */

/**
 * What the spooler says about a printer.
 *
 * ⚠ NONE OF THESE MEANS PAPER WILL COME OUT. `ready` is "the operating system
 * will accept a job", which a printer with no paper also reports.
 */
export type PrintPrinterStatus = 'ready' | 'offline' | 'error' | 'unknown';

/**
 * A paper a printer can take, with how far in from each edge it can print.
 * Every length is a whole number of hundredths of a millimetre.
 */
export interface PrintPaper {
  name: string;
  /** As the driver reports it: portrait for nearly every paper, but not turned by this module. */
  width: number;
  height: number;
  /**
   * The unprintable strip at each edge, or null where the driver did not say.
   * ⚠ Null is "unknown", never "borderless": a caller treats it as it would a
   * printer it knows nothing about.
   */
  margins: PrintMargins | null;
}

export interface PrintMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** One choice of a printer setting. `id` is the driver's own word for it, and what a job names. */
export interface PrintSettingOption {
  id: string;
  /** What the driver calls it for a person: "Epson Premium Glossy", "High". */
  label: string;
}

/**
 * What a job may choose on a printer besides its paper: the KIND of paper in
 * the tray, and how carefully to print.
 *
 * ⚠ AN EMPTY LIST IS "the driver did not say", and a job then leaves that
 * setting alone. The lists are the driver's, never a fixed vocabulary: one
 * printer's "High" is not another's.
 */
export interface PrintPrinterSettings {
  /** Plain, matte, glossy… as this driver names them. */
  mediaTypes: PrintSettingOption[];
  /** The printer's own current choice, one of `mediaTypes`, or null when it is not known. */
  mediaType: string | null;
  /** Draft, standard, high… as this driver names them. */
  qualities: PrintSettingOption[];
  quality: string | null;
}

/** One printer, as a computer reports it. */
export interface PrintReportedPrinter {
  name: string;
  driver: string;
  isDefault: boolean;
  status: PrintPrinterStatus;
  papers: PrintPaper[];
  settings: PrintPrinterSettings;
}

/**
 * Why a printing operation was refused. One union for the module, carried by
 * its one error class at the service boundary.
 *
 * ⚠ `not_found` ALSO MEANS "a computer in another workspace". Answering those
 * differently would let anyone probe ids across tenants.
 */
export type PrintRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'limit_reached'
  | 'invalid_name'
  | 'invalid_printers'
  | 'agent_revoked'
  | 'printer_gone'
  | 'agent_offline'
  | 'invalid_job'
  | 'job_too_large'
  | 'agent_busy'
  | 'job_not_found';

/**
 * Where a print job is.
 *
 *   waiting    opened; the browser and the computer have not both arrived
 *   sending    the file is passing from one to the other
 *   printing   the computer holds all of it and is handing it to the printer
 *   printed    the computer's operating system accepted it
 *   failed     see `PrintJobFailure`
 *
 * ⚠ `printed` IS NOT "PAPER CAME OUT". It is the spooler taking the job, which
 * a printer with no paper also allows (PLAN §12.105).
 */
export type PrintJobStatus = 'waiting' | 'sending' | 'printing' | 'printed' | 'failed';

/** Why a job failed. `jobFailureText` (`domain/jobs.ts`) has the sentence for each. */
export type PrintJobFailure =
  | 'agent_did_not_fetch'
  | 'nothing_sent'
  | 'not_a_pdf'
  | 'wrong_size'
  | 'interrupted'
  | 'printer_refused'
  | 'timed_out';

/** A job as the computer is told of it. JSON-safe. */
export interface PrintAgentJob {
  jobId: string;
  /** The queue's name on that computer. */
  printerName: string;
  /** Null: whatever the printer is set to. */
  paper: PrintPaper | null;
  copies: number;
  /** The file's exact length in bytes; a fetch that ends short is not the file. */
  size: number;
  /** One of that printer's `mediaTypes`, by id. Null: as the printer is set. */
  mediaType: string | null;
  /** One of that printer's `qualities`, by id. Null: as the printer is set. */
  quality: string | null;
}

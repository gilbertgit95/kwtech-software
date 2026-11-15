import type { PrintPaper, PrintReportedPrinter } from '@kwtech/module-print';

/**
 * How the agent learns what this computer can print on. One small interface,
 * so everything above it — pairing, the socket, reporting — runs and is tested
 * where there is no printer at all.
 */
/** One file to put on paper. */
export interface PrintRequest {
  /** A PDF on this computer's disk. The caller deletes it afterwards, whatever happens. */
  file: string;
  /** The queue's name in the operating system. */
  printerName: string;
  /** One of the papers this printer reported. Null: whatever the printer is set to. */
  paper: PrintPaper | null;
  copies: number;
  /** One of the paper types this printer reported, by id. Left out or null: as the printer is set. */
  mediaType?: string | null;
  /** One of the qualities this printer reported, by id. Left out or null: as the printer is set. */
  quality?: string | null;
}

/**
 * A receipt's bytes to send to a printer AS THEY ARE (#144): ESC/POS from
 * `encodeReceipt`, which the printer reads itself. Nothing opens or renders
 * them on this computer.
 */
export interface RawPrintRequest {
  /** The bytes, on this computer's disk. The caller deletes the file afterwards, whatever happens. */
  file: string;
  printerName: string;
  copies: number;
}

export interface PrinterDriver {
  /** Every printer the system has installed, minus the excluded ones, with its papers. */
  list(): Promise<PrintReportedPrinter[]>;
  /**
   * Hand a file to a printer, at actual size. Resolves when the operating
   * system has TAKEN it — ⚠ which is not paper coming out — and throws, with
   * a sentence a person can read, when it would not.
   */
  print(request: PrintRequest): Promise<void>;
  /**
   * Hand a receipt's bytes to a printer unchanged. Resolves when the printer
   * (or its queue) has taken them, and throws, with a sentence a person can
   * read, when it would not.
   */
  printRaw(request: RawPrintRequest): Promise<void>;
}

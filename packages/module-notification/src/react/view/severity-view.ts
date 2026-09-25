/**
 * How each severity LOOKS. Theme tokens only — the status colours flip with the
 * theme, so no raw palette colour appears here.
 */

export type SeverityIcon = 'info' | 'success' | 'warning' | 'alert';

export interface SeverityLook {
  label: string;
  icon: SeverityIcon;
  /** The coloured chip behind the icon. */
  chip: string;
  /** The toast's accent border. */
  border: string;
}

export function severityLook(severity: string): SeverityLook {
  switch (severity) {
    case 'success':
      return {
        label: 'Success',
        icon: 'success',
        chip: 'bg-status-success text-status-success-foreground',
        border: 'border-l-status-success-foreground',
      };
    case 'warning':
      return {
        label: 'Warning',
        icon: 'warning',
        chip: 'bg-status-warning text-status-warning-foreground',
        border: 'border-l-status-warning-foreground',
      };
    case 'alert':
      return {
        label: 'Alert',
        icon: 'alert',
        chip: 'bg-status-error text-status-error-foreground',
        border: 'border-l-status-error-foreground',
      };
    default:
      // 'info', and anything a newer server sends that this build does not know:
      // drawn as the quietest kind rather than as nothing.
      return {
        label: 'Info',
        icon: 'info',
        chip: 'bg-status-info text-status-info-foreground',
        border: 'border-l-status-info-foreground',
      };
  }
}

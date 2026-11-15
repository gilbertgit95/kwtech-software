'use client';

import { cn } from '@kwtech/web-ui/react';
import {
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Film,
  Image,
  type LucideIcon,
  Music,
  Presentation,
} from 'lucide-react';
import { type FileKind, fileKindOf } from '../view/files-view.js';

/**
 * The tile beside a file's name: its kind at a glance. Theme tokens only, so
 * every theme and dark mode tint it; the name and size still say what it is,
 * so the colour is never the only cue.
 */
const KIND_STYLE: Readonly<Record<FileKind, { icon: LucideIcon; tone: string }>> = {
  image: { icon: Image, tone: 'bg-status-success text-status-success-foreground' },
  video: { icon: Film, tone: 'bg-status-info text-status-info-foreground' },
  audio: { icon: Music, tone: 'bg-status-warning text-status-warning-foreground' },
  pdf: { icon: FileText, tone: 'bg-status-error text-status-error-foreground' },
  document: { icon: FileText, tone: 'bg-primary/15 text-primary' },
  sheet: { icon: FileSpreadsheet, tone: 'bg-status-success text-status-success-foreground' },
  slides: { icon: Presentation, tone: 'bg-status-warning text-status-warning-foreground' },
  archive: { icon: FileArchive, tone: 'bg-secondary text-secondary-foreground' },
  other: { icon: File, tone: 'bg-muted text-muted-foreground' },
};

export function FileKindIcon({
  contentType,
  name,
  size = 'md',
}: {
  contentType: string;
  name: string;
  size?: 'md' | 'lg';
}) {
  const { icon: Icon, tone } = KIND_STYLE[fileKindOf(contentType, name)];
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center',
        size === 'lg' ? 'size-12 rounded-2xl' : 'size-10 rounded-xl',
        tone,
      )}
    >
      <Icon className={size === 'lg' ? 'size-6' : 'size-5'} />
    </span>
  );
}

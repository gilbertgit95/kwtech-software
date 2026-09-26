import { cn } from '@kwtech/web-ui/react';
import type { CSSProperties } from 'react';

/**
 * The product's logo, drawn in whatever colour the THEME says.
 *
 * ## Why a mask, and not an <img>
 *
 * The artwork is a single colour of ink with its details (the face, the
 * laptop) cut out of it. As a plain image it can only be one colour, and it was
 * drawn light-on-dark — dropped onto the light theme it vanishes, and a second
 * "dark" file would mean two copies to keep in step and a flash of the wrong one
 * before next-themes has run.
 *
 * So `public/brand/*.png` are ALPHA MASKS: white ink on transparency, generated
 * from the source artwork. This component paints a box in a theme token
 * (`bg-foreground` by default) and lets the mask cut the logo out of it. The
 * colour then comes from the same CSS variables as the text beside it, so it
 * follows light/dark AND every palette with no JavaScript, and is correct on the
 * very first paint. The cut-outs show whatever is behind the logo, which is
 * what they are meant to be.
 *
 * Pass a different `bg-*` token in `className` to recolour it — for example
 * `bg-primary-foreground` on a `bg-primary` square.
 *
 * ## Sizing
 *
 * Give it a HEIGHT (`h-8`); the width follows from `aspect-ratio`, which is the
 * artwork's own. A mask has no intrinsic size, so without one of the two the
 * box would collapse to nothing and the logo would silently not render.
 */
const VARIANTS = {
  /** The pen nib alone — for small places, where the wordmark would be illegible. */
  mark: { src: '/brand/logo-mark.png', aspect: '578 / 974' },
  /** The nib with "KWTECH SOFTWARE" under it. */
  full: { src: '/brand/logo-full.png', aspect: '626 / 1127' },
} as const;

export type BrandLogoVariant = keyof typeof VARIANTS;

export function BrandLogo({
  variant = 'mark',
  label,
  className,
}: {
  variant?: BrandLogoVariant;
  /**
   * Its accessible name. Omit it where the product name is already written
   * beside the logo: the logo is then decoration, and announcing it would read
   * the same name twice.
   */
  label?: string;
  className?: string;
}) {
  const { src, aspect } = VARIANTS[variant];
  const style: CSSProperties = {
    aspectRatio: aspect,
    maskImage: `url(${src})`,
    maskSize: 'contain',
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    // Safari still ships only the prefixed property for masks on some versions.
    WebkitMaskImage: `url(${src})`,
    WebkitMaskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
  };
  const classes = cn('inline-block shrink-0 bg-foreground', className);
  if (!label) return <span aria-hidden className={classes} style={style} />;
  return <span role="img" aria-label={label} className={classes} style={style} />;
}

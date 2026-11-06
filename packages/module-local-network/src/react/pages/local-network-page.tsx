'use client';

import { cn, QrCode } from '@kwtech/web-ui/react';
import { Copy, Download, LoaderCircle, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { LOCAL_NETWORK_CERTIFICATE_FILE } from '../../domain/addresses.js';
import { LOCAL_NETWORK_API_OFF_MESSAGE } from '../../domain/messages.js';
import type { LocalNetworkCertificateView, LocalNetworkView } from '../../types.js';
import type { LocalNetworkClient } from '../local-network-client.js';
import { useLocalNetwork } from '../use-local-network.js';
import { DEVICE_FINGERPRINT_STEPS, fingerprintsShown, formatExpiry } from '../view/local-network-view.js';

export interface LocalNetworkPageProps {
  client?: LocalNetworkClient;
  /**
   * The page's own protocol, `location.protocol` when absent. Injectable so a
   * test can render both sides of the fingerprint rule.
   */
  protocol?: string;
}

/**
 * Server → Local Network (#66): what a phone, tablet or computer on the shop's
 * Wi-Fi needs to reach this app — the local authority's certificate and the
 * server's address. It reads and changes nothing (decision L10).
 *
 * Times are in the viewer's own zone: this is a page outside any workspace.
 */
export function LocalNetworkPage({ client, protocol }: LocalNetworkPageProps = {}) {
  const state = useLocalNetwork(client ? { client } : {});
  const answer = state.answer;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Local Network</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect phones, tablets and computers on the shop’s Wi-Fi to this app: install the certificate once on each
            device, then open the address.
          </p>
        </div>
        <button
          type="button"
          className={buttonClass('secondary')}
          disabled={state.busy}
          onClick={() => void state.reload()}
        >
          {state.busy ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="size-4" />
          )}
          Check again
        </button>
      </header>

      {state.error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{state.error}</span>
          <button type="button" className="shrink-0 font-medium underline" onClick={state.dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {answer === null && !state.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      ) : null}

      {answer?.kind === 'api_off' ? <NotSetUp message={LOCAL_NETWORK_API_OFF_MESSAGE} /> : null}
      {answer?.kind === 'view' ? (
        <LocalNetworkSections view={answer.view} protocol={protocol ?? window.location.protocol} />
      ) : null}
    </div>
  );
}

export interface LocalNetworkSectionsProps {
  view: LocalNetworkView;
  /** The page's protocol (`location.protocol`): it decides whether the fingerprints are shown. */
  protocol: string;
}

/**
 * The whole page once the API has answered: either why nothing is shown, or
 * everything. Exported apart from the page, which loads, so each state can be
 * rendered from a fixed view (test/page.test.tsx).
 */
export function LocalNetworkSections({ view, protocol }: LocalNetworkSectionsProps) {
  // ⚠ All three or nothing: a page that shows an address without its certificate, or the reverse, is half a setup.
  if (view.state !== 'ready' || !view.certificate || !view.appUrl || !view.certificateUrl) {
    return <NotSetUp message={view.problem ?? 'Local HTTPS is not set up on this computer.'} />;
  }
  return (
    <>
      <CertificateSection certificate={view.certificate} protocol={protocol} />
      <AddressSection appUrl={view.appUrl} certificateUrl={view.certificateUrl} />
      <section className="rounded-lg border border-border p-4 text-sm">
        <h2 className="text-base font-semibold">This computer</h2>
        <p className="mt-1 text-muted-foreground">
          The server itself opens <Code>https://localhost</Code>, not its network address (it cannot reach that from
          itself) and not <Code>http://localhost:8081</Code>, where live updates cannot connect.
        </p>
      </section>
    </>
  );
}

function NotSetUp({ message }: { message: string }) {
  return (
    <section
      role="status"
      className="flex items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning/5 p-4 text-sm"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
      <div>
        <h2 className="font-semibold">Not set up</h2>
        <p className="mt-1">{message}</p>
      </div>
    </section>
  );
}

function CertificateSection({ certificate, protocol }: { certificate: LocalNetworkCertificateView; protocol: string }) {
  function download() {
    // The PEM the API re-encoded from the parsed certificate, saved under the name Caddy serves it as.
    const url = URL.createObjectURL(new Blob([certificate.pem], { type: 'application/x-x509-ca-cert' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = LOCAL_NETWORK_CERTIFICATE_FILE;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">The certificate</h2>
          <p className="mt-1 text-muted-foreground">
            Installed and trusted on a device, it lets that device open this app over HTTPS with no warning, and live
            updates work.
          </p>
        </div>
        <button type="button" className={buttonClass('primary')} onClick={download}>
          <Download aria-hidden="true" className="size-4" />
          Download certificate
        </button>
      </div>

      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Names</dt>
        <dd className="break-words">{certificate.subject}</dd>
        <dt className="text-muted-foreground">Valid until</dt>
        <dd>{formatExpiry(certificate.expiresAt)}</dd>
      </dl>

      <div className="flex items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning/5 p-3">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
        <p>
          A device that trusts this certificate trusts <strong>any</strong> site this shop’s authority signs: it has no
          name limits and is valid until {formatExpiry(certificate.expiresAt)}. Install it only on the shop’s own
          devices, never a customer’s.
        </p>
      </div>

      <Fingerprints certificate={certificate} protocol={protocol} />
    </section>
  );
}

function Fingerprints({ certificate, protocol }: { certificate: LocalNetworkCertificateView; protocol: string }) {
  if (!fingerprintsShown(protocol)) {
    return (
      <div className="rounded-lg bg-muted p-3">
        <h3 className="font-semibold">Fingerprints</h3>
        <p className="mt-1 text-muted-foreground">
          Not shown on a page opened over <Code>http://</Code>: anyone on the same Wi-Fi could change it, and the
          fingerprint with it. Open this page on the server’s own <Code>https://localhost</Code>, or on a device that
          already trusts the certificate, to compare them.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">Fingerprints</h3>
        <p className="mt-1 text-muted-foreground">
          ⚠ Compare only if this page opened with <strong>no</strong> certificate warning: the server’s own{' '}
          <Code>https://localhost</Code> once its browser is registered, or a device that already trusts the
          certificate. A page that warned could show any fingerprint. Trust the certificate on a device only when its
          fingerprint matches this one character for character.
        </p>
      </div>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">SHA-256</dt>
        <dd className="break-all font-mono text-xs">{certificate.sha256}</dd>
        <dt className="text-muted-foreground">SHA-1</dt>
        <dd className="break-all font-mono text-xs">{certificate.sha1}</dd>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-xs">
          <caption className="mb-1 text-left text-sm text-muted-foreground">
            Where each device shows it, and when to compare. Menu names differ between versions.
          </caption>
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Device
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Shows
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Where
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Compare
              </th>
            </tr>
          </thead>
          <tbody>
            {DEVICE_FINGERPRINT_STEPS.map((step) => (
              <tr key={step.device} className="border-b border-border align-top last:border-0">
                <th scope="row" className="py-1.5 pr-3 font-medium">
                  {step.device}
                </th>
                <td className="py-1.5 pr-3">{step.fingerprint}</td>
                <td className="py-1.5 pr-3">{step.where}</td>
                <td className="py-1.5">{step.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddressSection({ appUrl, certificateUrl }: { appUrl: string; certificateUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied('Copied.');
    } catch {
      // The clipboard needs a secure page and the person's permission; the address is on screen either way.
      setCopied('Could not copy. Select the address and copy it.');
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4 text-sm">
      <div>
        <h2 className="text-base font-semibold">The address</h2>
        <p className="mt-1 text-muted-foreground">
          What a device on the shop’s Wi-Fi opens once it trusts the certificate.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Code className="text-base">{appUrl}</Code>
        <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => void copy()}>
          <Copy aria-hidden="true" className="size-3.5" />
          Copy
        </button>
        {copied ? (
          <span role="status" className="text-muted-foreground">
            {copied}
          </span>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <figure className="flex flex-col items-center gap-2 text-center">
          <QrCode value={certificateUrl} label={`QR code for ${certificateUrl}`} />
          <figcaption>
            <span className="font-medium">1. A new device: the certificate</span>
            <br />
            <Code>{certificateUrl}</Code>
          </figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-2 text-center">
          <QrCode value={appUrl} label={`QR code for ${appUrl}`} />
          <figcaption>
            <span className="font-medium">2. Once it is trusted: the app</span>
            <br />
            <Code>{appUrl}</Code>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function Code({ children, className }: { children: string; className?: string }) {
  return (
    <code className={cn('break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs', className)}>{children}</code>
  );
}

type ButtonVariant = 'primary' | 'secondary';

function buttonClass(variant: ButtonVariant, size: 'sm' | 'md' = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-background text-foreground shadow-sm hover:bg-muted',
  );
}

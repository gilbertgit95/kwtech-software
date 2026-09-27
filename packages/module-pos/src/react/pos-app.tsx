'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useState } from 'react';

/**
 * ⚠ SAMPLE DATA, NOT A CATALOGUE. The placeholder screen needs something to lay
 * out so the Apps page's tabs and grid can be tried with a realistic shape.
 * Nothing is read, sold or saved; this list goes when the point-of-sale API
 * lands. Prices are in cents so the placeholder does not teach float money.
 */
const SAMPLE_PRODUCTS = [
  { id: 'p1', name: 'Coffee', priceCents: 350 },
  { id: 'p2', name: 'Tea', priceCents: 300 },
  { id: 'p3', name: 'Sandwich', priceCents: 850 },
  { id: 'p4', name: 'Muffin', priceCents: 400 },
  { id: 'p5', name: 'Water', priceCents: 150 },
  { id: 'p6', name: 'Juice', priceCents: 450 },
] as const;

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The point of sale as a SUB-APP on the workspace's Apps page — a PLACEHOLDER.
 *
 * It exists so the Apps page and the module wiring can be tested end to end
 * with more than one app. The shape is the real contract all the same:
 *
 * - `@container`, and `@…:` variants rather than `sm:` / `lg:`, because a grid
 *   cell is narrow on a wide screen. The cart sits under the products when
 *   narrow and beside them when there is room.
 * - The cart is this component's own state, so it survives the app being moved
 *   to another cell — and it is lost on reload, which is fine for a placeholder.
 */
export function PosApp({ workspaceId }: AppProps) {
  const [cart, setCart] = useState<Record<string, number>>({});

  const lines = SAMPLE_PRODUCTS.filter((product) => (cart[product.id] ?? 0) > 0).map((product) => ({
    ...product,
    quantity: cart[product.id] ?? 0,
  }));
  const totalCents = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);

  function add(id: string) {
    setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }

  return (
    <div className="@container flex h-full w-full flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Point of sale</h1>
        <p className="text-xs text-muted-foreground">Coming soon — sample products, nothing is sold.</p>
      </header>

      <div className="grid gap-4 @2xl:grid-cols-[1fr_16rem]">
        <section aria-label="Products" className="grid grid-cols-2 gap-2 @md:grid-cols-3">
          {SAMPLE_PRODUCTS.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => add(product.id)}
              className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="text-sm font-medium">{product.name}</span>
              <span className="text-xs text-muted-foreground">{money(product.priceCents)}</span>
            </button>
          ))}
        </section>

        <section aria-labelledby="pos-cart-title" className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <h2 id="pos-cart-title" className="text-sm font-semibold">
            Cart
          </h2>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tap a product to add it.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {lines.map((line) => (
                <li key={line.id} className="flex justify-between gap-2">
                  <span>
                    {line.quantity} × {line.name}
                  </span>
                  <span>{money(line.priceCents * line.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
          <p role="status" className="mt-auto flex justify-between border-t border-border pt-2 text-sm font-semibold">
            <span>Total</span>
            <span>{money(totalCents)}</span>
          </p>
          <button
            type="button"
            onClick={() => setCart({})}
            disabled={lines.length === 0}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            Clear cart
          </button>
        </section>
      </div>

      <p className="text-xs text-muted-foreground">Workspace {workspaceId}</p>
    </div>
  );
}

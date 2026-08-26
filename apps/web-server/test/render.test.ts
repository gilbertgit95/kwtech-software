import { env } from '../src/config/env.js';
import { renderEmail } from '../src/mail/render.js';

/**
 * The template layer, and mostly one property of it.
 *
 * `displayName` is free text the account holder chooses — the schema is explicit
 * that it is a human name, not an identifier, so it is neither unique nor
 * normalised. Rendered unescaped it becomes live markup inside a genuine,
 * DKIM-signed password-reset email: a phishing primitive handed to anyone who
 * can edit their own profile. That was a real bug in the string-concatenated
 * version this replaced, which is why it is the first thing tested here.
 */

const URL = 'https://app.example.com/auth/reset-password?token=abc123_-XYZ';

const render = (displayName: string | null = 'Ada Lovelace') =>
  renderEmail('password-reset', { displayName, url: URL, expiresIn: 'one hour' });

describe('renderEmail — escaping', () => {
  it('ESCAPES a display name carrying markup', () => {
    const evil = render('<a href="https://evil.example">Reset here instead</a>');

    expect(evil.html).not.toContain('<a href="https://evil.example"');
    expect(evil.html).toContain('&lt;a href=&quot;https://evil.example&quot;');
  });

  it('leaves exactly ONE anchor in the message — the real button', () => {
    // The count is the assertion that matters: an injected link is only
    // dangerous because it sits beside a legitimate one in a trusted email.
    const evil = render('<a href="https://evil.example">click</a>');
    expect(evil.html.match(/<a href=/g)).toHaveLength(1);
  });

  it('escapes quotes, so a display name cannot break out of an attribute', () => {
    const evil = render('" onmouseover="alert(1)');
    expect(evil.html).not.toContain('onmouseover="alert(1)"');
  });

  it('does NOT escape the plain-text part — there is no markup to escape into', () => {
    // Escaping it is how text alternatives end up showing `&#39;` to a reader.
    const plain = render("Ada O'Brien & Co");
    expect(plain.text).toContain("Ada O'Brien & Co");
    expect(plain.text).not.toContain('&amp;');
    expect(plain.text).not.toContain('&#39;');
  });
});

describe('renderEmail — the message', () => {
  it('takes the subject from the .txt template, not from code', () => {
    // Built from env.MAIL_BRAND rather than asserted as a literal. The literal
    // version passed only because this machine's .env happens to say KWTech —
    // it would have failed the moment anyone renamed the product, which is a
    // test failing for being right.
    expect(render().subject).toBe(`Reset your ${env.MAIL_BRAND} password`);
  });

  it('puts the same reset URL in both parts', () => {
    const message = render();
    expect(message.html).toContain(`href="${URL}"`);
    expect(message.text).toContain(URL);
  });

  it('greets by name when there is one, and neutrally when there is not', () => {
    expect(render('Ada Lovelace').text).toContain('Hi Ada Lovelace,');
    // A user who signed up with Google may have no display name; "Hi ," is the
    // giveaway that nobody checked.
    expect(render(null).text).toContain('Hi,');
    expect(render(null).text).not.toContain('Hi ,');
  });

  it('renders a complete HTML document with the subject in the title', () => {
    const message = render();
    expect(message.html.startsWith('<!doctype html>')).toBe(true);
    expect(message.html).toContain(`<title>Reset your ${env.MAIL_BRAND} password</title>`);
  });

  it('carries the copy a reset email is required to carry', () => {
    // The "you can ignore this" line is not filler: /auth/forgot-password
    // answers identically whether or not the address has an account, so a real
    // person can receive this because someone else mistyped their address.
    for (const part of [render().html, render().text]) {
      expect(part).toMatch(/expires in one hour/);
      expect(part).toMatch(/only be used once/);
      expect(part).toMatch(/ignore this email/);
    }
  });

  it('leaves no template comments or unrendered tags in the output', () => {
    const message = render();
    expect(message.html).not.toContain('<%');
    expect(message.text).not.toContain('<%');
    // The `Subject:` line is consumed by the parser, not delivered as body text.
    expect(message.text).not.toContain('Subject:');
  });

  it('SHIPS NO HTML COMMENTS — they are delivered, not stripped', () => {
    // Eta strips `<% /* … */ %>`; it does not strip `<!-- … -->`. An early
    // version of these templates sent 922 characters of engineering notes to
    // every recipient, including the reasoning behind the enumeration-oracle
    // wording. Gmail also clips at ~102KB, so the bytes are not free either.
    //
    // Microsoft conditional comments are the one exception and are stripped
    // before the check: they are not commentary, they are the only way to
    // address Outlook, and the button below depends on them.
    const withoutConditionals = render()
      .html.replace(/<!--<!\[endif\]-->/g, '')
      .replace(/<!--\[if[^\]]*\]>/g, '')
      .replace(/<!\[endif\]-->/g, '')
      .replace(/<!-->/g, '');

    expect(withoutConditionals).not.toContain('<!--');
  });

  it('gives Outlook a real button and everyone else an anchor', () => {
    // Word — which is what Outlook on Windows renders with — ignores padding on
    // an <a>, so a plain styled anchor collapses to underlined text and the most
    // important control in the email stops looking like one.
    const { html } = render();
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('v:roundrect');
    expect(html).toContain('<!--[if !mso]><!-->');

    // Both branches must point at the same place — they are written out twice.
    expect(html.match(new RegExp(URL.replace(/[?]/g, '\\?'), 'g'))).toHaveLength(3);
  });

  it('declares dark-mode support rather than letting clients guess', () => {
    // Without the meta, a client in dark mode inverts the message itself and
    // usually lands on grey text against a grey card.
    const { html } = render();
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it("keeps the message well clear of Gmail's clipping threshold", () => {
    // ~102KB, after which Gmail hides the rest behind "View entire message" —
    // which for this email would mean hiding the button.
    expect(render().html.length).toBeLessThan(20_000);
  });
});

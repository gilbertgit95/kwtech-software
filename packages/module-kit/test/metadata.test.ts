import {
  CREDENTIAL_SURFACE_METADATA,
  declareScope,
  PUBLIC_SURFACE_METADATA,
  REQUIRED_SCOPE_METADATA,
} from '../src/index.js';

describe('the enforcement metadata keys', () => {
  it('keep the strings their enforcers read before the keys moved here', () => {
    // Moving the constants was meant to change nothing at runtime. Pinning the
    // values is what holds it to that: metadata already written under the old
    // strings must still be found.
    expect(PUBLIC_SURFACE_METADATA).toBe('kwtech:auth-public');
    expect(REQUIRED_SCOPE_METADATA).toBe('kwtech:required-scope');
  });

  it('never share a value', () => {
    // ⚠ The authentication guard treats ANY truthy value under its key as
    // "public". Were the two keys one string, a scope declaration would read
    // as a reason and every scoped handler would be anonymous.
    expect(PUBLIC_SURFACE_METADATA).not.toBe(REQUIRED_SCOPE_METADATA);
  });

  it('keep the credential-surface key apart from both', () => {
    // A credential marker is always written BESIDE a public one, so sharing a
    // string would be harmless there and ruinous on a scoped handler.
    expect(new Set([PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA, CREDENTIAL_SURFACE_METADATA]).size).toBe(3);
    expect(CREDENTIAL_SURFACE_METADATA).toBe('kwtech:credential-surface');
  });
});

describe('declareScope', () => {
  it('builds the declaration the permissions guard reads', () => {
    expect(declareScope('workspace')).toEqual({ level: 'workspace' });
  });

  it('carries the argument names for a resolver whose ids are named differently', () => {
    expect(declareScope('organization', { organizationIdArg: 'tenantId' })).toEqual({
      level: 'organization',
      organizationIdArg: 'tenantId',
    });
  });
});

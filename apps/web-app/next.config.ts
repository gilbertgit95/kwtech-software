import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * The module packages ship TypeScript compiled to dist/, but their React
   * entrypoints carry 'use client' and JSX that Next must process itself for
   * the client/server boundary to be drawn correctly.
   */
  transpilePackages: ['@kwtech/module-auth', '@kwtech/module-kit', '@kwtech/module-permissions', '@kwtech/web-ui'],
};

export default nextConfig;

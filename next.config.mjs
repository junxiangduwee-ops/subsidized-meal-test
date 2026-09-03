import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // `ldapts` is an optional dependency loaded dynamically by the LDAP auth
  // provider. Keep it external so the build does not fail when it is absent.
  serverExternalPackages: ['ldapts', 'bcryptjs'],

  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },

  // Allow the Food Ordering System to be displayed inside Joget iframe
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://duweetest.on.joget.cloud",
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
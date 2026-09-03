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
            value: "frame-ancestors 'self' https://duweetest.on.joget.cloud/jw/web/userview/food_ordering/food_order/_/207E99C7BA2B462C77326485269E8382",
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
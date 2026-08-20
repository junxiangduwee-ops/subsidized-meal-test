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
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);

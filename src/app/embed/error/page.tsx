import { getTranslations } from 'next-intl/server';

const REASON_KEY: Record<string, string> = {
    sso_failed: 'ssoFailed',
    inactive: 'ssoInactive',
    not_provisioned: 'ssoNotProvisioned',
};

export default async function EmbedErrorPage({
    searchParams,
}: {
    searchParams: Promise<{ reason?: string }>;
}) {
    const t = await getTranslations('login');
    const { reason } = await searchParams;
    const message = t(REASON_KEY[reason ?? ''] ?? 'ssoFailed');

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
            <div className="card-pad w-full max-w-sm text-center">
                <p className="text-sm text-red-800">{message}</p>
            </div>
        </main>
    );
}
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const canAccess =
    user.superAdmin ||
    can(user.role, 'catalogue:manage') ||
    can(user.role, 'finance:view');
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const inv = await prisma.vendorInvoice.findUnique({
    where: { id },
    select: { fileUrl: true, fileName: true },
  });

  if (!inv?.fileUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // base64 data URL — decode and serve directly
  if (inv.fileUrl.startsWith('data:')) {
    const [header, data] = inv.fileUrl.split(',');
    const mimeType = header.split(':')[1]?.split(';')[0] ?? 'application/octet-stream';
    const buffer = Buffer.from(data, 'base64');
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${inv.fileName ?? 'invoice'}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // Vercel Blob private URL — fetch server-side with token and proxy to browser
  const upstream = await fetch(inv.fileUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  if (!upstream.ok) return NextResponse.json({ error: 'File unavailable' }, { status: 502 });

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${inv.fileName ?? 'invoice'}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

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
    can(user.role, 'delivery:confirm') ||
    can(user.role, 'menu:plan') ||
    can(user.role, 'finance:view');
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const confirmation = await prisma.deliveryConfirmation.findUnique({
    where: { id },
    select: { photoDataUrl: true },
  });

  if (!confirmation?.photoDataUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // base64 — decode and serve directly
  if (confirmation.photoDataUrl.startsWith('data:')) {
    const [header, data] = confirmation.photoDataUrl.split(',');
    const mimeType = header.split(':')[1]?.split(';')[0] ?? 'image/jpeg';
    const buffer = Buffer.from(data, 'base64');
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }

  // Vercel Blob private URL — fetch server-side and proxy
  const upstream = await fetch(confirmation.photoDataUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });
  if (!upstream.ok) return NextResponse.json({ error: 'Photo unavailable' }, { status: 502 });

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

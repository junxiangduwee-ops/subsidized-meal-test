import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await params;
  const dish = await prisma.dish.findUnique({
    where: { id },
    select: { imageUrl: true },
  });

  if (!dish?.imageUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Public blob URL — redirect to CDN directly (no proxy needed)
  if (dish.imageUrl.startsWith('https://')) {
    return NextResponse.redirect(dish.imageUrl);
  }

  // Legacy base64 record — decode and serve
  const [header, data] = dish.imageUrl.split(',');
  const mimeType = header.split(':')[1]?.split(';')[0] ?? 'image/jpeg';
  const buffer = Buffer.from(data, 'base64');
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

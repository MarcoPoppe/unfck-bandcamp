import { NextResponse } from 'next/server';
import pkg from '../../../../package.json' with { type: 'json' };

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    version: pkg.version,
    name: pkg.name,
    uptime: process.uptime(),
  });
}

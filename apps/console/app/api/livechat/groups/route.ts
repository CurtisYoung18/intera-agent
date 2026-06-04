// GET /api/livechat/groups — Redirects to the gated admin route.
// The anonymous groups endpoint is deprecated; use /api/admin/livechat/groups.
// orgId is resolved from the verified session by defineRoute.
//
// Keep the handler here as a redirect for backward-compat with any external
// callers that haven't updated. Admin console UI uses the gated route.

import { NextRequest, NextResponse } from 'next/server'

export async function GET(_request: NextRequest) {
  // This endpoint is deprecated — groups data is now served from the gated
  // /api/admin/livechat/groups route which uses defineRoute + session orgId.
  return NextResponse.json(
    { groups: [], deprecated: true },
    {
      status: 410,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    },
  )
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

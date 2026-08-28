import { cookies } from 'next/headers';

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    const cookieStore = await cookies();
    const isHttps = (process.env.SITE_URL || '').startsWith('https://');
    cookieStore.set('hlyst_admin_session', process.env.ADMIN_PASS!, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'Invalid credentials.' }, { status: 401 });
}

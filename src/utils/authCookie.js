const COOKIE_NAME = 'fayola_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(req) {
    const secure = Boolean(req.secure || process.env.NODE_ENV === 'production');
    return {
        httpOnly: true,
        secure,
        sameSite: secure ? 'none' : 'lax',
        partitioned: secure,
        path: '/',
        maxAge: COOKIE_MAX_AGE_MS
    };
}

function setAuthCookie(req, res, token) {
    res.cookie(COOKIE_NAME, token, cookieOptions(req));
}

function clearAuthCookie(req, res) {
    const options = cookieOptions(req);
    delete options.maxAge;
    res.clearCookie(COOKIE_NAME, options);
}

function readAuthCookie(req) {
    const prefix = `${COOKIE_NAME}=`;
    const cookie = (req.headers.cookie || '').split(';').map(function(part) {
        return part.trim();
    }).find(function(part) {
        return part.startsWith(prefix);
    });

    if (!cookie) return null;
    try {
        return decodeURIComponent(cookie.slice(prefix.length));
    } catch (err) {
        return null;
    }
}

module.exports = { COOKIE_NAME, setAuthCookie, clearAuthCookie, readAuthCookie };

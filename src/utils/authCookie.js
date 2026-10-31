const COOKIE_NAMES = {
    estabelecimento: 'fayola_establishment_session',
    profissional: 'fayola_professional_session'
};
const LEGACY_COOKIE_NAME = 'fayola_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(req) {
    const secure = Boolean(req.secure || process.env.NODE_ENV === 'production');
    return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', partitioned: secure, path: '/', maxAge: COOKIE_MAX_AGE_MS };
}
function readCookie(req, name) {
    const prefix = name + '=';
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
    if (!cookie) return null;
    try { return decodeURIComponent(cookie.slice(prefix.length)); } catch (_) { return null; }
}
function setAuthCookie(req, res, token, tipo) {
    const name = COOKIE_NAMES[tipo];
    if (!name) throw new Error('Tipo de sessão inválido');
    res.cookie(name, token, cookieOptions(req));
    const options = cookieOptions(req); delete options.maxAge;
    res.clearCookie(LEGACY_COOKIE_NAME, options);
}
function clearAuthCookie(req, res, tipo) {
    const options = cookieOptions(req); delete options.maxAge;
    const nomes = tipo && COOKIE_NAMES[tipo] ? [COOKIE_NAMES[tipo], LEGACY_COOKIE_NAME] : [...Object.values(COOKIE_NAMES), LEGACY_COOKIE_NAME];
    nomes.forEach(name => res.clearCookie(name, options));
}
function readAuthCookie(req, tipo) {
    if (tipo && COOKIE_NAMES[tipo]) return readCookie(req, COOKIE_NAMES[tipo]) || readCookie(req, LEGACY_COOKIE_NAME);
    return readCookie(req, COOKIE_NAMES.estabelecimento) || readCookie(req, COOKIE_NAMES.profissional) || readCookie(req, LEGACY_COOKIE_NAME);
}
module.exports = { COOKIE_NAMES, setAuthCookie, clearAuthCookie, readAuthCookie };

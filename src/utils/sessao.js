const ORIGENS_PERMITIDAS = [
    'http://localhost:3000',
    'http://localhost:3003',
    'https://fayola-frontend-hlfj.vercel.app',
    'https://fayolaapp.com.br',
    'https://www.fayolaapp.com.br',
    process.env.APP_FRONTEND_URL
].filter(Boolean);

function lerCookie(req, nome) {
    const cabecalho = req.headers.cookie || '';
    const partes = cabecalho.split(';');
    for (const parte of partes) {
        const indice = parte.indexOf('=');
        if (indice === -1) continue;
        const chave = parte.slice(0, indice).trim();
        if (chave === nome) {
            try {
                return decodeURIComponent(parte.slice(indice + 1).trim());
            } catch (err) {
                return null;
            }
        }
    }
    return null;
}

// Protege contra CSRF: pedidos que alteram dados só passam se vierem de um site permitido
function origemValida(req) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
    const origem = req.headers.origin;
    return !!origem && ORIGENS_PERMITIDAS.includes(origem);
}

function definirCookie(res, nome, valor, maxAgeSegundos) {
    res.append(
        'Set-Cookie',
        `${nome}=${encodeURIComponent(valor)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAgeSegundos}`
    );
}

function limparCookie(res, nome) {
    res.append('Set-Cookie', `${nome}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`);
}

module.exports = { ORIGENS_PERMITIDAS, lerCookie, origemValida, definirCookie, limparCookie };
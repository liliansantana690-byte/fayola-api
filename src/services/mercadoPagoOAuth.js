const axios = require('axios');
const jwt = require('jsonwebtoken');

const MP_OAUTH_BASE = 'https://api.mercadopago.com/oauth/token';
const MP_AUTH_BASE = 'https://auth.mercadopago.com.br/authorization';

// Gera a URL pra onde o dono do estabelecimento é redirecionado pra autorizar o Fayola
// O "state" carrega o id do estabelecimento de forma assinada (JWT), pra ninguém forjar esse valor
function gerarUrlAutorizacao(estabelecimentoId) {
    const state = jwt.sign({ estabelecimento_id: estabelecimentoId }, process.env.JWT_SECRET, { expiresIn: '15m' });

    const params = new URLSearchParams({
        client_id: process.env.MP_CLIENT_ID,
        response_type: 'code',
        platform_id: 'mp',
        state,
        redirect_uri: `${process.env.APP_API_URL}/api/mercadopago/callback`
    });

    return `${MP_AUTH_BASE}?${params.toString()}`;
}

// Troca o "code" que o Mercado Pago manda de volta por um access_token do estabelecimento
async function trocarCodePorToken(code) {
    const resp = await axios.post(MP_OAUTH_BASE, {
        client_id: process.env.MP_CLIENT_ID,
        client_secret: process.env.MP_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.APP_API_URL}/api/mercadopago/callback`
    });
    return resp.data; // { access_token, refresh_token, user_id, public_key, expires_in, ... }
}

// Renova o access_token de um estabelecimento usando o refresh_token guardado
async function renovarToken(refreshToken) {
    const resp = await axios.post(MP_OAUTH_BASE, {
        client_id: process.env.MP_CLIENT_ID,
        client_secret: process.env.MP_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    });
    return resp.data;
}

// Garante um access_token válido do estabelecimento, renovando se estiver perto de expirar
async function obterTokenValido(pool, estabelecimento) {
    const expiraEm = estabelecimento.mp_token_expira_em ? new Date(estabelecimento.mp_token_expira_em) : null;
    const prestesAExpirar = !expiraEm || expiraEm.getTime() - Date.now() < 10 * 60 * 1000; // 10 min de folga

    if (!prestesAExpirar) {
        return estabelecimento.mp_access_token;
    }

    const novoToken = await renovarToken(estabelecimento.mp_refresh_token);
    const novaExpiracao = new Date(Date.now() + novoToken.expires_in * 1000);

    await pool.query(
        `UPDATE estabelecimentos SET mp_access_token = $1, mp_refresh_token = $2, mp_token_expira_em = $3 WHERE id = $4`,
        [novoToken.access_token, novoToken.refresh_token, novaExpiracao, estabelecimento.id]
    );

    return novoToken.access_token;
}

module.exports = { gerarUrlAutorizacao, trocarCodePorToken, renovarToken, obterTokenValido };
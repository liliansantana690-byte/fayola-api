const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const autenticar = require('../middleware/auth');
const { gerarUrlAutorizacao, trocarCodePorToken } = require('../services/mercadoPagoOAuth');

// Dono clica em "Conectar Mercado Pago" — devolve a URL de autorização
router.get('/conectar', autenticar, async (req, res) => {
    try {
        const url = gerarUrlAutorizacao(req.estabelecimento.id);
        res.json({ url });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Status da conexão (usado pelo painel pra mostrar "conectado" ou não)
router.get('/status', autenticar, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT mp_conectado FROM estabelecimentos WHERE id = $1',
            [req.estabelecimento.id]
        );
        res.json({ conectado: result.rows[0]?.mp_conectado || false });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Callback que o Mercado Pago chama depois que o dono autoriza — não é autenticado
// (o "state" assinado é o que garante que veio de uma sessão válida)
router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const frontendUrl = process.env.APP_FRONTEND_URL;

    try {
        if (!code || !state) {
            return res.redirect(`${frontendUrl}/login?mp_erro=parametros_faltando`);
        }

        let dadosState;
        try {
            dadosState = jwt.verify(state, process.env.JWT_SECRET);
        } catch (err) {
            return res.redirect(`${frontendUrl}/login?mp_erro=state_invalido`);
        }

        const tokenData = await trocarCodePorToken(code);
        const expiraEm = new Date(Date.now() + tokenData.expires_in * 1000);

        await pool.query(
            `UPDATE estabelecimentos
             SET mp_access_token = $1, mp_refresh_token = $2, mp_user_id = $3,
                 mp_public_key = $4, mp_token_expira_em = $5, mp_conectado = TRUE
             WHERE id = $6`,
            [
                tokenData.access_token,
                tokenData.refresh_token,
                String(tokenData.user_id),
                tokenData.public_key,
                expiraEm,
                dadosState.estabelecimento_id
            ]
        );

        res.redirect(`${frontendUrl}/login?mp_conectado=1`);
    } catch (err) {
        console.error('Erro no callback do Mercado Pago:', err.response?.data || err.message);
        res.redirect(`${frontendUrl}/login?mp_erro=falha_conexao`);
    }
});

module.exports = router;
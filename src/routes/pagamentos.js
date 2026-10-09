const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { consultarPagamento } = require('../services/pagamento');
const { obterTokenValido } = require('../services/mercadoPagoOAuth');
const { notificarAgendamento, notificarEstabelecimento } = require('../services/notificacao');
const validarWebhookMP = require('../middleware/validarWebhookMP');

// Webhook do Mercado Pago — só processa aviso com assinatura válida
router.post('/webhook', validarWebhookMP, async (req, res) => {
    try {
        const paymentId = (req.body && req.body.data && req.body.data.id) || req.query['data.id'];
        const tipo = (req.body && req.body.type) || req.query.type;
        const userId = req.body && req.body.user_id ? String(req.body.user_id) : null;

        if (tipo !== 'payment' || !paymentId || !userId) {
            return res.sendStatus(200);
        }

        const estabResult = await pool.query('SELECT * FROM estabelecimentos WHERE mp_user_id = $1', [userId]);
        if (estabResult.rows.length === 0) {
            console.error('Webhook recebido de user_id desconhecido:', userId);
            return res.sendStatus(200);
        }
        const estabelecimento = estabResult.rows[0];
        const accessToken = await obterTokenValido(pool, estabelecimento);

        const pagamento = await consultarPagamento(accessToken, paymentId);

        if (pagamento.status !== 'approved') {
            return res.sendStatus(200);
        }

        const referencia = String(pagamento.external_reference || '');

        // Sinal de PEDIDO DE TATTOO (referência com prefixo "tattoo-")
        if (referencia.startsWith('tattoo-')) {
            const pedidoId = referencia.replace('tattoo-', '');
            await pool.query(
                `UPDATE pedidos_tattoo SET sinal_status = 'pago' WHERE id = $1 AND estabelecimento_id = $2 AND sinal_status != 'pago' RETURNING *`,
                [pedidoId, estabelecimento.id]
            );
            return res.sendStatus(200);
        }

        // Sinal de AGENDAMENTO comum
        const agendamentoId = referencia;

        // sinal_status != 'pago' evita reprocessar/duplicar notificação em reenvios do webhook
        const result = await pool.query(
            `UPDATE agendamentos
             SET status = 'confirmado', sinal_status = 'pago'
             WHERE id = $1 AND estabelecimento_id = $2 AND sinal_status != 'pago'
             RETURNING *`,
            [agendamentoId, estabelecimento.id]
        );

        if (result.rows.length === 0) {
            return res.sendStatus(200);
        }

        const agendamento = result.rows[0];

        const detalhes = await pool.query(
            `SELECT s.nome as servico, p.nome as profissional
             FROM servicos s, profissionais p
             WHERE s.id = $1 AND p.id = $2`,
            [agendamento.servico_id, agendamento.profissional_id]
        );

        const contexto = {
            ...agendamento,
            servico: detalhes.rows[0].servico,
            profissional: detalhes.rows[0].profissional
        };

        await notificarAgendamento(contexto);
        await notificarEstabelecimento({ ...contexto, estabelecimento_whatsapp: estabelecimento.whatsapp });

        res.sendStatus(200);
    } catch (err) {
        console.error('Erro no webhook Mercado Pago:', err.response?.data || err.message);
        // 200 mesmo em erro interno, pra o Mercado Pago não ficar reenviando sem parar
        res.sendStatus(200);
    }
});

module.exports = router;
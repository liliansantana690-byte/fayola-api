const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/db');
const autenticar = require('../middleware/auth');
const autenticarProfissional = require('../middleware/authProfissional');
const { notificarOrcamentoTattoo } = require('../services/notificacao');
const { criarPagamentoPix } = require('../services/pagamento');
const { obterTokenValido } = require('../services/mercadoPagoOAuth');

const EXPIRATION_MINUTES = Number(process.env.DEPOSIT_EXPIRATION_MINUTES) || 15;

// Cliente envia o pedido de tattoo (público)
router.post('/', async (req, res) => {
    const {
        estabelecimento_id, profissional_id, cliente_nome, cliente_whatsapp,
        descricao, estilo, tamanho_aproximado, local_corpo, referencia_url, observacoes
    } = req.body;

    try {
        if (!descricao || !cliente_nome || !cliente_whatsapp) {
            return res.status(400).json({ erro: 'Descrição, nome e WhatsApp são obrigatórios' });
        }

        const tokenAcesso = crypto.randomBytes(24).toString('hex');

        const result = await pool.query(
            `INSERT INTO pedidos_tattoo
                (estabelecimento_id, profissional_id, cliente_nome, cliente_whatsapp,
                 descricao, estilo, tamanho_aproximado, local_corpo, referencia_url, observacoes, token_acesso)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                estabelecimento_id, profissional_id || null, cliente_nome, cliente_whatsapp,
                descricao, estilo || null, tamanho_aproximado || null, local_corpo || null,
                referencia_url || null, observacoes || null, tokenAcesso
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
});

// Status do pedido (público — identificado pelo token secreto, não pelo ID numérico)
router.get('/:token/status', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, estabelecimento_id, profissional_id, status, sinal_status,
                    valor_tattoo, valor_sinal, duracao_minutos, pix_expira_em, data_hora
             FROM pedidos_tattoo WHERE token_acesso = $1`,
            [req.params.token]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Horários já ocupados de um profissional num dia (público — usado pra cliente ver o que já está marcado)
router.get('/horarios-ocupados', async (req, res) => {
    const { profissional_id, data } = req.query;
    try {
        if (!profissional_id || !data) {
            return res.status(400).json({ erro: 'Informe profissional_id e data (YYYY-MM-DD)' });
        }

        const result = await pool.query(
            `SELECT data_hora, duracao_minutos
             FROM pedidos_tattoo
             WHERE profissional_id = $1
               AND status = 'convertido_agendamento'
               AND DATE(data_hora) = $2`,
            [profissional_id, data]
        );

        const ocupados = result.rows.map(function(r) {
            const inicio = new Date(r.data_hora);
            const fim = new Date(inicio.getTime() + r.duracao_minutos * 60 * 1000);
            return { inicio: inicio.toISOString(), fim: fim.toISOString() };
        });

        res.json(ocupados);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Gerar o PIX do sinal — identificado pelo token secreto
router.post('/:token/gerar-pix', async (req, res) => {
    try {
        const pedidoResult = await pool.query('SELECT * FROM pedidos_tattoo WHERE token_acesso = $1', [req.params.token]);
        if (pedidoResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }
        const pedido = pedidoResult.rows[0];

        if (pedido.status !== 'orcamento_enviado') {
            return res.status(400).json({ erro: 'Este pedido ainda não tem um orçamento definido pelo tatuador' });
        }
        if (pedido.sinal_status === 'pago') {
            return res.status(400).json({ erro: 'O sinal deste pedido já foi pago' });
        }

        const estabResult = await pool.query('SELECT * FROM estabelecimentos WHERE id = $1', [pedido.estabelecimento_id]);
        const estabelecimento = estabResult.rows[0];
        if (!estabelecimento.mp_conectado) {
            return res.status(400).json({ erro: 'Este estabelecimento ainda não configurou o recebimento via Pix' });
        }

        const accessToken = await obterTokenValido(pool, estabelecimento);
        const expiraEm = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000);

        const pix = await criarPagamentoPix({
            accessToken,
            valor: parseFloat(pedido.valor_sinal),
            descricao: 'Sinal - Tattoo',
            agendamentoId: `tattoo-${pedido.id}`,
            clienteWhatsapp: pedido.cliente_whatsapp
        });

        await pool.query(
            `UPDATE pedidos_tattoo SET mp_payment_id = $1, pix_expira_em = $2 WHERE id = $3`,
            [pix.mp_payment_id, expiraEm, pedido.id]
        );

        res.json({
            qr_code: pix.qr_code,
            qr_code_base64: pix.qr_code_base64,
            expira_em: expiraEm
        });
    } catch (err) {
        console.error('ERRO AO GERAR PIX DO PEDIDO DE TATTOO:', err.response?.data || err.message);
        res.status(400).json({ erro: err.response?.data?.message || err.message });
    }
});

// Cliente escolhe o horário depois de pagar o sinal — identificado pelo token secreto
router.patch('/:token/confirmar-horario', async (req, res) => {
    const { data_hora } = req.body;
    try {
        if (!data_hora) {
            return res.status(400).json({ erro: 'Informe a data e horário' });
        }

        const pedidoResult = await pool.query('SELECT * FROM pedidos_tattoo WHERE token_acesso = $1', [req.params.token]);
        if (pedidoResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }
        const pedido = pedidoResult.rows[0];

        if (pedido.sinal_status !== 'pago') {
            return res.status(400).json({ erro: 'O sinal ainda não foi pago' });
        }

        const duracaoMinutos = pedido.duracao_minutos || 120;
        const inicioNovo = new Date(data_hora);
        const fimNovo = new Date(inicioNovo.getTime() + duracaoMinutos * 60 * 1000);

        if (pedido.profissional_id) {
            const conflitosResult = await pool.query(
                `SELECT id, data_hora, duracao_minutos
                 FROM pedidos_tattoo
                 WHERE profissional_id = $1
                   AND status = 'convertido_agendamento'
                   AND id != $2`,
                [pedido.profissional_id, pedido.id]
            );

            const temConflito = conflitosResult.rows.some(function(outro) {
                const inicioOutro = new Date(outro.data_hora);
                const fimOutro = new Date(inicioOutro.getTime() + (outro.duracao_minutos || 120) * 60 * 1000);
                return inicioNovo < fimOutro && inicioOutro < fimNovo;
            });

            if (temConflito) {
                return res.status(409).json({ erro: 'Esse horário já está ocupado para este profissional. Escolha outro horário.' });
            }
        }

        const result = await pool.query(
            `UPDATE pedidos_tattoo SET data_hora = $1, status = 'convertido_agendamento', atualizado_em = NOW()
             WHERE id = $2 RETURNING *`,
            [data_hora, pedido.id]
        );

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Listar pedidos do estabelecimento (dono)
router.get('/', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `SELECT pt.*, p.nome as profissional
             FROM pedidos_tattoo pt
             LEFT JOIN profissionais p ON pt.profissional_id = p.id
             WHERE pt.estabelecimento_id = $1
             ORDER BY pt.criado_em DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Listar pedidos do profissional logado
router.get('/meus-pedidos', autenticarProfissional, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM pedidos_tattoo WHERE profissional_id = $1 ORDER BY criado_em DESC`,
            [req.profissional.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Profissional define o orçamento (valor da tattoo + sinal + duração da sessão) — dispara WhatsApp pro cliente
router.patch('/:id/orcamento', autenticarProfissional, async (req, res) => {
    const { valor_tattoo, valor_sinal, duracao_minutos } = req.body;
    try {
        if (!valor_tattoo || !valor_sinal) {
            return res.status(400).json({ erro: 'Informe o valor da tattoo e do sinal' });
        }

        const result = await pool.query(
            `UPDATE pedidos_tattoo
             SET valor_tattoo = $1, valor_sinal = $2, duracao_minutos = $3, status = 'orcamento_enviado', atualizado_em = NOW()
             WHERE id = $4 AND profissional_id = $5
             RETURNING *`,
            [valor_tattoo, valor_sinal, duracao_minutos || 120, req.params.id, req.profissional.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }

        const pedido = result.rows[0];

        try {
            await notificarOrcamentoTattoo({ ...pedido, link_base: process.env.APP_FRONTEND_URL });
        } catch (err) {
            console.error('Erro ao notificar orçamento tattoo:', err.message);
        }

        res.json(pedido);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
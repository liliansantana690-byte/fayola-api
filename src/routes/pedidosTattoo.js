const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticar = require('../middleware/auth');
const autenticarProfissional = require('../middleware/authProfissional');
const { notificarOrcamentoTattoo } = require('../services/notificacao');

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

        const result = await pool.query(
            `INSERT INTO pedidos_tattoo
                (estabelecimento_id, profissional_id, cliente_nome, cliente_whatsapp,
                 descricao, estilo, tamanho_aproximado, local_corpo, referencia_url, observacoes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
                estabelecimento_id, profissional_id || null, cliente_nome, cliente_whatsapp,
                descricao, estilo || null, tamanho_aproximado || null, local_corpo || null,
                referencia_url || null, observacoes || null
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
});

// Status do pedido (público — cliente confere se já tem orçamento)
router.get('/:id/status', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, status, valor_tattoo, valor_sinal, agendamento_id FROM pedidos_tattoo WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }
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

// Profissional define o orçamento (valor da tattoo + sinal) — dispara WhatsApp pro cliente
router.patch('/:id/orcamento', autenticarProfissional, async (req, res) => {
    const { valor_tattoo, valor_sinal } = req.body;
    try {
        if (!valor_tattoo || !valor_sinal) {
            return res.status(400).json({ erro: 'Informe o valor da tattoo e do sinal' });
        }

        const result = await pool.query(
            `UPDATE pedidos_tattoo
             SET valor_tattoo = $1, valor_sinal = $2, status = 'orcamento_enviado', atualizado_em = NOW()
             WHERE id = $3 AND profissional_id = $4
             RETURNING *`,
            [valor_tattoo, valor_sinal, req.params.id, req.profissional.id]
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
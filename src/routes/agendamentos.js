const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticar = require('../middleware/auth');
const { criarPagamentoPix } = require('../services/pagamento');

const DEPOSIT_PERCENT = Number(process.env.DEPOSIT_PERCENT || 30);
const EXPIRATION_MINUTES = Number(process.env.DEPOSIT_EXPIRATION_MINUTES || 15);

// Criar agendamento (público — cliente agenda e recebe cobrança PIX do sinal)
router.post('/', async (req, res) => {
    const { estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, data_hora } = req.body;
    try {
        const servicoResult = await pool.query('SELECT preco, nome FROM servicos WHERE id = $1', [servico_id]);
        if (servicoResult.rows.length === 0) {
            return res.status(400).json({ erro: 'Serviço não encontrado' });
        }

        const preco = parseFloat(servicoResult.rows[0].preco);
        const sinalValor = Number(((preco * DEPOSIT_PERCENT) / 100).toFixed(2));
        const expiraEm = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000);

        const result = await pool.query(
            `INSERT INTO agendamentos
                (estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, data_hora, status, sinal_valor, sinal_status, expira_em)
             VALUES ($1, $2, $3, $4, $5, $6, 'aguardando_pagamento', $7, 'pendente', $8) RETURNING *`,
            [estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, data_hora, sinalValor, expiraEm]
        );

        const agendamento = result.rows[0];

        const pix = await criarPagamentoPix({
            valor: sinalValor,
            descricao: `Sinal - ${servicoResult.rows[0].nome}`,
            agendamentoId: agendamento.id,
            clienteWhatsapp: cliente_whatsapp
        });

        await pool.query('UPDATE agendamentos SET mp_payment_id = $1 WHERE id = $2', [pix.mp_payment_id, agendamento.id]);

        res.status(201).json({
            agendamento,
            pagamento: {
                qr_code: pix.qr_code,
                qr_code_base64: pix.qr_code_base64,
                expira_em: expiraEm
            }
        });
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
});

// Status do agendamento (público — usado pelo frontend pra checar se o sinal foi pago)
router.get('/:id/status', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, status, sinal_status, expira_em FROM agendamentos WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Agendamento não encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Todos os agendamentos do estabelecimento
router.get('/todos', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `SELECT a.*, p.nome as profissional, s.nome as servico, s.preco
             FROM agendamentos a
             JOIN profissionais p ON a.profissional_id = p.id
             JOIN servicos s ON a.servico_id = s.id
             WHERE a.estabelecimento_id = $1
             ORDER BY a.data_hora DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Agendamentos do dia
router.get('/hoje', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `SELECT a.*, p.nome as profissional, s.nome as servico, s.preco
             FROM agendamentos a
             JOIN profissionais p ON a.profissional_id = p.id
             JOIN servicos s ON a.servico_id = s.id
             WHERE a.estabelecimento_id = $1
             AND DATE(a.data_hora) = CURRENT_DATE
             AND a.status = 'confirmado'
             ORDER BY a.data_hora ASC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Listar agendamentos do estabelecimento (protegido)
router.get('/', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `SELECT a.*, p.nome as profissional, s.nome as servico, s.preco
             FROM agendamentos a
             JOIN profissionais p ON a.profissional_id = p.id
             JOIN servicos s ON a.servico_id = s.id
             WHERE a.estabelecimento_id = $1
             ORDER BY a.data_hora DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Cancelar agendamento
router.patch('/:id/cancelar', autenticar, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE agendamentos SET status = 'cancelado' WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticar = require('../middleware/auth');
const { notificarAgendamento, notificarEstabelecimento } = require('../services/notificacao');

// Criar agendamento (público — cliente agenda)
router.post('/', async (req, res) => {
    const { estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, data_hora } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO agendamentos (estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, data_hora)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, data_hora]
        );

        const agendamento = result.rows[0];

        const detalhes = await pool.query(
            `SELECT s.nome as servico, p.nome as profissional, e.whatsapp as estabelecimento_whatsapp
             FROM servicos s, profissionais p, estabelecimentos e
             WHERE s.id = $1 AND p.id = $2 AND e.id = $3`,
            [servico_id, profissional_id, estabelecimento_id]
        );

        try {
            await notificarAgendamento({
                ...agendamento,
                servico: detalhes.rows[0].servico,
                profissional: detalhes.rows[0].profissional
            });

            await notificarEstabelecimento({
                ...agendamento,
                servico: detalhes.rows[0].servico,
                profissional: detalhes.rows[0].profissional,
                estabelecimento_whatsapp: detalhes.rows[0].estabelecimento_whatsapp
            });
        } catch (err) {
            console.error('Erro ao enviar notificacao:', err.message);
        }

        res.status(201).json(agendamento);
    } catch (err) {
        res.status(400).json({ erro: err.message });
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
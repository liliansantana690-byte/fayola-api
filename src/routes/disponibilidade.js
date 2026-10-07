const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticarProfissional = require('../middleware/authProfissional');

// Horário de funcionamento semanal do profissional (público)
router.get('/horarios/:profissional_id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT dia_semana, hora_inicio, hora_fim FROM horarios_profissional
             WHERE profissional_id = $1 ORDER BY dia_semana, hora_inicio`,
            [req.params.profissional_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Profissional logado substitui todo o horário semanal dele de uma vez
router.put('/horarios', autenticarProfissional, async (req, res) => {
    const { horarios } = req.body;
    try {
        if (!Array.isArray(horarios)) {
            return res.status(400).json({ erro: 'Envie uma lista de horários' });
        }

        await pool.query('DELETE FROM horarios_profissional WHERE profissional_id = $1', [req.profissional.id]);

        for (const h of horarios) {
            await pool.query(
                `INSERT INTO horarios_profissional (profissional_id, dia_semana, hora_inicio, hora_fim)
                 VALUES ($1, $2, $3, $4)`,
                [req.profissional.id, h.dia_semana, h.hora_inicio, h.hora_fim]
            );
        }

        const result = await pool.query(
            `SELECT dia_semana, hora_inicio, hora_fim FROM horarios_profissional
             WHERE profissional_id = $1 ORDER BY dia_semana, hora_inicio`,
            [req.profissional.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Dias bloqueados futuros do profissional (público)
router.get('/bloqueios/:profissional_id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, data, motivo FROM dias_bloqueados
             WHERE profissional_id = $1 AND data >= CURRENT_DATE
             ORDER BY data`,
            [req.params.profissional_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Profissional logado bloqueia um dia
router.post('/bloqueios', autenticarProfissional, async (req, res) => {
    const { data, motivo } = req.body;
    try {
        if (!data) {
            return res.status(400).json({ erro: 'Informe a data (YYYY-MM-DD)' });
        }
        const result = await pool.query(
            `INSERT INTO dias_bloqueados (profissional_id, data, motivo)
             VALUES ($1, $2, $3)
             ON CONFLICT (profissional_id, data) DO UPDATE SET motivo = EXCLUDED.motivo
             RETURNING *`,
            [req.profissional.id, data, motivo || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Profissional logado desbloqueia um dia
router.delete('/bloqueios/:id', autenticarProfissional, async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM dias_bloqueados WHERE id = $1 AND profissional_id = $2 RETURNING id`,
            [req.params.id, req.profissional.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Bloqueio não encontrado' });
        }
        res.json({ mensagem: 'Dia desbloqueado' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Visão consolidada de um dia específico — usado pelo cliente antes de escolher horário
router.get('/dia', async (req, res) => {
    const { profissional_id, data } = req.query;
    try {
        if (!profissional_id || !data) {
            return res.status(400).json({ erro: 'Informe profissional_id e data (YYYY-MM-DD)' });
        }

        const diaSemana = new Date(data + 'T12:00:00').getDay();

        const bloqueioResult = await pool.query(
            `SELECT id FROM dias_bloqueados WHERE profissional_id = $1 AND data = $2`,
            [profissional_id, data]
        );

        if (bloqueioResult.rows.length > 0) {
            return res.json({ aberto: false, motivo: 'Dia bloqueado pelo profissional', horario: null, ocupados: [] });
        }

        const horarioResult = await pool.query(
            `SELECT hora_inicio, hora_fim FROM horarios_profissional
             WHERE profissional_id = $1 AND dia_semana = $2
             ORDER BY hora_inicio LIMIT 1`,
            [profissional_id, diaSemana]
        );

        if (horarioResult.rows.length === 0) {
            return res.json({ aberto: false, motivo: 'Profissional não atende nesse dia da semana', horario: null, ocupados: [] });
        }

        const ocupadosResult = await pool.query(
            `SELECT data_hora, duracao_minutos FROM pedidos_tattoo
             WHERE profissional_id = $1 AND status = 'convertido_agendamento' AND DATE(data_hora) = $2`,
            [profissional_id, data]
        );

        const ocupados = ocupadosResult.rows.map(function(r) {
            const inicio = new Date(r.data_hora);
            const fim = new Date(inicio.getTime() + r.duracao_minutos * 60 * 1000);
            return { inicio: inicio.toISOString(), fim: fim.toISOString() };
        });

        res.json({
            aberto: true,
            motivo: null,
            horario: horarioResult.rows[0],
            ocupados
        });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
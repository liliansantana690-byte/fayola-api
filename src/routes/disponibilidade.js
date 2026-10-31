const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticarProfissional = require('../middleware/authProfissional');
const { buscarDisponibilidadeDia, validarData } = require('../utils/disponibilidade');

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
        if (!/^\d+$/.test(String(profissional_id || '')) || !validarData(data)) {
            return res.status(400).json({ erro: 'Informe profissional_id e data (YYYY-MM-DD)' });
        }
        return res.json(await buscarDisponibilidadeDia(pool, Number(profissional_id), data));
    } catch (err) {
        console.error('ERRO AO CONSULTAR DISPONIBILIDADE:', err.message);
        return res.status(500).json({ erro: 'Não foi possível consultar a disponibilidade.' });
    }
});

module.exports = router;
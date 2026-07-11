const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticar = require('../middleware/auth');

// Criar serviço
router.post('/', autenticar, async (req, res) => {
    const { nome, duracao_minutos, preco } = req.body;
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `INSERT INTO servicos (estabelecimento_id, nome, duracao_minutos, preco)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [id, nome, duracao_minutos, preco]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
});

// Listar serviços (público)
router.get('/:estabelecimento_id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM servicos WHERE estabelecimento_id = $1 AND ativo = TRUE`,
            [req.params.estabelecimento_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
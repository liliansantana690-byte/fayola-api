const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Cadastro do estabelecimento
router.post('/cadastro', async (req, res) => {
    const { nome, tipo, telefone, email, senha, whatsapp } = req.body;
    try {
        const hash = await bcrypt.hash(senha, 10);
        const result = await pool.query(
            `INSERT INTO estabelecimentos (nome, tipo, telefone, email, senha, whatsapp)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nome, email, tipo`,
            [nome, tipo, telefone, email, hash, whatsapp]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
});

// Login do estabelecimento
router.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM estabelecimentos WHERE email = $1',
            [email]
        );
        if (result.rows.length === 0) return res.status(401).json({ erro: 'Email não encontrado' });

        const estabelecimento = result.rows[0];
        const valido = await bcrypt.compare(senha, estabelecimento.senha);
        if (!valido) return res.status(401).json({ erro: 'Senha incorreta' });

        const token = jwt.sign(
            { id: estabelecimento.id, nome: estabelecimento.nome },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, estabelecimento_id: estabelecimento.id, nome: estabelecimento.nome });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Dados públicos do estabelecimento
router.get('/estabelecimento/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nome, tipo, telefone FROM estabelecimentos WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ erro: 'Não encontrado' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
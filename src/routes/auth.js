const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { notificarNovoCadastro } = require('../services/notificacao');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' }
});

// Cadastro do estabelecimento — fica pendente até você aprovar
router.post('/cadastro', async (req, res) => {
    const { nome, tipo, telefone, email, senha, whatsapp } = req.body;
    try {
        const hash = await bcrypt.hash(senha, 10);
        const result = await pool.query(
            `INSERT INTO estabelecimentos (nome, tipo, telefone, email, senha, whatsapp, aprovado)
             VALUES ($1, $2, $3, $4, $5, $6, FALSE) RETURNING id, nome, email, tipo`,
            [nome, tipo, telefone, email, hash, whatsapp]
        );

        try {
            await notificarNovoCadastro(result.rows[0]);
        } catch (err) {
            console.error('Erro ao notificar novo cadastro:', err.message);
        }

        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
});

// Login do estabelecimento — bloqueado até aprovação
router.post('/login', loginLimiter, async (req, res) => {
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

        if (!estabelecimento.aprovado) {
            return res.status(403).json({ erro: 'Sua conta ainda está aguardando aprovação. Você será avisado assim que for liberada.' });
        }

        const token = jwt.sign(
            { id: estabelecimento.id, nome: estabelecimento.nome, tipo: 'estabelecimento' },
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
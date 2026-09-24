const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticar = require('../middleware/auth');

// Criar serviço
router.post('/', autenticar, async (req, res) => {
    const { nome, duracao_minutos, preco, comissao_percentual } = req.body;
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `INSERT INTO servicos (estabelecimento_id, nome, duracao_minutos, preco, comissao_percentual)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [id, nome, duracao_minutos, preco, comissao_percentual || 0]
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

// Excluir serviço
router.delete('/:id', autenticar, async (req, res) => {
    const { id: estabelecimentoId } = req.estabelecimento;
    try {
        const verifica = await pool.query(
            'SELECT id FROM servicos WHERE id = $1 AND estabelecimento_id = $2',
            [req.params.id, estabelecimentoId]
        );
        if (verifica.rows.length === 0) {
            return res.status(404).json({ erro: 'Serviço não encontrado' });
        }
        await pool.query('DELETE FROM agendamentos WHERE servico_id = $1', [req.params.id]);
        await pool.query('DELETE FROM servicos WHERE id = $1', [req.params.id]);
        res.json({ mensagem: 'Serviço excluído' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
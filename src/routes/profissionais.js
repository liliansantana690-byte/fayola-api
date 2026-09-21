const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const autenticar = require('../middleware/auth');
const autenticarProfissional = require('../middleware/authProfissional');

// Criar profissional (dono) — gera convite pra ele definir a própria senha
router.post('/', autenticar, async (req, res) => {
    const { nome, especialidade, whatsapp } = req.body;
    const { id } = req.estabelecimento;
    try {
        const conviteToken = crypto.randomBytes(24).toString('hex');
        const conviteExpiraEm = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const result = await pool.query(
            `INSERT INTO profissionais (estabelecimento_id, nome, especialidade, whatsapp, convite_token, convite_expira_em)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [id, nome, especialidade, whatsapp, conviteToken, conviteExpiraEm]
        );

        res.status(201).json({
            ...result.rows[0],
            link_convite: `${process.env.APP_FRONTEND_URL}/painel-profissional/ativar?token=${conviteToken}`
        });
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
});

// Listar profissionais completos do estabelecimento (dono)
router.get('/', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `SELECT id, nome, especialidade, whatsapp, conta_ativada, convite_token, ativo
             FROM profissionais WHERE estabelecimento_id = $1 ORDER BY nome`,
            [id]
        );
        const profissionais = result.rows.map(function(p) {
            return {
                ...p,
                link_convite: (!p.conta_ativada && p.convite_token)
                    ? `${process.env.APP_FRONTEND_URL}/painel-profissional/ativar?token=${p.convite_token}`
                    : null
            };
        });
        res.json(profissionais);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Comissão acumulada de cada profissional (dono)
router.get('/comissoes', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `SELECT p.id, p.nome, p.especialidade,
                    COALESCE(SUM(a.comissao_valor), 0) as comissao_total,
                    COUNT(a.id) as atendimentos_concluidos
             FROM profissionais p
             LEFT JOIN agendamentos a ON a.profissional_id = p.id AND a.status = 'concluido'
             WHERE p.estabelecimento_id = $1
             GROUP BY p.id, p.nome, p.especialidade
             ORDER BY comissao_total DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Agenda do profissional logado
router.get('/minha-agenda', autenticarProfissional, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.*, s.nome as servico, s.preco, s.comissao_percentual
             FROM agendamentos a
             JOIN servicos s ON a.servico_id = s.id
             WHERE a.profissional_id = $1 AND a.status IN ('confirmado', 'concluido')
             ORDER BY a.data_hora DESC`,
            [req.profissional.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Total de comissão acumulada do profissional logado
router.get('/minha-comissao', autenticarProfissional, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT COALESCE(SUM(comissao_valor), 0) as total, COUNT(*) as atendimentos
             FROM agendamentos WHERE profissional_id = $1 AND status = 'concluido'`,
            [req.profissional.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Validar convite (tela de "criar senha")
router.get('/convite/:token', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, nome FROM profissionais WHERE convite_token = $1 AND convite_expira_em > NOW() AND conta_ativada = FALSE`,
            [req.params.token]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Convite inválido ou expirado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Ativar conta — profissional define a própria senha
router.post('/convite/:token/ativar', async (req, res) => {
    const { senha } = req.body;
    try {
        const result = await pool.query(
            `SELECT id FROM profissionais WHERE convite_token = $1 AND convite_expira_em > NOW() AND conta_ativada = FALSE`,
            [req.params.token]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Convite inválido ou expirado' });
        }

        const hash = await bcrypt.hash(senha, 10);
        await pool.query(
            `UPDATE profissionais SET senha = $1, conta_ativada = TRUE, convite_token = NULL, convite_expira_em = NULL WHERE id = $2`,
            [hash, result.rows[0].id]
        );
        res.json({ mensagem: 'Conta ativada com sucesso' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Login do profissional (WhatsApp + senha)
router.post('/login', async (req, res) => {
    const { whatsapp, senha } = req.body;
    try {
        const result = await pool.query(
            `SELECT * FROM profissionais WHERE whatsapp = $1 AND conta_ativada = TRUE`,
            [whatsapp]
        );
        if (result.rows.length === 0) return res.status(401).json({ erro: 'WhatsApp não encontrado ou conta não ativada' });

        const profissional = result.rows[0];
        const valido = await bcrypt.compare(senha, profissional.senha);
        if (!valido) return res.status(401).json({ erro: 'Senha incorreta' });

        const token = jwt.sign(
            { id: profissional.id, estabelecimento_id: profissional.estabelecimento_id, nome: profissional.nome, tipo: 'profissional' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, profissional_id: profissional.id, nome: profissional.nome });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Marcar atendimento como concluído — calcula a comissão na hora
router.patch('/agendamentos/:id/concluir', autenticarProfissional, async (req, res) => {
    const { valor_pago_total } = req.body;
    try {
        const agendamentoResult = await pool.query(
            `SELECT a.*, s.preco, s.comissao_percentual
             FROM agendamentos a JOIN servicos s ON a.servico_id = s.id
             WHERE a.id = $1 AND a.profissional_id = $2`,
            [req.params.id, req.profissional.id]
        );
        if (agendamentoResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Agendamento não encontrado' });
        }
        const agendamento = agendamentoResult.rows[0];
        if (agendamento.status !== 'confirmado') {
            return res.status(400).json({ erro: 'Só é possível concluir agendamentos confirmados' });
        }

        const valorFinal = valor_pago_total != null ? Number(valor_pago_total) : Number(agendamento.preco);
        const comissaoValor = Number((valorFinal * agendamento.comissao_percentual / 100).toFixed(2));

        const result = await pool.query(
            `UPDATE agendamentos SET status = 'concluido', valor_pago_total = $1, comissao_valor = $2 WHERE id = $3 RETURNING *`,
            [valorFinal, comissaoValor, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Listar profissionais ativos (público — usado na tela de agendamento). Fica por último de propósito:
// é uma rota "coringa" (/:estabelecimento_id) e precisa vir depois de todas as rotas de caminho fixo acima.
router.get('/:estabelecimento_id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, estabelecimento_id, nome, especialidade FROM profissionais WHERE estabelecimento_id = $1 AND ativo = TRUE`,
            [req.params.estabelecimento_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Excluir profissional
router.delete('/:id', autenticar, async (req, res) => {
    try {
        await pool.query('DELETE FROM agendamentos WHERE profissional_id = $1', [req.params.id]);
        await pool.query('DELETE FROM profissionais WHERE id = $1', [req.params.id]);
        res.json({ mensagem: 'Profissional excluído' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;
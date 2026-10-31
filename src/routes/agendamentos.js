const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticar = require('../middleware/auth');
const { criarPagamentoPix } = require('../services/pagamento');
const { obterTokenValido } = require('../services/mercadoPagoOAuth');
const { normalizarDataHora, validarHorarioDisponivel } = require('../utils/disponibilidade');

const DEPOSIT_PERCENT = Number(process.env.DEPOSIT_PERCENT || 30);
const EXPIRATION_MINUTES = Number(process.env.DEPOSIT_EXPIRATION_MINUTES || 15);

// =====================================================
// CRIAR AGENDAMENTO
// Público — cliente agenda e recebe cobrança PIX do sinal
// =====================================================
router.post('/', async (req, res) => {
    const { estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, data_hora } = req.body;
    let client;
    let agendamento;
    let estabelecimento;
    let servico;
    let sinalValor;
    const idsValidos = [estabelecimento_id, profissional_id, servico_id].every(v => /^\d+$/.test(String(v || '')) && Number(v) > 0);
    const dataHora = normalizarDataHora(data_hora);
    if (!idsValidos || !cliente_nome || !cliente_whatsapp || !dataHora) {
        return res.status(400).json({ erro: 'Preencha os dados corretamente, incluindo data e horário válidos.' });
    }
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [Number(profissional_id), dataHora.slice(0, 10)]);
        const estabResult = await client.query('SELECT * FROM estabelecimentos WHERE id = $1', [estabelecimento_id]);
        if (!estabResult.rows.length) throw Object.assign(new Error('Estabelecimento não encontrado.'), { statusCode: 404 });
        estabelecimento = estabResult.rows[0];
        if (!estabelecimento.mp_conectado) throw Object.assign(new Error('Este estabelecimento ainda não configurou o recebimento via Pix.'), { statusCode: 400 });
        const profissionalResult = await client.query('SELECT id FROM profissionais WHERE id = $1 AND estabelecimento_id = $2', [profissional_id, estabelecimento_id]);
        if (!profissionalResult.rows.length) throw Object.assign(new Error('Profissional não pertence a este estabelecimento.'), { statusCode: 400 });
        const servicoResult = await client.query('SELECT id, estabelecimento_id, duracao_minutos, preco, nome FROM servicos WHERE id = $1 AND estabelecimento_id = $2', [servico_id, estabelecimento_id]);
        if (!servicoResult.rows.length) throw Object.assign(new Error('Serviço não pertence a este estabelecimento.'), { statusCode: 400 });
        servico = servicoResult.rows[0];
        const preco = Number(servico.preco);
        if (!Number.isFinite(preco) || preco <= 0) throw Object.assign(new Error('O preço deste serviço é inválido.'), { statusCode: 400 });
        sinalValor = Number(((preco * DEPOSIT_PERCENT) / 100).toFixed(2));
        if (!Number.isFinite(sinalValor) || sinalValor <= 0) throw Object.assign(new Error('Não foi possível calcular o valor do sinal.'), { statusCode: 400 });
        await validarHorarioDisponivel(client, Number(profissional_id), dataHora, servico.duracao_minutos || 60);
        const expiraEm = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000);
        const result = await client.query(
            "INSERT INTO agendamentos (estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, data_hora, status, sinal_valor, sinal_status, expira_em) VALUES ($1, $2, $3, $4, $5, $6::timestamp, 'aguardando_pagamento', $7, 'pendente', $8) RETURNING *",
            [estabelecimento_id, profissional_id, servico_id, cliente_nome, cliente_whatsapp, dataHora.replace('T', ' '), sinalValor, expiraEm]
        );
        agendamento = result.rows[0];
        await client.query('COMMIT');
        client.release();
        client = null;
        const accessToken = await obterTokenValido(pool, estabelecimento);
        const pix = await criarPagamentoPix({ accessToken, valor: sinalValor, descricao: 'Sinal - ' + servico.nome, agendamentoId: agendamento.id, clienteWhatsapp: cliente_whatsapp, idempotencyKey: 'fayola-agendamento-' + agendamento.id, expiraEm });
        await pool.query('UPDATE agendamentos SET mp_payment_id = $1 WHERE id = $2', [pix.mp_payment_id, agendamento.id]);
        return res.status(201).json({ agendamento, pagamento: { qr_code: pix.qr_code, qr_code_base64: pix.qr_code_base64, expira_em: agendamento.expira_em } });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) { /* conexão pode já ter encerrado */ }
            client.release();
        }
        console.error('ERRO AO CRIAR AGENDAMENTO:', err.response?.data || err.message);
        if (agendamento?.id) {
            await pool.query("UPDATE agendamentos SET status = 'expirado', expira_em = NOW() WHERE id = $1 AND status = 'aguardando_pagamento'", [agendamento.id]).catch(e => console.error('Falha ao liberar reserva sem Pix:', e.message));
        }
        return res.status(err.statusCode || (agendamento?.id ? 502 : 400)).json({ erro: err.statusCode ? err.message : (err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao criar agendamento.') });
    }
});

// =====================================================
// STATUS DO AGENDAMENTO
// Público — usado pelo frontend para verificar pagamento
// =====================================================
router.get('/:id/status', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                id,
                status,
                sinal_status,
                expira_em
             FROM agendamentos
             WHERE id = $1`,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                erro: 'Agendamento não encontrado.'
            });
        }

        return res.json(result.rows[0]);

    } catch (err) {
        console.error(
            'ERRO AO CONSULTAR STATUS:',
            err.message
        );

        return res.status(500).json({
            erro: err.message
        });
    }
});

// =====================================================
// TODOS OS AGENDAMENTOS DO ESTABELECIMENTO
// =====================================================
router.get('/todos', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;

    try {
        const result = await pool.query(
            `SELECT
                a.*,
                p.nome AS profissional,
                s.nome AS servico,
                s.preco
             FROM agendamentos a
             JOIN profissionais p
                ON a.profissional_id = p.id
             JOIN servicos s
                ON a.servico_id = s.id
             WHERE a.estabelecimento_id = $1
             ORDER BY a.data_hora DESC`,
            [id]
        );

        return res.json(result.rows);

    } catch (err) {
        console.error(
            'ERRO AO LISTAR TODOS OS AGENDAMENTOS:',
            err.message
        );

        return res.status(500).json({
            erro: err.message
        });
    }
});

// =====================================================
// AGENDAMENTOS DO DIA
// =====================================================
router.get('/hoje', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;

    try {
        const result = await pool.query(
            `SELECT
                a.*,
                p.nome AS profissional,
                s.nome AS servico,
                s.preco
             FROM agendamentos a
             JOIN profissionais p
                ON a.profissional_id = p.id
             JOIN servicos s
                ON a.servico_id = s.id
             WHERE a.estabelecimento_id = $1
               AND DATE(a.data_hora) = CURRENT_DATE
               AND a.status = 'confirmado'
             ORDER BY a.data_hora ASC`,
            [id]
        );

        return res.json(result.rows);

    } catch (err) {
        console.error(
            'ERRO AO LISTAR AGENDAMENTOS DE HOJE:',
            err.message
        );

        return res.status(500).json({
            erro: err.message
        });
    }
});

// =====================================================
// LISTAR AGENDAMENTOS DO ESTABELECIMENTO
// Protegido
// =====================================================
router.get('/', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;

    try {
        const result = await pool.query(
            `SELECT
                a.*,
                p.nome AS profissional,
                s.nome AS servico,
                s.preco
             FROM agendamentos a
             JOIN profissionais p
                ON a.profissional_id = p.id
             JOIN servicos s
                ON a.servico_id = s.id
             WHERE a.estabelecimento_id = $1
             ORDER BY a.data_hora DESC`,
            [id]
        );

        return res.json(result.rows);

    } catch (err) {
        console.error(
            'ERRO AO LISTAR AGENDAMENTOS:',
            err.message
        );

        return res.status(500).json({
            erro: err.message
        });
    }
});

// =====================================================
// CANCELAR AGENDAMENTO
// =====================================================
router.patch('/:id/cancelar', autenticar, async (req, res) => {
    const { id: estabelecimentoId } = req.estabelecimento;

    try {
        const result = await pool.query(
            `UPDATE agendamentos
             SET status = 'cancelado'
             WHERE id = $1
               AND estabelecimento_id = $2
             RETURNING *`,
            [
                req.params.id,
                estabelecimentoId
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                erro: 'Agendamento não encontrado.'
            });
        }

        return res.json(result.rows[0]);

    } catch (err) {
        console.error(
            'ERRO AO CANCELAR AGENDAMENTO:',
            err.message
        );

        return res.status(500).json({
            erro: err.message
        });
    }
});

module.exports = router;
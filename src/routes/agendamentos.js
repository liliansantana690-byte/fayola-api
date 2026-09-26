const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const autenticar = require('../middleware/auth');
const { criarPagamentoPix } = require('../services/pagamento');
const { obterTokenValido } = require('../services/mercadoPagoOAuth');

const DEPOSIT_PERCENT = Number(process.env.DEPOSIT_PERCENT || 30);
const EXPIRATION_MINUTES = Number(process.env.DEPOSIT_EXPIRATION_MINUTES || 15);

// =====================================================
// CRIAR AGENDAMENTO
// Público — cliente agenda e recebe cobrança PIX do sinal
// =====================================================
router.post('/', async (req, res) => {
    const {
        estabelecimento_id,
        profissional_id,
        servico_id,
        cliente_nome,
        cliente_whatsapp,
        data_hora
    } = req.body;

    try {
        // -------------------------------------------------
        // VALIDAÇÃO DOS DADOS RECEBIDOS
        // -------------------------------------------------
        if (
            !estabelecimento_id ||
            !profissional_id ||
            !servico_id ||
            !cliente_nome ||
            !cliente_whatsapp ||
            !data_hora
        ) {
            return res.status(400).json({
                erro: 'Preencha todos os dados do agendamento.'
            });
        }

        // -------------------------------------------------
        // VALIDAÇÃO DA DATA/HORA
        // O frontend envia: 2026-09-26T18:00
        // -------------------------------------------------
        if (
            typeof data_hora !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data_hora)
        ) {
            return res.status(400).json({
                erro: 'Data e horário do agendamento inválidos.'
            });
        }

        // Converte:
        // 2026-09-26T18:00
        //
        // para:
        // 2026-09-26 18:00
        //
        // e força o PostgreSQL a tratar como timestamp.
        const dataHoraAgendamento = data_hora.replace('T', ' ');

        // -------------------------------------------------
        // VERIFICA SE A DATA REALMENTE É VÁLIDA
        // -------------------------------------------------
        const dataTeste = new Date(`${data_hora}:00`);

        if (Number.isNaN(dataTeste.getTime())) {
            return res.status(400).json({
                erro: 'A data e o horário informados são inválidos.'
            });
        }

        // -------------------------------------------------
        // BUSCAR ESTABELECIMENTO
        // -------------------------------------------------
        const estabResult = await pool.query(
            'SELECT * FROM estabelecimentos WHERE id = $1',
            [estabelecimento_id]
        );

        if (estabResult.rows.length === 0) {
            return res.status(400).json({
                erro: 'Estabelecimento não encontrado.'
            });
        }

        const estabelecimento = estabResult.rows[0];

        // -------------------------------------------------
        // VERIFICAR MERCADO PAGO
        // -------------------------------------------------
        if (!estabelecimento.mp_conectado) {
            return res.status(400).json({
                erro: 'Este estabelecimento ainda não configurou o recebimento via Pix. Peça pro dono conectar o Mercado Pago no painel.'
            });
        }

        // -------------------------------------------------
        // BUSCAR SERVIÇO
        // -------------------------------------------------
        const servicoResult = await pool.query(
            'SELECT preco, nome FROM servicos WHERE id = $1',
            [servico_id]
        );

        if (servicoResult.rows.length === 0) {
            return res.status(400).json({
                erro: 'Serviço não encontrado.'
            });
        }

        const servico = servicoResult.rows[0];

        // -------------------------------------------------
        // CALCULAR PREÇO
        // -------------------------------------------------
        const preco = parseFloat(servico.preco);

        if (!Number.isFinite(preco) || preco <= 0) {
            return res.status(400).json({
                erro: 'O preço deste serviço é inválido.'
            });
        }

        const sinalValor = Number(
            ((preco * DEPOSIT_PERCENT) / 100).toFixed(2)
        );

        if (!Number.isFinite(sinalValor) || sinalValor <= 0) {
            return res.status(400).json({
                erro: 'Não foi possível calcular o valor do sinal.'
            });
        }

        // -------------------------------------------------
        // DATA DE EXPIRAÇÃO DO PIX
        // -------------------------------------------------
        const expiraEm = new Date(
            Date.now() + EXPIRATION_MINUTES * 60 * 1000
        );

        // -------------------------------------------------
        // DEBUG — DATA RECEBIDA
        // -------------------------------------------------
        console.log('DEBUG AGENDAMENTO:', {
            estabelecimento_id,
            profissional_id,
            servico_id,
            cliente_nome,
            cliente_whatsapp,
            data_hora,
            dataHoraAgendamento,
            tipo_data_hora: typeof data_hora,
            sinalValor
        });

        // -------------------------------------------------
        // CRIAR AGENDAMENTO NO BANCO
        // -------------------------------------------------
        const result = await pool.query(
            `INSERT INTO agendamentos
                (
                    estabelecimento_id,
                    profissional_id,
                    servico_id,
                    cliente_nome,
                    cliente_whatsapp,
                    data_hora,
                    status,
                    sinal_valor,
                    sinal_status,
                    expira_em
                )
             VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6::timestamp,
                    'aguardando_pagamento',
                    $7,
                    'pendente',
                    $8
                )
             RETURNING *`,
            [
                estabelecimento_id,
                profissional_id,
                servico_id,
                cliente_nome,
                cliente_whatsapp,
                dataHoraAgendamento,
                sinalValor,
                expiraEm
            ]
        );

        const agendamento = result.rows[0];

        // -------------------------------------------------
        // OBTER TOKEN DO MERCADO PAGO
        // -------------------------------------------------
        const accessToken = await obterTokenValido(
            pool,
            estabelecimento
        );

        // -------------------------------------------------
        // CRIAR PAGAMENTO PIX
        // -------------------------------------------------
        const pix = await criarPagamentoPix({
            accessToken,
            valor: sinalValor,
            descricao: `Sinal - ${servico.nome}`,
            agendamentoId: agendamento.id,
            clienteWhatsapp: cliente_whatsapp
        });

        // -------------------------------------------------
        // SALVAR ID DO PAGAMENTO
        // -------------------------------------------------
        await pool.query(
            `UPDATE agendamentos
             SET mp_payment_id = $1
             WHERE id = $2`,
            [pix.mp_payment_id, agendamento.id]
        );

        // -------------------------------------------------
        // RESPONDER PARA O FRONTEND
        // -------------------------------------------------
        return res.status(201).json({
            agendamento,
            pagamento: {
                qr_code: pix.qr_code,
                qr_code_base64: pix.qr_code_base64,
                expira_em: expiraEm
            }
        });

    } catch (err) {
        console.error(
            'ERRO AO CRIAR AGENDAMENTO:',
            err.response?.data || err.message
        );

        return res.status(400).json({
            erro:
                err.response?.data?.message ||
                err.response?.data?.error ||
                err.message ||
                'Erro ao criar agendamento.'
        });
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
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/db');
const { normalizarDataHora, validarHorarioDisponivel } = require('../utils/disponibilidade');
const autenticar = require('../middleware/auth');
const autenticarProfissional = require('../middleware/authProfissional');
const { criarPagamentoPix } = require('../services/pagamento');
const { obterTokenValido } = require('../services/mercadoPagoOAuth');

const CAMPOS_ANAMNESE = [
    'alergias', 'condicoes_sanguineas', 'condicao_cardiaca', 'gravidez_amamentacao',
    'pele_cicatrizacao', 'medicamentos', 'reacao_anterior', 'alcool_drogas', 'outra_condicao'
];
const VERSAO_CONSENTIMENTO_ANAMNESE = 'anamnese-tattoo-v1';

const EXPIRATION_MINUTES = Number(process.env.DEPOSIT_EXPIRATION_MINUTES) || 15;

// Cliente envia o pedido de tattoo (público)
router.post('/', async (req, res) => {
    const {
        estabelecimento_id, profissional_id, cliente_nome, cliente_whatsapp,
        descricao, estilo, tamanho_aproximado, local_corpo, referencia_url, observacoes,
        respostas_anamnese, consentimento_anamnese, versao_consentimento_anamnese
    } = req.body;

    const dbClient = await pool.connect();
    try {
        if (!descricao || !cliente_nome || !cliente_whatsapp) {
            return res.status(400).json({ erro: 'Descrição, nome e WhatsApp são obrigatórios' });
        }

        if (consentimento_anamnese !== true || versao_consentimento_anamnese !== VERSAO_CONSENTIMENTO_ANAMNESE) {
            return res.status(400).json({ erro: 'O consentimento para o uso das informações de saúde é obrigatório' });
        }
        if (!profissional_id) {
            return res.status(400).json({ erro: 'Selecione o tatuador responsável pelo pedido' });
        }

        const respostasValidadas = {};
        for (const campo of CAMPOS_ANAMNESE) {
            const resposta = respostas_anamnese?.[campo];
            if (!resposta || !['sim', 'nao'].includes(resposta.resposta)) {
                return res.status(400).json({ erro: 'Responda todas as perguntas da ficha de saúde' });
            }
            respostasValidadas[campo] = {
                resposta: resposta.resposta,
                detalhe: typeof resposta.detalhe === 'string' ? resposta.detalhe.trim().slice(0, 1000) : ''
            };
        }

        const estabelecimento = await dbClient.query('SELECT id FROM estabelecimentos WHERE id = $1', [estabelecimento_id]);
        if (estabelecimento.rows.length === 0) {
            return res.status(400).json({ erro: 'Estabelecimento não encontrado' });
        }
        const profissional = await dbClient.query(
            'SELECT id FROM profissionais WHERE id = $1 AND estabelecimento_id = $2',
            [profissional_id, estabelecimento_id]
        );
        if (profissional.rows.length === 0) {
            return res.status(400).json({ erro: 'Tatuador inválido para este estabelecimento' });
        }

        const tokenAcesso = crypto.randomBytes(24).toString('hex');

        await dbClient.query('BEGIN');
        const result = await dbClient.query(
            `INSERT INTO pedidos_tattoo
                (estabelecimento_id, profissional_id, cliente_nome, cliente_whatsapp,
                 descricao, estilo, tamanho_aproximado, local_corpo, referencia_url, observacoes, token_acesso)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                estabelecimento_id, profissional_id || null, cliente_nome, cliente_whatsapp,
                descricao, estilo || null, tamanho_aproximado || null, local_corpo || null,
                referencia_url || null, observacoes || null, tokenAcesso
            ]
        );

        await dbClient.query(
            `INSERT INTO pedidos_tattoo_anamnese
                (pedido_id, respostas, consentimento, consentimento_versao, consentimento_em)
             VALUES ($1, $2::jsonb, true, $3, NOW())`,
            [result.rows[0].id, JSON.stringify(respostasValidadas), VERSAO_CONSENTIMENTO_ANAMNESE]
        );
        await dbClient.query('COMMIT');

        const pedido = result.rows[0];
        res.status(201).json({
            id: pedido.id,
            estabelecimento_id: pedido.estabelecimento_id,
            profissional_id: pedido.profissional_id,
            cliente_nome: pedido.cliente_nome,
            status: pedido.status,
            token_acesso: pedido.token_acesso
        });
    } catch (err) {
        await dbClient.query('ROLLBACK').catch(function() {});
        console.error('Erro ao salvar pedido e ficha de saúde:', err.message);
        res.status(400).json({ erro: err.message });
    } finally {
        dbClient.release();
    }
});

// Status do pedido (público — identificado pelo token secreto, não pelo ID numérico)
router.get('/:token/status', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, estabelecimento_id, profissional_id, status, sinal_status,
                    valor_tattoo, valor_sinal, duracao_minutos, pix_expira_em, data_hora
             FROM pedidos_tattoo WHERE token_acesso = $1`,
            [req.params.token]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Gerar o PIX do sinal — identificado pelo token secreto
router.post('/:token/gerar-pix', async (req, res) => {
    try {
        const pedidoResult = await pool.query('SELECT * FROM pedidos_tattoo WHERE token_acesso = $1', [req.params.token]);
        if (pedidoResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }
        const pedido = pedidoResult.rows[0];

        if (pedido.status !== 'orcamento_enviado') {
            return res.status(400).json({ erro: 'Este pedido ainda não tem um orçamento definido pelo tatuador' });
        }
        if (pedido.sinal_status === 'pago') {
            return res.status(400).json({ erro: 'O sinal deste pedido já foi pago' });
        }

        const estabResult = await pool.query('SELECT * FROM estabelecimentos WHERE id = $1', [pedido.estabelecimento_id]);
        const estabelecimento = estabResult.rows[0];
        if (!estabelecimento.mp_conectado) {
            return res.status(400).json({ erro: 'Este estabelecimento ainda não configurou o recebimento via Pix' });
        }

        const accessToken = await obterTokenValido(pool, estabelecimento);
        const expiraEm = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000);

        const pix = await criarPagamentoPix({
            accessToken,
            valor: parseFloat(pedido.valor_sinal),
            descricao: 'Sinal - Tattoo',
            agendamentoId: `tattoo-${pedido.id}`,
            clienteWhatsapp: pedido.cliente_whatsapp
        });

        await pool.query(
            `UPDATE pedidos_tattoo SET mp_payment_id = $1, pix_expira_em = $2 WHERE id = $3`,
            [pix.mp_payment_id, expiraEm, pedido.id]
        );

        res.json({
            qr_code: pix.qr_code,
            qr_code_base64: pix.qr_code_base64,
            expira_em: expiraEm
        });
    } catch (err) {
        console.error('ERRO AO GERAR PIX DO PEDIDO DE TATTOO:', err.response?.data || err.message);
        res.status(400).json({ erro: err.response?.data?.message || err.message });
    }
});

// Cliente escolhe o horário depois de pagar o sinal — identificado pelo token secreto
router.patch('/:token/confirmar-horario', async (req, res) => {
    const dataHora = normalizarDataHora(req.body.data_hora);
    let client;
    try {
        if (!dataHora) return res.status(400).json({ erro: 'Informe uma data e horário válidos.' });
        const pedidoResult = await pool.query('SELECT * FROM pedidos_tattoo WHERE token_acesso = $1', [req.params.token]);
        if (!pedidoResult.rows.length) return res.status(404).json({ erro: 'Pedido não encontrado' });
        const pedidoInicial = pedidoResult.rows[0];
        if (pedidoInicial.sinal_status !== 'pago') return res.status(400).json({ erro: 'O sinal ainda não foi pago' });
        if (!pedidoInicial.profissional_id) return res.status(400).json({ erro: 'Este pedido ainda não tem um profissional atribuído.' });

        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [pedidoInicial.profissional_id, dataHora.slice(0, 10)]);
        const pedidoAtualResult = await client.query('SELECT * FROM pedidos_tattoo WHERE id = $1 FOR UPDATE', [pedidoInicial.id]);
        const pedido = pedidoAtualResult.rows[0];
        if (pedido.sinal_status !== 'pago') throw Object.assign(new Error('O sinal ainda não foi pago'), { statusCode: 400 });
        const duracaoMinutos = pedido.duracao_minutos || 120;
        await validarHorarioDisponivel(client, pedido.profissional_id, dataHora, duracaoMinutos, { excluirPedidoTattooId: pedido.id });
        const result = await client.query(
            "UPDATE pedidos_tattoo SET data_hora = $1::timestamp, status = 'convertido_agendamento', atualizado_em = NOW() WHERE id = $2 RETURNING *",
            [dataHora.replace('T', ' '), pedido.id]
        );
        await client.query('COMMIT');
        client.release();
        client = null;
        return res.json(result.rows[0]);
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) { /* conexão pode já ter encerrado */ }
            client.release();
        }
        return res.status(err.statusCode || 500).json({ erro: err.message || 'Não foi possível confirmar o horário.' });
    }
});

// Cliente escolhe o horário depois de pagar o sinal — identificado pelo token secreto
// Listar pedidos do estabelecimento (dono)
router.get('/', autenticar, async (req, res) => {
    const { id } = req.estabelecimento;
    try {
        const result = await pool.query(
            `SELECT pt.*, p.nome as profissional
             FROM pedidos_tattoo pt
             LEFT JOIN profissionais p ON pt.profissional_id = p.id
             WHERE pt.estabelecimento_id = $1
             ORDER BY pt.criado_em DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Listar pedidos do profissional logado
router.get('/meus-pedidos', autenticarProfissional, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT pt.*,
                    a.respostas AS anamnese_respostas,
                    a.consentimento,
                    a.consentimento_versao,
                    a.consentimento_em
             FROM pedidos_tattoo pt
             LEFT JOIN pedidos_tattoo_anamnese a ON a.pedido_id = pt.id
             WHERE pt.profissional_id = $1
             ORDER BY pt.criado_em DESC`,
            [req.profissional.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Profissional define o orçamento (valor da tattoo + sinal + duração da sessão). Envio ao cliente é feito manualmente pelo botão de copiar.
router.patch('/:id/orcamento', autenticarProfissional, async (req, res) => {
    const { valor_tattoo, valor_sinal, duracao_minutos } = req.body;
    try {
        if (!valor_tattoo || !valor_sinal) {
            return res.status(400).json({ erro: 'Informe o valor da tattoo e do sinal' });
        }

        const result = await pool.query(
            `UPDATE pedidos_tattoo
             SET valor_tattoo = $1, valor_sinal = $2, duracao_minutos = $3, status = 'orcamento_enviado', atualizado_em = NOW()
             WHERE id = $4 AND profissional_id = $5
             RETURNING *`,
            [valor_tattoo, valor_sinal, duracao_minutos || 120, req.params.id, req.profissional.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Dono exclui um pedido que ainda não teve sinal pago
router.delete('/:id', autenticar, async (req, res) => {
    const { id: estabelecimentoId } = req.estabelecimento;
    try {
        const result = await pool.query(
            `DELETE FROM pedidos_tattoo
             WHERE id = $1 AND estabelecimento_id = $2 AND sinal_status != 'pago'
             RETURNING id`,
            [req.params.id, estabelecimentoId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado ou já pago (não pode ser excluído)' });
        }
        res.json({ mensagem: 'Pedido excluído' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

module.exports = router;

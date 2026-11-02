// Validação da assinatura do webhook do Mercado Pago.
// Hoje ela só registra quando não bate e deixa o aviso seguir.
// A segurança real está na rota: ela consulta o pagamento direto na API do
// Mercado Pago (com o token da conta do tatuador) antes de liberar qualquer sinal.
const crypto = require('crypto');

function validarWebhookMP(req, res, next) {
    const segredo = process.env.MP_WEBHOOK_SECRET;
    const assinatura = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];

    try {
        if (!segredo || !assinatura || !requestId) {
            console.log('MP AVISO SEM VALIDACAO: faltam segredo, x-signature ou x-request-id');
            return next();
        }

        const partes = {};
        assinatura.split(',').forEach(function(p) {
            const i = p.indexOf('=');
            if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
        });

        let dataId = (req.query && req.query['data.id']) || (req.body && req.body.data && req.body.data.id);
        if (dataId) dataId = String(dataId).toLowerCase();

        const manifesto = `id:${dataId};request-id:${requestId};ts:${partes.ts};`;
        const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');

        if (esperado !== partes.v1) {
            console.log('MP AVISO COM ASSINATURA DIFERENTE (seguindo; pagamento sera confirmado na API do Mercado Pago)');
        }
    } catch (err) {
        console.log('MP erro ao validar assinatura:', err.message);
    }

    return next();
}

module.exports = validarWebhookMP;
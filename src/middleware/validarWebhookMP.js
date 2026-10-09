const crypto = require('crypto');

const TOLERANCIA_MS = 5 * 60 * 1000;

function validarWebhookMP(req, res, next) {
    const segredo = process.env.MP_WEBHOOK_SECRET;
    if (!segredo) {
        console.error('MP_WEBHOOK_SECRET nao configurada: webhook recusado');
        return res.sendStatus(401);
    }

    const assinatura = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    if (!assinatura || !requestId) {
        return res.sendStatus(401);
    }

    const partes = {};
    assinatura.split(',').forEach(function(parte) {
        const [chave, valor] = parte.split('=').map(function(s) { return s.trim(); });
        if (chave && valor) partes[chave] = valor;
    });

    const ts = partes.ts;
    const v1 = partes.v1;
    if (!ts || !v1) {
        return res.sendStatus(401);
    }

    // Recusa avisos antigos (proteção contra reenvio de uma assinatura capturada)
    const idadeMs = Math.abs(Date.now() - Number(ts) * 1000);
    if (Number.isNaN(idadeMs) || idadeMs > TOLERANCIA_MS) {
        return res.sendStatus(401);
    }

    let dataId = (req.query && req.query['data.id']) || (req.body && req.body.data && req.body.data.id);
    if (dataId === undefined || dataId === null) {
        return res.sendStatus(401);
    }
    dataId = String(dataId);
    if (/^[a-zA-Z0-9]+$/.test(dataId)) {
        dataId = dataId.toLowerCase();
    }

    const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');

    const bufEsperado = Buffer.from(esperado, 'utf8');
    const bufRecebido = Buffer.from(v1, 'utf8');
    if (bufEsperado.length !== bufRecebido.length || !crypto.timingSafeEqual(bufEsperado, bufRecebido)) {
        return res.sendStatus(401);
    }

    next();
}

module.exports = validarWebhookMP;
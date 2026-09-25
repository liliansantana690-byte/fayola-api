const { MercadoPagoConfig, Payment } = require('mercadopago');

function criarClientePix(accessToken) {
    const client = new MercadoPagoConfig({ accessToken });
    return new Payment(client);
}

/**
 * Cria uma cobrança PIX usando o access_token DO ESTABELECIMENTO (não um token fixo da plataforma).
 * O dinheiro cai direto na conta Mercado Pago do dono do salão/barbearia.
 */
async function criarPagamentoPix({ accessToken, valor, descricao, agendamentoId, clienteWhatsapp }) {
    const paymentClient = criarClientePix(accessToken);
    const emailPagador = `cliente${clienteWhatsapp}@fayola.app`;

    const resultado = await paymentClient.create({
        body: {
            transaction_amount: Number(valor.toFixed(2)),
            description: descricao,
            payment_method_id: 'pix',
            payer: { email: emailPagador },
            external_reference: String(agendamentoId),
            notification_url: `${process.env.APP_API_URL}/api/pagamentos/webhook`
        }
    });

    const dadosTransacao = resultado.point_of_interaction.transaction_data;

    return {
        mp_payment_id: resultado.id,
        status: resultado.status,
        qr_code: dadosTransacao.qr_code,
        qr_code_base64: dadosTransacao.qr_code_base64
    };
}

async function consultarPagamento(accessToken, paymentId) {
    const paymentClient = criarClientePix(accessToken);
    return paymentClient.get({ id: paymentId });
}

module.exports = { criarPagamentoPix, consultarPagamento };